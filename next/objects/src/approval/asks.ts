/**
 * The pending-ask registry.
 *
 * DSH's `ApprovalRequest` deliberately carries no arguments — it links to a
 * tool call the UI has already streamed. A confirmation card in Yunzhijia has
 * no such stream to link to, so the guard hands the full parsed arguments over
 * here immediately before it returns `ask`, and the answerer pairs them by
 * (session, callId). Same shape as the pattern the old gateway proved with
 * `yzj/ask-pending`, minus the broadcast.
 */

import type { JsonValue } from '@yzj-next/graph'

/** One gated call, described in full for the card that will ask about it. */
export interface PendingAsk {
  readonly callId: string
  readonly toolName: string
  readonly level: 'standard' | 'strong'
  readonly reason: string
  /** Parsed call arguments, rendered onto the card. */
  readonly args: JsonValue
}

/** Provided by the approval plugin, consumed by the orchestrator's guard. */
export interface YzjAsks {
  /**
   * Record the detail of a call that is about to `ask`. Must be called before
   * returning the ask decision: the answerer treats an unrecorded ask as
   * somebody else's question and passes it down the waterfall.
   */
  record(sessionAnchor: string, ask: PendingAsk): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjAsks?: YzjAsks
  }
}
