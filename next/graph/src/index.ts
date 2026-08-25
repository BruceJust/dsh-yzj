/**
 * `@yzj-next/graph` — the conversation-graph kernel plugin.
 *
 * Zero business dependencies by construction (§2): it accepts anchors and
 * events and knows nothing about Yunzhijia, DSH Sessions, or cards. Everything
 * product-level that the harness's own whitelisted Session vocabulary cannot
 * hold lives here instead (F4 / TD-1).
 * @module @yzj-next/graph
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { YzjGraph } from './service.ts'

export { YzjGraph } from './service.ts'
/**
 * Re-exported so every object family declares its vocabulary against the SAME
 * zod instance the kernel validates with — schema identity across package
 * boundaries is not something to leave to dependency resolution.
 */
export { z } from 'zod'
export { KERNEL_FAMILIES, artifactRef } from './vocabulary.ts'
export { decodeEvent } from './log.ts'
export { asNumber, asObjectRef, asRecord, asString, asStringArray } from './json.ts'
export { GraphStore } from './store.ts'
export {
  GRAPH_ENVELOPE_VERSION, GRAPH_FOLD_VERSION, ORG_DEFAULT_CONTRACT, refKey,
  type GraphActor, type GraphAppendInput, type GraphEvent, type GraphEventQuery,
  type GraphEventSpec, type GraphFamily, type GraphObject, type GraphQuery,
  type GraphReadHook, type GraphViewer, type JsonValue, type ObjectRef,
  type PlaceContract, type TopicHandle,
} from './types.ts'

export const name = 'yzj-next-graph'

const defaultHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')

export interface Config {
  /** Partition root. Each account key becomes a directory beneath it. */
  root?: string
  /** Open this partition at boot instead of waiting for `selectAccount`. */
  accountKey?: string
}

export const Config: z<Config> = z.object({
  root: z.string().default(join(defaultHome, 'yzj-next', 'graph')),
  accountKey: z.string().default(''),
})

export function apply(ctx: Context, config: Config): void {
  const root = config.root ?? join(defaultHome, 'yzj-next', 'graph')
  const accountKey = config.accountKey === undefined || config.accountKey === ''
    ? undefined
    : config.accountKey
  const graph = new YzjGraph(ctx, {
    root: isAbsolute(root) ? root : resolve(root),
    ...(accountKey === undefined ? {} : { accountKey }),
  })
  ctx.effect(() => {
    if (accountKey !== undefined) {
      void graph.selectAccount(accountKey).catch((error: unknown) => {
        console.error('[yzj-next-graph] failed to open the configured partition', error)
      })
    }
    return async () => {
      try {
        await graph.flush()
      } catch (error) {
        console.error('[yzj-next-graph] failed to flush the graph snapshot', error)
      }
    }
  })
}
