/**
 * IM-domain tools: sending, history, cross-conversation search, and recent sessions.
 *
 * Sending is the one tool in this family that speaks OUTWARD under the
 * operator's own name, so it validates the CLI's mutually exclusive target and
 * msg-type combinations itself rather than letting a malformed call reach the
 * wire — and it is gated by the guard on top of that.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  asArray, asNumber, asRecord, asString, clipJson, named, runValue, titled, yzjToolOutput,
  type YzjToolBudget,
} from './shared.ts'

/** Format "YYYY-MM-DD HH:mm:ss.SSS" as `MM-DD HH:mm`. */
function shortTime(text: unknown): string {
  const value = asString(text)
  return value.length >= 16 ? value.slice(5, 16) : value
}

function messageLine(record: unknown): string {
  const message = asRecord(record)
  const content = asString(message.content)
  const from = asString(message.fromOpenId)
  const time = shortTime(message.sendTime)
  const msgType = asString(message.msgType)
  const replySummary = asString(asRecord(message.param).replySummary)
  const parts: string[] = []
  if (time !== '') parts.push(`[${time}]`)
  parts.push(from === '' ? '(unknown sender)' : from)
  const body = content === '' ? `(${msgType === '' ? 'message' : msgType})` : content
  parts.push(`${body}${replySummary === '' ? '' : ` ↳${replySummary}`}`)
  const msgId = asString(message.msgId)
  if (msgId !== '') parts.push(`<${msgId}>`)
  return parts.join(' ')
}

function groupLine(record: unknown): string {
  const group = asRecord(record)
  const name = asString(group.groupName)
  const id = asString(group.groupId)
  const groupType = asNumber(group.groupType)
  const unread = asNumber(group.unreadCount)
  const lastContent = asString(asRecord(group.lastMsg).content)
  const parts = [name === '' ? id : name]
  if (groupType !== undefined) parts.push(`类型${String(groupType)}`)
  if (unread !== undefined && unread > 0) parts.push(`未读 ${String(unread)}`)
  if (lastContent !== '') parts.push(`最近: ${lastContent.replace(/\s+/gu, ' ').slice(0, 40)}`)
  if (id !== '' && id !== name) parts.push(`(${id})`)
  return parts.join(' · ')
}

/** Register the im-domain tools. Returns the disposer for all of them. */
export function applyImTools(ctx: Context, budget: YzjToolBudget): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'yzj_im_message_send',
    description: 'Send an IM message to a group or direct chat. Exactly one of groupId / toOpenId; msg-type text|richText require content (file requires fileId). @ mentions need at-open-id per @姓名 in content and at-all per @all (group chats only). Reply uses replyMsgId with text/richText. Requires user confirmation before dispatch.',
    presentCall: args => titled(args.groupId === undefined ? '发一条私聊消息' : '往群里发一条消息', 'edit'),
    parameters: {
      groupId: { type: 'string', description: 'Target group or chat session id; mutually exclusive with toOpenId.' },
      toOpenId: { type: 'string', description: 'Direct-chat target openId; mutually exclusive with groupId.' },
      msgType: { type: 'string', required: true, enum: ['text', 'file', 'richText'], description: 'text or richText need content; file needs fileId.' },
      content: { type: 'string', description: 'Message body; required for text/richText. @all and @姓名 must be standalone fragments ("@all 请关注").' },
      fileId: { type: 'string', description: 'Uploaded file id (from yzj_file_upload); required for msg-type file.' },
      replyMsgId: { type: 'string', description: 'Reply-to message id; text/richText only.' },
      atOpenIds: { type: 'array', items: { type: 'string' }, description: 'One per @姓名 in content, in order; group chats only.' },
      atAll: { type: 'boolean', description: 'True when content contains @all (the user must have explicitly asked for @all).' },
      images: { type: 'array', items: { type: 'string' }, description: 'File ids for [图片] placeholders in richText content.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      if ((args.groupId === undefined) === (args.toOpenId === undefined)) {
        throw new Error('yzj_im_message_send: exactly one of groupId or toOpenId is required')
      }
      if (args.msgType === 'file') {
        if (args.fileId === undefined) throw new Error('yzj_im_message_send: msg-type file requires fileId')
        if (args.content !== undefined || args.replyMsgId !== undefined
          || args.atAll === true || (args.atOpenIds ?? []).length > 0) {
          throw new Error('yzj_im_message_send: msg-type file does not support content, reply, or @ mentions')
        }
      } else if (args.content === undefined || args.content.trim() === '') {
        throw new Error('yzj_im_message_send: text/richText require non-empty content')
      }
      if (args.msgType !== 'richText' && (args.images ?? []).length > 0) {
        throw new Error('yzj_im_message_send: images are only supported for msg-type richText')
      }
      const command = ['im', 'message', 'send', '--msg-type', args.msgType]
      if (args.groupId !== undefined) command.push('--group-id', args.groupId)
      if (args.toOpenId !== undefined) command.push('--to-open-id', args.toOpenId)
      if (args.content !== undefined) command.push('--content', args.content)
      if (args.fileId !== undefined) command.push('--file-id', args.fileId)
      if (args.replyMsgId !== undefined) command.push('--reply-msg-id', args.replyMsgId)
      for (const id of args.atOpenIds ?? []) command.push('--at-open-id', id)
      if (args.atAll === true) command.push('--at-all')
      for (const image of args.images ?? []) command.push('--image', image)
      return runValue(ctx, budget, 'im message send', command, (json) => {
        const payload = asRecord(json)
        const msgId = asString(payload.msgId ?? payload.id)
        return {
          content: `sent ${args.msgType} message${msgId === '' ? '' : ` (${msgId})`}`,
          data: { payload: clipJson(payload, { maxChars: budget.maxMetaChars }), msgId },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_im_message_list',
    description: 'List chat history of a group/session: newest (default) or anchored old/new around msgId. Returns one line per message with time, sender, content, and msgId.',
    presentCall: () => titled('读群里的消息', 'read'),
    parameters: {
      groupId: { type: 'string', required: true, description: 'Group or chat session id.' },
      type: { type: 'string', enum: ['newest', 'old', 'new'], description: 'newest fetches the latest; old/new page around msgId.' },
      msgId: { type: 'string', description: 'Anchor message id; required for type old/new.' },
      limit: { type: 'number', description: 'Message count; default 20, range 1-20 (CLI cap).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['im', 'message', 'list', '--group-id', args.groupId]
      if (args.type !== undefined) command.push('--type', args.type)
      if (args.msgId !== undefined) command.push('--msg-id', args.msgId)
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
          throw new Error('yzj_im_message_list: limit must be an integer between 1 and 20 (CLI cap)')
        }
        command.push('--limit', String(args.limit))
      }
      return runValue(ctx, budget, 'im message list', command, (json) => {
        const root = asRecord(json)
        const messages = asArray(root.list)
        const more = root.more === true
        const lines = messages.map(messageLine)
        return {
          content: [
            ...(lines.length === 0 ? ['(no messages)'] : lines),
            ...(more ? ['(more messages available)'] : []),
          ].join('\n'),
          data: { list: clipJson(messages, { maxChars: budget.maxMetaChars }), more },
        }
      })
    },
  }))

  /**
   * 跨会话内容检索 —— yzj-cli 0.1.6 起平台有了这一面 (`im message search`).
   *
   * 分册接缝⑦此前的事实前提是「主册 §7 没有跨会话的内容搜索面（`im group search`
   * 是群名录搜索）」——**这个前提从 0.1.6 起不再成立**：平台按群聚合返回当前用户全部
   * 可见范围内的匹配消息。这里先落成 agent 的**读工具**（F-read，可见域本含）；桌面
   * 搜索面要不要落座是主册 §7 的产品裁决，不在这个工具里越权。
   *
   * 与 `yzj_im_message_list` 同一条纪律：读是可见域内的合法读，**说**才受听众集合
   * 约束——群回合里从别的群搜到的话，不得引进这个群。读侧要不要按听众集合收窄，
   * 两个工具应同一裁决（目前 list 也不收窄），记在能力盘点里待裁。
   */
  register(defineTool({
    name: 'yzj_im_message_search',
    description: 'Search chat history by keyword across every group/chat the login user can see (platform full-text search, grouped by conversation). Optional filters: groupId, senderOpenId, notifyToOpenId (who was @-mentioned), start/end (date, datetime or unix timestamp). Returns one line per matched message with group, time, sender, content and msgId. In a group turn, never quote messages found in OTHER conversations into this one.',
    presentCall: args => titled(`搜聊天记录「${String(args.keyword ?? '')}」`, 'search'),
    parameters: {
      keyword: { type: 'string', required: true, description: 'Search keyword.' },
      groupId: { type: 'string', description: 'Restrict to one group or chat session id.' },
      senderOpenId: { type: 'string', description: 'Only messages sent by this openId.' },
      notifyToOpenId: { type: 'string', description: 'Only messages that @-mention this openId.' },
      start: { type: 'string', description: 'Range start: a date, a datetime, or a unix timestamp.' },
      end: { type: 'string', description: 'Range end; same forms as start.' },
      limit: { type: 'number', description: 'Per-page count; default 10, must be >= 1.' },
      page: { type: 'number', description: 'Page number; default 1, must be >= 1.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.keyword.trim() === '') throw new Error('yzj_im_message_search: keyword must not be empty')
      const command = ['im', 'message', 'search', '--keyword', args.keyword]
      if (args.groupId !== undefined) command.push('--group-id', args.groupId)
      if (args.senderOpenId !== undefined) command.push('--sender-open-id', args.senderOpenId)
      if (args.notifyToOpenId !== undefined) command.push('--notify-to-open-id', args.notifyToOpenId)
      if (args.start !== undefined) command.push('--start', args.start)
      if (args.end !== undefined) command.push('--end', args.end)
      for (const [flag, value] of [['--limit', args.limit], ['--page', args.page]] as const) {
        if (value === undefined) continue
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`yzj_im_message_search: ${flag.slice(2)} must be an integer >= 1`)
        }
        command.push(flag, String(value))
      }
      return runValue(ctx, budget, 'im message search', command, (json) => {
        const root = asRecord(json)
        // 0.1.6 回 `{ data: { count, list } }`；桥接层若已剥掉 data，顶层就是它。两种都认。
        const body = asRecord(root.data ?? root)
        const groups = asArray(body.list)
        const lines: string[] = []
        for (const entry of groups) {
          const item = asRecord(entry)
          const group = asRecord(item.group)
          const name = asString(group.groupName)
          const id = asString(group.groupId)
          const matched = asNumber(item.matchedMessageCount)
          const header = [`## ${name === '' ? id : name}`]
          if (id !== '' && id !== name) header.push(`(${id})`)
          if (matched !== undefined) header.push(`· 命中 ${String(matched)} 条`)
          if (item.hasMoreMessages === true) header.push('· 还有更多')
          lines.push(header.join(' '))
          for (const wrapped of asArray(item.messages)) {
            lines.push(messageLine(asRecord(wrapped).message ?? wrapped))
          }
        }
        return {
          content: lines.length === 0 ? '(没有搜到消息)' : lines.join('\n'),
          data: {
            count: asNumber(body.count) ?? groups.length,
            list: clipJson(groups, { maxChars: budget.maxMetaChars }),
          },
        }
      })
    },
  }))

  /**
   * 建一个群 = **创造一个新的听众集合** (设计 v4.18).
   *
   * 这套系统里最贵的一个参数一直是「谁听得见」。此前 agent 只能在**已有**的听众集合里
   * 挑一个（而且「场所人选不推导」——那是人的社交决策）；0.1.4 之后它能凭空造一个出来。
   * 造一个听众集合，比在现成的里面挑一个**更需要人批**，所以这个工具在 guard 里是
   * **强确认**，agent 只有提议权。
   *
   * 摩擦刀在这里的用法值得写下来：平台让建群变容易了，而**建群的难度本来在保护听众
   * 集合**——所以设计的动向是把这个新能力放进确认门，不是拥抱这份便利。
   *
   * **结果未知时不要自动重试。** 超时或读不到回包时，这条命令**可能已经成功了**；再发
   * 一次的代价是组织里凭空多一个群、多一批被拉进去的人。先用 `yzj_im_group_recent`
   * 核对（刚建的群排在最前），确认没建成再议。
   */
  register(defineTool({
    name: 'yzj_im_group_create',
    description: 'Propose creating a new Yunzhijia group chat. This CREATES A NEW AUDIENCE — who can hear everything said there from now on — so it always goes to the operator for confirmation; you only ever propose it. Members are 2-10 openIds NOT counting the creator (use yzj_contact_search to resolve names). The creator is the logged-in operator, who becomes the owner. IMPORTANT: if this call times out or the result is unreadable, the group MAY ALREADY EXIST — never call it again to retry. Check with yzj_im_group_recent first (a just-created group sorts first) and report what you found.',
    presentCall: args => titled(named('新建群组', args.name), 'edit'),
    parameters: {
      name: { type: 'string', required: true, description: 'Group name.' },
      memberOpenIds: {
        type: 'array',
        required: true,
        description: 'Initial member openIds, 2-10, excluding the creator.',
        items: { type: 'string' },
      },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      /*
        人数在这里挡一次，而不是让 CLI 去挡。

        平台的边界是「不含创建人，至少 2 人、最多 10 人」。让一个越界的调用打到线上，
        换回来的是一句平台的错误码——而这个工具的每一次调用前面都站着一次**人的签字**，
        把人问过了再失败，是最贵的一种失败。
      */
      const members = args.memberOpenIds.filter(id => id.trim() !== '')
      if (members.length < 2 || members.length > 10) {
        throw new Error(
          `yzj_im_group_create: 初始成员要 2-10 人（不含你自己），这次给了 ${String(members.length)} 人`,
        )
      }
      const command = ['im', 'group', 'create', '--name', args.name, '--member-open-id', ...members]
      return runValue(ctx, budget, 'im group create', command, (json) => {
        const group = asRecord(json)
        const id = asString(group.groupId)
        return {
          content: `已建群「${args.name}」${id === '' ? '' : ` (${id})`}`
            + `\n注意：新群里 agent **默认不在岗**——没有人显式接入之前，发到这个群的登记卡`
            + `不会有回执被接收。`,
          data: { record: clipJson(group, { maxChars: budget.maxMetaChars }), groupId: id },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_im_group_search',
    description: 'Search groups visible to the operator by keyword. NOTE: on some tenants this endpoint answers 服务内部异常 — when it does, fall back to yzj_im_group_recent and page through it, and say plainly that search was unavailable rather than reporting "no such group".',
    presentCall: args => titled(`搜群：${String(args.keyword)}`, 'read'),
    parameters: {
      keyword: { type: 'string', required: true, description: 'Search keyword.' },
      limit: { type: 'number', description: 'Per-page count; default 10.' },
      page: { type: 'number', description: 'Page number; default 1, must be >= 1.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['im', 'group', 'search', '--keyword', args.keyword]
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1) {
          throw new Error('yzj_im_group_search: limit must be an integer >= 1')
        }
        command.push('--limit', String(args.limit))
      }
      if (args.page !== undefined) {
        if (!Number.isInteger(args.page) || args.page < 1) {
          throw new Error('yzj_im_group_search: page must be an integer >= 1')
        }
        command.push('--page', String(args.page))
      }
      return runValue(ctx, budget, 'im group search', command, (json) => {
        const root = asRecord(json)
        // 回包形状按 `group recent` 的同族猜：`list` 优先，退回顶层数组。
        const groups = asArray(root.list).length > 0 ? asArray(root.list) : asArray(json)
        const lines = groups.map(groupLine)
        return {
          content: lines.length === 0 ? '(没有搜到群)' : lines.join('\n'),
          data: { list: clipJson(groups, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_im_group_recent',
    description: 'List recent group/chat sessions with unread counts and last-message previews, newest first. Page through this to locate a target group; yzj_im_group_search exists but is unreliable on some tenants.',
    presentCall: () => titled('最近的群列表', 'read'),
    parameters: {
      limit: { type: 'number', description: 'Per-page count; default 20, range 1-20 (CLI cap).' },
      page: { type: 'number', description: 'Page number; default 1, must be >= 1.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['im', 'group', 'recent']
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
          throw new Error('yzj_im_group_recent: limit must be an integer between 1 and 20 (CLI cap)')
        }
        command.push('--limit', String(args.limit))
      }
      if (args.page !== undefined) {
        if (!Number.isInteger(args.page) || args.page < 1) {
          throw new Error('yzj_im_group_recent: page must be an integer >= 1')
        }
        command.push('--page', String(args.page))
      }
      return runValue(ctx, budget, 'im group recent', command, (json) => {
        const root = asRecord(json)
        const groups = asArray(root.list)
        const more = root.more === true
        const lines = groups.map(groupLine)
        return {
          // The empty case is an ARRAY entry, not a bare string: spreading a
          // string here would emit one character per line (the old system's
          // bug, carried no further).
          content: [
            ...(lines.length === 0 ? ['(no recent groups)'] : lines),
            ...(more ? ['(more pages available)'] : []),
          ].join('\n'),
          data: { list: clipJson(groups, { maxChars: budget.maxMetaChars }), more },
        }
      })
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
