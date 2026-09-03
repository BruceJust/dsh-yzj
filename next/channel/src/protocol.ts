/**
 * Wire parsing, topic anchoring and key minting.
 *
 * Ported patterns (technical plan §1.3): four-level topic anchoring, domain
 * separated hashing with account partitioning, and the DM-continuous
 * boundary rule (§1.7 / v2.5 F11 — one contact, one running conversation;
 * `/new` is the only way to segment it).
 *
 * The hash domain tag is NEW on purpose (TD-14). Reusing the old system's tag
 * would make the same Yunzhijia topic resume into the OLD system's session:
 * mixed history and a workspace-ownership conflict, in a deployment whose
 * whole premise is that the two instances stay apart.
 */

import { createHash } from 'node:crypto'

/** Domain tag of this system's session-id space. Never share it with the old one. */
const TOPIC_DOMAIN = 'yzj-next-topic-v1'
const CHANNEL_DOMAIN = 'yzj-next-channel-v1'
const ACCOUNT_DOMAIN = 'yzj-next-account-v1'

export interface YzjIdentity {
  readonly orgId: string
  readonly openId: string
  readonly name: string
}

export interface YzjMessageParam {
  /** Image segments of a richText message. */
  readonly desc?: readonly { type: 'image'; data: string; w?: number; h?: number }[]
  /** File messages: what was attached. */
  readonly name?: string
  readonly fileId?: string
  readonly ext?: string
  readonly size?: number
  /**
   * 1 = the attachment is a PICTURE, sent as a file message.
   *
   * Measured: an image pasted into a chat arrives as `msgType: 'file'` with
   * `ftype: 1`, `ext: 'png'` and `picWidth/picHeight` — not as `richText` with
   * a `desc[]` segment. Reading only `desc[]` therefore rendered every pasted
   * screenshot as a grey file card.
   */
  readonly ftype?: number
  readonly picWidth?: number
  readonly picHeight?: number
  readonly notifyDesc?: string
  readonly notifyType?: number
  readonly notifyToAll?: boolean
  readonly replyMsgId?: string
  readonly replyOpenId?: string
  readonly replyPersonName?: string
  readonly replyRootMsgId?: string
  readonly replySummary?: string
}

export interface YzjMessage {
  readonly msgId: string
  readonly content: string
  readonly fromOpenId: string
  readonly msgType: string
  readonly sendTime: string
  readonly param: YzjMessageParam
}

export interface YzjGroup {
  readonly groupId: string
  readonly groupName: string
  readonly groupType?: number
  /** Empty for a conversation that has never carried a message. */
  readonly lastMsgId: string
  readonly lastMsgSendTime: string
  readonly lastMsg?: YzjMessage
  /**
   * The server's own unread count. READ-ONLY: `yzj-cli` exposes no mark-read
   * command at any level, so this only ever goes down when somebody reads the
   * conversation on their phone — which is also why our desktop cannot clear
   * the red dot there (v4.8, an accepted defect that has to be said out loud).
   */
  readonly unreadCount?: number
  /** Real avatar. A letter tile is a stand-in for one, not a substitute. */
  readonly headerUrl?: string
}

/** Everything a turn needs to know about where it came from. */
export interface YzjTopicRoute {
  readonly accountKey: string
  readonly accountOrgId: string
  readonly accountOpenId: string
  readonly conversationKind: 'group' | 'direct'
  readonly groupId: string
  readonly groupName: string
  readonly placeKey: string
  readonly channelKey: string
  readonly topicRootId: string
  readonly topicKey: string
  readonly topicLabel: string
  readonly generation: number
  readonly sessionId: string
  readonly title: string
}

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
  /*
    图片段：richText 的正文里是 `[图片]` 占位，真身在 `param.desc[]`.

    Measured shape: `{type:'image', data:'<imageId>', w, h, start, length}`.
    Reading it is the difference between a room that shows what people sent
    and one that shows the word 「[图片]」 where a picture was.
  */
  const desc = (Array.isArray(param.desc) ? param.desc : [])
    .map(asRecord)
    .filter(entry => asString(entry.type) === 'image' && asString(entry.data) !== '')
    .map(entry => ({
      type: 'image' as const,
      data: asString(entry.data),
      ...(asNumber(entry.w) === undefined ? {} : { w: asNumber(entry.w) as number }),
      ...(asNumber(entry.h) === undefined ? {} : { h: asNumber(entry.h) as number }),
    }))
  return {
    msgId,
    content: asString(raw.content),
    fromOpenId: asString(raw.fromOpenId),
    msgType: asString(raw.msgType),
    sendTime: asString(raw.sendTime),
    param: {
      ...(desc.length === 0 ? {} : { desc }),
      ...(asString(param.name) === '' ? {} : { name: asString(param.name) }),
      ...(asString(param.file_id) === '' ? {} : { fileId: asString(param.file_id) }),
      ...(asString(param.ext) === '' ? {} : { ext: asString(param.ext) }),
      ...(asNumber(param.size) === undefined ? {} : { size: asNumber(param.size) as number }),
      ...(asNumber(param.ftype) === undefined ? {} : { ftype: asNumber(param.ftype) as number }),
      ...(asNumber(param.picWidth) === undefined ? {} : { picWidth: asNumber(param.picWidth) as number }),
      ...(asNumber(param.picHeight) === undefined ? {} : { picHeight: asNumber(param.picHeight) as number }),
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

/**
 * One row of `im group recent`.
 *
 * A conversation with NO message is still a conversation — the server returns
 * rows with no `lastMsg` at all, a sentinel `lastMsgSendTime` of
 * `2018-01-02 00:00:00.000`, and a non-zero `unreadCount`. Requiring
 * `lastMsgId` dropped every one of them, which was invisible while this list
 * only fed triage (nothing to triage there anyway) and is a hole the moment
 * the list also has to BE the conversation list.
 */
export function parseGroup(value: unknown): YzjGroup | undefined {
  const raw = asRecord(value)
  const groupId = asString(raw.groupId)
  if (groupId === '') return undefined
  const lastMsg = parseMessage(raw.lastMsg)
  const groupType = asNumber(raw.groupType)
  const unreadCount = asNumber(raw.unreadCount)
  const headerUrl = asString(raw.headerUrl)
  return {
    groupId,
    groupName: asString(raw.groupName) || groupId,
    ...(groupType === undefined ? {} : { groupType }),
    lastMsgId: asString(raw.lastMsgId),
    lastMsgSendTime: asString(raw.lastMsgSendTime),
    ...(lastMsg === undefined ? {} : { lastMsg }),
    ...(unreadCount === undefined ? {} : { unreadCount }),
    ...(headerUrl === '' ? {} : { headerUrl }),
  }
}

/**
 * The server's placeholder for "this conversation has never had a message".
 * Sorting it as a real date puts empty conversations in the year 2018, which
 * is at least honest, but showing it as a timestamp is not.
 */
export const NO_MESSAGE_TIME = '2018-01-02 00:00:00.000'

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function digest(parts: readonly string[], length = 32): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\0')
  return hash.digest('hex').slice(0, length)
}

export function accountKeyFor(identity: Pick<YzjIdentity, 'orgId' | 'openId'>): string {
  return `yzj-account-${digest([ACCOUNT_DOMAIN, identity.orgId, identity.openId])}`
}

export function conversationKindForGroup(group: YzjGroup): 'group' | 'direct' {
  return group.groupType === 1 ? 'direct' : 'group'
}

/** Group types this system will act in: 1 = direct chat, 2 = ordinary group. */
export function isTriageableConversation(group: YzjGroup): boolean {
  return group.groupType === 1 || group.groupType === 2
}

/** Is this the operator talking to themselves? Only true for their own DM. */
export function isSelfChat(group: YzjGroup, identity: Pick<YzjIdentity, 'openId'>): boolean {
  return conversationKindForGroup(group) === 'direct'
    && (group.groupId.split('-')[0] === group.groupId.split('-')[1] || group.groupId.includes(identity.openId))
}

export type TopicLookup = (groupId: string, messageId: string) => string | undefined

/**
 * Four-level topic anchoring: the server-issued reply root, then the durable
 * message→topic index (which includes the agent's own replies), then a
 * cycle-guarded walk up the parent chain, then self-as-root. A DM is a single
 * running conversation, so it anchors to the constant `direct` (§1.7).
 */
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
    const parent: YzjMessage | undefined = byId.get(parentId)
    if (parent === undefined) return parentId
    if (parent.param.replyRootMsgId !== undefined) return parent.param.replyRootMsgId
    if (parent.param.replyMsgId === undefined) return parent.msgId
    parentId = parent.param.replyMsgId
  }
  return message.param.replyMsgId
}

/**
 * The topic's display name.
 *
 * The trigger alias is stripped: `@next` is how the operator ADDRESSED the
 * agent, not what the topic is about. Leaving it in makes every title in the
 * sidebar start with the same four characters, which is the same as having no
 * titles at all.
 */
export function compactTopicSummary(value: string): string {
  const text = value
    .replace(/[@＠][^\s，。！？,:;]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text === '') return '新话题'
  return text.length <= 36 ? text : `${text.slice(0, 36).trimEnd()}…`
}

/** Mint the durable route for one topic. `generation` advances on `/new`. */
export function topicRouteFor(
  identity: Pick<YzjIdentity, 'orgId' | 'openId'>,
  group: YzjGroup,
  message: YzjMessage,
  context: readonly YzjMessage[] = [],
  resolvedTopicRootId?: string,
  generation = 1,
): YzjTopicRoute {
  const conversationKind = conversationKindForGroup(group)
  const topicRootId = resolvedTopicRootId ?? resolveTopicRootId(group, message, context)
  const channelHash = digest([
    CHANNEL_DOMAIN, identity.orgId, identity.openId, conversationKind, group.groupId,
  ])
  const topicHash = digest([
    TOPIC_DOMAIN, identity.orgId, identity.openId,
    conversationKind, group.groupId, topicRootId, `generation-${String(generation)}`,
  ])
  const root = context.find(candidate => candidate.msgId === topicRootId)
  const summary = root?.content ?? message.param.replySummary ?? message.content
  const topicLabel = compactTopicSummary(summary)
  return {
    accountKey: accountKeyFor(identity),
    accountOrgId: identity.orgId,
    accountOpenId: identity.openId,
    conversationKind,
    groupId: group.groupId,
    groupName: group.groupName,
    // The place a viewer is scoped to. A DM is not a place anybody else is in.
    placeKey: placeKeyFor(conversationKind, group.groupId),
    channelKey: `yzj-channel-${channelHash}`,
    topicRootId,
    topicKey: `yzj-topic-${topicHash}`,
    topicLabel,
    generation,
    sessionId: `session-yzj-next-${topicHash}`,
    title: conversationKind === 'direct'
      ? `私聊 · ${group.groupName}`
      : `群 · ${group.groupName} · ${topicLabel}`,
  }
}

/** The viewer-scoping key of one Yunzhijia conversation. */
export function placeKeyFor(kind: 'group' | 'direct', groupId: string): string {
  return kind === 'direct' ? `yzj-dm-${groupId}` : `yzj-group-${groupId}`
}

/** Recover the raw conversation id from a place key, for outbound delivery. */
export function groupIdFromPlaceKey(placeKey: string): string | undefined {
  if (placeKey.startsWith('yzj-dm-')) return placeKey.slice('yzj-dm-'.length)
  if (placeKey.startsWith('yzj-group-')) return placeKey.slice('yzj-group-'.length)
  return undefined
}

/**
 * What may follow a trigger word without swallowing it.
 *
 * The old rule demanded whitespace, one of a handful of punctuation marks, or
 * end of string. **中文不这么打字。** 「@next他发的是什么东西」 is how a person
 * actually addresses somebody in Chinese — no space — and the agent scored it
 * as not-addressed and stayed silent. Measured live in 830 项目【登顶计划】:
 * message at 17:38, no turn, and nothing in the log to explain it.
 *
 * The thing that lookahead was really guarding against is a LONGER alias:
 * `@next` must not fire on `@nextgen`. That risk only exists where the next
 * character could continue the token — for an ASCII alias, another ASCII word
 * character. A CJK character cannot continue `@next`, so it is a boundary, and
 * so is every punctuation mark in every language rather than the six somebody
 * happened to list.
 */
const ALIAS_BOUNDARY = '(?![A-Za-z0-9_-])'

export function hasLeadingAlias(content: string, aliases: readonly string[]): boolean {
  return aliases.some(alias => (
    new RegExp(`^\\s*${escaped(alias)}${ALIAS_BOUNDARY}`, 'iu').test(content)
  ))
}

export function isAgentTrigger(
  message: YzjMessage,
  aliases: readonly string[],
  acceptAccountMentions: boolean,
): boolean {
  if (acceptAccountMentions && message.param.notifyType === 1 && message.param.notifyToAll !== true) return true
  return aliases.some(alias => (
    // Symmetric on the left for the same reason: 「问一下@next他发的什么」 has
    // no space before the mention either. `@` is already a boundary; what must
    // not precede it is another ASCII word character (`mail@next`).
    new RegExp(`(?<![A-Za-z0-9_-])${escaped(alias)}${ALIAS_BOUNDARY}`, 'iu').test(message.content)
  ))
}

/**
 * 这条消息**显式**叫了人 —— 受话判定的收窄 (v4.7 冻结内澄清, 2026-09-03 dsh-2 实测).
 *
 * 「回复 agent 的消息即向它受话」是**隐式**受话：回复锚指向 agent 说的那条。可寄生期
 * agent 顶着操作者的账号说话，同事回复"你账号发的那条"再 @ 你本人，最自然的读法是在
 * 跟你说话。实测：单国鑫回复我们的回帖并 @ 代少兵说"你好，我在"，助理替人接了单、还要
 * 他验收。显式受话者集合非空又不含 agent 时，隐式那一层不该反过来盖住它。
 *
 * 显式叫人的三种形状：平台标记「有人@你」（`notifyType === 1`，@ 的是这个账号——而
 * `acceptAccountMentions: false` 正是操作者说过"@ 我的账号 = 叫的是人"）、@所有人、
 * 正文里的 `@某人`（触发词先剥掉，剩下的 @ 才是人）。
 */
export function mentionsPeople(message: YzjMessage, aliases: readonly string[]): boolean {
  if (message.param.notifyType === 1 || message.param.notifyToAll === true) return true
  return mentionsPeopleInText(message.content, aliases)
}

/** 正文层面的 `@某人`——桌面出站没有平台标记，只有这一层可看。 */
export function mentionsPeopleInText(content: string, aliases: readonly string[]): boolean {
  const rest = stripTriggerAliases(content, aliases)
  // 邮箱（a@b.com）前面是字母，不算；`@` 开头的 token 才是叫人。
  return /(?<![\p{L}\p{N}_.-])[@＠][^\s@＠]+/u.test(rest)
}

export function stripTriggerAliases(content: string, aliases: readonly string[]): string {
  let result = content
  for (const alias of aliases) result = result.replace(new RegExp(escaped(alias), 'giu'), ' ')
  return result.replace(/\s+/gu, ' ').trim()
}

/** Stable fingerprint of one outbound message, for crash-window echo matching. */
export function outboundFingerprint(groupId: string, content: string): string {
  return digest(['yzj-next-outbound-v1', groupId, content.replace(/\s+/gu, ' ').trim()], 24)
}

/** Render the conversation context handed to the model as the turn's preamble. */
export function renderChatContext(
  group: YzjGroup,
  messages: readonly YzjMessage[],
  trigger: YzjMessage,
  route: YzjTopicRoute,
): string {
  const lines = messages.map((message) => {
    const marker = message.msgId === trigger.msgId ? ' [触发消息]' : ''
    const body = message.content.replace(/\s+/gu, ' ').trim() || `(${message.msgType || 'message'})`
    return `- ${message.sendTime} ${message.fromOpenId}${marker}: ${body}`
  })
  const reply = trigger.param.replySummary === undefined
    ? ''
    : `\n回复引用：${trigger.param.replyPersonName ?? trigger.param.replyOpenId ?? '未知发送者'}：${trigger.param.replySummary}`
  return [
    route.conversationKind === 'direct' ? '[云之家私聊上下文]' : '[云之家话题上下文]',
    `会话：${group.groupName} (${group.groupId})`,
    `话题根：${route.topicRootId}`,
    `话题键：${route.topicKey}`,
    `触发者：${trigger.fromOpenId}`,
    `触发消息ID：${trigger.msgId}${reply}`,
    route.conversationKind === 'direct' ? '最近私聊消息（由旧到新）：' : '本话题消息（由旧到新）：',
    ...lines,
  ].join('\n')
}
