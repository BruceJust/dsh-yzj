/**
 * `obj-task` — the task household: task terminal states and rework rounds,
 * waiting (including the system's own), and conflict flags. One cordis plugin,
 * because their events are one coupled family: a task's cancellation cascades
 * its waits closed, and a conflict pauses the task it collided with.
 *
 * `conflict/*` is kernel vocabulary (a collision is not owned by any one
 * object family); this plugin contributes its CARD and its tool.
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyConflictTools, conflictCard } from './conflict.ts'
import { taskCard, taskFamily } from './task.ts'
import { waitingCard, waitingFamily } from './waiting.ts'

export const name = 'yzj-next-obj-task'
export const inject = ['yzjGraph', 'yzjCards', 'tools']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers = [
      ctx.yzjGraph.defineFamily(waitingFamily),
      ctx.yzjGraph.defineFamily(taskFamily),
      ctx.yzjCards.register(waitingCard),
      ctx.yzjCards.register(taskCard),
      ctx.yzjCards.register(conflictCard),
      applyConflictTools(ctx),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  })
}
