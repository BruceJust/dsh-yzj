/**
 * `@yzj-next/surface` — the desktop workbench, node half.
 *
 * The whole package rests on one idea: **a view is a projection of the graph
 * and the conversation, never a store of its own.** So this half owns no
 * state. It answers what the browser asks, reading through `ctx.yzjTopics`
 * and `ctx.yzjGraph` at request time, and holds nothing between requests.
 *
 * Why that matters beyond tidiness: the moment a view keeps its own copy, the
 * copy becomes a second body of truth that can disagree with the graph, and
 * every question about "what actually happened" acquires two answers. A
 * projection may lag — it must never be authoritative (数据律 1).
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@yzj-next/channel'
import { applySurfaceRpc } from './rpc.ts'

export {
  applySurfaceRpc, chipsFor, fusedWindow,
  type FusedWindow, type TopicChip,
} from './rpc.ts'

export const name = 'yzj-next-surface'
/**
 * `yzjCards` is as load-bearing here as `yzjGraph`.
 *
 * Every endpoint that touches an answerable object reads a card definition —
 * its verbs, its resolved test, its desktop actor. Without the injection those
 * reads throw at request time rather than at boot, so the failure surfaces
 * only for a session that HAS cards: local sessions look fine and every real
 * Yunzhijia topic 500s. Declaring it is what turns that into a startup
 * condition instead of a per-topic one.
 */
export const inject = ['connection', 'yzjGraph', 'yzjCards']

export interface Config {
  /** Messages the fused window reads per request. */
  windowSize?: number
  /**
   * 演示隐身档 (D10).
   *
   * "One screen does everything" is also "one screen exposes everything", and
   * a projector is the worst place to discover that. On: the conversation base
   * folds away, every unread badge reads zero and no message preview is drawn.
   * It is a deployment switch rather than a control in the column, because the
   * moment it becomes a toggle somebody has to remember to press it.
   */
  stealth?: boolean
}

export const Config: z<Config> = z.object({
  windowSize: z.number().step(1).min(5).max(200).default(40),
  stealth: z.boolean().default(false),
})

export function apply(ctx: Context, config: Config): void {
  applySurfaceRpc(ctx, config.windowSize ?? 40, config.stealth ?? false)
}
