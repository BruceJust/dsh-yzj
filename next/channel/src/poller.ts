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
import { describeObject, ownsCommitment, processSummary } from '@yzj-next/objects'
import {
  accountKeyFor, conversationKindForGroup, groupIdFromPlaceKey, hasLeadingAlias,
  isAgentTrigger, isSelfChat, isTriageableConversation, NO_MESSAGE_TIME, outboundFingerprint,
  placeKeyFor, resolveTopicRootId, topicRouteFor,
  type YzjGroup, type YzjIdentity, type YzjMessage, type YzjTopicRoute,
} from './protocol.ts'
import { triage, type TriageOutcome } from './triage.ts'
import { parseSendTime } from './topics.ts'
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
}): 'send' | 'send-and-ignite' | 'refuse' | 'refuse-feed' {
  // Nobody is on the other end of a push feed. Closing the composer in the UI
  // is the first door; this is the one that actually holds.
  if (input.feed === true) return 'refuse-feed'
  // 受话判定 (v4.7): an alias addresses the agent; so does replying to one of
  // its own messages — replying to somebody IS addressing them.
  const addressed = input.addressesAgent || input.repliesToAgent
  if (!addressed) return 'send'
  return input.onDuty ? 'send-and-ignite' : 'refuse'
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
}): boolean {
  if (input.deniedGroupIds.has(input.groupId)) return false
  return input.allowedGroupIds.size === 0 || input.allowedGroupIds.has(input.groupId)
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
      for (const group of await this.client.recentGroups(this.config.groupPages)) {
        await this.inspectGroup(group)
      }
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
        this.orchestrator.enqueue(task.group, task.message, task.route, context)
      })().catch(this.onError)
    }
  }

  private allowed(groupId: string): boolean {
    return onDutyIn({
      groupId,
      allowedGroupIds: this.config.allowedGroupIds,
      deniedGroupIds: this.config.deniedGroupIds,
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

    const outcome = triage({
      group,
      message,
      isOwnOutbound: this.state.isOwnOutbound(
        message.msgId, group.groupId, outboundFingerprint(group.groupId, message.content),
      ),
      isSelfChat: isSelfChat(group, identity),
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
      case 'command':
        await this.runCommand(group, message, outcome.name, outcome.argument, identity)
        return
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
        await this.runTrigger(group, message, batch, identity)
    }
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
  ): Promise<{ msgId?: string; ignited: boolean; refused?: 'not-on-duty' | 'feed' }> {
    const identity = this.identity
    if (identity === undefined) throw new Error('云之家身份尚未就绪')
    const groupId = groupIdFromPlaceKey(placeKey)
    if (groupId === undefined) throw new Error(`认不出这个场所：${placeKey}`)

    const listed = this.state.conversation(groupId)
    const plan = deskSendPlan({
      feed: listed !== undefined && listed.type !== 1 && listed.type !== 2,
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
      repliesToAgent: replyTo !== undefined && this.state.isAgentOutboundId(replyTo),
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
      const batch = await this.client.messages(groupId, 20)
      await this.runTrigger(group, message, [...batch, message], identity)
    } catch (error) {
      // The words are in the group. Saying "failed" now would be a lie about
      // the only irreversible thing that happened.
      this.onError(error)
      return { msgId: sent.msgId, ignited: false }
    }
    return { msgId: sent.msgId, ignited: true }
  }

  /**
   * A conversation the roster remembers but this poll's page window missed.
   *
   * `recentGroups` reads only `groupPages` pages; the roster is everything
   * ever seen. Igniting in an on-duty place must not depend on that place
   * happening to sit in today's first sixty rows.
   */
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

  private async runTrigger(
    group: YzjGroup,
    message: YzjMessage,
    batch: readonly YzjMessage[],
    identity: YzjIdentity,
  ): Promise<void> {
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
    if (!this.state.admit({ group, message, route, admittedAt: Date.now() })) return
    try {
      await this.state.save()
    } catch (error) {
      this.state.forget(message.msgId)
      throw error
    }
    this.orchestrator.enqueue(group, message, route, context)
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
