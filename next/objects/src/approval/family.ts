/**
 * The `approval` object family: graph vocabulary plus the pure helpers the
 * card and the answerer share.
 *
 * The state machine is the one the technical plan closed in §5.5 (v2.4/v2.5):
 *
 * ```
 *                 ┌── decided(approved|rejected)   ← terminal
 *   pending ──────┼── expired(timeout)             ← terminal
 *                 └── interrupted ── retry ──► superseded(retryTaskAnchor)  ← terminal
 * ```
 *
 * `interrupted` exists because a restart kills the CARRIER, not the INTENT: a
 * pending question is graph data (§1.9-1), so it comes back answerable. What
 * it does NOT come back as is a standing permission — retry re-issues the work
 * and asks again, because turning an old answer into a cross-turn
 * pre-authorization is a lease's job, and leases are not in P1.
 */

import { createHash } from 'node:crypto'
import { z, type GraphFamily, type JsonValue } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

/** Status vocabulary of one approval. */
export type ApprovalStatus =
  | 'pending' | 'approved' | 'rejected' | 'expired' | 'interrupted' | 'superseded'

/** Materialized approval state. */
export interface ApprovalState {
  readonly approvalId: string
  readonly status: ApprovalStatus
  readonly toolName: string
  readonly reason: string
  readonly level: 'standard' | 'strong'
  /** Full parsed call arguments, shown on the card. */
  readonly args: JsonValue
  /** Canonical digest of `args`, carried into a retry so the work is the same. */
  readonly argsDigest: string
  /** openId permitted to decide. */
  readonly decider: string
  readonly deadline: number
  readonly callId?: string
  readonly sessionAnchor?: string
  readonly topicKey?: string
  readonly placeKey?: string
  readonly audience?: readonly string[]
  readonly note?: string
  readonly decidedBy?: string
  readonly retryTaskAnchor?: string
  /** Set on the interrupted card once its one retry has been spent. */
  readonly retried?: boolean
}

const openedSchema = z.object({
  approvalId: z.string().min(1),
  toolName: z.string().min(1),
  reason: z.string(),
  level: z.enum(['standard', 'strong']),
  args: z.unknown(),
  argsDigest: z.string().min(1),
  decider: z.string().min(1),
  deadline: z.number().int(),
  status: z.literal('pending').default('pending'),
  callId: z.string().optional(),
  sessionAnchor: z.string().optional(),
  topicKey: z.string().optional(),
  placeKey: z.string().optional(),
  audience: z.array(z.string()).optional(),
})

export const approvalFamily: GraphFamily = {
  kind: 'approval',
  events: {
    'approval/opened': { schema: openedSchema },
    'approval/decided': {
      schema: z.object({
        approvalId: z.string().min(1),
        status: z.enum(['approved', 'rejected']),
        decidedBy: z.string().min(1),
        note: z.string().optional(),
      }),
    },
    'approval/expired': {
      schema: z.object({
        approvalId: z.string().min(1),
        cause: z.literal('timeout'),
        status: z.literal('expired').default('expired'),
      }),
    },
    'approval/interrupted': {
      schema: z.object({
        approvalId: z.string().min(1),
        status: z.literal('interrupted').default('interrupted'),
      }),
    },
    'approval/superseded': {
      schema: z.object({
        approvalId: z.string().min(1),
        retryTaskAnchor: z.string().min(1),
        status: z.literal('superseded').default('superseded'),
        retried: z.literal(true).default(true),
      }),
    },
  },
  /**
   * `interrupted` is pending on purpose: the operator can still answer it
   * (with 「重试」), and restart recovery must not treat it as settled.
   */
  pendingStatuses: ['pending', 'interrupted'],
  objectIdOf: (_type, data) => asString(asRecord(data)?.approvalId),
}

/** Terminal statuses — no further action is offered. */
export function isTerminal(status: ApprovalStatus): boolean {
  return status === 'approved' || status === 'rejected'
    || status === 'expired' || status === 'superseded'
}

/**
 * Canonical digest of one call's arguments. Key-sorted so a re-serialization
 * with different key order still matches — this digest is what tells a retry
 * it is re-issuing the same work.
 */
export function digestArgs(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex').slice(0, 16)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

/**
 * Deterministic approval id. Derived from the session and call so the same
 * blocked call cannot open two cards, and so a crash between "graph event
 * written" and "DM sent" is repairable by差额补投 rather than by a duplicate.
 */
export function approvalIdFor(sessionAnchor: string, callId: string): string {
  const hash = createHash('sha256')
    .update('yzj-next-approval-v1').update('\0')
    .update(sessionAnchor).update('\0')
    .update(callId)
    .digest('hex')
    .slice(0, 24)
  return `apv-${hash}`
}

/**
 * Idempotency anchor of the one retry an interrupted approval is allowed
 * (§5.5, v2.5 F16). Computed here, in the state machine — never by the model.
 */
export function retryIdemKeyFor(approvalId: string): string {
  return `${approvalId}:retry`
}
