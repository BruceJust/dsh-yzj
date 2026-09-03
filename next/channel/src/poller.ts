/**
 * The inbound loop: discover conversations, read what is new, triage it, and
 * dispatch. One poll is one pass; overlapping passes are suppressed rather
 * than queued, because a slow pass means the CLI is slow and piling more
 * subprocesses onto it helps nobody.
 *
 * Three transport patterns here are learned, not invented (§1.3):
 *
 * - **First-seen continuation.** A conversation seen for the first time is
 *   scanned backwards to a freshness cutoff, page by page, and its cursor only
 *   moves once the whole scan finished. A cursor advanced mid-scan would skip
 *   whatever the next page held.
 * - **Self leading-command recovery.** Our own outbound advances the cursor,
 *   so a command the operator types in their own chat can end up behind it.
 *   When the cursor already equals the newest message, the newest message is
 *   re-examined if it is ours, recent, and starts with an alias.
 * - **Persist before executing.** Admission is written to disk before the turn
 *   runs, and the pending row is what replays it after a crash.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphActor } from '@yzj-next/graph'
import { describeObject, ownsCommitment, processSummary, readSignature } from '@yzj-next/objects'
import {
  accountKeyFor, conversationKindForGroup, groupIdFromPlaceKey, hasLeadingAlias,
  isAgentTrigger, isSelfChat, isTriageableConversation, mentionsPeopleInText, NO_MESSAGE_TIME,
  outboundFingerprint, placeKeyFor, resolveTopicRootId, topicRouteFor,
  type YzjGroup, type YzjIdentity, type YzjMessage, type YzjTopicRoute,
} from './protocol.ts'
import { triage, triageOutbound, type TriageOutcome } from './triage.ts'
import { parseSendTime, type DeskSend, type PresenceView } from './topics.ts'
import {
  classifyPeerOutbound, looksLikeInstanceOutbound, presenceDeclaration, presenceWithdrawal,
  resolveAddressee, resolveCommand, type ClaimTier, type PeerSignal, type YieldReason,
} from './presence.ts'
import { executeHandoff, openHandoffCard, prepareHandoff, type HandoffPlan } from './handoff.ts'
import type { YzjChannelClient } from './client.ts'
import type { ChannelState } from './state.ts'
import type { YzjOrchestrator } from './orchestrator.ts'
import type { ChannelHealth } from './health.ts'

/** How far back a self-sent leading command is still worth recovering. */
const SELF_COMMAND_RECOVERY_MS = 60 * 60_000

/**
 * When this conversation last carried a message — 0 when it never has.
 *
 * The server marks "never" with a `2018-01-02` placeholder rather than an
 * absent field, and that parses as a perfectly valid timestamp. Passing it
 * through put 「8年」 in the conversation list's clock for a conversation that
 * has no messages at all: a real-looking answer to a question with no answer.
 */
function lastMessageTime(group: YzjGroup): number {
  if (group.lastMsgSendTime === NO_MESSAGE_TIME) return 0
  return parseSendTime(group.lastMsgSendTime)
}

/**
 * What one desk send is allowed to do — 人看人发不受限制，agent 触发仍限接单场所
 * (v4.8).
 *
 * Two different things share one send key, and the difference is not who typed
 * it but whether the AGENT is among the addressees:
 *
 * - nobody addressed the agent → send it. Talking to colleagues is the
 *   product's whole point and is gated nowhere;
 * - the agent is addressed where it is on duty → send it and ignite;
 * - the agent is addressed where it is NOT → send NOTHING. Posting it would
 *   leave a public @ in front of colleagues that nothing will ever answer, and
 *   a silent non-answer is how a product teaches people it randomly does
 *   nothing. Refusing here, with the reason, is the cheaper failure.
 *
 * @param input - what the send is and where it is going.
 * @returns the one outcome this send is allowed to have.
 */
export function deskSendPlan(input: {
  readonly addressesAgent: boolean
  readonly repliesToAgent: boolean
  readonly onDuty: boolean
  /** Assistant / system feeds: a subscription, not a conversation. */
  readonly feed?: boolean
  /**
   * **桌面出站对称** (决策 #63, v3.15③ 同律)：这个场所有同侪实例对群在岗。
   *
   * 本实例不在岗而它在：话照发、**不就地点火**——将由它接单，锚定条要在按下之前就
   * 说这句。不发（refuse）是给「谁都不接」留的：一个永远没人应答的公开 @。
   */
  readonly peerOnDuty?: boolean
  /**
   * 级 0 对象归属：回复的是**同侪实例**的消息。真身在对方图上，动作经文本到达它
   * （镜像行的动作 = 文本传送门）——话照发，本实例永不就地动手。
   */
  readonly repliesToPeer?: boolean
}): 'send' | 'send-and-ignite' | 'send-deferred' | 'refuse' | 'refuse-feed' {
  // Nobody is on the other end of a push feed. Closing the composer in the UI
  // is the first door; this is the one that actually holds.
  if (input.feed === true) return 'refuse-feed'
  // 对象归属先于一切：指向同侪对象的话语，跨实例永不竞赛。
  if (input.repliesToPeer === true) return 'send-deferred'
  // 受话判定 (v4.7): an alias addresses the agent; so does replying to one of
  // its own messages — replying to somebody IS addressing them.
  const addressed = input.addressesAgent || input.repliesToAgent
  if (!addressed) return 'send'
  if (input.onDuty) return 'send-and-ignite'
  return input.peerOnDuty === true ? 'send-deferred' : 'refuse'
}

/**
 * 这个群 agent 在不在岗。**「从没提过」和「明确说了不」是两回事。**
 *
 * 此前只有一个集合：接入就 `add`、移出就 `delete`。于是一次明确的「不」和一次从未
 * 发生的决定压成了同一个状态，而这个集合还兼职表达配置——空集是「这个部署没有名单，
 * 到处都在岗」。两个含义挤在一个数据结构里，结果是一道**双向的悬崖**：
 *
 * - 名单空着的部署里，操作者点开一个群 → 集合变成非空 → **另外 45 个群悄悄下岗**；
 * - 名单只剩一个的部署里，操作者把它关掉 → 集合变空 → **agent 在 46 个真实工作群里
 *   同时上岗**。
 *
 * 后一种正是 `set-served` 那段注释在担心的爆炸半径——而那个开关自己就有这个洞。
 *
 * 落库那一层本来就是三值的（`Record<string, boolean>`：有 true / 有 false / 没有），
 * 值丢在合并成一个 Set 的那一步。所以把「明确关掉」单独拿出来，且**先于**空集那条
 * 捷径判断：人明确说过的话，任何默认都不该盖过它。
 */
export function onDutyIn(input: {
  readonly groupId: string
  readonly allowedGroupIds: ReadonlySet<string>
  readonly deniedGroupIds: ReadonlySet<string>
  /** 部署层显式声明的「全量上岗」。**语义与数据结构分离** (v3.15 裁决①)。 */
  readonly serveAll?: boolean
}): boolean {
  // 人明确说过的「不」，任何默认都不该盖过它——所以它排在最前面。
  if (input.deniedGroupIds.has(input.groupId)) return false
  /*
    **空集 = 全关**（v3.15 裁决①，「合同默认最严」的构造性兑现）。

    此前空集是「到处都在岗」，于是这一个集合同时兼职表达两件事：部署配置与逐群决定。
    两个含义挤在一个数据结构里，结果是一道**双向的悬崖**——而其中一个方向是这套系统
    最贵的一种事故：名单只剩一个群时把它关掉，集合变空，**agent 在 46 个真实工作群里
    同时上岗**。

    「到处都在岗」仍然是一个合法的部署选择，只是它现在要被**写下来**（`serveAll`）：
    语义从数据结构里分出来之后，关掉最后一个群就只是关掉最后一个群。
  */
  if (input.serveAll === true) return true
  return input.allowedGroupIds.has(input.groupId)
}

/**
 * 摘除的裁定 —— **与收养对称的减法动词** (`/unlink`, v4.22 裁决②).
 *
 * 抽成纯函数和 `onDutyIn` `deskSendPlan` 同一个理由：这三件事都是**判断**，而判断是
 * 会被改错的那一部分；埋在一个要 client/state/orchestrator 才跑得起来的方法里，它就
 * 只能靠手测。
 *
 * 三个出口各说各的，不合并：
 *
 * - `nothing` —— 这个话题里没有挂着目标的承诺。**没有可摘的**和「不许你摘」是两件事，
 *   合成一句话会让人以为自己没权限；
 * - `not-mine` —— 有，但它不是你登记的。摘除归**该承诺的 owner**（v4.22 还给了目标
 *   owner 一条路，那一半要先读它挂在哪、再读那个目标是谁签的——先严后宽）；
 * - `unlink` —— 摘。
 */
export function unlinkPlan(input: {
  /** 这个话题里那条挂着目标的承诺，没有就是 undefined。 */
  readonly attached?: { readonly delegatedBy?: string }
  readonly fromOpenId: string
}): 'unlink' | 'not-mine' | 'nothing' {
  if (input.attached === undefined) return 'nothing'
  return ownsCommitment(input.fromOpenId, input.attached) ? 'unlink' : 'not-mine'
}

export interface PollerConfig {
  readonly aliases: readonly string[]
  readonly acceptAccountMentions: boolean
  readonly groupPages: number
  readonly contextMessages: number
  readonly discoveryPages: number
  readonly pollIntervalMs: number
  readonly allowedGroupIds: ReadonlySet<string>
  /** 被**明确**移出服务的群。见 `allowed()`：人说过的「不」，任何默认都不该盖过。 */
  readonly deniedGroupIds: ReadonlySet<string>
  /** 部署层显式写下的「全量上岗」。空名单不再等于它 (v3.15 裁决①)。 */
  readonly serveAll?: boolean
}

/** The full command set (§6.4). */
const LIVE_COMMANDS = new Set([
  'new', 'reset', 'cancel', 'done', 'reject', 'link', 'unlink', 'handoff', 'fork', 'status',
])

interface Continuation {
  readonly anchor: string
  readonly highWater: string
  readonly messages: readonly YzjMessage[]
}

export class YzjPoller {
  private polling = false
  private identity: YzjIdentity | undefined
  private accountReady = false
  private replayedPending = false
  private readonly startedAt = Date.now()
  /** In-flight first-seen scans, keyed by conversation. */
  private readonly discovery = new Map<string, Continuation>()
  /** groupId → the route most recently active there, for bare commands. */
  private readonly lastRoutes = new Map<string, YzjTopicRoute>()
  /** Handoff plans whose confirmation card has not been answered yet. */
  private readonly handoffs = new Map<string, HandoffPlan>()
  /** 本进程里已经读过一次近史找在岗声明的群 (决策 #63)。 */
  private readonly presenceScanned = new Set<string>()
  /**
   * 每次轮询最多为一个群读近史找在岗声明。
   *
   * 平台对连着打的读会回 `10000429 请求过于频繁`（实测）。开机那一刻所有在岗群一起
   * 扫两页，就是在自己制造一次限流——错开到每轮一个群，几轮之内扫完，代价只是
   * 头几轮里在岗观测慢一点，而观测缺口本来就有认领协议兜底。
   */
  private presenceScanBudget = 0

  constructor(
    private readonly ctx: Context,
    private readonly client: YzjChannelClient,
    private readonly state: ChannelState,
    private readonly orchestrator: YzjOrchestrator,
    private readonly health: ChannelHealth,
    private readonly config: PollerConfig,
    private readonly onError: (error: unknown) => void,
    private readonly onIdentity?: (identity: YzjIdentity) => void | Promise<void>,
  ) {}

  currentIdentity(): YzjIdentity | undefined {
    return this.identity
  }

  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const identity = await this.client.identity()
      this.client.pinIdentity(identity)
      if (this.identity === undefined) {
        this.identity = identity
        this.state.selectAccount(accountKeyFor(identity))
        await this.ctx.yzjGraph.selectAccount(accountKeyFor(identity))
        this.health.adopt()
        await this.onIdentity?.(identity)
        this.accountReady = true
      } else if (accountKeyFor(this.identity) !== accountKeyFor(identity)) {
        throw new Error('Yunzhijia login account changed while the channel was running')
      }
      if (!this.accountReady) return
      if (!this.replayedPending) {
        this.replayedPending = true
        this.replayPending()
      }
      this.presenceScanBudget = 1
      for (const group of await this.client.recentGroups(this.config.groupPages)) {
        await this.inspectGroup(group)
      }
      // 群都看过了（同侪的 ack 已经记下），再回头看为发言者实例让过一周期的触发。
      await this.reviewParked()
      await this.state.save()
      await this.health.recordSuccess()
    } catch (error) {
      this.onError(error)
      await this.health.recordFailure(error)
    } finally {
      this.polling = false
    }
  }

  /** Re-enqueue tasks admitted by a previous run that never finished. */
  private replayPending(): void {
    for (const task of this.state.pendingTasks()) {
      void (async (): Promise<void> => {
        const lookup = (groupId: string, msgId: string): string | undefined => (
          this.state.topicForMessage(groupId, msgId)
        )
        const context = await this.client.contextFor(
          task.group, task.message, this.config.contextMessages, task.route.topicRootId, lookup,
        )
        this.orchestrator.enqueue(task.group, task.message, task.route, context, task.claim)
      })().catch(this.onError)
    }
  }

  allowed(groupId: string): boolean {
    return onDutyIn({
      groupId,
      allowedGroupIds: this.config.allowedGroupIds,
      deniedGroupIds: this.config.deniedGroupIds,
      ...(this.config.serveAll === undefined ? {} : { serveAll: this.config.serveAll }),
    })
  }


  private async inspectGroup(group: YzjGroup): Promise<void> {
    /*
      Remember EVERY conversation, before any gate.

      The conversation list is not the agent's work queue — it is the
      operator's IM surface (v4.8). This poll already fetches the whole list
      to find work in it, so the roster costs nothing; what it buys is a left
      column that survives a restart and can be filtered locally, which is the
      only search this platform has.
    */
    this.state.rememberConversation(group, lastMessageTime(group))
    /*
      A conversation with no message at all: nothing to triage, and nothing
      that may be written as a cursor. An empty cursor is DEFINED, so the
      first-seen scan would be skipped the day this conversation becomes
      on-duty, and the poll would ask the CLI for "everything after ''".
    */
    if (group.lastMsgId === '') return
    if (!isTriageableConversation(group) || !this.allowed(group.groupId)) {
      // Still advance the cursor: a conversation we do not act in must not
      // accumulate a backlog that a later allow-list change would replay.
      this.state.setCursor(group.groupId, group.lastMsgId)
      return
    }
    /*
      在岗声明可能是我们不在线的时候发的，也可能早于新鲜度窗口——每个在岗的群本进程
      读一次近史找它（决策 #63 §8「接单前先读近史」的运行时对偶）。观测缺口之外的
      部分由认领协议兜底，这里只是把缺口缩小。
    */
    if (!this.presenceScanned.has(group.groupId) && this.presenceScanBudget > 0) {
      this.presenceScanBudget -= 1
      this.presenceScanned.add(group.groupId)
      await this.scanPresence(group.groupId).catch(this.onError)
    }
    const cursor = this.state.cursor(group.groupId)
    if (cursor === undefined || this.discovery.has(group.groupId)) {
      const discovered = await this.inspectFirstSeen(group)
      if (discovered !== undefined) this.state.setCursor(group.groupId, discovered)
      return
    }
    if (cursor === group.lastMsgId) {
      await this.recoverSelfCommand(group)
      return
    }
    const messages = await this.client.messages(group.groupId, 20, cursor)
    for (const message of messages) await this.inspectMessage(group, message, messages)
    const newest = messages.at(-1)
    if (newest !== undefined) this.state.setCursor(group.groupId, newest.msgId)
  }

  /**
   * First sight of a conversation: scan back to the freshness cutoff, resuming
   * a truncated scan across polls. The cursor only moves when the scan is
   * complete — a high-water mark confirmed mid-scan would silently skip the
   * pages still unread.
   */
  private async inspectFirstSeen(group: YzjGroup): Promise<string | undefined> {
    const freshness = Math.max(this.config.pollIntervalMs * 3, 30_000)
    const cutoff = this.startedAt - freshness
    const continuation = this.discovery.get(group.groupId)
    const highWater = continuation?.highWater ?? group.lastMsgId
    const latestAt = Date.parse((group.lastMsg?.sendTime ?? group.lastMsgSendTime).replace(' ', 'T'))
    if (!Number.isFinite(latestAt) || latestAt < cutoff) {
      // Nothing fresh here: adopt the high-water mark and stop scanning.
      this.discovery.delete(group.groupId)
      return highWater
    }

    const batch = await this.client.messagesSince(
      group.groupId, cutoff, this.config.discoveryPages, continuation?.anchor,
    )
    const batchIds = new Set(batch.messages.map(message => message.msgId))
    let history: YzjMessage[] = [
      ...batch.messages,
      ...(continuation?.messages ?? []).filter(message => !batchIds.has(message.msgId)),
    ]
    if (batch.truncated && batch.nextAnchor !== undefined) {
      this.discovery.set(group.groupId, { anchor: batch.nextAnchor, highWater, messages: history })
      return undefined
    }
    if (!history.some(message => message.msgId === highWater)) {
      const preview = group.lastMsg
      if (preview === undefined || preview.msgId !== highWater) {
        this.discovery.delete(group.groupId)
        return undefined
      }
      history = [...history, preview]
    }
    for (const message of history) {
      const sentAt = Date.parse(message.sendTime.replace(' ', 'T'))
      if (Number.isFinite(sentAt) && sentAt >= cutoff) {
        await this.inspectMessage(group, message, history)
      }
    }
    this.discovery.delete(group.groupId)
    return highWater
  }

  /**
   * The cursor already sits on the newest message — usually because we sent
   * it. If that newest message is instead the operator's own leading-alias
   * command, it would be stranded behind the cursor forever.
   */
  private async recoverSelfCommand(group: YzjGroup): Promise<void> {
    const preview = group.lastMsg
    const identity = this.identity
    if (preview === undefined || identity === undefined) return
    if (preview.fromOpenId !== identity.openId) return
    if (this.state.isProcessed(preview.msgId)) return
    if (!hasLeadingAlias(preview.content, this.config.aliases)) return
    const sentAt = Date.parse(preview.sendTime.replace(' ', 'T'))
    if (!Number.isFinite(sentAt) || sentAt < this.startedAt - SELF_COMMAND_RECOVERY_MS) return
    const history = await this.client.messages(group.groupId, this.config.contextMessages)
    const message = history.find(candidate => candidate.msgId === preview.msgId)
    if (message !== undefined) await this.inspectMessage(group, message, history)
  }

  private async inspectMessage(
    group: YzjGroup,
    message: YzjMessage,
    batch: readonly YzjMessage[],
  ): Promise<void> {
    if (this.state.isProcessed(message.msgId)) return
    const identity = this.identity
    if (identity === undefined) return

    // 署名协议：带落款的是实例出站——自己的或同侪的，都不是受话 (决策 #63)。
    const signature = readSignature(message.content)
    const outcome = triage({
      group,
      message,
      isOwnOutbound: this.state.isOwnOutbound(
        message.msgId, group.groupId, outboundFingerprint(group.groupId, message.content),
      ),
      isSelfChat: isSelfChat(group, identity),
      ...(signature === undefined ? {} : { signature }),
      aliases: this.config.aliases,
      acceptAccountMentions: this.config.acceptAccountMentions,
      operatorOpenId: identity.openId,
      // 受话判定 (v4.7): identity cannot answer "did the agent send that" —
      // the agent posts under the operator's account — so the outbound
      // registry answers it.
      repliesToAgent: (candidate) => {
        for (const anchor of [candidate.param.replyMsgId, candidate.param.replyRootMsgId]) {
          if (anchor !== undefined && this.state.isOwnOutboundId(anchor)) return true
        }
        return false
      },
      cardForAnchor: anchor => this.ctx.yzjCards.cardForAnchor(anchor),
      resolveKeyword: (cardRef, text) => this.ctx.yzjCards.resolveKeyword(cardRef, text),
    })

    // A trigger's admission is persisted inside `runTrigger` (before the work
    // starts). Everything else is settled here and now.
    if (outcome.kind !== 'trigger') this.state.markProcessed(message.msgId)
    await this.dispatch(group, message, batch, outcome, identity)
  }

  private async dispatch(
    group: YzjGroup,
    message: YzjMessage,
    batch: readonly YzjMessage[],
    outcome: TriageOutcome,
    identity: YzjIdentity,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'echo-suppressed':
      case 'noise':
        return
      case 'peer-echo': {
        /*
          同侪回声只作观测与镜像源，永不受话。观测三种：在岗声明/退岗（级 2 的数据）、
          同侪 ack（级 1/级 3 的数据；打到进行中的回合上还可能让位——梯队高于时序）、
          让位帖（对方让给我，无需动作）。
        */
        const signal = this.observePeer(group.groupId, message)
        const replyTo = message.param.replyMsgId
        if (signal === 'ack' && replyTo !== undefined) {
          await this.orchestrator.onPeerAck(group.groupId, replyTo, {
            openId: outcome.operatorOpenId, name: outcome.operatorName,
          })
        }
        return
      }
      case 'command': {
        /*
          级 0 对象归属也管命令 (v3.23r ②)：回复着同侪实例的消息说 `/cancel`，取消的是**它**的
          话题，不是本机在这个群里最近的那个。不是叫我 → 记一笔让位，丢弃。
        */
        const anchor = message.param.replyMsgId ?? message.param.replyRootMsgId
        const owner = anchor === undefined ? undefined : this.state.peerMessageOf(anchor)
        if (conversationKindForGroup(group) === 'group') {
          const placeKey = placeKeyFor('group', group.groupId)
          if (owner !== undefined) {
            await this.recordYield(placeKey, message.msgId, 'object-owner', owner.openId)
            return
          }
          // 裸命令按同一把刀切，但不等：发言者有实例就是他的实例答，仅本人不答他人的。
          const speakerPeer = message.fromOpenId === identity.openId ? undefined : this.state.peerOf(message.fromOpenId)
          const verdict = resolveCommand({
            speakerOpenId: message.fromOpenId,
            selfOpenId: identity.openId,
            ...(speakerPeer === undefined ? {} : { speakerInstance: { openId: message.fromOpenId, name: speakerPeer.name } }),
            selfScope: this.allowed(group.groupId) ? (this.state.scopeOf(group.groupId) ?? 'all') : 'off',
            peersOnDuty: this.state.peersOnDutyIn(group.groupId),
          })
          if (verdict.kind === 'yield') {
            await this.recordYield(placeKey, message.msgId, verdict.reason, verdict.to)
            return
          }
          if (verdict.kind === 'unserved') {
            await this.recordYield(placeKey, message.msgId, 'presence', undefined)
            return
          }
        }
        await this.runCommand(group, message, outcome.name, outcome.argument, identity)
        return
      }
      case 'card-action': {
        const actor: GraphActor = {
          kind: message.fromOpenId === identity.openId ? 'operator' : 'person',
          openId: message.fromOpenId,
        }
        const result = await this.ctx.yzjCards.act(
          outcome.projection.cardRef, outcome.actionId, actor, 'yzj-text', outcome.input,
        )
        await this.client.send({ groupId: group.groupId }, result.receipt, message.msgId)
        return
      }
      case 'trigger':
        // 私聊对端唯一，无歧义；群场所要先回答「叫的是哪一个」(§6.2 ④′)。
        if (conversationKindForGroup(group) === 'direct') {
          await this.runTrigger(group, message, batch, identity)
          return
        }
        await this.resolveAndRun(group, message, batch, identity, false)
    }
  }

  // ---- 多实例受话唯一律 (决策 #63) -------------------------------------------

  /**
   * 记一条同侪出站的观测。返回它是哪种信号。
   *
   * 能派生就不落图：同侪在岗与同侪 ack 都是群消息流的派生观测，住在运行态。
   */
  private observePeer(groupId: string, message: YzjMessage): PeerSignal | undefined {
    const identity = this.identity
    const signature = readSignature(message.content)
    if (identity === undefined || message.fromOpenId === identity.openId) return undefined
    // 没落款但是机器形状（过渡期的旧构建）：也是实例出站，只是名字不知道。
    if (signature === undefined && !looksLikeInstanceOutbound(message.content)) return undefined
    const time = parseSendTime(message.sendTime) || Date.now()
    const signal = classifyPeerOutbound(message.content)
    const known = this.state.peerOf(message.fromOpenId)?.name
    /*
      名字给人读：让位帖「已由 云小助（张三）接单」、板上「云小助（张三）登记的真身…」。
      旧构建的实例没有落款，名字只能问名录——问一次，记住；问不到就先用 openId，
      不猜。这一趟不等它：观测不该被一次目录读拖住。
    */
    if (signature === undefined && (known === undefined || known === message.fromOpenId)) {
      const openId = message.fromOpenId
      void this.client.usersByOpenId([openId]).then((users) => {
        const user = users.find(candidate => candidate.openId === openId)
        if (user !== undefined && user.name !== openId) this.state.rememberPeer(openId, user.name, time)
      }).catch(this.onError)
    }
    this.state.rememberPeer(message.fromOpenId, signature?.operator ?? known ?? message.fromOpenId, time)
    this.state.recordPeerMessage({
      msgId: message.msgId,
      groupId,
      openId: message.fromOpenId,
      time,
      signal,
      ...(message.param.replyMsgId === undefined ? {} : { replyMsgId: message.param.replyMsgId }),
    })
    if (signal === 'presence-declared' || signal === 'presence-withdrawn') {
      this.state.setPeerPresence(groupId, message.fromOpenId, {
        on: signal === 'presence-declared', msgId: message.msgId, time,
        name: signature?.operator ?? known ?? message.fromOpenId,
      })
    }
    return signal
  }

  /**
   * 桌面读回来的一页消息，顺手当观测 (决策 #63 桌面出站对称的数据基础)。
   *
   * 不在岗的群我们不轮询，于是永远不知道谁在那儿对群在岗——而锚定条要在按下之前说
   * 「本群在岗：云小助（张三）」。群视图本来就要读这一页，零额外调用。
   */
  observeMessages(groupId: string, messages: readonly YzjMessage[]): void {
    for (const message of messages) this.observePeer(groupId, message)
  }

  /** 读一个群的近史（两页）找同侪的在岗声明与出站——接单前、以及每个在岗群每进程一次。 */
  async scanPresence(groupId: string): Promise<void> {
    const newest = await this.client.messages(groupId, 20)
    const earliest = newest[0]
    const older = earliest === undefined ? [] : (await this.client.olderPage(groupId, earliest.msgId)).messages
    for (const message of [...older, ...newest]) this.observePeer(groupId, message)
  }

  /**
   * 四级解析：受话成立后、入队前，回答「叫的是哪一个」。
   *
   * @param waited - 这条触发已经为发言者实例让过一个轮询周期。
   */
  private async resolveAndRun(
    group: YzjGroup,
    message: YzjMessage,
    batch: readonly YzjMessage[],
    identity: YzjIdentity,
    waited: boolean,
  ): Promise<void> {
    const groupId = group.groupId
    const placeKey = placeKeyFor('group', groupId)
    // 级 0 的材料：回复指向的那条消息在谁的图上。先看直接回复的，再看链根。
    let objectOwner: 'self' | 'peer' | 'unknown' = 'unknown'
    let objectOwnerOpenId: string | undefined
    for (const anchor of [message.param.replyMsgId, message.param.replyRootMsgId]) {
      if (anchor === undefined) continue
      const known = this.state.peerMessageOf(anchor)
      const inBatch = batch.find(candidate => candidate.msgId === anchor)
      const peerOpenId = known?.openId
        ?? (inBatch !== undefined && inBatch.fromOpenId !== identity.openId
          && (readSignature(inBatch.content) !== undefined || looksLikeInstanceOutbound(inBatch.content))
          ? inBatch.fromOpenId
          : undefined)
      if (peerOpenId !== undefined) {
        objectOwner = 'peer'
        objectOwnerOpenId = peerOpenId
        break
      }
      if (this.state.isOwnOutboundId(anchor)) {
        objectOwner = 'self'
        break
      }
    }
    const speakerPeer = message.fromOpenId === identity.openId
      ? undefined
      : this.state.peerOf(message.fromOpenId)
    const resolution = resolveAddressee({
      speakerOpenId: message.fromOpenId,
      selfOpenId: identity.openId,
      objectOwner,
      ...(objectOwnerOpenId === undefined ? {} : { objectOwnerOpenId }),
      ...(speakerPeer === undefined
        ? {}
        : { speakerInstance: { openId: message.fromOpenId, name: speakerPeer.name } }),
      waited,
      speakerAcked: this.state.peerAcksOn(groupId, message.msgId)
        .some(ack => ack.openId === message.fromOpenId),
      selfScope: this.allowed(groupId) ? (this.state.scopeOf(groupId) ?? 'all') : 'off',
      peersOnDuty: this.state.peersOnDutyIn(groupId),
    })
    switch (resolution.kind) {
      case 'mine':
        await this.runTrigger(group, message, batch, identity, {
          tier: resolution.tier, tiebreak: resolution.tiebreak, contenders: resolution.contenders,
        })
        return
      case 'wait':
        /*
          发言者有自己的实例：让它先。**落盘**而不是留在内存——游标已经过了这条消息，
          进程这时崩掉它就永远没人看了。不标 processed：一周期后它还要走一次入场。
        */
        this.state.park({ group, message, readyAt: Date.now() + this.config.pollIntervalMs })
        await this.state.save()
        return
      case 'yield':
        this.state.markProcessed(message.msgId)
        await this.recordYield(placeKey, message.msgId, resolution.reason, resolution.to)
        return
      case 'unserved':
        // 仅本人合同：他人的受话本实例不接。记一笔无对象的让位——「为什么没接」要可答。
        this.state.markProcessed(message.msgId)
        await this.recordYield(placeKey, message.msgId, 'presence', undefined)
    }
  }

  /** 让过一周期的触发，到点再看一次：发言者实例接了就静默让位，没接就往下走。 */
  private async reviewParked(): Promise<void> {
    const identity = this.identity
    if (identity === undefined) return
    const now = Date.now()
    for (const parked of this.state.parked()) {
      if (parked.readyAt > now) continue
      this.state.unpark(parked.message.msgId)
      if (this.state.isProcessed(parked.message.msgId)) continue
      let batch: YzjMessage[] = []
      try {
        batch = await this.client.messages(parked.group.groupId, 20)
      } catch (error) {
        this.onError(error)
      }
      await this.resolveAndRun(parked.group, parked.message, batch, identity, true)
    }
  }

  /** 让位留痕：静默让位无帖但有账。 */
  private async recordYield(
    placeKey: string, triggerMsgId: string, reason: YieldReason, to: string | undefined,
  ): Promise<void> {
    try {
      await this.ctx.yzjGraph.append({
        type: 'presence/yielded',
        data: {
          placeKey,
          triggerAnchor: `yzj:${triggerMsgId}`,
          reason,
          ...(to === undefined ? {} : { toOperatorOpenId: to }),
        },
        actor: { kind: 'system' },
      })
    } catch (error) {
      this.onError(error)
    }
  }

  /** 本实例在这个群是否已向群声明过对群在岗（图上的在岗对象）。 */
  declaredIn(groupId: string): boolean {
    const object = this.ctx.yzjGraph.rawObject('presence', placeKeyFor('group', groupId))
    return asString(asRecord(object?.state)?.status) === 'declared'
  }

  /** 这个群的在岗图景：本实例的范围与同侪的声明。 */
  presenceIn(groupId: string): PresenceView {
    const placeKey = placeKeyFor('group', groupId)
    const object = this.ctx.yzjGraph.rawObject('presence', placeKey)
    const declared = asString(asRecord(object?.state)?.status) === 'declared'
    const anchor = declared ? asString(asRecord(object?.state)?.msgAnchor) : undefined
    return {
      self: this.allowed(groupId) ? (this.state.scopeOf(groupId) ?? 'all') : 'off',
      ...(anchor === undefined ? {} : { selfAnchor: anchor }),
      ...(declared && object !== undefined ? { selfSince: object.updatedAt } : {}),
      peers: this.state.peersOnDutyIn(groupId)
        .map(peer => ({ openId: peer.openId, name: peer.name, since: peer.since })),
    }
  }

  /**
   * 向群发一次在岗声明并记岗。**发不出去也记岗**——但返回 false，面板要说「群里还不知道」。
   *
   * 接单 = 人签发的身份/听众敏感动作；群即审计面（v3.15⑤ 兑现，三方知情零新机制）。
   */
  async declarePresence(groupId: string): Promise<boolean> {
    const identity = this.identity
    if (identity === undefined) throw new Error('云之家身份尚未就绪')
    let msgId: string | undefined
    try {
      msgId = (await this.client.send({ groupId }, presenceDeclaration(identity.name))).msgId
    } catch (error) {
      this.onError(error)
    }
    const groupName = this.groupNameOf(groupId)
    await this.ctx.yzjGraph.append({
      type: 'presence/declared',
      data: {
        placeKey: placeKeyFor('group', groupId),
        scope: 'all',
        ...(msgId === undefined ? {} : { msgAnchor: msgId }),
        ...(groupName === undefined ? {} : { groupName }),
      },
      actor: this.ctx.yzjCards.desktopActor(),
    })
    return msgId !== undefined
  }

  /** 退岗帖 + 退岗记录。在岗移交 = 这一帖 + 接岗者自己的在岗帖。 */
  async withdrawPresence(groupId: string): Promise<boolean> {
    const identity = this.identity
    if (identity === undefined) throw new Error('云之家身份尚未就绪')
    let msgId: string | undefined
    try {
      msgId = (await this.client.send({ groupId }, presenceWithdrawal(identity.name))).msgId
    } catch (error) {
      this.onError(error)
    }
    await this.ctx.yzjGraph.append({
      type: 'presence/withdrawn',
      data: {
        placeKey: placeKeyFor('group', groupId),
        ...(msgId === undefined ? {} : { msgAnchor: msgId }),
      },
      actor: this.ctx.yzjCards.desktopActor(),
    })
    return msgId !== undefined
  }

  private async routeFor(
    group: YzjGroup,
    message: YzjMessage,
    context: readonly YzjMessage[],
    identity: YzjIdentity,
  ): Promise<YzjTopicRoute> {
    const topicRootId = resolveTopicRootId(
      group, message, context, (groupId, msgId) => this.state.topicForMessage(groupId, msgId),
    )
    const provisional = topicRouteFor(identity, group, message, context, topicRootId, 1)
    const generation = this.state.generation(provisional.topicKey)
    const route = generation === 1
      ? provisional
      : topicRouteFor(identity, group, message, context, topicRootId, generation)
    if (this.ctx.yzjGraph.topicHandle(route.topicKey) === undefined) {
      await this.ctx.yzjGraph.append({
        type: 'topic/registered',
        data: {
          topicKey: route.topicKey,
          placeKey: route.placeKey,
          conversationKind: route.conversationKind,
          generation: route.generation,
          label: route.topicLabel,
          topicRootId: route.topicRootId,
          groupId: route.groupId,
          groupName: route.groupName,
        },
        actor: { kind: 'system' },
      })
    }
    return route
  }

  /**
   * Say something into a place from the desktop — and ignite it when the
   * agent is among the addressees.
   *
   * The ignition half is not an optimisation, it is the only way this works at
   * all: our own outbound is echo-suppressed on the way back in (§6.3), so a
   * `@next` typed at the desktop would post into the group and then be
   * discarded by our own triage. The composer's 受话 question would have been
   * answerable but never answered.
   *
   * Ignition runs the SAME path an inbound trigger runs — same route minting,
   * same chain anchoring, same admission record — because a topic born from
   * the desktop and one born from the phone must be the same object.
   */
  async sendFromDesktop(
    placeKey: string,
    text: string,
    replyTo?: string,
  ): Promise<DeskSend> {
    const identity = this.identity
    if (identity === undefined) throw new Error('云之家身份尚未就绪')
    const groupId = groupIdFromPlaceKey(placeKey)
    if (groupId === undefined) throw new Error(`认不出这个场所：${placeKey}`)

    const listed = this.state.conversation(groupId)
    /*
      **桌面出站对称** (决策 #63)：本实例不在岗而有同侪对群在岗 → 话照发、不就地点火，
      由它接单；回复的是同侪实例的消息 → 真身在对方图上，动作经文本到达它。
    */
    const peersOnDuty = this.state.peersOnDutyIn(groupId)
    const repliedPeer = replyTo === undefined ? undefined : this.state.peerMessageOf(replyTo)
    const deferTo = repliedPeer !== undefined
      ? { openId: repliedPeer.openId, name: this.state.peerOf(repliedPeer.openId)?.name ?? repliedPeer.openId }
      : peersOnDuty[0] === undefined
        ? undefined
        : { openId: peersOnDuty[0].openId, name: peersOnDuty[0].name }
    const plan = deskSendPlan({
      feed: listed !== undefined && listed.type !== 1 && listed.type !== 2,
      peerOnDuty: peersOnDuty.length > 0,
      repliesToPeer: repliedPeer !== undefined,
      addressesAgent: isAgentTrigger(
        { msgId: '', content: text, fromOpenId: identity.openId, msgType: 'text', sendTime: '', param: {} },
        this.config.aliases,
        this.config.acceptAccountMentions,
      ),
      // The AGENT's own messages, not everything this desk ever sent. The
      // outbound registry records both — it exists so we do not answer
      // ourselves — so asking it "is this ours" answered a different question
      // and made replying to your OWN message in an off-duty place a refusal
      // with no `@` in it to remove.
      // 显式叫了人的回复不算向 agent 受话（v4.7 澄清）——桌面这一侧只有正文层面可看。
      repliesToAgent: replyTo !== undefined && this.state.isAgentOutboundId(replyTo)
        && !mentionsPeopleInText(text, this.config.aliases),
      // An assistant or system feed is a subscription, not a conversation:
      // triage refuses those types outright, so igniting in one would run a
      // turn whose answers nobody can reply to. With the shipped default of an
      // empty allow-list ("every conversation"), the gate said yes to all 63
      // of them while the column correctly said no.
      onDuty: this.allowed(groupId)
        && (listed === undefined || listed.type === 1 || listed.type === 2),
    })
    if (plan === 'refuse-feed') return { ignited: false, refused: 'feed' }
    if (plan === 'refuse') return { ignited: false, refused: 'not-on-duty' }
    if (plan === 'send-deferred') {
      const sent = await this.client.send({ groupId }, text, replyTo, 'desk')
      return {
        ...(sent.msgId === undefined ? {} : { msgId: sent.msgId }),
        ignited: false,
        ...(deferTo === undefined ? {} : { deferredTo: deferTo }),
      }
    }
    const addressed = plan === 'send-and-ignite'

    /*
      Everything that can fail happens BEFORE the send, or is contained after
      it. A send is irreversible: reporting a delivered message as failed makes
      the operator retry, and the group gets it twice. So the group is resolved
      from the roster first (free, and complete — `recentGroups` reads only the
      first `groupPages` pages and rate-limits when called right after a send),
      and anything that still goes wrong afterwards is reported as "sent but
      not ignited" rather than as a failure to send.
    */
    const group = addressed
      ? this.groupFromRoster(groupId)
        ?? (await this.client.recentGroups(this.config.groupPages))
          .find(candidate => candidate.groupId === groupId)
      : undefined
    if (addressed && group === undefined) throw new Error('这个场所不在最近会话里')

    const sent = await this.client.send({ groupId }, text, replyTo, 'desk')
    if (sent.msgId === undefined) return { ignited: false }
    if (!addressed || group === undefined) return { msgId: sent.msgId, ignited: false }

    const message: YzjMessage = {
      msgId: sent.msgId,
      content: text,
      fromOpenId: identity.openId,
      msgType: 'text',
      sendTime: new Date().toISOString().replace('T', ' ').slice(0, 23),
      param: replyTo === undefined ? {} : { replyMsgId: replyTo },
    }
    try {
      /*
        **桌面出站分诊，与入站③对称** (v3.15 裁决③).

        入站有一条规则：回复锚命中一张已投影的卡、文本命中它的动词 → 那是一次**应答**，
        不是一次触发。桌面这条路绕过了整个分诊直接 `runTrigger`——于是在私聊面对着一张
        卡回一句「确认」，落成的是 `task/opened`：**开了一个没人要的任务，而那张卡还在
        等人答**。同一个手势在两个入口一个算应答一个算下单，正是「同一投影任一处应答
        全局生效」这条定律最不能出的错。

        判据与入站是**同两个函数**（`cardForAnchor` / `resolveKeyword`），不另写一份：
        两份判断迟早在「哪些词算确认」上分道扬镳。
      */
      const answered = await this.answerCardFromDesk(groupId, message, identity)
      if (answered) return { msgId: sent.msgId, ignited: false }
      const batch = await this.client.messages(groupId, 20)
      const born = await this.runTrigger(group, message, [...batch, message], identity)
      return { msgId: sent.msgId, ignited: true, ...(born === undefined ? {} : { sessionId: born }) }
    } catch (error) {
      // The words are in the group. Saying "failed" now would be a lie about
      // the only irreversible thing that happened.
      this.onError(error)
      return { msgId: sent.msgId, ignited: false }
    }
  }

  /**
   * 给一个还没聊过的人发第一句 —— **私聊在这一刻出生** (v4.24 场所选项集).
   *
   * 和 `sendFromDesktop` 的顺序恰好相反,而那是被平台逼出来的:那边先解析场所再发送
   * （因为发送不可逆,能先失败的都先失败）;这边**根本没有场所可解析**——它是这次发送的
   * 产物,groupId 要等回包。
   *
   * 于是发送之后的每一步都必须是**可以失败而不改口的**:话已经出去了,再说「没发出去」
   * 就是在唯一不可逆的那件事上撒谎。所以点火拿不到名录时返回 `ignited: false`,而不是
   * 抛错——那句话在对方的窗口里,板上那条登记也照落。
   */
  async sendToPerson(openId: string, text: string): Promise<DeskSend & { placeKey?: string }> {
    const identity = this.identity
    if (identity === undefined) throw new Error('云之家身份尚未就绪')
    const sent = await this.client.send({ toOpenId: openId }, text, undefined, 'desk')
    const groupId = sent.groupId
    if (sent.msgId === undefined || groupId === undefined) {
      return { ...(sent.msgId === undefined ? {} : { msgId: sent.msgId }), ignited: false }
    }
    const placeKey = placeKeyFor('direct', groupId)
    const addressed = isAgentTrigger(
      { msgId: '', content: text, fromOpenId: identity.openId, msgType: 'text', sendTime: '', param: {} },
      this.config.aliases,
      this.config.acceptAccountMentions,
    )
    if (!addressed || !this.allowed(groupId)) {
      return { msgId: sent.msgId, placeKey, ignited: false }
    }
    try {
      const group: YzjGroup = {
        groupId, groupName: '', groupType: 1, lastMsgId: sent.msgId, lastMsgSendTime: '',
      }
      const message: YzjMessage = {
        msgId: sent.msgId,
        content: text,
        fromOpenId: identity.openId,
        msgType: 'text',
        sendTime: new Date().toISOString().replace('T', ' ').slice(0, 23),
        param: {},
      }
      const born = await this.runTrigger(group, message, [message], identity)
      return {
        msgId: sent.msgId, placeKey, ignited: true,
        ...(born === undefined ? {} : { sessionId: born }),
      }
    } catch (error) {
      this.onError(error)
      return { msgId: sent.msgId, placeKey, ignited: false }
    }
  }

  /**
   * A conversation the roster remembers but this poll's page window missed.
   *
   * `recentGroups` reads only `groupPages` pages; the roster is everything
   * ever seen. Igniting in an on-duty place must not depend on that place
   * happening to sit in today's first sixty rows.
   */
  /**
   * 这个群叫什么 —— 给审计读的，不是给逻辑用的 (v3.15 裁决⑤).
   *
   * `placeKey` 是个 id，回头查「谁把 agent 接进了哪个群」时人认不出它是哪一间屋子。
   * 名录里没有就返回 undefined——**不猜**，宁可那一笔只有 id。
   */
  groupNameOf(groupId: string): string | undefined {
    return this.state.conversation(groupId)?.name
  }

  private groupFromRoster(groupId: string): YzjGroup | undefined {
    const record = this.state.conversation(groupId)
    if (record === undefined) return undefined
    return {
      groupId,
      groupName: record.name,
      groupType: record.type,
      lastMsgId: record.lastMsgId,
      lastMsgSendTime: '',
    }
  }

  /**
   * 桌面发出去的这句话，是不是在**答一张卡** (v3.15 裁决③ 出站分诊对称).
   *
   * 回 true 表示它已经按应答处理过了，调用方不要再开 turn。
   *
   * 与入站分诊③ 共用同两个函数，连「不是关键词就当普通话语」这一步也一样：一张卡
   * 也是 agent 说的话，对着它说一句别的，本来就该是一次触发。
   */
  private async answerCardFromDesk(
    groupId: string, message: YzjMessage, identity: YzjIdentity,
  ): Promise<boolean> {
    const answer = triageOutbound({
      text: message.content,
      ...(message.param.replyMsgId === undefined ? {} : { replyTo: message.param.replyMsgId }),
      aliases: this.config.aliases,
      cardForAnchor: anchor => this.ctx.yzjCards.cardForAnchor(anchor),
      resolveKeyword: (cardRef, text) => this.ctx.yzjCards.resolveKeyword(cardRef, text),
    })
    if (answer === undefined) return false
    const result = await this.ctx.yzjCards.act(
      answer.projection.cardRef,
      answer.actionId,
      { kind: 'operator', openId: identity.openId },
      // 与入站③ 同一个投影面：文本面是四通道之一，动作在哪一面按下都全局生效。
      'yzj-text',
      answer.input,
    )
    /*
      回执也要发出去 —— 和入站那一路一字不差。

      群里看得见的是那句「确认」，看不见的是它到底生效了没有。入站路径一直把回执贴
      回去；桌面这一路不贴，同一个动作在两个入口就有两种可见后果。
    */
    await this.client.send({ groupId }, result.receipt, message.msgId)
    return true
  }

  /**
   * @returns 这句话落进的那个话题的 sessionId —— 主楼委派长出的新话题要挂目标语境,
   *   而在这之前桌面那一侧无从知道它叫什么。没被受理（重复入场）时是 undefined。
   */
  private async runTrigger(
    group: YzjGroup,
    message: YzjMessage,
    batch: readonly YzjMessage[],
    identity: YzjIdentity,
    /** 四级解析的结果。私聊与桌面点火没有它：对端唯一 / 发言者就是本人。 */
    claim?: { tier: ClaimTier; tiebreak: 'sole' | 'msgId'; contenders: readonly string[] },
  ): Promise<string | undefined> {
    const lookup = (groupId: string, msgId: string): string | undefined => (
      this.state.topicForMessage(groupId, msgId)
    )
    const rootId = resolveTopicRootId(group, message, batch, lookup)
    const context = await this.client.contextFor(
      group, message, this.config.contextMessages, rootId, lookup,
    )
    const route = await this.routeFor(group, message, context, identity)
    for (const candidate of context) {
      if (resolveTopicRootId(group, candidate, context, lookup) === route.topicRootId) {
        this.state.recordMessageTopic(group.groupId, candidate.msgId, route.topicRootId)
      }
    }
    this.state.recordMessageTopic(group.groupId, message.msgId, route.topicRootId)
    this.lastRoutes.set(group.groupId, route)

    // Persist the admission BEFORE the work starts; a failed write un-admits
    // rather than leaving a task that is neither pending nor running.
    if (!this.state.admit({
      group, message, route, admittedAt: Date.now(), ...(claim === undefined ? {} : { claim }),
    })) return undefined
    try {
      await this.state.save()
    } catch (error) {
      this.state.forget(message.msgId)
      throw error
    }
    this.orchestrator.enqueue(group, message, route, context, claim)
    return route.sessionId
  }

  /**
   * Commands run on the bypass channel. A bare command with no reply anchor
   * addresses the conversation's most recent topic — "cancel what you are
   * doing here" is what an operator means when they type it into a group.
   */
  private async runCommand(
    group: YzjGroup,
    message: YzjMessage,
    name: string,
    argument: string,
    identity: YzjIdentity,
  ): Promise<void> {
    const reply = async (text: string): Promise<void> => {
      await this.client.send({ groupId: group.groupId }, text, message.msgId)
    }
    if (!LIVE_COMMANDS.has(name)) {
      await reply(`未知命令 /${name}。现有命令：/new /reset /cancel /done /reject /link /unlink /handoff /fork /status。`)
      return
    }
    const anchored = message.param.replyMsgId ?? message.param.replyRootMsgId
    const route = (anchored === undefined ? undefined : this.routeForAnchor(group, anchored, identity))
      ?? this.lastRoutes.get(group.groupId)
      // In-memory recency dies with the process, but the graph remembers every
      // topic this place has. A bare command after a restart must not be told
      // there is no topic here when the record plainly says otherwise.
      ?? this.latestTopicIn(group, identity)
    if (route === undefined) {
      await reply('这个会话里还没有进行中的话题。')
      return
    }

    if (name === 'cancel') {
      const cancelled = await this.orchestrator.cancelTopic(route)
      await reply(cancelled ? '已取消当前话题的执行。' : '当前话题没有进行中的执行。')
      return
    }
    if (name === 'status') {
      await reply(this.renderStatus(route))
      return
    }
    if (name === 'done' || name === 'reject') {
      await reply(await this.settleTask(route, name, argument, message.fromOpenId))
      return
    }
    if (name === 'link') {
      await reply(await this.linkGoal(route, argument))
      return
    }
    if (name === 'unlink') {
      await reply(await this.unlinkGoal(route, message.fromOpenId))
      return
    }
    if (name === 'handoff') {
      await reply(await this.startHandoff(route, argument, identity.openId))
      return
    }
    if (name === 'fork') {
      // A fork is a new generation that keeps the old one addressable — the
      // same mechanism as /new, named for the intent it serves.
      const forked = this.state.advanceGeneration(route.topicKey)
      await this.ctx.yzjGraph.append({
        type: 'topic/generation-advanced',
        data: { topicKey: route.topicKey, generation: forked },
        actor: { kind: 'operator', openId: message.fromOpenId },
      })
      this.lastRoutes.delete(group.groupId)
      await this.state.save()
      await reply(`已从当前话题分叉（第 ${String(forked)} 代）${argument === '' ? '' : `：${argument}`}。原话题仍可回复继续。`)
      return
    }
    // /new and /reset: advance the generation so the next trigger in this
    // conversation mints a fresh session. In a DM this is the ONLY way to
    // segment the running conversation (§1.7).
    const generation = this.state.advanceGeneration(route.topicKey)
    await this.ctx.yzjGraph.append({
      type: 'topic/generation-advanced',
      data: { topicKey: route.topicKey, generation },
      actor: { kind: 'operator', openId: message.fromOpenId },
    })
    this.lastRoutes.delete(group.groupId)
    await this.state.save()
    await reply(argument === ''
      ? `已开启新会话（第 ${String(generation)} 代），此前上下文不再带入。`
      : `已开启新会话（第 ${String(generation)} 代）。请 @ 我并说明任务：${argument}`)
  }

  /** `/status` — the pull view, rendered from the same query the model uses. */
  private renderStatus(route: YzjTopicRoute): string {
    const viewer = route.conversationKind === 'group'
      ? { kind: 'place' as const, placeKey: route.placeKey }
      : { kind: 'operator' as const, openId: route.accountOpenId }
    const objects = this.ctx.yzjGraph.query(viewer, { limit: 20 })
      .filter(object => ['commitment', 'waiting', 'approval', 'task', 'conflict'].includes(object.kind))
    const summary = processSummary(this.ctx, { topicKey: route.topicKey, viewer })
    if (objects.length === 0 && summary === undefined) return '（这个范围内暂时没有在跟的东西）'
    return [
      ...(objects.length === 0 ? [] : ['【在跟的】', ...objects.map(describeObject)]),
      ...(summary === undefined ? [] : ['', summary]),
    ].join('\n')
  }

  /** `/done` and `/reject` — acceptance verbs against this topic's task. */
  private async settleTask(
    route: YzjTopicRoute,
    verb: 'done' | 'reject',
    argument: string,
    actorOpenId: string,
  ): Promise<string> {
    const viewer = { kind: 'operator' as const, openId: route.accountOpenId }
    const task = this.ctx.yzjGraph.query(viewer, { kind: 'task', status: ['terminal'] })
      .find(object => asString(asRecord(object.state)?.topicKey) === route.topicKey)
    if (task === undefined) return '这个话题里没有待验收的任务。'
    if (verb === 'reject' && argument === '') return '请说明打回原因：/reject <原因>'
    const result = await this.ctx.yzjCards.act(
      { kind: 'task', id: task.id },
      verb === 'done' ? 'accept' : 'reject',
      { kind: 'operator', openId: actorOpenId },
      'yzj-text',
      argument === '' ? undefined : argument,
    )
    return result.receipt
  }

  /**
   * `/link` — attach or re-attach the parent goal. It doubles as the manual
   * refill verb for a reference whose real body moved (§3.2 truth/changed):
   * a broken link is never silently re-pointed, so a human has to say where.
   */
  private async linkGoal(route: YzjTopicRoute, argument: string): Promise<string> {
    if (argument === '') return '请给出目标引用：/link <目标文档链接或 ID>'
    const viewer = { kind: 'operator' as const, openId: route.accountOpenId }
    const commitment = this.ctx.yzjGraph.query(viewer, { kind: 'commitment', status: ['open'] })
      .find(object => {
        const executor = asRecord(asRecord(object.state)?.executor)
        return asString(executor?.topicKey) === route.topicKey
      })
    if (commitment === undefined) return '这个话题里还没有可挂接的承诺。'
    await this.ctx.yzjGraph.append({
      type: 'commitment/updated',
      data: {
        commitmentId: commitment.id,
        parentGoalRef: argument,
        attachedVia: 'linked',
      },
      actor: { kind: 'operator', openId: route.accountOpenId },
    })
    return `已挂接到目标：${argument}`
  }

  /**
   * `/unlink` —— **摘除**：与收养（`/link`）对称的减法动词 (v4.22 裁决②).
   *
   * 为什么它值得一个自己的动词：作废**杀掉承诺**、移交**换掉执行者**，而这里要做的
   * 只是「这件事不再算在那个目标名下」——那件事还在做，只是它不服务于那个目标了。
   * 用前两个去表达它，都是拿一个语义过重的动作去凑一个轻的意思，而图上留下的是假账。
   *
   * 数据语义与桌面那颗「移出」**同一条**：`commitment/updated` 追加去除 parentGoalRef
   * （更正即追加，`attachedVia: 'detached'` 让出处留痕），行落回无归属组——未挂是合法
   * 状态，所以这是一次搬家，不是一次撤销。
   *
   * 主权：v4.22 写的是「该承诺所挂目标的 owner **或** 承诺 owner」。这里查后者——
   * 目标那一半要先读出它挂在哪、再读那个目标是谁签发的；**先严后宽**，多说一句拒绝
   * 可以改，误摘一条边的账改不回来。
   */
  private async unlinkGoal(route: YzjTopicRoute, fromOpenId: string): Promise<string> {
    const viewer = { kind: 'operator' as const, openId: route.accountOpenId }
    const commitment = this.ctx.yzjGraph.query(viewer, { kind: 'commitment', status: ['open'] })
      .find(object => {
        const state = asRecord(object.state)
        const executor = asRecord(state?.executor)
        return (asString(executor?.topicKey) === route.topicKey
          || asString(state?.topicKey) === route.topicKey)
          && asString(state?.parentGoalRef) !== undefined
          && asString(state?.parentGoalRef) !== ''
      })
    const state = asRecord(commitment?.state)
    const delegatedBy = asString(state?.delegatedBy)
    const plan = unlinkPlan({
      fromOpenId,
      ...(commitment === undefined
        ? {}
        : { attached: delegatedBy === undefined ? {} : { delegatedBy } }),
    })
    // 「没有可摘的」和「不许你摘」是两件事，合成一句会让人以为自己没权限。
    if (plan === 'nothing') return '这个话题里没有挂着目标的承诺——没有可摘的。'
    // 不禁言：说清归谁，并把那条走得通的路指出来。
    if (plan === 'not-mine') return '这条承诺不是你登记的，摘除归登记它的人——你可以直接跟他说一声。'
    // `plan === 'unlink'` 已经蕴含它在场（`nothing` 是它不在场的唯一出口）。
    if (commitment === undefined) return '这个话题里没有挂着目标的承诺——没有可摘的。'
    const was = asString(state?.parentGoalRef)
    await this.ctx.yzjGraph.append({
      type: 'commitment/updated',
      data: { commitmentId: commitment.id, parentGoalRef: '', attachedVia: 'detached' },
      actor: { kind: 'operator', openId: fromOpenId },
    })
    return `已从目标摘除：${was ?? ''}。这件事还在做，只是不再算在那个目标名下（未挂是合法状态，/link 可以再挂回去）。`
  }

  /** `/handoff` — prepare the package, then let the confirmation card decide. */
  private async startHandoff(
    route: YzjTopicRoute,
    argument: string,
    operatorOpenId: string,
  ): Promise<string> {
    const [target, ...rest] = argument.split(/\s+/u)
    if (target === undefined || target === '') {
      return '请给出目标会话：/handoff <群名或群ID> [说明]'
    }
    const deps = {
      ctx: this.ctx,
      client: this.client,
      allowedGroupIds: this.config.allowedGroupIds,
      deniedGroupIds: this.config.deniedGroupIds,
      ...(this.config.serveAll === undefined ? {} : { serveAll: this.config.serveAll }),
      groupPages: this.config.groupPages,
    }
    const prepared = await prepareHandoff(deps, route, target, rest.join(' '))
    if (prepared.kind === 'ambiguous') {
      return [
        `「${target}」匹配到多个会话，请用群 ID 重发：`,
        ...prepared.candidates.map(group => `· ${group.groupName} — ${group.groupId}`),
      ].join('\n')
    }
    if (prepared.kind === 'refused') {
      // The declared fallback: the agent drafts, the operator sends.
      return [
        `无法代发：${prepared.reason}。`,
        '以下是拟好的背景包，你可以自己复制发过去：',
        '',
        prepared.draft,
      ].join('\n')
    }
    this.handoffs.set(prepared.plan.handoffId, prepared.plan)
    await openHandoffCard(deps, prepared.plan, operatorOpenId)
    return `移交待确认：目标「${prepared.plan.targetGroupName}」(${prepared.plan.targetGroupId})。已发确认卡，回复「确认」后才会投递。`
  }

  /**
   * React to an answered handoff card. Called from the graph subscription so
   * either surface's answer drives it.
   */
  async onApprovalDecided(approvalId: string, approved: boolean, by: string): Promise<void> {
    const plan = this.handoffs.get(approvalId)
    if (plan === undefined) return
    this.handoffs.delete(approvalId)
    if (!approved) return
    const deps = {
      ctx: this.ctx,
      client: this.client,
      allowedGroupIds: this.config.allowedGroupIds,
      deniedGroupIds: this.config.deniedGroupIds,
      ...(this.config.serveAll === undefined ? {} : { serveAll: this.config.serveAll }),
      groupPages: this.config.groupPages,
    }
    const { delivered } = await executeHandoff(deps, plan, by)
    if (!delivered) console.error(`[yzj-next-channel] handoff ${approvalId} delivery outcome unknown`)
  }

  /** The most recently registered topic of this place, read from the graph. */
  private latestTopicIn(group: YzjGroup, identity: YzjIdentity): YzjTopicRoute | undefined {
    const placeKey = placeKeyFor(conversationKindForGroup(group), group.groupId)
    const topics = this.ctx.yzjGraph.query(
      { kind: 'operator', openId: identity.openId }, { kind: 'topic', limit: 50 },
    ).filter(object => asString(asRecord(object.state)?.placeKey) === placeKey)
    const newest = topics.at(0)
    if (newest === undefined) return undefined
    const handle = this.ctx.yzjGraph.topicHandle(newest.id)
    if (handle?.topicRootId === undefined) return undefined
    const synthetic: YzjMessage = {
      msgId: handle.topicRootId, content: '', fromOpenId: identity.openId,
      msgType: 'text', sendTime: '', param: {},
    }
    return topicRouteFor(
      identity, group, synthetic, [], handle.topicRootId, handle.generation,
    )
  }

  private routeForAnchor(
    group: YzjGroup,
    anchor: string,
    identity: YzjIdentity,
  ): YzjTopicRoute | undefined {
    const rootId = this.state.topicForMessage(group.groupId, anchor)
      ?? (conversationKindForGroup(group) === 'direct' ? 'direct' : undefined)
    if (rootId === undefined) return undefined
    const synthetic: YzjMessage = {
      msgId: anchor, content: '', fromOpenId: identity.openId, msgType: 'text',
      sendTime: '', param: {},
    }
    const provisional = topicRouteFor(identity, group, synthetic, [], rootId, 1)
    return topicRouteFor(identity, group, synthetic, [], rootId, this.state.generation(provisional.topicKey))
  }
}
