import { createHash } from 'node:crypto'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { AgentTurnOutcome, YzjGroup, YzjIdentity, YzjMessage, YzjTopicRoute } from './types.ts'

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return undefined
}

export function parseMessage(value: unknown): YzjMessage | undefined {
  const raw = asRecord(value)
  const msgId = asString(raw.msgId)
  if (msgId === '') return undefined
  const param = asRecord(raw.param)
  const notifyType = asNumber(param.notifyType)
  const notifyToAll = asBoolean(param.notifyToAll)
  return {
    content: asString(raw.content),
    fromOpenId: asString(raw.fromOpenId),
    msgId,
    msgType: asString(raw.msgType),
    sendTime: asString(raw.sendTime),
    param: {
      ...(asString(param.notifyDesc) === '' ? {} : { notifyDesc: asString(param.notifyDesc) }),
      ...(notifyType === undefined ? {} : { notifyType }),
      ...(notifyToAll === undefined ? {} : { notifyToAll }),
      ...(asString(param.replyMsgId) === '' ? {} : { replyMsgId: asString(param.replyMsgId) }),
      ...(asString(param.replyOpenId) === '' ? {} : { replyOpenId: asString(param.replyOpenId) }),
      ...(asString(param.replyPersonName) === '' ? {} : { replyPersonName: asString(param.replyPersonName) }),
      ...(asString(param.replyRootMsgId) === '' ? {} : { replyRootMsgId: asString(param.replyRootMsgId) }),
      ...(asString(param.replySummary) === '' ? {} : { replySummary: asString(param.replySummary) }),
    },
  }
}

export function parseGroup(value: unknown): YzjGroup | undefined {
  const raw = asRecord(value)
  const groupId = asString(raw.groupId)
  const lastMsgId = asString(raw.lastMsgId)
  if (groupId === '' || lastMsgId === '') return undefined
  const lastMsg = parseMessage(raw.lastMsg)
  const groupType = asNumber(raw.groupType)
  return {
    groupId,
    groupName: asString(raw.groupName) || groupId,
    ...(groupType === undefined ? {} : { groupType }),
    lastMsgId,
    lastMsgSendTime: asString(raw.lastMsgSendTime),
    ...(lastMsg === undefined ? {} : { lastMsg }),
  }
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function hasLeadingAgentAlias(message: YzjMessage, aliases: readonly string[]): boolean {
  return aliases.some(alias => new RegExp(`^\\s*${escaped(alias)}(?=\\s|[，。！？,:;]|$)`, 'iu').test(message.content))
}

function digest(parts: readonly string[], length = 24): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\0')
  return hash.digest('hex').slice(0, length)
}

export function accountKeyFor(identity: Pick<YzjIdentity, 'orgId' | 'openId'>): string {
  return `yzj-account-${digest(['yzj-account-v1', identity.orgId, identity.openId], 32)}`
}

export function conversationKindForGroup(group: YzjGroup): 'group' | 'direct' {
  return group.groupType === 1 ? 'direct' : 'group'
}

export function isTriggerableConversation(group: YzjGroup): boolean {
  return group.groupType === 1 || group.groupType === 2
}

export type TopicLookup = (groupId: string, messageId: string) => string | undefined

export function resolveTopicRootId(
  group: YzjGroup,
  message: YzjMessage,
  context: readonly YzjMessage[] = [],
  lookup?: TopicLookup,
): string {
  if (conversationKindForGroup(group) === 'direct') return 'direct'
  if (message.param.replyRootMsgId !== undefined) return message.param.replyRootMsgId
  if (message.param.replyMsgId === undefined) return message.msgId
  const mapped = lookup?.(group.groupId, message.param.replyMsgId)
  if (mapped !== undefined) return mapped

  const byId = new Map(context.map(candidate => [candidate.msgId, candidate]))
  const visited = new Set<string>()
  let parentId: string | undefined = message.param.replyMsgId
  while (parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId)
    const indexed = lookup?.(group.groupId, parentId)
    if (indexed !== undefined) return indexed
    const parent = byId.get(parentId)
    if (parent === undefined) return parentId
    if (parent.param.replyRootMsgId !== undefined) return parent.param.replyRootMsgId
    if (parent.param.replyMsgId === undefined) return parent.msgId
    parentId = parent.param.replyMsgId
  }
  return message.param.replyMsgId
}

export function topicRootIdFor(group: YzjGroup, message: YzjMessage): string {
  return resolveTopicRootId(group, message)
}

export function messageBelongsToTopic(message: YzjMessage, topicRootId: string): boolean {
  return message.msgId === topicRootId
    || message.param.replyRootMsgId === topicRootId
    || message.param.replyMsgId === topicRootId
}

function compactTopicSummary(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text === '') return '新话题'
  return text.length <= 36 ? text : `${text.slice(0, 36).trimEnd()}…`
}

export function topicRouteFor(
  identity: Pick<YzjIdentity, 'orgId' | 'openId'>,
  group: YzjGroup,
  message: YzjMessage,
  context: readonly YzjMessage[] = [],
  resolvedTopicRootId?: string,
): YzjTopicRoute {
  const conversationKind = conversationKindForGroup(group)
  const topicRootId = resolvedTopicRootId ?? resolveTopicRootId(group, message, context)
  const accountKey = accountKeyFor(identity)
  const channelHash = digest([
    'yzj-channel-v1', identity.orgId, identity.openId, conversationKind, group.groupId,
  ], 32)
  const topicHash = digest([
    'yzj-topic-session-v1', identity.orgId, identity.openId,
    conversationKind, group.groupId, topicRootId, 'generation-1',
  ], 32)
  const root = context.find(candidate => candidate.msgId === topicRootId)
  const summary = root?.content ?? message.param.replySummary ?? message.content
  const topicLabel = compactTopicSummary(summary)
  const title = conversationKind === 'direct'
    ? `私聊 · ${group.groupName}`
    : `群 · ${group.groupName} · ${topicLabel}`
  return {
    accountKey,
    accountOrgId: identity.orgId,
    accountOpenId: identity.openId,
    conversationKind,
    groupId: group.groupId,
    groupName: group.groupName,
    channelKey: `yzj-channel-${channelHash}`,
    topicRootId,
    topicKey: `yzj-topic-${topicHash}`,
    topicLabel,
    sessionId: `session-yzj-topic-${topicHash}`,
    title,
  }
}

export function isAgentTrigger(
  message: YzjMessage,
  aliases: readonly string[],
  acceptAccountMentions: boolean,
): boolean {
  if (acceptAccountMentions && message.param.notifyType === 1 && message.param.notifyToAll !== true) return true
  return aliases.some(alias => new RegExp(`(^|\\s)${escaped(alias)}(?=\\s|[，。！？,:;]|$)`, 'iu').test(message.content))
}

export function stripTriggerAliases(content: string, aliases: readonly string[]): string {
  let result = content
  for (const alias of aliases) result = result.replace(new RegExp(escaped(alias), 'giu'), ' ')
  return result.replace(/\s+/g, ' ').trim()
}

export function renderChatContext(
  group: YzjGroup,
  messages: readonly YzjMessage[],
  trigger: YzjMessage,
  route?: YzjTopicRoute,
): string {
  const lines = messages.map((message) => {
    const marker = message.msgId === trigger.msgId ? ' [触发消息]' : ''
    const body = message.content.replace(/\s+/g, ' ').trim() || `(${message.msgType || 'message'})`
    return `- ${message.sendTime} ${message.fromOpenId}${marker}: ${body}`
  })
  const reply = trigger.param.replySummary === undefined
    ? ''
    : `\n回复引用：${trigger.param.replyPersonName ?? trigger.param.replyOpenId ?? '未知发送者'}：${trigger.param.replySummary}`
  return [
    route?.conversationKind === 'direct' ? '[云之家私聊上下文]' : '[云之家话题上下文]',
    `会话：${group.groupName} (${group.groupId})`,
    ...(route === undefined ? [] : [`话题根：${route.topicRootId}`, `话题键：${route.topicKey}`]),
    `触发者：${trigger.fromOpenId}`,
    `触发消息ID：${trigger.msgId}${reply}`,
    route?.conversationKind === 'direct' ? '最近私聊消息（由旧到新）：' : '本话题消息（由旧到新）：',
    ...lines,
  ].join('\n')
}

export function sessionIdForGroup(groupId: string): string {
  return `session-yzj-${createHash('sha256').update(groupId).digest('hex').slice(0, 24)}`
}

export function summarizeTurn(
  events: readonly SessionEvent[], firstSeq: number, beforeSeq: number = Number.POSITIVE_INFINITY,
): AgentTurnOutcome {
  let text = ''
  let reason: TurnEndReason | undefined
  for (const event of events) {
    if (event.seq < firstSeq || event.seq >= beforeSeq) continue
    if (event.type === 'assistant/message') {
      const next = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim()
      if (next !== '') text = next
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, ...(reason === undefined ? {} : { reason }) }
}

export function summarizeGatewayTask(
  events: readonly SessionEvent[], messageId: string,
): AgentTurnOutcome | undefined {
  let startSeq: number | undefined
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = event.data.source as { kind?: unknown; messageId?: unknown }
    if (source.kind === 'yzj-agent' && source.messageId === messageId) startSeq = event.seq
  }
  if (startSeq === undefined) return undefined
  const next = events.find(event => event.seq > startSeq && event.type === 'user/message')
  return summarizeTurn(events, startSeq, next?.seq)
}
