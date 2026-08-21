/**
 * The orchestrator: sessions per topic, turn binding, outbound discipline, and
 * the lifecycle rules the previous system paid to learn (§1.3).
 *
 * Four of those rules shape everything below:
 *
 * - **Same topic serial, different topics parallel.** One promise chain per
 *   `topicKey`. That queue IS P1's steering semantics — turn to turn, not
 *   mid-step.
 * - **Persist before executing.** A task is admitted, written, and only then
 *   run; a crash replays it. The dedupe row is written in the same breath, so
 *   the replay cannot become a second admission.
 * - **A settled task is never re-run.** On replay, the session log is asked
 *   whether this Yunzhijia message already had a turn. Re-running a write
 *   because we crashed after it is worse than not replying.
 * - **Unknown delivery never double-posts.** If a reply fails mid-flight we do
 *   not know whether it landed, so the task is closed rather than retried.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace'
import { asRecord, asString } from '@yzj-next/graph'
import {
  commitmentIdFor, earnsCommitment, memoriesFor, processSummary, YZJ_TEXT_SURFACE,
  type TurnBinding,
} from '@yzj-next/objects'
import { createHash } from 'node:crypto'
import { renderChatContext, type YzjGroup, type YzjMessage, type YzjTopicRoute } from './protocol.ts'
import { askSourceFor, sourceFor, yzjSourceOf } from './source.ts'
import type { YzjChannelClient } from './client.ts'
import type { ChannelState } from './state.ts'
import type { TopicDescriptor } from './topics.ts'

/** What the model is told about the channel it is speaking through. */
export const CHANNEL_PROMPT = [
  '你正在通过云之家（Yunzhijia）会话处理任务。要点：',
  '- 回复会以纯文本投递到原话题，控制长度，不要使用需要富文本的排版；',
  '- 写操作会经过确认卡；被拒绝时不要重试同一次写入，先说明并等待新指令；',
  '- 需要产出工件时优先落到云之家文档/表格，并在回复里给出链接；',
  '- 学到这里长期成立的做法（口径、惯例、某人的固定偏好）用 memory_note 记一条，并在回复里说明你记了什么，让人能纠正。',
].join('\n')

/** What a read-only projection is told about its own shape. */
const LIGHT_ASK_PROMPT = [
  '这是一次「轻问」：只读投影。',
  '- 你只能查，不能写：任何写工具都会被拒绝，不要尝试；',
  '- 直接回答问题本身，给出数/结论和它的出处，不要展开成任务计划；',
  '- 回答不会被发到群里，只有提问的人看得见。',
].join('\n')

/** A projection nobody is waiting on stops being a projection. */
const LIGHT_ASK_TIMEOUT_MS = 3 * 60_000

/** Raised when a reply may or may not have landed — never retry these. */
export class DeliveryOutcomeUnknownError extends Error {
  constructor(override readonly cause: unknown) {
    super('Yunzhijia reply delivery outcome is unknown')
  }
}

export interface OrchestratorConfig {
  readonly cwd: string
  readonly preset: string
  readonly maxReplyChars: number
  readonly taskTimeoutMs: number
  readonly contextMessages: number
  /** Idle time before a topic's Agent is released (resumable). */
  readonly agentIdleMs: number
}

interface ActiveTurn {
  readonly binding: TurnBinding
  readonly group: YzjGroup
  readonly trigger: YzjMessage
  readonly route: YzjTopicRoute
}

/** Clip one outbound body to the transport's contract. */
export function clipMessage(text: string, max: number): string {
  const body = text.trim() === '' ? '(空回复)' : text.trim()
  return body.length <= max ? body : `${body.slice(0, max - 12)}\n…（已截断）`
}

/** Fold the assistant text and end reason out of one turn's slice of the log. */
export function summarizeTurn(
  events: readonly SessionEvent[],
  firstSeq: number,
  beforeSeq: number = Number.POSITIVE_INFINITY,
): { text: string; reason?: TurnEndReason } {
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

/**
 * The binding a turn started AT THE DESK runs under.
 *
 * The orchestrator only knows about turns it started itself, so a prompt the
 * operator types into a topic session had no binding at all and fell through
 * to the desktop default — which has no place. Everything such a turn learned
 * or produced was then filed under `desktop` / `session:<id>`: a coordinate
 * nothing ever reads back, so a convention learned in a group by typing at the
 * desk was invisible in that very group, and an artifact it wrote landed in
 * no place's pool.
 *
 * Who typed is not what decides the read domain — the audience set is (§1.6).
 * A desk turn inside a topic session therefore runs in that topic's place,
 * under the same conservative single-domain rule as an admitted turn: a group
 * topic reads that place, a DM reads as the operator.
 *
 * @param base - the desktop default binding (operator identity, no place).
 * @param topic - the topic this session belongs to, when it belongs to one.
 * @returns the binding, or `base` when this session is in no place.
 */
export function deskBinding(
  base: TurnBinding | undefined,
  topic: TopicDescriptor | undefined,
): TurnBinding | undefined {
  if (base === undefined || topic === undefined) return base
  return {
    ...base,
    viewer: topic.conversationKind === 'group'
      ? { kind: 'place', placeKey: topic.placeKey }
      : base.viewer,
    topicKey: topic.topicKey,
    placeKey: topic.placeKey,
    audience: [topic.placeKey],
  }
}

/**
 * The outcome of an earlier turn for this exact Yunzhijia message, when the
 * log already has one. Its presence means: do not run this again.
 */
export function priorTurnFor(
  events: readonly SessionEvent[],
  messageId: string,
): { text: string; reason?: TurnEndReason } | undefined {
  let startSeq: number | undefined
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (yzjSourceOf(event.data)?.messageId === messageId) startSeq = event.seq
  }
  if (startSeq === undefined) return undefined
  const next = events.find(event => event.seq > startSeq && event.type === 'user/message')
  return summarizeTurn(events, startSeq, next?.seq)
}

export class YzjOrchestrator {
  private readonly handles = new Map<string, AgentHandle>()
  private readonly creating = new Map<string, Promise<Agent>>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly activeTurns = new Map<Agent, ActiveTurn>()
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Sessions whose Agent would not go quiet; never reopened this run. */
  private readonly quarantined = new Set<string>()
  private defaultTurnBinding: TurnBinding | undefined
  /**
   * The workspace every topic session is attached to.
   *
   * Not cosmetic. The desktop lists sessions BY workspace, and a deployment
   * with no workspace has no way to open — or start — a conversation at all:
   * the home screen sits on "select a workspace" forever and every
   * session-scoped surface has nothing to attach to. Owning one is the
   * difference between a desktop half that exists and one that cannot be
   * reached.
   */
  private workspace: Workspace | undefined
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly client: YzjChannelClient,
    private readonly state: ChannelState,
    private readonly config: OrchestratorConfig,
  ) {}

  /**
   * Ensure the workspace this instance's conversations live in. Idempotent:
   * `create` adopts an existing record for the same canonical path.
   */
  async ensureWorkspace(title: string): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return
    try {
      this.workspace = await registry.create(this.config.cwd, title)
    } catch (error) {
      console.error('[yzj-next-channel] failed to open the workspace', error)
    }
  }

  /** The binding a desktop-originated turn runs under (operator, no place). */
  setDefaultBinding(binding: TurnBinding): void {
    this.defaultTurnBinding = binding
  }

  defaultBinding(): TurnBinding | undefined {
    return this.defaultTurnBinding
  }

  /**
   * The binding this agent's current turn runs under.
   *
   * A turn the orchestrator started has one. A turn the OPERATOR started at
   * the desk does not — and until this fell through to the topic index, it
   * fell through to the desktop default instead, which has no place. Anything
   * that turn learned or produced was then filed under `desktop` /
   * `session:<id>`: a coordinate nothing ever reads back, so a convention
   * learned in a group by typing at the desk was invisible in that very group.
   *
   * A desk turn inside a topic session happens in that topic's place — who
   * typed is not what decides the read domain, the audience set is (§1.6).
   */
  bindingFor(agent: Agent): TurnBinding | undefined {
    const active = this.activeTurns.get(agent)?.binding
    if (active !== undefined) return active
    return deskBinding(
      this.defaultTurnBinding,
      this.ctx.get('yzjTopics')?.topicOf(String(agent.session.id)),
    )
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const agent of this.activeTurns.keys()) agent.cancel({ kind: 'disposed' })
    this.activeTurns.clear()
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    await Promise.allSettled([...this.queues.values()])
    const handles = [...this.handles.values()]
    this.handles.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose()))
  }

  /** Queue one triggered turn on its topic. */
  enqueue(group: YzjGroup, trigger: YzjMessage, route: YzjTopicRoute, context: readonly YzjMessage[]): void {
    const key = route.topicKey
    const previous = this.queues.get(key) ?? Promise.resolve()
    const queued = previous
      .catch(() => undefined)
      .then(() => (this.disposed ? undefined : this.runTurn(group, trigger, route, context)))
      .catch((error: unknown) => { console.error('[yzj-next-channel] turn failed', error) })
      .finally(() => { if (this.queues.get(key) === queued) this.queues.delete(key) })
    this.queues.set(key, queued)
  }

  /** True when this topic currently has work queued or running. */
  isBusy(topicKey: string): boolean {
    return this.queues.has(topicKey)
  }

  private bindingOf(route: YzjTopicRoute, trigger: YzjMessage): TurnBinding {
    return {
      // P1's conservative single-domain rule (§3.3, registered as a known
      // narrowing): a group turn reads only that place; a DM reads as the
      // operator. The full two-domain rule — read by the asker's visible
      // domain, output filtered by the intersection of who is present — needs
      // the organization mirror to resolve audiences to members.
      viewer: route.conversationKind === 'group'
        ? { kind: 'place', placeKey: route.placeKey }
        : { kind: 'operator', openId: route.accountOpenId },
      decider: route.accountOpenId,
      accountKey: route.accountKey,
      accountOrgId: route.accountOrgId,
      accountOpenId: route.accountOpenId,
      topicKey: route.topicKey,
      placeKey: route.placeKey,
      audience: [route.placeKey],
      messageId: trigger.msgId,
      writeMode: 'standard',
    }
  }

  private async runTurn(
    group: YzjGroup,
    trigger: YzjMessage,
    route: YzjTopicRoute,
    context: readonly YzjMessage[],
  ): Promise<void> {
    const agent = await this.ensureAgent(route)
    await agent.whenIdle()

    // Replay guard: this exact message already had a turn in this session.
    const prior = priorTurnFor(agent.session.events, trigger.msgId)
    if (prior !== undefined) {
      await this.deliver(group, trigger, route, prior.text === ''
        ? '【Agent】此任务上次执行未形成终态；为避免重复写入，本次没有自动重跑。'
        : prior.text)
      this.state.completeTask(trigger.msgId)
      await this.state.save()
      return
    }

    const binding = this.bindingOf(route, trigger)
    this.activeTurns.set(agent, { binding, group, trigger, route })
    const taskId = taskIdFor(trigger.msgId)
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await this.openTask(taskId, trigger, route)
      await this.deliver(group, trigger, route, '【Agent】已接收，正在处理。')
      const firstSeq = agent.session.seq
      agent.followup(createUserMessage({
        content: [{
          type: 'text',
          text: buildPrompt(group, context, trigger, route, renderMemory(this.ctx, route)),
        }],
        source: sourceFor(route, trigger.msgId, trigger.fromOpenId),
      }))
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => { resolve('timeout') }, this.config.taskTimeoutMs)
      })
      const outcome = await Promise.race([agent.whenIdle().then(() => 'idle' as const), timedOut])
      if (outcome === 'timeout') {
        // Revoke first, cancel second: a tool already in flight has to lose its
        // authority before the cancellation races it.
        await this.revoke(trigger.msgId)
        agent.cancel({ kind: 'hook', reason: 'Yunzhijia task timeout' })
        await this.voidTask(taskId, '任务超时，已取消')
        await this.deliver(group, trigger, route, '【Agent失败】任务超时，已取消。')
        if (!await this.settlesWithin(agent.whenIdle(), 30_000)) await this.quarantine(agent, route)
        return
      }
      const summary = summarizeTurn(agent.session.events, firstSeq)
      if (summary.reason?.kind === 'error') {
        /*
          载体断了，意图没断 (measured 2026-08-20).

          A failed turn produced nothing to accept, so it must not stay OPEN
          and must not offer an acceptance. But VOIDING it was too final: the
          intent died with the carrier, the trigger was forgotten, and the only
          way to finish the work was to nudge the agent privately — at which
          point the answer had nowhere to go, because the destination lived on
          the turn that had already ended. A 452KB zip was analysed in full and
          never spoken.

          So it becomes 中断: answerable, resumable, and — the whole point —
          resuming delivers to the SAME place it was born for. The address to
          resume from is stored durably, separately from the run queue, so it
          survives a restart without the work retrying itself in a loop.
        */
        const detail = summary.reason.error?.message ?? '未知错误'
        this.state.rememberResumable(taskId, { group, message: trigger, route, admittedAt: Date.now() })
        await this.state.save().catch((error: unknown) => {
          console.error('[yzj-next-channel] failed to store the resume address', error)
        })
        await this.interruptTask(taskId, clipMessage(detail, 200))
        await this.deliver(
          group, trigger, route,
          `【Agent中断】${clipMessage(detail, 600)}\n回复「继续」我接着做，结果仍然发在这里。`,
        )
        return
      }
      if (summary.text.trim() === '') {
        // No failure, but nothing said either: report it plainly rather than
        // dressing silence up as a deliverable.
        await this.voidTask(taskId, '本回合没有产生回复')
        await this.deliver(group, trigger, route, '【Agent】本回合没有产生回复。')
        return
      }
      await this.closeTask(taskId, trigger, route, summary.text, startedAt)
      const replyId = await this.deliver(group, trigger, route, this.finalReply(summary.text, route, taskId))
      // Register the projection so 「验收」/「打回」 replied to THIS message
      // resolve to the task card. Without it the handle in the text is a
      // promise the triage cannot keep.
      if (replyId !== undefined) {
        await this.ctx.yzjCards.project({
          cardRef: { kind: 'task', id: taskId },
          surface: YZJ_TEXT_SURFACE,
          msgAnchors: [replyId],
          placeKey: route.placeKey,
        }).catch((error: unknown) => {
          console.error('[yzj-next-channel] failed to register the task projection', error)
        })
      }
    } catch (error) {
      if (error instanceof DeliveryOutcomeUnknownError) {
        // We do not know whether the message landed. Retrying could double-post
        // into a real group; staying quiet is the lesser failure.
        console.error('[yzj-next-channel] reply delivery outcome unknown; not retrying', error.cause)
      } else {
        throw error
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      this.activeTurns.delete(agent)
      this.scheduleIdle(agent, route)
      this.state.completeTask(trigger.msgId)
      await this.state.save().catch((error: unknown) => {
        console.error('[yzj-next-channel] failed to clear the completed task', error)
      })
    }
  }

  /**
   * Open the task object for this turn. Every triggered turn gets one: the
   * task is the unit acceptance and rejection attach to, and a turn with no
   * object behind it can never be accepted, rejected, or summarized.
   */
  private async openTask(taskId: string, trigger: YzjMessage, route: YzjTopicRoute): Promise<void> {
    if (this.ctx.yzjGraph.rawObject('task', taskId) !== undefined) return
    try {
      await this.ctx.yzjGraph.append({
        type: 'task/opened',
        data: {
          taskId,
          what: trigger.content.replace(/\s+/gu, ' ').trim().slice(0, 200) || '(空任务)',
          topicKey: route.topicKey,
          sourceAnchor: `yzj:${trigger.msgId}`,
          audience: [route.placeKey],
          /*
            验收权在出生时刻就定下 (v3.8r 收紧③：委派者 ∪ 操作者)。

            记在对象上而不是事后从 `sourceAnchor` 反查那条消息:消息会滚出窗口、
            会被撤回,而「这活是谁派的」是验收权的依据,不能取决于一次还读不读
            得到的历史查询。
          */
          ...(trigger.fromOpenId === '' ? {} : { delegatedBy: trigger.fromOpenId }),
          ...(route.accountOpenId === '' ? {} : { operator: route.accountOpenId }),
        },
        actor: { kind: 'agent' },
      })
    } catch (error) {
      console.error('[yzj-next-channel] failed to open the task object', error)
    }
  }

  /** End a task that produced nothing, with the reason on the record. */
  /** 中断：可继续的死法。Only from OPEN — a settled task is not interruptible. */
  private async interruptTask(taskId: string, reason: string): Promise<void> {
    const object = this.ctx.yzjGraph.rawObject('task', taskId)
    if (object === undefined) return
    if (asString(asRecord(object.state)?.status) !== 'open') return
    try {
      await this.ctx.yzjGraph.append({
        type: 'task/interrupted',
        data: { taskId, reason },
        actor: { kind: 'system' },
      })
    } catch (error) {
      console.error('[yzj-next-channel] failed to interrupt the task object', error)
    }
  }

  /**
   * Resume an interrupted task into the landing point it was born with.
   *
   * 原来该发哪里，继续之后的结果就发哪里 — that is the entire property, and it
   * is why this re-enters the normal triggered path rather than nudging the
   * agent: `runTrigger` is what owns delivery, and a resumption that skipped it
   * would strand its answer exactly the way the private nudge did.
   */
  async resumeTask(taskId: string): Promise<boolean> {
    const pending = this.state.resumable(taskId)
    if (pending === undefined) return false
    this.state.dropResumable(taskId)
    await this.state.save().catch(() => undefined)
    this.enqueue(pending.group, pending.message, pending.route, [])
    return true
  }

  private async voidTask(taskId: string, reason: string): Promise<void> {
    const object = this.ctx.yzjGraph.rawObject('task', taskId)
    if (object === undefined) return
    if (asString(asRecord(object.state)?.status) !== 'open') return
    try {
      await this.ctx.yzjGraph.append({
        type: 'task/voided',
        data: { taskId, reason, voidedBy: 'system' },
        actor: { kind: 'system' },
      })
    } catch (error) {
      console.error('[yzj-next-channel] failed to void the task object', error)
    }
  }

  /**
   * Close the turn: record what it produced, and promote it to a commitment
   * only if it EARNED one. "Ask for one number" must not mint a commitment —
   * the pool is the evidence base for whether commitments are worth anything.
   */
  private async closeTask(
    taskId: string,
    trigger: YzjMessage,
    route: YzjTopicRoute,
    summaryText: string,
    startedAt: number,
  ): Promise<void> {
    const artifacts = producedSince(this.ctx, route.topicKey, startedAt)
    try {
      await this.ctx.yzjGraph.append({
        type: 'task/terminal',
        data: {
          taskId,
          summary: summaryText.replace(/\s+/gu, ' ').trim().slice(0, 400),
          artifacts: artifacts.map(artifact => ({ ...artifact })),
        },
        actor: { kind: 'agent' },
      })
    } catch (error) {
      console.error('[yzj-next-channel] failed to close the task object', error)
      return
    }

    // When the task's whole point WAS registering somebody else's commitment,
    // promoting the agent's own turn on top of it books the same utterance
    // twice — once against the person who owes the work and once against the
    // agent that wrote it down. The source anchor is what makes them the same
    // utterance, so it is what tells them apart.
    const anchor = `yzj:${trigger.msgId}`
    for (const object of this.ctx.yzjGraph.query(
      { kind: 'operator', openId: route.accountOpenId }, { kind: 'commitment' },
    )) {
      if (asString(asRecord(object.state)?.sourceAnchor) === anchor) return
    }

    /*
      A task the operator was told was dead must not grow a commitment.

      The task family's reduce now discards a late `task/terminal` — but the
      APPEND still resolves, so execution fell straight through to promotion:
      the board grew an open commitment for work that had already been voided,
      and 催一下 would re-post it into the real group. The tombstone closed the
      front door; this is the one beside it.
    */
    const settled = asString(asRecord(
      this.ctx.yzjGraph.rawObject('task', taskId)?.state,
    )?.status)
    if (settled === 'voided' || settled === 'accepted') return

    const promoted = earnsCommitment({
      hadWriteAction: artifacts.length > 0,
      delegationLanguage: /(负责|你来|安排|交给|盯一下|跟进)/u.test(trigger.content),
    })
    if (!promoted) return
    const what = trigger.content.replace(/\s+/gu, ' ').trim().slice(0, 200)
    const commitmentId = commitmentIdFor(anchor, what)
    if (this.ctx.yzjGraph.rawObject('commitment', commitmentId) !== undefined) return
    try {
      await this.ctx.yzjGraph.append({
        type: 'commitment/opened',
        data: {
          commitmentId,
          what,
          executor: { kind: 'agent', topicKey: route.topicKey },
          sourceAnchor: anchor,
          topicKey: route.topicKey,
          audience: [route.placeKey],
          idemKey: `cmt:${commitmentId.replace('cmt-', '')}`,
        },
        actor: { kind: 'agent' },
      })
    } catch (error) {
      console.error('[yzj-next-channel] failed to promote the task to a commitment', error)
    }
  }

  /**
   * The terminal reply, upgraded to a transparency artifact: the model's answer
   * plus the free projection of what actually happened, and the words that
   * accept or reject it.
   */
  private finalReply(text: string, route: YzjTopicRoute, taskId: string): string {
    const viewer = route.conversationKind === 'group'
      ? { kind: 'place' as const, placeKey: route.placeKey }
      : { kind: 'operator' as const, openId: route.accountOpenId }
    const summary = processSummary(this.ctx, { topicKey: route.topicKey, viewer })
    const body = clipMessage(text, this.config.maxReplyChars)
    return [
      body,
      ...(summary === undefined ? [] : ['', summary]),
      '',
      `回复「验收」或「打回 <原因>」定终态。[card#task:${taskId}]`,
    ].join('\n')
  }

  private async revoke(messageId: string): Promise<void> {
    try {
      await this.ctx.yzjGraph.append({
        type: 'authority/revoked',
        data: { messageId, reason: 'task timeout' },
        actor: { kind: 'system' },
      })
    } catch (error) {
      console.error('[yzj-next-channel] failed to record the authority revocation', error)
    }
  }

  /** Reply into the trigger's topic and index the reply for topic anchoring. */
  private async deliver(
    group: YzjGroup,
    trigger: YzjMessage,
    route: YzjTopicRoute,
    content: string,
  ): Promise<string | undefined> {
    let sent: { msgId?: string }
    try {
      sent = await this.client.send(
        { groupId: group.groupId },
        clipMessage(content, this.config.maxReplyChars),
        trigger.msgId,
      )
    } catch (error) {
      throw new DeliveryOutcomeUnknownError(error)
    }
    if (sent.msgId === undefined) return undefined
    // The agent's own replies belong to the topic index too: a colleague
    // replying to OUR message must land in the same topic (§1.3).
    this.state.recordMessageTopic(group.groupId, sent.msgId, route.topicRootId)
    await this.state.save()
    return sent.msgId
  }

  /** Public reply path for the poller's command and card responses. */
  async reply(group: YzjGroup, trigger: YzjMessage, route: YzjTopicRoute, content: string): Promise<void> {
    await this.deliver(group, trigger, route, content)
  }

  /**
   * 轻问 — one read-only turn that answers a question and produces nothing else.
   *
   * Three things make it a different KIND of turn rather than a shorter one:
   * no task object is opened (there is no deliverable to accept), nothing is
   * posted into the place (the operator asked, not the group), and the binding
   * carries `read-only` so the guard refuses every write for its duration.
   *
   * It still queues on the topic, because a projection read while a task is
   * halfway through writing would answer with a half-written world.
   */
  lightAsk(route: YzjTopicRoute, text: string): Promise<string> {
    const key = route.topicKey
    const previous = this.queues.get(key) ?? Promise.resolve()
    const queued = previous
      .catch(() => undefined)
      .then(() => (this.disposed ? '' : this.runLightAsk(route, text)))
    const tracked: Promise<void> = queued
      .then(() => undefined, () => undefined)
      .finally(() => { if (this.queues.get(key) === tracked) this.queues.delete(key) })
    this.queues.set(key, tracked)
    return queued
  }

  private async runLightAsk(route: YzjTopicRoute, text: string): Promise<string> {
    const agent = await this.ensureAgent(route)
    await agent.whenIdle()
    const synthetic: YzjMessage = {
      msgId: '', content: text, fromOpenId: route.accountOpenId,
      msgType: 'text', sendTime: '', param: {},
    }
    // The gateway's `messageId` is deliberately absent: no inbound message
    // admitted this, so nothing here inherits an inbound message's authority.
    const { messageId: _ignored, ...base } = this.bindingOf(route, synthetic)
    const binding: TurnBinding = { ...base, writeMode: 'read-only' }
    this.activeTurns.set(agent, { binding, group: groupOf(route), trigger: synthetic, route })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const firstSeq = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: `${LIGHT_ASK_PROMPT}\n\n[轻问]\n${text.trim()}` }],
        source: askSourceFor(route),
      }))
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => { resolve('timeout') }, LIGHT_ASK_TIMEOUT_MS)
      })
      const outcome = await Promise.race([agent.whenIdle().then(() => 'idle' as const), timedOut])
      // A failed projection THROWS rather than returning its excuse as prose.
      // Returning "轻问失败：…" as if it were the answer means the caller sees
      // a successful reply, shows no receipt, and the failure is invisible:
      // the ask produces no assistant row either, so nothing at all happens on
      // screen. Failing loudly is the only version the operator can act on.
      if (outcome === 'timeout') {
        agent.cancel({ kind: 'hook', reason: 'light ask timeout' })
        throw new Error('轻问超时，没有结果。')
      }
      const summary = summarizeTurn(agent.session.events, firstSeq)
      if (summary.reason?.kind === 'error') {
        throw new Error(`轻问失败：${summary.reason.error?.message ?? '未知错误'}`)
      }
      if (summary.text.trim() === '') throw new Error('轻问没有产生回答。')
      return summary.text
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      this.activeTurns.delete(agent)
      this.scheduleIdle(agent, route)
    }
  }

  private async ensureAgent(route: YzjTopicRoute): Promise<Agent> {
    const id = SessionId(route.sessionId)
    if (this.quarantined.has(route.sessionId)) {
      throw new Error('Yunzhijia topic Session is quarantined after a non-quiescing cancellation')
    }
    this.clearIdle(route.sessionId)
    const live = this.ctx.agents.get(id)
    if (live !== undefined) return live
    const pending = this.creating.get(route.sessionId)
    if (pending !== undefined) return pending
    const creation = this.createAgent(id, route)
      .finally(() => { this.creating.delete(route.sessionId) })
    this.creating.set(route.sessionId, creation)
    return creation
  }

  private async createAgent(id: SessionId, route: YzjTopicRoute): Promise<Agent> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const preset = await this.ctx.agentPresets.resolve(this.config.preset)
    const setup = async (agentCtx: Context): Promise<void> => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
      await this.ctx.agentPresets.mount(agentCtx, preset.id)
      agentCtx.systemPrompt.section({ name: 'yzj-next:channel', order: 90, text: CHANNEL_PROMPT })
    }
    const persistence = this.ctx.get('sessionPersistence')
    const persisted = persistence === undefined
      ? false
      : (await persistence.list()).some(header => header.id === id)
    const handle = persisted
      ? await this.ctx.agents.resume({ resumeSessionId: id, agentOptions: selection, setup })
      : await this.ctx.agents.create({
        sessionId: id,
        agentOptions: selection,
        meta: { cwd: this.config.cwd, agentPreset: preset.id },
        setup,
      })
    // Attach before the title: an unattached session is invisible in the
    // desktop's own browser no matter what it is called.
    if (this.workspace !== undefined) {
      try {
        await this.workspace.attachSession(id)
      } catch (error) {
        console.error('[yzj-next-channel] failed to attach the session to its workspace', error)
      }
    }
    const current = this.ctx.sessionTitle.get(handle.agent.session)
    if (current === undefined || current.title === this.state.managedTitle(route.sessionId)) {
      const renamed = this.ctx.sessionTitle.rename(handle.agent.session, route.title).title
      this.state.setManagedTitle(route.sessionId, renamed)
    }
    this.handles.set(route.sessionId, handle)
    return handle.agent
  }

  /**
   * Release an idle topic's Agent. The SESSION is untouched — the next message
   * resumes it — so an operator's long-running topic costs nothing while
   * nobody is talking in it.
   */
  private scheduleIdle(agent: Agent, route: YzjTopicRoute): void {
    if (this.disposed || this.config.agentIdleMs <= 0) return
    this.clearIdle(route.sessionId)
    const timer = setTimeout(() => {
      this.idleTimers.delete(route.sessionId)
      const handle = this.handles.get(route.sessionId)
      if (handle?.agent !== agent || this.activeTurns.has(agent)) return
      this.handles.delete(route.sessionId)
      void handle.dispose().catch((error: unknown) => {
        console.error('[yzj-next-channel] failed to release an idle Agent', error)
      })
    }, this.config.agentIdleMs)
    this.idleTimers.set(route.sessionId, timer)
  }

  private clearIdle(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId)
    if (timer !== undefined) clearTimeout(timer)
    this.idleTimers.delete(sessionId)
  }

  /**
   * An Agent that will not go quiet after a cancellation is walled off rather
   * than reused: whatever it is still doing must not receive the next task's
   * authority.
   */
  private async quarantine(agent: Agent, route: YzjTopicRoute): Promise<void> {
    this.quarantined.add(route.sessionId)
    const handle = this.handles.get(route.sessionId)
    this.handles.delete(route.sessionId)
    console.error(`[yzj-next-channel] Session ${route.sessionId} quarantined: cancellation did not settle`)
    if (handle?.agent === agent) {
      await this.settlesWithin(handle.dispose(), 30_000)
    }
  }

  private async settlesWithin(task: PromiseLike<unknown>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve(task).then(() => true, () => false),
        new Promise<false>((resolve) => { timer = setTimeout(() => { resolve(false) }, timeoutMs) }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async cancelTopic(route: YzjTopicRoute): Promise<boolean> {
    const agent = this.ctx.agents.get(SessionId(route.sessionId))
    if (agent === undefined) return false
    const active = this.activeTurns.get(agent)
    if (active !== undefined) await this.revoke(active.trigger.msgId)
    agent.cancel({ kind: 'hook', reason: 'operator issued /cancel' })
    return true
  }
}

/** The place a route names, in the shape the delivery path expects. */
function groupOf(route: YzjTopicRoute): YzjGroup {
  return {
    groupId: route.groupId,
    groupName: route.groupName,
    groupType: route.conversationKind === 'direct' ? 1 : 2,
    lastMsgId: '',
    lastMsgSendTime: '',
  }
}

/** Deterministic task id: one inbound message, one task. */
function taskIdFor(messageId: string): string {
  return `tsk-${createHash('sha256').update('yzj-next-task-v1').update(messageId).digest('hex').slice(0, 20)}`
}

/** Artifacts this topic produced at or after `since`. */
function producedSince(
  ctx: Context,
  topicKey: string,
  since: number,
): { uri: string; placeKey: string; title?: string }[] {
  const out: { uri: string; placeKey: string; title?: string }[] = []
  for (const event of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    if (event.time < since) continue
    const data = asRecord(event.data)
    if (asString(data?.topicKey) !== topicKey) continue
    const artifact = asRecord(data?.artifact)
    const uri = asString(artifact?.uri)
    const placeKey = asString(artifact?.placeKey)
    if (uri === undefined || placeKey === undefined) continue
    const title = asString(artifact?.title)
    out.push({ uri, placeKey, ...(title === undefined ? {} : { title }) })
  }
  return out
}

/**
 * What this place has already taught us, read fresh every turn.
 *
 * Per-turn rather than a system-prompt section fixed at Agent creation: a
 * convention learned at 10:05 has to hold at 10:06, and a topic's Agent can
 * live for hours. The id travels with each line so the model can retire one
 * the moment somebody corrects it — a memory nobody can forget is one nobody
 * keeps trusting.
 */
export function renderMemory(ctx: Context, route: YzjTopicRoute): string {
  const axes: readonly [string, string, string][] = [
    ['place', route.placeKey, '本场所'],
    ['entity', route.accountOpenId, '本人'],
    ['org', route.accountOrgId, '全组织'],
  ]
  const lines: string[] = []
  for (const [axis, scope, label] of axes) {
    for (const memory of memoriesFor(ctx, axis, scope)) {
      lines.push(`- [${memory.id}] ${label}：${memory.summary}`)
    }
  }
  if (lines.length === 0) return ''
  return [
    '[已知惯例]（这里已经学到的做法。发现哪条不再成立，用 memory_forget 忘掉它）',
    ...lines,
  ].join('\n')
}

function buildPrompt(
  group: YzjGroup,
  context: readonly YzjMessage[],
  trigger: YzjMessage,
  route: YzjTopicRoute,
  memory: string,
): string {
  return [
    renderChatContext(group, context, trigger, route),
    ...(memory === '' ? [] : ['', memory]),
    '',
    '[用户任务]',
    trigger.content.trim(),
  ].join('\n')
}
