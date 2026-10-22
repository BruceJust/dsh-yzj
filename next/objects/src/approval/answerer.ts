/**
 * The approval answerer: the bridge between DSH's approval seam and the
 * confirmation card object.
 *
 * Routing through `ctx.approval` rather than deciding inside the guard is
 * deliberate (TD-4'): the seam is what appends the official, durable
 * `approval/asked` / `approval/decided` audit pair to the Session log, and
 * those two events are the ONLY durable carrier a rejected approval ever gets
 * — a denied call produces no tool result to hang `presentationMeta` on.
 *
 * Everything else lives in the graph, which is why a restart can pick the
 * question back up (§1.9-1).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { CardProjection, CardRef } from '@yzj-next/cards'
import { asRecord, asString, type GraphEvent, type JsonValue } from '@yzj-next/graph'
import {
  approvalIdFor, digestArgs, isTerminal,
  type ApprovalState, type ApprovalStatus,
} from './family.ts'
import type { PendingAsk } from './asks.ts'
import type { TurnBinding } from '../turns.ts'

/** Surface key of the Yunzhijia text projection of a card. */
export const YZJ_TEXT_SURFACE = 'yzj:text'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * An interrupted approval was retried. The channel re-issues the original
     * work as a NEW turn — deliberately not "let the old answer through", which
     * would silently convert one answer into a cross-turn pre-authorization.
     */
    'yzj-approval/retry-requested'(payload: {
      approvalId: string
      toolName: string
      args: JsonValue
      argsDigest: string
      retryTaskAnchor: string
      sessionAnchor?: string
      topicKey?: string
    }): void
  }
}

export interface ApprovalAnswererConfig {
  /** Confirmation-card TTL, aligned with the task deadline (§5.5). */
  readonly ttlMs: number
}

interface Waiter {
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly cleanup: () => void
}

const askKey = (sessionAnchor: string, callId: string): string => `${sessionAnchor}\0${callId}`

export class ApprovalAnswerer {
  private readonly asks = new Map<string, PendingAsk>()
  private readonly waiters = new Map<string, Waiter>()
  /** 中断的卡到点就过期——它们的回合已经死了，没有 `awaitDecision` 替它们看钟。 */
  private readonly expiries = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ApprovalAnswererConfig,
  ) {}

  /** Guard-side entry point (see {@link PendingAsk}). */
  record(sessionAnchor: string, ask: PendingAsk): void {
    this.asks.set(askKey(sessionAnchor, ask.callId), ask)
  }

  /** Resolve every in-flight wait as cancelled; the restart path takes over. */
  dispose(): void {
    this.disposed = true
    for (const [, waiter] of this.waiters) {
      waiter.cleanup()
      waiter.resolve('cancelled')
    }
    this.waiters.clear()
    this.asks.clear()
    for (const [, timer] of this.expiries) clearTimeout(timer)
    this.expiries.clear()
  }

  /** The `approval/request` waterfall listener. */
  async handle(
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const sessionAnchor = String(request.agent.session.id)
    const callId = request.callId === undefined ? undefined : String(request.callId)
    if (callId === undefined) return next()
    const key = askKey(sessionAnchor, callId)
    const ask = this.asks.get(key)
    // Not one of our gated writes: somebody else's question, somebody else's
    // answer. Passing it down beats claiming it and guessing.
    if (ask === undefined) return next()
    this.asks.delete(key)

    const binding = this.bindingFor(request)
    if (binding === undefined) return next()

    const approvalId = approvalIdFor(sessionAnchor, callId)
    const existing = this.stateOf(approvalId)
    if (existing !== undefined && isTerminal(existing.status)) {
      return outcomeFor(existing.status)
    }
    if (existing === undefined) {
      await this.open(approvalId, ask, binding, sessionAnchor, callId)
    }

    const cardRef: CardRef = { kind: 'approval', id: approvalId }
    await this.deliver(cardRef)
    return this.awaitDecision(approvalId, request.signal)
  }

  /**
   * Restart recovery (§5.5). A pending question is graph data, so it survives
   * — but a TURN-BLOCKING card's tool call died with the turn, so the card
   * comes back as `interrupted` (intent alive, carrier dead) rather than as
   * something a stale answer could still execute. TTL wins over interruption:
   * a card that timed out while the process was down was already answered by
   * the clock.
   *
   * **每一次重启都是，不只第一次**——此前这条只看 `pending`：卡一旦中断，期限就再也没人
   * 看了，每次重启都跳过它，「重试」永远开着。实测一张 8/21 01:20 到期、01:12 被重启
   * 打断的写入确认，在「要你」里挂了 61 天。中断杀死的是载体，可这道题问的是「现在
   * 能不能写」，「现在」有期限；中断不给它续命。
   */
  async recoverPending(binding: TurnBinding | undefined): Promise<void> {
    if (binding === undefined) return
    const now = Date.now()
    const pending = this.ctx.yzjGraph.pendingAnswerables(binding.viewer)
      .filter(object => object.kind === 'approval')
    for (const object of pending) {
      const state = object.state as unknown as ApprovalState
      const cardRef: CardRef = { kind: 'approval', id: state.approvalId }
      if (now > state.deadline) {
        await this.expire(state.approvalId)
        // 中断的那条消息还写着「回复重试」：卡从「要你」里走了，那里欠一句为什么。
        if (state.status === 'interrupted') this.echoResolved(cardRef)
        continue
      }
      this.expireAt(state.approvalId, state.deadline)
      const justNow = state.status === 'pending'
      if (justNow) {
        await this.ctx.yzjGraph.append({
          type: 'approval/interrupted',
          data: { approvalId: state.approvalId },
          actor: { kind: 'system' },
        })
      }
      /*
        中断欠操作者一行字，只欠一次。

        刚被这次重启打断的，回显「因重启中断」；DM 从没发出去的，补投整张卡（差额补投）。
        **早就中断、也早就投出去过的不再回显**——它仍在 pendingAnswerables 里（中断态
        故意算待答，好让人还能按「重试」），于是此前每重启一次，自聊里就多一条一字不差的
        整卡回显：实测 61 天前中断的一张卡，一天里重复了十几遍。

        代价写明：如果上一次进程恰好死在「记下中断」和「回显」之间，那一行就不补了。
        卡本身还在桌面的「要你」里、还能按重试——少一行提醒，好过每次重启刷一遍屏。
      */
      const projected = this.ctx.yzjCards.projectionsOf(cardRef)
        .some((projection: CardProjection) => projection.surface === YZJ_TEXT_SURFACE)
      if (justNow || !projected) await this.deliver(cardRef)
    }
  }

  /** Re-issue request hook: fired when an interrupted card is retried. */
  onGraphEvent(event: GraphEvent): void {
    if (event.type !== 'approval/superseded') return
    const data = asRecord(event.data)
    const approvalId = asString(data?.approvalId)
    const retryTaskAnchor = asString(data?.retryTaskAnchor)
    if (approvalId === undefined || retryTaskAnchor === undefined) return
    const state = this.stateOf(approvalId)
    if (state === undefined) return
    this.ctx.emit('yzj-approval/retry-requested', {
      approvalId,
      toolName: state.toolName,
      args: state.args,
      argsDigest: state.argsDigest,
      retryTaskAnchor,
      ...(state.sessionAnchor === undefined ? {} : { sessionAnchor: state.sessionAnchor }),
      ...(state.topicKey === undefined ? {} : { topicKey: state.topicKey }),
    })
  }

  private bindingFor(request: ApprovalRequest): TurnBinding | undefined {
    const turns = this.ctx.get('yzjTurns')
    return turns?.bindingFor(request.agent) ?? turns?.defaultBinding()
  }

  private stateOf(approvalId: string): ApprovalState | undefined {
    const object = this.ctx.yzjGraph.rawObject('approval', approvalId)
    return object === undefined ? undefined : object.state as unknown as ApprovalState
  }

  private async open(
    approvalId: string,
    ask: PendingAsk,
    binding: TurnBinding,
    sessionAnchor: string,
    callId: string,
  ): Promise<void> {
    await this.ctx.yzjGraph.append({
      type: 'approval/opened',
      data: {
        approvalId,
        toolName: ask.toolName,
        reason: ask.reason,
        level: ask.level,
        args: ask.args,
        argsDigest: digestArgs(ask.args),
        decider: binding.decider,
        deadline: Date.now() + this.config.ttlMs,
        callId,
        sessionAnchor,
        ...(binding.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
        ...(binding.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
        // A confirmation card is never projected into a group in P1, so its
        // audience is the operator alone — recorded, not implied.
        audience: [],
      },
      actor: { kind: 'agent' },
    })
  }

  /**
   * Put (or re-put) the card in front of the operator. When the card already
   * has a text projection we ECHO onto it instead of sending a second copy —
   * the projection registry is what makes that distinction possible.
   */
  private async deliver(cardRef: CardRef): Promise<void> {
    const channel = this.ctx.get('yzjCardChannel')
    if (channel === undefined) return
    const cards = this.ctx.yzjCards
    const existing = cards.projectionsOf(cardRef)
      .filter((projection: CardProjection) => projection.surface === YZJ_TEXT_SURFACE)
    try {
      if (existing.length === 0) {
        await channel.deliverToOperator(cardRef)
        return
      }
      const rendered = cards.renderText(cardRef)
      if (rendered === undefined) return
      for (const projection of existing) await channel.echo(projection, rendered.body)
    } catch (error) {
      // A dead transport must not strand the turn: the desktop card is still
      // live, and channel health is its own visible object (§5.4).
      console.error('[yzj-next-approval] failed to deliver the confirmation card', error)
    }
  }

  /** 中断的卡还在期限内：到点还没人按重试，就过期，并在它投过的地方说一句。 */
  private expireAt(approvalId: string, deadline: number): void {
    if (this.expiries.has(approvalId)) return
    const timer = setTimeout(() => {
      this.expiries.delete(approvalId)
      if (this.stateOf(approvalId)?.status !== 'interrupted') return
      void this.expire(approvalId)
        .then(() => { this.echoResolved({ kind: 'approval', id: approvalId }) })
        .catch((error: unknown) => {
          console.error('[yzj-next-approval] failed to expire an interrupted card', error)
        })
    }, Math.max(0, deadline - Date.now()))
    timer.unref?.()
    this.expiries.set(approvalId, timer)
  }

  /** 终态回声，走和答卡同一条路（按面去重、贴在原来那条消息上）。 */
  private echoResolved(cardRef: CardRef): void {
    const state = this.ctx.yzjGraph.rawObject(cardRef.kind, cardRef.id)?.state
    const echo = this.ctx.yzjCards.definition(cardRef.kind)?.onResolved?.(state as never)
    if (echo === undefined) return
    this.ctx.emit('yzj-cards/resolved', {
      cardRef, echoText: echo.echoText, projections: this.ctx.yzjCards.projectionsOf(cardRef),
    })
  }

  private async expire(approvalId: string): Promise<void> {
    await this.ctx.yzjGraph.append({
      type: 'approval/expired',
      data: { approvalId, cause: 'timeout' },
      actor: { kind: 'system' },
    })
  }

  /** Block the gated call until the card settles, the clock runs out, or the turn is withdrawn. */
  private awaitDecision(approvalId: string, signal: AbortSignal | undefined): Promise<ApprovalOutcome> {
    const settled = this.stateOf(approvalId)
    if (settled !== undefined && isTerminal(settled.status)) return Promise.resolve(outcomeFor(settled.status))
    if (this.disposed) return Promise.resolve('cancelled')

    return new Promise<ApprovalOutcome>((resolve) => {
      const finish = (outcome: ApprovalOutcome): void => {
        const waiter = this.waiters.get(approvalId)
        if (waiter === undefined) return
        this.waiters.delete(approvalId)
        waiter.cleanup()
        resolve(outcome)
      }

      const offAppend = this.ctx.on('yzj-graph/appended', (event: GraphEvent) => {
        const data = asRecord(event.data)
        if (asString(data?.approvalId) !== approvalId) return
        const state = this.stateOf(approvalId)
        if (state !== undefined && isTerminal(state.status)) finish(outcomeFor(state.status))
      })

      const remaining = Math.max(0, (this.stateOf(approvalId)?.deadline ?? Date.now()) - Date.now())
      const timer = setTimeout(() => {
        void this.expire(approvalId)
          .catch((error: unknown) => {
            console.error('[yzj-next-approval] failed to record the approval timeout', error)
          })
          .finally(() => { finish('rejected') })
      }, remaining)

      const onAbort = (): void => { finish('cancelled') }
      signal?.addEventListener('abort', onAbort, { once: true })

      this.waiters.set(approvalId, {
        resolve,
        cleanup: () => {
          offAppend()
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        },
      })

      if (signal?.aborted === true) finish('cancelled')
    })
  }
}

/**
 * Map a settled card onto the seam's vocabulary. `allowed-once` is the only
 * grant, and a superseded (retried) card is NOT one: the retry re-runs the
 * work and asks again.
 */
function outcomeFor(status: ApprovalStatus): ApprovalOutcome {
  return status === 'approved' ? 'allowed-once' : 'rejected'
}
