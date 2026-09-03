/**
 * 授权租约（§5.1 最小租约）—— 对象级 + 期间级可过期预授权，创建走强确认，到期自动收回。
 *
 * 状态机：`proposed`（等强确认）→ `active`（granted）| `declined`；`active` → `revoked` | `expired`。
 * 过期是一次追加的事件，不是状态悄悄变——审计要读得出"什么时候不再免确认了"。
 */

import { createHash } from 'node:crypto'
import { z, type GraphFamily, type JsonValue } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

export type LeaseStatus = 'proposed' | 'active' | 'declined' | 'revoked' | 'expired'

export interface LeaseState {
  readonly leaseId: string
  readonly status: LeaseStatus
  /** 覆盖哪一类工具（`doc` / `sheet` / `calendar` / `im` …），可再收窄到一个场所。 */
  readonly scope: { readonly toolClass: string; readonly placeKey?: string }
  readonly period: { readonly from: number; readonly to: number }
  readonly periodText: string
  /** 哪一个裁决族的比值把这扇门推开的——私账侧只读它来对上自己的私记。 */
  readonly family: string
  readonly decider: string
  readonly reason: string
  readonly grantedBy?: string
  readonly revokedBy?: string
  readonly sessionAnchor?: string
}

export const leaseFamily: GraphFamily = {
  kind: 'lease',
  events: {
    'lease/proposed': {
      schema: z.object({
        leaseId: z.string().min(1),
        scope: z.object({ toolClass: z.string().min(1), placeKey: z.string().optional() }),
        period: z.object({ from: z.number().int(), to: z.number().int() }),
        periodText: z.string().min(1),
        family: z.string().min(1),
        decider: z.string().min(1),
        reason: z.string(),
        sessionAnchor: z.string().optional(),
        status: z.literal('proposed').default('proposed'),
        idemKey: z.string().min(1),
      }),
    },
    'lease/granted': {
      schema: z.object({
        leaseId: z.string().min(1),
        grantedBy: z.string().min(1),
        // 私账侧从这条事件私记 clause{lease}——它们随事件走，私账不必回图解析。
        scope: z.object({ toolClass: z.string().min(1), placeKey: z.string().optional() }),
        periodText: z.string().min(1),
        family: z.string().min(1),
        status: z.literal('active').default('active'),
      }),
    },
    'lease/declined': {
      schema: z.object({ leaseId: z.string().min(1), status: z.literal('declined').default('declined') }),
    },
    'lease/revoked': {
      schema: z.object({ leaseId: z.string().min(1), revokedBy: z.string().min(1), reason: z.string().optional(), status: z.literal('revoked').default('revoked') }),
    },
    'lease/expired': {
      schema: z.object({ leaseId: z.string().min(1), status: z.literal('expired').default('expired') }),
    },
  },
  pendingStatuses: ['proposed'],
  objectIdOf: (_type, data) => asString(asRecord(data)?.leaseId),
  reduce: (previous: JsonValue | undefined, event) => ({ ...(asRecord(previous) ?? {}), ...(asRecord(event.data) ?? {}) }),
}

export function leaseIdFor(decider: string, toolClass: string, placeKey: string | undefined, from: number): string {
  const hash = createHash('sha256').update('yzj-next-lease-v1').update(decider).update('\0').update(toolClass)
    .update('\0').update(placeKey ?? '').update('\0').update(String(from))
  return `lse-${hash.digest('hex').slice(0, 20)}`
}

/** 工具的类：`yzj_doc_create` → `doc`。租约按类覆盖，不按单个工具名。 */
export function toolClassOf(toolName: string): string | undefined {
  const match = /^yzj_([a-z]+)_/u.exec(toolName)
  return match?.[1]
}
