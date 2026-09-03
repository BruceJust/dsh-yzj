/**
 * Contact-domain tools: whoami, directory search, and user lookups. All
 * read-only. `yzj_whoami` doubles as the identity probe the guard's re-pin and
 * the channel's account selection both depend on.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  asRecord, asString, clipJson, counted, runValue, titled, yzjToolOutput,
  listOf,
  type YzjToolBudget,
} from './shared.ts'

function contactLine(record: unknown): string {
  const user = asRecord(record)
  const name = asString(user.name)
  const openId = asString(user.openId ?? user.oId)
  const department = asString(user.department ?? user.fulldepartment)
  const jobTitle = asString(user.jobTitle)
  const jobNo = asString(user.jobNo)
  const parts = [name === '' ? openId : name]
  if (department !== '') parts.push(department)
  if (jobTitle !== '') parts.push(jobTitle)
  if (jobNo !== '') parts.push(`工号 ${jobNo}`)
  if (openId !== '' && openId !== name) parts.push(`<${openId}>`)
  return parts.join(' · ')
}

/** The user array from either a bare array or an object payload. */
function usersOf(json: unknown): unknown[] {
  return listOf(json)
}

/** Register the contact-domain tools. Returns the disposer for all of them. */
export function applyContactTools(ctx: Context, budget: YzjToolBudget): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'yzj_whoami',
    description: 'Return the current yzj-cli login user: name, openId, department, job title, and job number.',
    presentCall: () => titled('确认自己是谁', 'read'),
    parameters: {},
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute() {
      /*
        yzj-cli 0.1.6 起有原生的 `whoami`（个人授权身份），比 `contact user get` 取首条多
        两样只有它给的事实：`tokenStatus` 与 `expiresAt`。**登录快过期**此前只能以一串
        莫名失败的形态被人发现——「看不了不等于没有」那条纪律在这里有了可读的原料。
        回包形状 `{ data: {...一个人} }`；桥接层若已剥掉 data，顶层就是它。两种都认。
      */
      return runValue(ctx, budget, 'whoami', ['whoami'], (json) => {
        const root = asRecord(json)
        const me = asRecord(root.data ?? root)
        const users = asString(me.openId) !== '' ? [me] : usersOf(json)
        const lines = users.map(contactLine)
        const tokenStatus = asString(me.tokenStatus)
        const expiresAt = asString(me.expiresAt)
        if (tokenStatus !== '') {
          lines.push(`登录态：${tokenStatus}${expiresAt === '' ? '' : ` · 到期 ${expiresAt}`}`)
        }
        return {
          content: lines.length === 0 ? '(no user info)' : lines.join('\n'),
          data: {
            record: clipJson(asRecord(users[0]), { maxChars: budget.maxMetaChars }),
            users: clipJson(users, { maxChars: budget.maxMetaChars }),
            ...(tokenStatus === '' ? {} : { tokenStatus }),
            ...(expiresAt === '' ? {} : { expiresAt }),
          },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_contact_search',
    description: 'Search the Yunzhijia contact directory by keyword (name etc.). Returns one line per match with openId for follow-up get/send calls.',
    presentCall: args => titled(`在通讯录里找「${args.keyword}」`, 'search'),
    parameters: {
      keyword: { type: 'string', required: true, description: 'Search keyword (a name or other directory term).' },
      orgId: { type: 'string', description: 'Optional org/department id to scope the search.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['contact', 'user', 'search', '--keyword', args.keyword]
      if (args.orgId !== undefined) command.push('--org-id', args.orgId)
      return runValue(ctx, budget, 'contact user search', command, (json) => {
        const users = usersOf(json)
        const lines = users.map(contactLine)
        return {
          content: lines.length === 0 ? '(no matches)' : lines.join('\n'),
          data: { list: clipJson(users, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_contact_get',
    description: 'Fetch Yunzhijia user details by openId (repeatable); without openIds returns the current login user.',
    presentCall: args => titled(counted('取同事资料', args.openIds), 'read'),
    parameters: {
      openIds: { type: 'array', items: { type: 'string' }, description: 'One or more openIds to fetch; omit to fetch the current user.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const openIds = args.openIds ?? []
      if (openIds.some(id => id.trim() === '')) {
        throw new Error('yzj_contact_get: openIds must not contain empty strings')
      }
      const command = ['contact', 'user', 'get']
      for (const id of openIds) command.push('--open-id', id)
      return runValue(ctx, budget, 'contact user get', command, (json) => {
        const users = usersOf(json)
        const lines = users.map(contactLine)
        return {
          content: lines.length === 0 ? '(no user info)' : lines.join('\n'),
          data: { list: clipJson(users, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
