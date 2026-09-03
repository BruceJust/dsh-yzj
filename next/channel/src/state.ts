/**
 * Durable channel runtime: cursors, inbound dedupe, the message→topic index,
 * per-topic generation, and the OUTBOUND REGISTRY that makes the self-chat
 * echo protocol work (§5.2).
 *
 * This is deliberately NOT in the graph. The graph holds product-level facts;
 * a polling cursor is neither a fact about the work nor something anybody
 * would ever audit — the data-sovereignty boundary (§2) puts it in a plain
 * runtime file, and only anchors cross between the two.
 *
 * The outbound registry is written BEFORE the send and back-filled with the
 * message id after it: the window where a process dies between "sent" and
 * "recorded" is covered by the content fingerprint, because on the next poll
 * that message will come back looking exactly like a human reply.
 */

import type { ServeScope } from './presence.ts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { YzjGroup, YzjMessage, YzjTopicRoute } from './protocol.ts'

const MAX_PROCESSED = 2_000
const MAX_TOPIC_INDEX = 20_000
const MAX_OUTBOUND = 2_000
const MAX_CONVERSATIONS = 1_000
const RETAIN_MS = 7 * 24 * 60 * 60 * 1_000

const topicIndexKey = (groupId: string, msgId: string): string => `${groupId}\0${msgId}`

/** Read mark for a conversation that has never carried a message. */
export const READ_EMPTY = '\0empty'

interface OutboundRecord {
  readonly nonce: string
  readonly groupId: string
  readonly fingerprint: string
  /** Filled in after the CLI returns; absent means the send outcome is unknown. */
  msgId?: string
  time: number
  /**
   * Who spoke: the AGENT, or the operator typing at this desk.
   *
   * The registry exists so we never answer ourselves, and for that question
   * both are equally "ours". 受话判定 asks a different question — did somebody
   * address the AGENT — and answering it with "did this desk send it" made
   * replying to your own message read as delegating to the agent. Absent means
   * a record written before this field existed; treated as the agent, which is
   * what every pre-existing record was.
   */
  origin?: 'agent' | 'desk'
}

/**
 * One admitted-but-unfinished task. Persisted BEFORE the work starts, so a
 * crash mid-task replays it instead of losing it; `processed` is written in
 * the same breath, so the replay cannot become a duplicate admission.
 * The conversation context is deliberately not stored — it is re-read on
 * replay, which is both smaller and fresher than a snapshot of it.
 */
export interface PendingTask {
  readonly group: YzjGroup
  readonly message: YzjMessage
  readonly route: YzjTopicRoute
  readonly admittedAt: number
  /**
   * 四级解析的结果——这条触发凭什么由本实例接 (决策 #63)。缺席 = 旧记录或私聊，
   * 按「没有对手」跑。
   */
  readonly claim?: {
    readonly tier: 'speaker' | 'presence' | 'standby'
    readonly tiebreak: 'sole' | 'msgId'
    readonly contenders: readonly string[]
  }
}

/**
 * 一条**为发言者实例让了一个轮询周期**的触发 (决策 #63 级 1).
 *
 * 落盘而不是留在内存：游标已经过了它，进程这时崩掉，它就永远没人看了——而它是一句
 * 真人对着 agent 说的话。
 */
export interface ParkedTrigger {
  readonly group: YzjGroup
  readonly message: YzjMessage
  readonly readyAt: number
  /** 到点时这条触发一共等过几个周期（备岗序按它数；缺席 = 旧账，按 1 算）。 */
  readonly cycles?: number
}

/** 一条观察到的同侪出站（署名识别）。能派生就不落图，落运行态。 */
export interface PeerMessageRecord {
  readonly msgId: string
  readonly groupId: string
  readonly openId: string
  readonly time: number
  readonly signal: 'presence-declared' | 'presence-withdrawn' | 'yield' | 'ack' | 'other'
  readonly replyMsgId?: string
}

/** 一个同侪实例在某群的在岗观测。 */
export interface PeerPresenceRecord {
  readonly on: boolean
  readonly msgId: string
  readonly time: number
  readonly name: string
}

/**
 * One conversation, as the desktop's conversation list needs it.
 *
 * This is a ROSTER, not a cache of messages: name, kind, who spoke last and
 * when, and the server's unread count. It accumulates — every poll already
 * fetches the conversation list to find work in it, so remembering what it
 * saw costs nothing and is the only thing that makes the list survive a
 * restart (and makes local name filtering possible at all: the platform has
 * no group-search API, so filtering over what we have seen IS the search).
 */
export interface ConversationRecord {
  name: string
  /** 1 = direct, 2 = group, 3 = assistant/app, 8 = system notice. */
  type: number
  lastMsgId: string
  /** Epoch ms of the last message; 0 when the conversation has never had one. */
  lastMsgTime: number
  preview: string
  unread: number
  avatarUrl?: string
}

interface AccountState {
  cursors: Record<string, string>
  processed: { msgId: string; time: number }[]
  pending: PendingTask[]
  messageTopics: Record<string, string>
  /** topicKey → generation, advanced by `/new`. */
  generations: Record<string, number>
  outbound: OutboundRecord[]
  managedTitles: Record<string, string>
  /** groupId → the conversation, as the desktop list shows it. */
  conversations?: Record<string, ConversationRecord>
  /**
   * groupId → the last message id the operator has actually seen at this desk.
   *
   * The unread rule is `effectiveUnread = min(server, local)`: the server's
   * count is read-only and can only be believed downward, and the one thing
   * this side knows better is "I have read up to here". There is no mark-read
   * API, so this never travels — the phone's red dot stays lit, and saying so
   * is part of the feature rather than an omission.
   */
  readAt?: Record<string, string>
  /**
   * groupId → whether the OPERATOR put this conversation in or out of service.
   *
   * The config's `allowedGroupIds` is the deployment's baseline; this is what a
   * person decided afterwards, and the two are merged at boot with this one
   * winning. It has to be durable state rather than a rewrite of the config
   * file: the config ships with the bundle, and an app that edits its own
   * shipped configuration makes "what is this deployment allowed to touch"
   * unanswerable from the repository.
   *
   * Both directions are recorded, because removing a baseline conversation is
   * as much a decision as adding one, and an override that only says "yes"
   * cannot express it.
   */
  served?: Record<string, boolean>
  /**
   * taskId → the trigger a 中断 task can be resumed from.
   *
   * Separate from `pending` on purpose: `pending` is the run QUEUE, replayed
   * automatically after a restart, and an interrupted task must not be retried
   * by itself — 重试是人发起的，一次 (the approval family's own rule). This is
   * the address book that makes 「继续」 possible, including after a restart,
   * without putting the work back in a loop.
   */
  resumable?: Record<string, PendingTask>
  /**
   * groupId → 触发者范围 (决策 #63)：`all` 对群在岗，`self` 仅本人。
   *
   * 和 `served` 分开存：接不接是一件事，接谁的话是另一件。缺席 = 旧记录，按 `all`
   * 读（那是它们一直以来的行为）。
   */
  servedScope?: Record<string, ServeScope>
  /** 观察到的同侪实例：operatorOpenId → 名字与最后一次出现。 */
  peers?: Record<string, { name: string; lastSeen: number }>
  /** groupId → operatorOpenId → 在岗观测。 */
  peerPresence?: Record<string, Record<string, PeerPresenceRecord>>
  /** 同侪出站的索引——级 0 对象归属与 ack 检测的数据基础。 */
  peerMessages?: PeerMessageRecord[]
  /** 为发言者实例让位一周期的触发。 */
  parked?: ParkedTrigger[]
}

interface StateFile {
  version: 1
  accounts: Record<string, AccountState>
}

function freshAccount(): AccountState {
  return {
    cursors: {}, processed: [], pending: [], messageTopics: {},
    generations: {}, outbound: [], managedTitles: {},
    conversations: {}, readAt: {}, served: {}, resumable: {},
    servedScope: {}, peers: {}, peerPresence: {}, peerMessages: [], parked: [],
  }
}

const MAX_PEER_MESSAGES = 2_000
/** 一个同侪实例多久没出声就不再当它存在——级 1 的一周期延迟不该为一个卸了的助理永远付。 */
const PEER_RETAIN_MS = 30 * 24 * 60 * 60 * 1_000

export class ChannelState {
  private data: StateFile = { version: 1, accounts: {} }
  private activeKey: string | undefined
  private readonly seen = new Set<string>()
  private readonly ownMsgIds = new Set<string>()
  private readonly ownFingerprints = new Set<string>()
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<StateFile>
      if (parsed.version === 1 && typeof parsed.accounts === 'object' && parsed.accounts !== null) {
        this.data = { version: 1, accounts: parsed.accounts }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /** Open one account partition; switching after load is the circuit breaker. */
  selectAccount(accountKey: string): void {
    if (this.activeKey !== undefined && this.activeKey !== accountKey) {
      throw new Error('Yunzhijia login account changed while the channel was running')
    }
    const existing = this.data.accounts[accountKey]
    if (existing === undefined) this.data.accounts[accountKey] = freshAccount()
    // A partition written before `pending` existed decodes without it.
    else existing.pending ??= []
    this.activeKey = accountKey
    this.reindex()
  }

  private active(): AccountState {
    const key = this.activeKey
    if (key === undefined) throw new Error('Yunzhijia channel state has no selected account')
    const account = this.data.accounts[key]
    if (account === undefined) throw new Error('Selected Yunzhijia channel account state is missing')
    return account
  }

  private reindex(): void {
    this.seen.clear()
    this.ownMsgIds.clear()
    this.ownFingerprints.clear()
    if (this.activeKey === undefined) return
    const account = this.active()
    for (const entry of account.processed) this.seen.add(entry.msgId)
    for (const entry of account.outbound) {
      if (entry.msgId !== undefined) this.ownMsgIds.add(entry.msgId)
      this.ownFingerprints.add(entry.fingerprint)
    }
  }

  cursor(groupId: string): string | undefined { return this.active().cursors[groupId] }
  setCursor(groupId: string, msgId: string): void { this.active().cursors[groupId] = msgId }

  /**
   * Remember one conversation the poll just saw.
   *
   * Called for EVERY row, including the ones triage will not act in: the
   * conversation list is not the agent's work queue, it is the operator's IM
   * surface, and an agent-shaped slice of it is exactly the entrance
   * fragmentation this product exists to end (v4.8).
   */
  rememberConversation(group: YzjGroup, lastMsgTime: number): void {
    const account = this.active()
    account.conversations ??= {}
    const previous = account.conversations[group.groupId]
    account.conversations[group.groupId] = {
      name: group.groupName,
      type: group.groupType ?? 2,
      lastMsgId: group.lastMsgId,
      lastMsgTime,
      preview: (group.lastMsg?.content ?? previous?.preview ?? '').replace(/\s+/gu, ' ').slice(0, 90),
      unread: group.unreadCount ?? 0,
      ...(group.headerUrl === undefined
        ? (previous?.avatarUrl === undefined ? {} : { avatarUrl: previous.avatarUrl })
        : { avatarUrl: group.headerUrl }),
    }
  }

  /**
   * The roster, with the unread rule already applied.
   *
   * `min(server, local)`: our read mark can only ever take the count DOWN to
   * zero — a desk that has seen the newest message knows that much — and the
   * server's own decrease is adopted for free because the count is re-read
   * every poll.
   */
  conversations(): readonly (ConversationRecord & { groupId: string; unreadEffective: number })[] {
    const account = this.active()
    const readAt = account.readAt ?? {}
    return Object.entries(account.conversations ?? {}).map(([groupId, record]) => ({
      ...record,
      groupId,
      // A message-less conversation is marked read against a stand-in, since
      // it has no message id to name.
      unreadEffective: readAt[groupId] === (record.lastMsgId === '' ? READ_EMPTY : record.lastMsgId)
        ? 0
        : record.unread,
    }))
  }

  /** Conversations with a read mark — the pruning invariant, made checkable. */
  readAtKeys(): readonly string[] {
    return Object.keys(this.active().readAt ?? {})
  }

  /** One conversation from the roster. */
  conversation(groupId: string): ConversationRecord | undefined {
    return this.active().conversations?.[groupId]
  }

  /** The operator has seen this conversation up to `msgId`, at this desk. */
  markRead(groupId: string, msgId: string): void {
    if (msgId === '') return

    const account = this.active()
    account.readAt ??= {}
    account.readAt[groupId] = msgId
  }

  /**
   * What the operator decided about serving this conversation, if anything.
   *
   * `undefined` means "never decided" — the config's baseline stands.
   */
  servedOverrides(): Readonly<Record<string, boolean>> {
    return this.active().served ?? {}
  }

  setServed(groupId: string, on: boolean, scope?: ServeScope): void {
    if (groupId === '') return
    const account = this.active()
    account.served ??= {}
    account.served[groupId] = on
    if (scope !== undefined) {
      account.servedScope ??= {}
      account.servedScope[groupId] = scope
    }
  }

  /** 触发者范围。缺席 = 从没选过，调用方按 `all` 读。 */
  scopeOf(groupId: string): ServeScope | undefined {
    return this.active().servedScope?.[groupId]
  }

  // ---- 同侪观测 (决策 #63) ----------------------------------------------

  /** 见过一条署名出站：这个操作者有实例。 */
  rememberPeer(openId: string, name: string, time: number = Date.now()): void {
    if (openId === '') return
    const account = this.active()
    account.peers ??= {}
    account.peers[openId] = { name, lastSeen: time }
  }

  peerOf(openId: string): { name: string; lastSeen: number } | undefined {
    return this.active().peers?.[openId]
  }

  peers(): readonly { openId: string; name: string; lastSeen: number }[] {
    return Object.entries(this.active().peers ?? {}).map(([openId, peer]) => ({ openId, ...peer }))
  }

  recordPeerMessage(record: PeerMessageRecord): void {
    const account = this.active()
    account.peerMessages ??= []
    if (account.peerMessages.some(entry => entry.msgId === record.msgId)) return
    account.peerMessages.push(record)
  }

  peerMessageOf(msgId: string): PeerMessageRecord | undefined {
    return this.active().peerMessages?.find(entry => entry.msgId === msgId)
  }

  /** 在这个群里见过出站的同侪实例（备岗序的席位表：能派生就不落账）。 */
  peersSeenIn(groupId: string): readonly string[] {
    return [...new Set((this.active().peerMessages ?? []).filter(entry => entry.groupId === groupId).map(entry => entry.openId))]
  }

  /** 同侪对某条触发的 ack——按看到的顺序。 */
  peerAcksOn(groupId: string, triggerMsgId: string): readonly PeerMessageRecord[] {
    return (this.active().peerMessages ?? []).filter(entry => (
      entry.groupId === groupId && entry.signal === 'ack' && entry.replyMsgId === triggerMsgId
    ))
  }

  setPeerPresence(groupId: string, openId: string, record: PeerPresenceRecord): void {
    const account = this.active()
    account.peerPresence ??= {}
    account.peerPresence[groupId] ??= {}
    const previous = account.peerPresence[groupId][openId]
    // 只往前走：一条更早的观测不能推翻更晚的。
    if (previous !== undefined && previous.time > record.time) return
    account.peerPresence[groupId][openId] = record
  }

  /** 此刻在这个群对群在岗的同侪实例。 */
  peersOnDutyIn(groupId: string): readonly { openId: string; name: string; since: number; msgId: string }[] {
    return Object.entries(this.active().peerPresence?.[groupId] ?? {})
      .filter(([, record]) => record.on)
      .map(([openId, record]) => ({ openId, name: record.name, since: record.time, msgId: record.msgId }))
  }

  // ---- 让位一周期 ----------------------------------------------------------

  park(trigger: ParkedTrigger): void {
    const account = this.active()
    account.parked ??= []
    if (account.parked.some(entry => entry.message.msgId === trigger.message.msgId)) return
    account.parked.push(trigger)
  }

  parked(): readonly ParkedTrigger[] {
    return [...(this.active().parked ?? [])]
  }

  unpark(msgId: string): void {
    const account = this.active()
    account.parked = (account.parked ?? []).filter(entry => entry.message.msgId !== msgId)
  }

  /** Remember how to resume an interrupted task. */
  rememberResumable(taskId: string, task: PendingTask): void {
    const account = this.active()
    account.resumable ??= {}
    account.resumable[taskId] = task
  }

  resumable(taskId: string): PendingTask | undefined {
    return this.active().resumable?.[taskId]
  }

  dropResumable(taskId: string): void {
    const account = this.active()
    if (account.resumable !== undefined) delete account.resumable[taskId]
  }

  isProcessed(msgId: string): boolean { return this.seen.has(msgId) }

  markProcessed(msgId: string, time: number = Date.now()): void {
    if (this.seen.has(msgId)) return
    this.seen.add(msgId)
    this.active().processed.push({ msgId, time })
  }

  /**
   * Admit one task: dedupe, mark processed, and record it as pending. The
   * CALLER must persist before executing — that ordering is what makes a
   * crash replay the task instead of dropping it.
   * @returns false when this message was already admitted.
   */
  admit(task: PendingTask): boolean {
    if (this.seen.has(task.message.msgId)) return false
    this.markProcessed(task.message.msgId, task.admittedAt)
    this.active().pending.push(task)
    return true
  }

  /** Tasks admitted but never finished — replayed at boot. */
  pendingTasks(): readonly PendingTask[] {
    return [...this.active().pending]
  }

  completeTask(msgId: string): void {
    const account = this.active()
    account.pending = account.pending.filter(task => task.message.msgId !== msgId)
  }

  /** Undo an admission whose persistence failed; the message stays unseen. */
  forget(msgId: string): void {
    const account = this.active()
    this.completeTask(msgId)
    account.processed = account.processed.filter(entry => entry.msgId !== msgId)
    this.seen.delete(msgId)
  }

  topicForMessage(groupId: string, msgId: string): string | undefined {
    return this.active().messageTopics[topicIndexKey(groupId, msgId)]
  }

  recordMessageTopic(groupId: string, msgId: string, topicRootId: string): void {
    if (msgId !== '') this.active().messageTopics[topicIndexKey(groupId, msgId)] = topicRootId
  }

  generation(topicKey: string): number {
    return this.active().generations[topicKey] ?? 1
  }

  advanceGeneration(topicKey: string): number {
    const next = this.generation(topicKey) + 1
    this.active().generations[topicKey] = next
    return next
  }

  managedTitle(sessionId: string): string | undefined {
    return this.active().managedTitles[sessionId]
  }

  setManagedTitle(sessionId: string, title: string): void {
    this.active().managedTitles[sessionId] = title
  }

  /**
   * Pre-register an outbound message. Call this BEFORE the send: the record is
   * what stops the next poll from reading our own words back as input.
   */
  registerOutbound(
    nonce: string, groupId: string, fingerprint: string, origin: 'agent' | 'desk' = 'agent',
  ): void {
    this.active().outbound.push({ nonce, groupId, fingerprint, time: Date.now(), origin })
    this.ownFingerprints.add(fingerprint)
  }

  /** Back-fill the message id once the CLI reports it. */
  confirmOutbound(nonce: string, msgId: string): void {
    const record = this.active().outbound.find(entry => entry.nonce === nonce)
    if (record !== undefined) record.msgId = msgId
    this.ownMsgIds.add(msgId)
  }

  /**
   * Is this inbound message one of ours? By id when the send was recorded, by
   * content fingerprint when the process died in the send window.
   */
  /**
   * Whether we sent the message with this id.
   *
   * The 受话判定 half of the registry (v4.7): "did the agent send the message
   * this one replies to". Id-only, with no fingerprint claiming — this is a
   * pure question about the past, and the claiming path exists to settle an
   * echo we are seeing for the first time.
   */
  isOwnOutboundId(msgId: string): boolean {
    return this.ownMsgIds.has(msgId)
      || this.active().outbound.some(entry => entry.msgId === msgId)
  }

  /**
   * Did the AGENT say this? 回复某人的消息就是向其受话 (v4.7) — so this is the
   * predicate the trigger rule needs, and it is NOT `isOwnOutboundId`: the
   * operator's own words go through the same send path.
   */
  isAgentOutboundId(msgId: string): boolean {
    const record = this.active().outbound.find(entry => entry.msgId === msgId)
    return record !== undefined && record.origin !== 'desk'
  }

  isOwnOutbound(msgId: string, groupId: string, fingerprint: string): boolean {
    if (this.ownMsgIds.has(msgId)) return true
    if (!this.ownFingerprints.has(fingerprint)) return false
    // Claim the fingerprint once, so a human who genuinely repeats the exact
    // text later is not suppressed forever.
    const record = this.active().outbound.find(entry => (
      entry.fingerprint === fingerprint && entry.groupId === groupId && entry.msgId === undefined
    ))
    if (record === undefined) return false
    record.msgId = msgId
    this.ownMsgIds.add(msgId)
    return true
  }

  save(now: number = Date.now()): Promise<void> {
    const next = this.saving.catch(() => undefined).then(() => this.persist(now))
    this.saving = next
    return next
  }

  private async persist(now: number): Promise<void> {
    for (const account of Object.values(this.data.accounts)) {
      // A pending task's dedupe row must survive trimming, or the replay it
      // is waiting for would admit it a second time.
      const pendingIds = new Set((account.pending ?? []).map(task => task.message.msgId))
      const retained = account.processed
        .filter(entry => entry.time >= now - RETAIN_MS || pendingIds.has(entry.msgId))
      const kept = retained.filter(entry => !pendingIds.has(entry.msgId)).slice(-MAX_PROCESSED)
      const keptIds = new Set(kept.map(entry => entry.msgId))
      account.processed = retained.filter(entry => (
        pendingIds.has(entry.msgId) || keptIds.has(entry.msgId)
      ))
      account.outbound = account.outbound
        .filter(entry => entry.time >= now - RETAIN_MS)
        .slice(-MAX_OUTBOUND)
      account.peerMessages = (account.peerMessages ?? [])
        .filter(entry => entry.time >= now - RETAIN_MS)
        .slice(-MAX_PEER_MESSAGES)
      account.peers = Object.fromEntries(
        Object.entries(account.peers ?? {}).filter(([, peer]) => peer.lastSeen >= now - PEER_RETAIN_MS),
      )
      const topics = Object.entries(account.messageTopics)
      if (topics.length > MAX_TOPIC_INDEX) {
        account.messageTopics = Object.fromEntries(topics.slice(-MAX_TOPIC_INDEX))
      }
      // The roster is bounded by the operator's social graph, not by traffic —
      // but "bounded" is not "small" (this account has 525 conversations), so
      // it is capped by staleness rather than left to grow forever.
      const rows = Object.entries(account.conversations ?? {})
      if (rows.length > MAX_CONVERSATIONS) {
        account.conversations = Object.fromEntries(
          rows.sort((left, right) => right[1].lastMsgTime - left[1].lastMsgTime)
            .slice(0, MAX_CONVERSATIONS),
        )
      }
      // Unconditionally, not inside the branch above: at this account's 525
      // conversations that branch never runs, so read marks were collected by
      // code that could not execute.
      const live = new Set(Object.keys(account.conversations ?? {}))
      account.readAt = Object.fromEntries(
        Object.entries(account.readAt ?? {}).filter(([groupId]) => live.has(groupId)),
      )
    }
    this.reindex()
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${String(process.pid)}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }
}
