/**
 * Turn binding — the orchestration seam object families read instead of
 * reaching into the transport.
 *
 * `viewer` is the load-bearing field: it is derived by the orchestrator from
 * the turn's message source and is NEVER a model-facing parameter (§4.1). A
 * model that could name its own viewer would read cross-place facts and then
 * speak them into a group, which is exactly the leak the signature rule
 * exists to prevent.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GraphViewer } from '@yzj-next/graph'

/** Everything an object family needs to know about the turn it is running in. */
export interface TurnBinding {
  /** Read domain for this turn. */
  readonly viewer: GraphViewer
  /** openId permitted to answer cards this turn opens (P1: the operator). */
  readonly decider: string
  /** The account partition this turn belongs to. */
  readonly accountKey: string
  /** Pinned account identity, re-verified before every gated Yunzhijia call. */
  readonly accountOrgId?: string
  readonly accountOpenId?: string
  readonly topicKey?: string
  readonly placeKey?: string
  /** Listener set inherited by objects this turn registers. */
  readonly audience?: readonly string[]
  /** The inbound Yunzhijia message that admitted this turn, when there was one. */
  readonly messageId?: string
  /**
   * `write mode` granted by the gateway admission, when there was one.
   *
   * `read-only` is not a weaker grant — it is a REFUSAL, issued by 轻问: a
   * one-shot projection answers a question and is not allowed to change
   * anything while doing so. It is enforced in the monotonic guard rather than
   * in a prompt, because "ask a question, get a number" stops being true the
   * first time a model decides the helpful thing to do is write the number
   * down somewhere.
   */
  readonly writeMode?: 'standard' | 'read-only'
}

/** Provided by the channel plugin. Absent means no transport is mounted. */
export interface YzjTurns {
  /** Binding for a turn admitted through Yunzhijia, when this agent has one. */
  bindingFor(agent: Agent): TurnBinding | undefined
  /** Binding for a desktop-originated turn: operator viewer, no place. */
  defaultBinding(): TurnBinding | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjTurns?: YzjTurns
  }
}
