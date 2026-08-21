/**
 * `obj-event` —— 事件枢纽 (§5.6 日程五边模型).
 *
 * 和 `obj-goal` 同一个形状：日程的真身在云之家，这个插件不复制它，只补平台答不了的
 * 那几条边——「这场会为哪个目标开」「为它要准备什么」「它从哪句话里长出来」——以及
 * 一个免费推导（材料就绪度）和一条回程（材料清单写进日程描述，全参会人可见）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { eventFamily } from './family.ts'
import { applyEventTools } from './tools.ts'

export const name = 'yzj-next-obj-event'
export const inject = ['yzjGraph', 'tools']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers = [
      ctx.yzjGraph.defineFamily(eventFamily),
      applyEventTools(ctx),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  })
}
