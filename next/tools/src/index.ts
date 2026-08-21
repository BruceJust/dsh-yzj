/**
 * `@yzj-next/tools` — the model-facing Yunzhijia tool family and its guard.
 *
 * Task-completion quality is carried by these tools, which is why the port is
 * in the budget at all (TD-11): the previous system's tool surface is the
 * thing that actually does the work, and leaving it implicit was v2's biggest
 * omission. Tool NAMES are preserved deliberately — the dual-instance
 * deployment removes the same-layer name collision (F10).
 *
 * All six domains are registered: doc, im, sheet, calendar, file, contact.
 * @module @yzj-next/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@yzj-next/bridge'
import type {} from '@yzj-next/graph'
import { applyCalendarTools } from './calendar.ts'
import { applyContactTools } from './contact.ts'
import { applyDocTools } from './doc.ts'
import { applyFileTools } from './file.ts'
import { applyImTools } from './im.ts'
import { applySheetTools } from './sheet.ts'
import { applyApprovalGuard } from './guard.ts'
import { applyLineage } from './lineage.ts'
import type { YzjToolBudget } from './shared.ts'

export { applyCalendarTools } from './calendar.ts'
export { applyContactTools } from './contact.ts'
export { applyDocTools } from './doc.ts'
export { applyFileTools } from './file.ts'
export { applyImTools } from './im.ts'
export { applySheetTools } from './sheet.ts'
export {
  applyApprovalGuard, denialFor, GATEWAY_ESCAPE_TOOLS, WRITE_SPECS, ORG_DEFAULT_PLACE,
  type YzjRiskLevel,
} from './guard.ts'
export { applyLineage, LINEAGE_SPECS } from './lineage.ts'
export {
  clipJson, docLink, failureDigest, runValue, yzjToolOutput,
  type YzjToolBudget, type YzjToolValue,
} from './shared.ts'

export const name = 'yzj-next-tools'
export const inject = ['tools', 'yzjBridge', 'yzjGraph']

export interface Config {
  /** Cooperative timeout per CLI invocation in milliseconds. */
  timeoutMs?: number
  /** Cap on the model-facing digest in characters. */
  maxRenderChars?: number
  /** Cap on the UI presentation payload in characters. */
  maxMetaChars?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1_000).default(60_000),
  maxRenderChars: z.number().step(1).min(200).default(8_000),
  maxMetaChars: z.number().step(1).min(200).default(24_000),
})

export function apply(ctx: Context, config: Config): void {
  const budget: YzjToolBudget = {
    timeoutMs: config.timeoutMs ?? 60_000,
    maxRenderChars: config.maxRenderChars ?? 8_000,
    maxMetaChars: config.maxMetaChars ?? 24_000,
  }
  ctx.effect(() => {
    // The guard first: a domain registered before its gate would be callable
    // ungated for the width of one plugin load.
    const disposeGuard = applyApprovalGuard(ctx)
    const disposeLineage = applyLineage(ctx)
    const domains = [
      applyDocTools(ctx, budget),
      applyImTools(ctx, budget),
      applySheetTools(ctx, budget),
      applyCalendarTools(ctx, budget),
      applyFileTools(ctx, budget),
      applyContactTools(ctx, budget),
    ]
    return () => {
      for (const dispose of domains.reverse()) dispose()
      void disposeLineage()
      void disposeGuard()
    }
  })
}
