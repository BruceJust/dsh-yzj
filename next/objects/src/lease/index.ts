/**
 * `obj-lease` —— 最小租约（§5.1）：族 + 强确认卡 + `yzjLeases.covers()` + 到期收回。
 *
 * guard 的决策序里租约命中放行早已有座位（`leases.ts`）；这里把座位坐上。强写永远
 * 不被租约覆盖（安全地板）——那一条在 guard 里，不在这里。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import type { YzjLeases } from '../leases.ts'
import { leaseCard } from './card.ts'
import { leaseFamily, leaseIdFor, toolClassOf, type LeaseState } from './family.ts'

export const name = 'yzj-next-obj-lease'
export const inject = ['yzjGraph', 'yzjCards']

const SWEEP_MS = 10 * 60_000

/** 此刻生效的租约。 */
export function activeLeases(ctx: Context, now = Date.now()): readonly LeaseState[] {
  return ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'lease', status: ['active'] })
    .map(object => object.state as unknown as LeaseState)
    .filter(state => state.period.to > now && state.period.from <= now)
}

export function leasesService(ctx: Context): YzjLeases {
  return {
    covers(query) {
      const toolClass = toolClassOf(query.toolName)
      if (toolClass === undefined) return false
      return activeLeases(ctx).some(lease => (
        lease.scope.toolClass === toolClass
          && (lease.scope.placeKey === undefined || lease.scope.placeKey === query.placeKey)
          && (query.openId === undefined || lease.grantedBy === query.openId)
      ))
    },
  }
}

/** 提一份租约（等强确认）。幂等：同人同类同场所同起点只有一张。 */
export async function proposeLease(ctx: Context, input: {
  readonly decider: string
  readonly toolClass: string
  readonly placeKey?: string
  readonly days: number
  readonly family: string
  readonly reason: string
  readonly sessionAnchor?: string
  readonly now?: number
}): Promise<string> {
  const from = input.now ?? Date.now()
  const to = from + input.days * 24 * 60 * 60 * 1000
  const leaseId = leaseIdFor(input.decider, input.toolClass, input.placeKey, from)
  if (ctx.yzjGraph.rawObject('lease', leaseId) !== undefined) return leaseId
  await ctx.yzjGraph.append({
    type: 'lease/proposed',
    data: {
      leaseId,
      scope: { toolClass: input.toolClass, ...(input.placeKey === undefined ? {} : { placeKey: input.placeKey }) },
      period: { from, to },
      periodText: `${String(input.days)} 天`,
      family: input.family,
      decider: input.decider,
      reason: input.reason,
      ...(input.sessionAnchor === undefined ? {} : { sessionAnchor: input.sessionAnchor }),
      idemKey: `lease:${leaseId}`,
    },
    actor: { kind: 'operator', openId: input.decider },
  })
  return leaseId
}

/** 到期收回：过期的 active 租约各追加一条 `lease/expired`——审计证据，不是悄悄变。 */
export async function sweepExpired(ctx: Context, now = Date.now()): Promise<readonly string[]> {
  const expired: string[] = []
  for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'lease', status: ['active'] })) {
    const to = asRecord(asRecord(object.state)?.period)?.to
    if (typeof to !== 'number' || to > now) continue
    await ctx.yzjGraph.append({ type: 'lease/expired', data: { leaseId: object.id }, actor: { kind: 'system' } })
    expired.push(object.id)
  }
  return expired
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers = [
      ctx.yzjGraph.defineFamily(leaseFamily),
      ctx.yzjCards.register(leaseCard),
      ctx.provide('yzjLeases', leasesService(ctx)),
    ]
    const timer = setInterval(() => {
      void sweepExpired(ctx).catch((error: unknown) => { console.error('[yzj-next-lease] expiry sweep failed', error) })
    }, SWEEP_MS)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      for (const dispose of disposers.reverse()) void dispose()
    }
  })
  // 一张新提出的租约卡也投到操作者的自聊（有通道时）：签发是主权动作，得在手机上也答得了。
  ctx.on('yzj-graph/appended', (event) => {
    if (event.type !== 'lease/proposed') return
    const leaseId = asString(asRecord(event.data)?.leaseId)
    const channel = ctx.get('yzjCardChannel')
    if (leaseId === undefined || channel === undefined) return
    void channel.deliverToOperator({ kind: 'lease', id: leaseId }).catch((error: unknown) => {
      console.error('[yzj-next-lease] failed to deliver the lease card', error)
    })
  })
}
