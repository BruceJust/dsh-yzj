/**
 * `obj-goal` — 目标的出生、执行与验收动线 (v4.9 / v4.10).
 *
 * Split from `obj-commitment` rather than folded into it, because a goal is not
 * a new kind of object and this plugin proves it: everything here writes
 * ordinary commitments through ordinary events. What it adds is the three
 * moments a human must appear in — a proposal to sign, a decomposition to
 * decide, a report to accept on — plus the one mechanical consequence that must
 * never be silent (代发登记话语).
 */

import type { Context } from '@deepseek-ai/cordis'
import { assessmentCard } from './assessment-card.ts'
import { assessmentFamily, goalContextFamily, proposalFamily } from './family.ts'
import { applyCommitmentNotify } from './notify.ts'
import { createProposalCard } from './proposal-card.ts'
import { applyGoalTools } from './tools.ts'
import { applyGoalWriteback } from './writeback.ts'
import { applyDeliveryInference } from '../delivery/inference.ts'

export const name = 'yzj-next-obj-goal'
export const inject = ['yzjGraph', 'yzjCards', 'tools']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers = [
      ctx.yzjGraph.defineFamily(proposalFamily),
      ctx.yzjGraph.defineFamily(assessmentFamily),
      ctx.yzjGraph.defineFamily(goalContextFamily),
      ctx.yzjCards.register(createProposalCard(ctx)),
      ctx.yzjCards.register(assessmentCard),
      applyGoalTools(ctx),
      applyCommitmentNotify(ctx),
      // 同一条边的第二个听众：全组看的是云之家那份文档 (v4.9 生与死两时刻)。
      applyGoalWriteback(ctx),
      // 行为回执：操作者自己甩的文件 → 交付推断提议卡（P1 仅本人）。
      applyDeliveryInference(ctx),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  })
}
