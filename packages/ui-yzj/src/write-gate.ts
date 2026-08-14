/**
 * Confirmation-card bridge for yzj write operations (design v1.6 §5.2).
 *
 * How it works within harness constraints: out-of-repo plugins cannot append
 * custom session event types (the generated `KNOWN_SESSION_EVENT_TYPES` set
 * refuses unknown events without an `ignorable` marker, and `Session.append`
 * offers no marker entry). The card therefore rides the OFFICIAL audit path:
 *
 * - `tools/pre-execute` asks (tool-yzj guard) and broadcasts `yzj/ask-pending`
 *   with the full parsed arguments;
 * - this module answers the `approval/request` waterfall for `yzj_*` tools,
 *   keeping an in-memory pending record (status `pending` → `approved` /
 *   `cancelled`) that the browser card queries and decides through RPC;
 * - the official `tools/result` event drives the terminal status (`done` /
 *   `failed`), so replay reconstructs results from the durable tool events
 *   while the card's transient state lives in this process (SPA reloads keep
 *   it; a host restart degrades to the ordinary tool card).
 *
 * The record never enters the model transcript; it is a UI-only decision
 * surface on top of the already-logged tool call.
 *
 * Type hygiene: this package compiles its node half and browser half in ONE
 * program, and importing the host-only packages (`user-approval`,
 * `dsh-session` roots) would merge their `ctx.sessions` declarations over
 * the browser runtime's — so every event contract used here is declared
 * locally with structural types.
 */

import type { Context } from '@deepseek-ai/cordis'

/** The approval vocabulary (mirrors `user-approval`). */
export type YzjApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Structural view of one `approval/request` waterfall question. */
export interface YzjApprovalRequest {
  readonly agent: {
    readonly session: {
      readonly id: string
      readonly events: readonly { type: string; data: unknown }[]
    }
  }
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly signal?: {
    readonly aborted: boolean
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
    removeEventListener(type: 'abort', listener: () => void): void
  }
}

/** The ask-pending contract emitted by `@dsh-yzj/tool-yzj`'s guard. */
export interface YzjWriteAskPending {
  callId: string
  toolName: string
  level: 'standard' | 'strong'
  reason: string
  args: Record<string, unknown>
}

/** One tool execution as seen by `tools/result`. */
interface YzjToolExecShape {
  name: string
  callId: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'yzj/ask-pending'(pending: YzjWriteAskPending): void
    'approval/request'(
      req: YzjApprovalRequest,
      next: () => Promise<YzjApprovalOutcome>,
    ): Promise<YzjApprovalOutcome>
    'tools/result'(
      exec: YzjToolExecShape,
      result: { isError?: boolean; content?: { type: string; text?: string }[] },
    ): void
  }
}

/** Status of one confirmation record. */
export type YzjWriteStatus = 'pending' | 'approved' | 'cancelled' | 'done' | 'failed'

/** One browser-visible confirmation record (lossless JSON). */
export interface YzjWriteRecord {
  /** Stable id — the pairing approval/asked audit id. */
  writeId: string
  sessionId: string
  toolName: string
  callId?: string
  level: 'standard' | 'strong'
  domain: string
  args: Record<string, unknown>
  reason: string
  status: YzjWriteStatus
  error?: string
  time: number
  decidedAt?: number
}

interface LiveRecord extends YzjWriteRecord {
  resolve: ((outcome: YzjApprovalOutcome) => void) | undefined
  removeAbort: (() => void) | undefined
}

/** Minimal structural views over the audit events the pairing scan needs. */
interface AskedEventShape { type: 'approval/asked'; data: { id: string; callId?: string } }
interface DecidedEventShape { type: 'approval/decided'; data: { id: string } }
type AuditEventShape = AskedEventShape | DecidedEventShape | { type: string; data: unknown }

/** Map a tool name to its confirmation-card domain. */
export function domainOf(toolName: string): string {
  if (toolName.startsWith('yzj_im_')) return 'im'
  if (toolName.startsWith('yzj_doc_workspace_')) return 'kb'
  if (toolName.startsWith('yzj_doc_')) return 'doc'
  if (toolName.startsWith('yzj_sheet_')) return 'sheet'
  if (toolName.startsWith('yzj_calendar_')) return 'calendar'
  if (toolName.startsWith('yzj_file_')) return 'file'
  return 'other'
}

/**
 * Find the audit id pairing one approval request: the newest `approval/asked`
 * event with the same callId that is neither decided nor claimed by another
 * pending record (mirrors the apiproxy pairing rule).
 */
function findApprovalId(
  sessionEvents: readonly { type: string; data: unknown }[],
  callId: string | undefined,
  claimed: ReadonlySet<string>,
): string | undefined {
  const decided = new Set<string>()
  for (let index = sessionEvents.length - 1; index >= 0; index -= 1) {
    const event = sessionEvents[index] as AuditEventShape
    if (event.type === 'approval/decided') {
      decided.add((event as DecidedEventShape).data.id)
    } else if (event.type === 'approval/asked') {
      const asked = event as AskedEventShape
      if (decided.has(asked.data.id) || claimed.has(asked.data.id)) continue
      if ((callId ?? null) !== (asked.data.callId ?? null)) continue
      return asked.data.id
    }
  }
  return undefined
}

/**
 * Register the confirmation-card bridge. Returns the query/decide faces the
 * `/yzj` RPC channel exposes to the browser.
 */
export function applyWriteGate(ctx: Context): {
  list: (sessionId: string, callId?: string) => YzjWriteRecord[]
  decide: (writeId: string, outcome: YzjApprovalOutcome) => boolean
} {
  /** callId → ask metadata broadcast by the tool-yzj guard. */
  const askPending = new Map<string, YzjWriteAskPending>()
  /** writeId → live record. */
  const records = new Map<string, LiveRecord>()
  /** Settled records kept for a short window so cards refresh after reload. */
  const settled: YzjWriteRecord[] = []
  const SETTLED_WINDOW = 200

  const statusOf = (outcome: YzjApprovalOutcome): YzjWriteStatus =>
    outcome === 'allowed-once' ? 'approved' : 'cancelled'

  const retain = (record: LiveRecord): void => {
    records.delete(record.writeId)
    settled.push(projectRecord(record))
    if (settled.length > SETTLED_WINDOW) settled.splice(0, settled.length - SETTLED_WINDOW)
  }

  ctx.on('yzj/ask-pending', (pending: YzjWriteAskPending) => {
    askPending.set(pending.callId, pending)
  })

  ctx.on('approval/request', (req, next) => {
    if (!req.toolName.startsWith('yzj_')) return next()
    if (req.signal?.aborted === true) return Promise.resolve<YzjApprovalOutcome>('cancelled')
    const claimed = new Set(records.keys())
    const id = findApprovalId(req.agent.session.events, req.callId, claimed)
    if (id === undefined) return next()
    const pending = req.callId === undefined ? undefined : askPending.get(req.callId)
    const record: LiveRecord = {
      writeId: id,
      sessionId: req.agent.session.id,
      toolName: req.toolName,
      ...req.callId === undefined ? {} : { callId: req.callId },
      level: pending?.level ?? 'standard',
      domain: domainOf(req.toolName),
      args: pending?.args ?? {},
      reason: req.reason ?? pending?.reason ?? '',
      status: 'pending',
      time: Date.now(),
      resolve: undefined,
      removeAbort: undefined,
    }
    return new Promise<YzjApprovalOutcome>((resolve) => {
      const settle = (outcome: YzjApprovalOutcome): void => {
        record.removeAbort?.()
        record.removeAbort = undefined
        record.resolve = undefined
        if (record.status === 'pending') {
          record.status = statusOf(outcome)
          record.decidedAt = Date.now()
        }
        retain(record)
        resolve(outcome)
      }
      const onAbort = (): void => { settle('cancelled') }
      record.resolve = settle
      record.removeAbort = () => req.signal?.removeEventListener('abort', onAbort)
      req.signal?.addEventListener('abort', onAbort, { once: true })
      records.set(record.writeId, record)
    })
  })

  // The official tool lifecycle drives the terminal card status.
  ctx.on('tools/result', (exec, result) => {
    const apply = (record: YzjWriteRecord): boolean => {
      if (record.callId === exec.callId && record.status === 'approved') {
        record.status = result.isError === true ? 'failed' : 'done'
        if (result.isError === true) {
          record.error = String(result.content?.[0]?.text ?? '工具执行失败')
        } else {
          delete record.error
        }
        return true
      }
      return false
    }
    for (const record of records.values()) {
      if (apply(record)) return
    }
    for (const record of settled) {
      if (apply(record)) return
    }
  })

  ctx.effect(() => () => {
    for (const record of records.values()) {
      record.removeAbort?.()
      if (record.status === 'pending') record.resolve?.('cancelled')
    }
    records.clear()
    settled.length = 0
    askPending.clear()
  }, 'ui-yzj: write-gate teardown')

  return {
    list: (sessionId: string, callId?: string): YzjWriteRecord[] => {
      const out: YzjWriteRecord[] = []
      for (const record of records.values()) {
        if (record.sessionId !== sessionId) continue
        if (callId !== undefined && record.callId !== callId) continue
        out.push(projectRecord(record))
      }
      for (const record of settled) {
        if (record.sessionId !== sessionId) continue
        if (callId !== undefined && record.callId !== callId) continue
        out.push(record)
      }
      return out
    },
    decide: (writeId: string, outcome: YzjApprovalOutcome): boolean => {
      const record = records.get(writeId)
      if (record === undefined || record.status !== 'pending' || record.resolve === undefined) return false
      record.resolve(outcome)
      return true
    },
  }
}

/** Project a live record into a lossless JSON snapshot. */
function projectRecord(record: YzjWriteRecord): YzjWriteRecord {
  return {
    writeId: record.writeId,
    sessionId: record.sessionId,
    toolName: record.toolName,
    ...record.callId === undefined ? {} : { callId: record.callId },
    level: record.level,
    domain: record.domain,
    args: record.args,
    reason: record.reason,
    status: record.status,
    ...record.error === undefined ? {} : { error: record.error },
    time: record.time,
    ...record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt },
  }
}
