/**
 * The waiting object — "等待可见" made into a thing rather than a feeling.
 *
 * Three properties the design insists on and that the shape here carries:
 *
 * - **The waited-for party is a first-class field.** Waiting on a third party
 *   (not the operator) was the blind spot outside the inbox's three states;
 *   recording WHO and SINCE WHEN is the whole point.
 * - **Escalation is not a terminal state.** Timing out means shouting louder,
 *   not giving up — an escalated wait is still a wait.
 * - **Same cause, same object.** The idempotency anchor makes a repeated block
 *   reuse one object, so "how long we have been waiting" accumulates truthfully
 *   instead of resetting each time somebody notices it again.
 *
 * The system's own offline state is a waiting object of `kind: 'system'` for
 * one reason: a product whose trust rests on visible waiting cannot be blind
 * to its own silence (§6.5).
 */

import { createHash } from 'node:crypto'
import { z, type GraphFamily } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'
import type { CardDefinition } from '@yzj-next/cards'

export type WaitingStatus = 'open' | 'escalated' | 'closed'

/** Why the wait ended. `task-cancelled` is the cascade from its owning task. */
export type WaitingCloseCause = 'resolved' | 'receipt' | 'task-cancelled'

export interface WaitingState {
  readonly waitingId: string
  readonly status: WaitingStatus
  /** `system` = the channel itself is down; the rest are ordinary work waits. */
  readonly kind: 'operator' | 'third-party' | 'system'
  readonly what: string
  /** openId of the person being waited on, when there is one. */
  readonly waitedFor?: string
  readonly openedAt: number
  readonly topicKey?: string
  readonly placeKey?: string
  readonly audience?: readonly string[]
  readonly idemKey?: string
  readonly escalations?: number
  readonly cause?: WaitingCloseCause
  readonly detail?: string
}

export const waitingFamily: GraphFamily = {
  kind: 'waiting',
  events: {
    'waiting/opened': {
      schema: z.object({
        waitingId: z.string().min(1),
        kind: z.enum(['operator', 'third-party', 'system']),
        what: z.string().min(1),
        openedAt: z.number().int(),
        status: z.literal('open').default('open'),
        waitedFor: z.string().optional(),
        topicKey: z.string().optional(),
        placeKey: z.string().optional(),
        audience: z.array(z.string()).optional(),
        idemKey: z.string().optional(),
      }),
    },
    'waiting/escalated': {
      schema: z.object({
        waitingId: z.string().min(1),
        escalations: z.number().int().min(1),
        detail: z.string(),
        // Deliberately NOT terminal: escalation is volume, not surrender.
        status: z.literal('escalated').default('escalated'),
      }),
    },
    'waiting/closed': {
      schema: z.object({
        waitingId: z.string().min(1),
        cause: z.enum(['resolved', 'receipt', 'task-cancelled']),
        status: z.literal('closed').default('closed'),
      }),
    },
  },
  pendingStatuses: ['open', 'escalated'],
  objectIdOf: (_type, data) => asString(asRecord(data)?.waitingId),
}

/**
 * Idempotency anchor for a wait. Computed here, from the normalized cause —
 * never supplied by a model (§3.2): the same blockage reached twice must land
 * on the same object or the elapsed time is a lie.
 */
export function waitingIdemKeyFor(scope: string, cause: string): string {
  const hash = createHash('sha256')
    .update('yzj-next-waiting-v1').update('\0')
    .update(scope).update('\0')
    .update(cause.replace(/\s+/gu, ' ').trim().toLowerCase())
    .digest('hex')
    .slice(0, 24)
  return `wait:${hash}`
}

/** Deterministic waiting id derived from its anchor. */
export function waitingIdFor(scope: string, cause: string): string {
  return waitingIdemKeyFor(scope, cause).replace('wait:', 'wtg-')
}

function elapsed(openedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - openedAt) / 60_000))
  if (minutes < 60) return `${String(minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${String(hours)} 小时` : `${String(Math.floor(hours / 24))} 天`
}

export const waitingCard: CardDefinition<WaitingState> = {
  type: 'waiting',
  updateStrategy: 'append-echo',

  actions: [
    {
      id: 'resolve',
      label: '已解决',
      keywords: ['已解决', '好了', '解决了', 'done'],
      // Anyone in the audience may close an ordinary wait — the person being
      // waited on is usually not the operator. The system's own wait closes
      // itself when the channel recovers.
      allowedActors: (actor, state) => state.kind !== 'system' && actor.openId !== undefined,
      available: state => state.status !== 'closed',
    },
  ],

  isResolved: state => state.status === 'closed',

  /**
   * 第三层：信号，不进决断面 (v4.15)。
   *
   * 等待在等的是**别人**，不是操作者。它要的是被看见（等了多久、升级了几次），
   * 不是被裁决——把「有人还没回你」画成一件待办，只会让人为别人的沉默签字。
   * 「已解决」这个动词就近长在等待行上。
   */
  demand: state => (
    state.status === 'closed'
      ? undefined
      : { layer: 'signal', mode: 'open-question', label: `等待中：${state.what}` }
  ),

  renderText: state => ({
    body: [
      `⏸ 等待${state.kind === 'system' ? '（系统）' : ''}：${state.what}`,
      state.waitedFor === undefined ? '' : `被等待者：${state.waitedFor}`,
      `已等 ${elapsed(state.openedAt)}${state.escalations === undefined ? '' : `（已升级 ${String(state.escalations)} 次）`}`,
      `[card#waiting:${state.waitingId}]`,
    ].filter(line => line !== '').join('\n'),
    replyHints: state.kind === 'system' ? [] : ['已解决'],
  }),

  onResolved: state => ({
    echoText: `✅ 等待解除：${state.what}（共等 ${elapsed(state.openedAt)}）`,
  }),

  apply: (state, _action, actor) => ({
    events: [{
      type: 'waiting/closed',
      data: { waitingId: state.waitingId, cause: 'resolved' },
      actor,
    }],
  }),
}
