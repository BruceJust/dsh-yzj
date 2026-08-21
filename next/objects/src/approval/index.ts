/**
 * `obj-approval` — the confirmation-card object family, mounted as one cordis
 * plugin inside the objects package (TD-6': plugin boundary ≠ npm boundary).
 * It registers all four registration points a family owns: graph vocabulary,
 * card definition (with its `keywords[]`), the approval-seam answerer, and —
 * once P1.5 adds them — its own narrow model tools.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-user-approval'
import { approvalCard } from './card.ts'
import { approvalFamily } from './family.ts'
import { ApprovalAnswerer } from './answerer.ts'

export const name = 'yzj-next-obj-approval'
export const inject = ['yzjGraph', 'yzjCards', 'approval']

export interface Config {
  /** Confirmation-card TTL in milliseconds; aligned with the task deadline. */
  ttlMs?: number
}

export const Config: z<Config> = z.object({
  ttlMs: z.number().step(1).min(60_000).default(30 * 60_000),
})

export function apply(ctx: Context, config: Config): void {
  const answerer = new ApprovalAnswerer(ctx, { ttlMs: config.ttlMs ?? 30 * 60_000 })

  ctx.effect(() => {
    const disposers = [
      ctx.yzjGraph.defineFamily(approvalFamily),
      ctx.yzjCards.register(approvalCard),
      ctx.provide('yzjAsks', {
        record: (sessionAnchor: string, ask) => { answerer.record(sessionAnchor, ask) },
      }),
      // PREPEND is load-bearing. The cordis waterfall runs listeners in
      // registration order, and the web layer's own approval answerer — which
      // mounts before any bundle row inserted after it — claims every ask that
      // has a matching `approval/asked` event, i.e. all of them. Registered
      // normally, this answerer would never see a single request: the operator
      // would get the standard host prompt, no card would open, and no
      // Yunzhijia DM would go out. Asks we did not gate still fall through to
      // that answerer via `next()`.
      ctx.on('approval/request', (request, next) => answerer.handle(request, next), { prepend: true }),
      ctx.on('yzj-graph/appended', (event) => { answerer.onGraphEvent(event) }),
    ]
    return () => {
      answerer.dispose()
      for (const dispose of disposers.reverse()) void dispose()
    }
  })

  // Restart recovery needs an identity to bind a viewer to, so it waits for
  // the transport rather than guessing one (§5.5 部分投影恢复 + 中断可恢复).
  ctx.inject(['yzjTurns', 'yzjCardChannel', 'yzjGraph'], (scoped) => {
    void scoped.yzjGraph.ready()
      .then(() => answerer.recoverPending(scoped.get('yzjTurns')?.defaultBinding()))
      .catch((error: unknown) => {
        console.error('[yzj-next-approval] restart recovery failed', error)
      })
  })
}
