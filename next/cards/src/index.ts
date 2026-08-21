/**
 * `@yzj-next/cards` — the card system's node half.
 *
 * Zero business dependencies beyond the graph (§2): it knows about objects,
 * actions and surfaces, and nothing about Yunzhijia, approvals, or React. The
 * browser half registers desktop renderers separately; both answer through
 * this one action bus.
 * @module @yzj-next/cards
 */

import type { Context } from '@deepseek-ai/cordis'
import { YzjCards } from './service.ts'
import { applyCardRpc } from './rpc.ts'

export { applyCardRpc, projectCard, type CardWire } from './rpc.ts'
export { YzjCards, type PendingDemand } from './service.ts'
export {
  CARD_TEXT_MAX_CHARS, MODE_BADGE,
  type AnswerableDemand, type AnswerableLayer, type AnswerableMode,
  type CardAction, type CardActOutcome, type CardActResult, type CardDefinition,
  type CardProjection, type CardRef, type CardTextProjection, type CardTransition,
  type CardUpdateStrategy,
  type CardVia, type YzjCardChannel,
} from './types.ts'

export const name = 'yzj-next-cards'
export const inject = ['yzjGraph']

export function apply(ctx: Context): void {
  // Constructing the service registers it on the context (cordis idiom).
  void new YzjCards(ctx)
  applyCardRpc(ctx)
}
