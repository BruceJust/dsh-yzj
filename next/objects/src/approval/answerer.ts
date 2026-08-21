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
   */
  async recoverPending(binding: TurnBinding | undefined): Promise<void> {
    if (binding === undefined) return
    const now = Date.now()
    const pending = this.ctx.yzjGraph.pendingAnswerables(binding.viewer)
      .filter(object => object.kind === 'approval')
    for (const object of pending) {
      const state = object.state as unknown as ApprovalState
      if (state.status === 'pending' && now > state.deadline) {
        await this.expire(state.approvalId)
        continue
      }
      if (state.status === 'pending') {
        await this.ctx.yzjGraph.append({
          type: 'approval/interrupted',
          data: { approvalId: state.approvalId },
          actor: { kind: 'system' },
        })
      }
      // Whether it was interrupted just now or in an earlier crashed run, an
      // interrupted card owes the operator a line — and a card whose DM never
      // made it out owes them the whole card (差额补投).
      await this.deliver({ kind: 'approval', id: state.approvalId })
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
