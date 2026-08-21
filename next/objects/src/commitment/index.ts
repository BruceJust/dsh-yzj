/**
 * `obj-commitment` — the commitment, process, and goal-reference family.
 * Registers all four surfaces a family owns: graph vocabulary, card, narrow
 * model tools, and (through the card's `keywords[]`) the IM verbs.
 */

import type { Context } from '@deepseek-ai/cordis'
import { commitmentCard } from './card.ts'
import { commitmentFamily, processFamily } from './family.ts'
import { applyCommitmentTools } from './tools.ts'

export const name = 'yzj-next-obj-commitment'
export const inject = ['yzjGraph', 'yzjCards', 'tools']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers = [
      ctx.yzjGraph.defineFamily(commitmentFamily),
      ctx.yzjGraph.defineFamily(processFamily),
      ctx.yzjCards.register(commitmentCard),
      applyCommitmentTools(ctx),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  })
}
