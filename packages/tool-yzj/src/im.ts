/**
 * IM-domain tools: message sending, history listing, and recent group
 * sessions. Sending is a serious side effect and is gated by the approval
 * guard; the tool itself validates the mutually exclusive target and
 * msg-type/attachment combinations the CLI enforces.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  runValue, yzjToolOutput,
  asRecord, asArray, asString, asNumber, clipJson,
} from './shared.ts'
import type { YzjToolBudget } from './shared.ts'

/** Format "YYYY-MM-DD HH:mm:ss.SSS" as `MM-DD HH:mm`. */
function shortTime(text: unknown): string {
  const value = asString(text)
  return value.length >= 16 ? value.slice(5, 16) : value
}

/** One message line for history digests. */
function messageLine(record: unknown): string {
  const message = asRecord(record)
  const content = asString(message.content)
  const from = asString(message.fromOpenId)
  const time = shortTime(message.sendTime)
  const msgType = asString(message.msgType)
  const reply = asRecord(message.param)
  const replySummary = asString(reply.replySummary)
  const parts: string[] = []
  if (time !== '') parts.push(`[${time}]`)
  parts.push(from === '' ? '(unknown sender)' : from)
  const body = content === '' ? `(${msgType === '' ? 'message' : msgType})` : content
  const replyMark = replySummary === '' ? '' : ` ↳${replySummary}`
  parts.push(`${body}${replyMark}`)
  const msgId = asString(message.msgId)
  if (msgId !== '') parts.push(`<${msgId}>`)
  return parts.join(' ')
}

/** One group line for recent-session digests. */
function groupLine(record: unknown): string {
  const group = asRecord(record)
  const name = asString(group.groupName)
  const id = asString(group.groupId)
  const groupType = asNumber(group.groupType)
  const unread = asNumber(group.unreadCount)
  const last = asRecord(group.lastMsg)
  const lastContent = asString(last.content)
  const parts = [name === '' ? id : name]
  if (groupType !== undefined) parts.push(`类型${groupType}`)
  if (unread !== undefined && unread > 0) parts.push(`未读 ${unread}`)
  if (lastContent !== '') parts.push(`最近: ${lastContent.replace(/\s+/g, ' ').slice(0, 40)}`)
  if (id !== '' && id !== name) parts.push(`(${id})`)
  return parts.join(' · ')
}

/** Register the im-domain tools. */
export function applyImTools(ctx: Context, budget: YzjToolBudget): void {
  ctx.tools.register(defineTool({
    name: 'yzj_im_message_send',
    description: 'Send an IM message to a group or direct chat. Exactly one of groupId / toOpenId; msg-type text|richText require content (file requires fileId). @ mentions need at-open-id per @姓名 in content and at-all per @all (group chats only). Reply uses replyMsgId with text/richText. Requires user confirmation before dispatch.',
    parameters: {
      groupId: { type: 'string', description: 'Target group or chat session id; mutually exclusive with toOpenId.' },
      toOpenId: { type: 'string', description: 'Direct-chat target openId; mutually exclusive with groupId.' },
      msgType: { type: 'string', required: true, enum: ['text', 'file', 'richText'], description: 'text or richText need content; file needs fileId.' },
      content: { type: 'string', description: 'Message body; required for text/richText. @all and @姓名 must be standalone fragments ("@all 请关注").' },
      fileId: { type: 'string', description: 'Uploaded file id (from yzj_file_upload); required for msg-type file.' },
      replyMsgId: { type: 'string', description: 'Reply-to message id; text/richText only.' },
      atOpenIds: { type: 'array', items: { type: 'string' }, description: 'One per @姓名 in content, in order; group chats only.' },
      atAll: { type: 'boolean', description: 'True when content contains @all (user must have explicitly asked for @all).' },
      images: { type: 'array', items: { type: 'string' }, description: 'File ids for [图片] placeholders in richText content.' },
      refs: { type: 'array', items: { type: 'string' }, description: 'Referenced Yunzhijia ref tokens (yzj:... encodings from dragged or @-picked chips) this message is based on; the confirmation card shows them as 关联引用. Never sent to the CLI.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      if ((args.groupId === undefined) === (args.toOpenId === undefined)) {
        throw new Error('yzj_im_message_send: exactly one of groupId or toOpenId is required')
      }
      if (args.msgType === 'file') {
        if (args.fileId === undefined) {
          throw new Error('yzj_im_message_send: msg-type file requires fileId')
        }
        if (args.content !== undefined || args.replyMsgId !== undefined || args.atAll === true || (args.atOpenIds ?? []).length > 0) {
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

  ctx.tools.register(defineTool({
    name: 'yzj_im_message_list',
    description: 'List chat history of a group/session: newest (default) or anchored old/new around msgId. Returns one line per message with time, sender, content, and msgId.',
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
        const messages = asArray(asRecord(json).list)
        const more = asRecord(json).more === true
        const lines = messages.map(messageLine)
        const content = [
          ...(lines.length === 0 ? ['(no messages)'] : lines),
          ...(more ? ['(more messages available)'] : []),
        ].join('\n')
        return { content, data: { list: clipJson(messages, { maxChars: budget.maxMetaChars }), more } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_im_group_recent',
    description: 'List recent group/chat sessions with unread counts and last-message previews, newest first. There is no group search; page through this to locate a target group.',
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
        const groups = asArray(asRecord(json).list)
        const more = asRecord(json).more === true
        const lines = groups.map(groupLine)
        const content = [
          ...(lines.length === 0 ? '(no recent groups)' : lines),
          ...(more ? ['(more pages available)'] : []),
        ].join('\n')
        return { content, data: { list: clipJson(groups, { maxChars: budget.maxMetaChars }), more } }
      })
    },
  }))
}
