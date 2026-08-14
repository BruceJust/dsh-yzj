/**
 * Model-facing Yunzhijia tool family over `ctx.yzjBridge`: doc, sheet,
 * calendar, contact, im, and file domains. Every tool renders a bounded
 * model-facing digest and projects a capped structured payload for the UI
 * through `output.presentationMeta`; destructive or irreversible operations
 * ask through the `tools/pre-execute` approval seam (the bundle's browser
 * surface answers via the GUI approval panel).
 * @module @dsh-yzj/tool-yzj
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@dsh-yzj/bridge'
import { applyContactTools } from './contact.ts'
import { applyDocTools } from './doc.ts'
import { applySheetTools } from './sheet.ts'
import { applyCalendarTools } from './calendar.ts'
import { applyImTools } from './im.ts'
import { applyFileTools } from './file.ts'
import { applyApprovalGuard } from './guard.ts'
import type { YzjToolBudget } from './shared.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-yzj'
/** Services required by the yzj tools. */
export const inject = ['tools', 'yzjBridge']

/** tool-yzj configuration; the schema fills every default. */
export interface Config {
  /** Cooperative timeout per bridge invocation in milliseconds. Defaults to 60000. */
  timeoutMs?: number
  /** Cap on model-facing digests in characters. Defaults to 30000. */
  maxRenderChars?: number
  /** Cap on UI presentation payloads in characters. Defaults to 50000. */
  maxMetaChars?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1).default(60_000),
  maxRenderChars: z.number().step(1).min(1).default(30_000),
  maxMetaChars: z.number().step(1).min(1).default(50_000),
})

/** Register the full yzj tool family and the approval guard. */
export function apply(ctx: Context, config: Config): void {
  const budget: YzjToolBudget = {
    timeoutMs: config.timeoutMs ?? 60_000,
    maxRenderChars: config.maxRenderChars ?? 30_000,
    maxMetaChars: config.maxMetaChars ?? 50_000,
  }
  applyContactTools(ctx, budget)
  applyDocTools(ctx, budget)
  applySheetTools(ctx, budget)
  applyCalendarTools(ctx, budget)
  applyImTools(ctx, budget)
  applyFileTools(ctx, budget)
  applyApprovalGuard(ctx)
}
