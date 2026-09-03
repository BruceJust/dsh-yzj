/**
 * 最小租约（§5.1，随 #64 D4 同批开工）：强确认 → 生效 → guard 命中放行 → 到期收回。
 *
 * 强写永远不被租约覆盖那一条在 guard 里锁着（`guard.spec.ts`）；这里锁的是租约自己的
 * 生命周期与 `covers()` 的边界：类、场所、人，三个都对上才放行。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { leaseCard } from '../src/lease/card.ts'
import { leaseFamily, toolClassOf } from '../src/lease/family.ts'
import { activeLeases, leasesService, proposeLease, sweepExpired } from '../src/lease/index.ts'

const OPERATOR = { kind: 'operator' as const, openId: 'op-1' }
let ctx: Context
let graph: YzjGraph
let cards: YzjCards

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-lease-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(leaseFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(leaseCard)
  cards.setDesktopActor(OPERATOR, '我')
})

describe('租约的一生', () => {
  it('提出 = 一张等强确认的卡；签发之后才生效；到期自动收回并留证据', async () => {
    const leaseId = await proposeLease(ctx, { decider: 'op-1', toolClass: 'doc', days: 7, family: 'write-confirm', reason: '写确认 19 次 1.6 秒', now: 1_000 })
    expect(asString(asRecord(graph.rawObject('lease', leaseId)?.state)?.status)).toBe('proposed')
    // 等强确认的卡进决断面：它是组织侧的可应答对象，三层定律里的阻塞待答。
    expect(cards.demands({ kind: 'operator', openId: 'op-1' }).some(one => one.ref.id === leaseId)).toBe(true)
    const covers = leasesService(ctx)
    expect(covers.covers({ toolName: 'yzj_doc_create', args: {}, openId: 'op-1' })).toBe(false)

    const acted = await cards.act({ kind: 'lease', id: leaseId }, 'grant', OPERATOR, 'desktop')
    expect(acted.outcome).toBe('applied')
    expect(asString(asRecord(graph.rawObject('lease', leaseId)?.state)?.status)).toBe('active')
    expect(activeLeases(ctx, 2_000).map(one => one.leaseId)).toEqual([leaseId])

    // 到期：一条追加的 `lease/expired`，不是状态悄悄变。
    const expired = await sweepExpired(ctx, 1_000 + 8 * 24 * 60 * 60 * 1000)
    expect(expired).toEqual([leaseId])
    expect(asString(asRecord(graph.rawObject('lease', leaseId)?.state)?.status)).toBe('expired')
    expect(graph.rawEvents(['lease/expired'])).toHaveLength(1)
  })

  it('同人同类同场所同起点只提一次', async () => {
    const first = await proposeLease(ctx, { decider: 'op-1', toolClass: 'doc', days: 7, family: 'write-confirm', reason: 'x', now: 5 })
    const second = await proposeLease(ctx, { decider: 'op-1', toolClass: 'doc', days: 7, family: 'write-confirm', reason: 'y', now: 5 })
    expect(second).toBe(first)
    expect(graph.rawEvents(['lease/proposed'])).toHaveLength(1)
  })

  it('不签与收回：两种退出各留各的痕', async () => {
    const declined = await proposeLease(ctx, { decider: 'op-1', toolClass: 'sheet', days: 7, family: 'write-confirm', reason: 'x', now: 5 })
    await cards.act({ kind: 'lease', id: declined }, 'decline', OPERATOR, 'desktop')
    expect(asString(asRecord(graph.rawObject('lease', declined)?.state)?.status)).toBe('declined')
    const granted = await proposeLease(ctx, { decider: 'op-1', toolClass: 'doc', days: 7, family: 'write-confirm', reason: 'x', now: 6 })
    await cards.act({ kind: 'lease', id: granted }, 'grant', OPERATOR, 'desktop')
    await cards.act({ kind: 'lease', id: granted }, 'revoke', OPERATOR, 'desktop', '先问着')
    expect(asString(asRecord(graph.rawObject('lease', granted)?.state)?.status)).toBe('revoked')
    expect(leasesService(ctx).covers({ toolName: 'yzj_doc_create', args: {}, openId: 'op-1' })).toBe(false)
  })
})

describe('covers()：类、场所、人三个都对上才放行', () => {
  it('类不同不放行；限场所的租约只在那个场所放行；别人的租约不放行', async () => {
    const now = Date.now()
    const scoped = await proposeLease(ctx, { decider: 'op-1', toolClass: 'doc', placeKey: 'yzj-group-g1', days: 7, family: 'write-confirm', reason: 'x', now })
    await cards.act({ kind: 'lease', id: scoped }, 'grant', OPERATOR, 'desktop')
    const covers = leasesService(ctx)
    expect(covers.covers({ toolName: 'yzj_doc_create', args: {}, placeKey: 'yzj-group-g1', openId: 'op-1' })).toBe(true)
    expect(covers.covers({ toolName: 'yzj_doc_create', args: {}, placeKey: 'yzj-group-g2', openId: 'op-1' })).toBe(false)
    expect(covers.covers({ toolName: 'yzj_sheet_write', args: {}, placeKey: 'yzj-group-g1', openId: 'op-1' })).toBe(false)
    expect(covers.covers({ toolName: 'yzj_doc_create', args: {}, placeKey: 'yzj-group-g1', openId: 'op-2' })).toBe(false)
  })

  it('工具的类从名字来：yzj_doc_create → doc；不是云之家工具就没有类', () => {
    expect(toolClassOf('yzj_doc_create')).toBe('doc')
    expect(toolClassOf('yzj_sheet_write')).toBe('sheet')
    expect(toolClassOf('bash')).toBeUndefined()
  })

  it('签发是人签发的裁决终态：广播 lease-grant，判据留给听的人', async () => {
    const heard: string[] = []
    ctx.on('yzj-cards/verdict-settled', (payload) => { heard.push(payload.kind) })
    const leaseId = await proposeLease(ctx, { decider: 'op-1', toolClass: 'doc', days: 7, family: 'write-confirm', reason: 'x' })
    await cards.act({ kind: 'lease', id: leaseId }, 'grant', OPERATOR, 'desktop')
    expect(heard).toEqual(['lease-grant'])
  })
})
