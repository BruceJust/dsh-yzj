/**
 * 场所合同面板读到的东西 —— 这里只钉**接单史** (v3.15 裁决⑤).
 *
 * 「谁把 agent 接进这个群」写进了图，但**记下来而没人读得到等于没记**：要靠 grep 一个
 * jsonl 才看得到的东西不叫可审计。这一组盯住那条读路径的三件事：只报本场所的、只报
 * 动作不报状态、认不出人就不猜。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { contractView } from '../src/rpc.ts'

const HERE = 'yzj-group-g1'
const ELSEWHERE = 'yzj-group-g2'

let ctx: Context
let graph: YzjGraph

const served = async (placeKey: string, on: boolean, by?: string): Promise<void> => {
  await graph.append({
    type: 'contract/served',
    data: { placeKey, served: on, groupName: '财务组' },
    actor: by === undefined ? { kind: 'operator' } : { kind: 'operator', openId: by },
  })
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-contract-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  await graph.selectAccount('acct-1')
  ctx.provide('yzjTopics', {
    tree: () => [{ place: { placeKey: HERE, groupName: '财务组' }, topics: [] }],
    topicOf: () => undefined,
    aliases: () => ['@next'],
    presenceIn: () => ({ self: 'off' as const, peers: [] }),
    peers: () => [],
    conversations: () => [],
  })
})

describe('接单史', () => {
  it('两个方向都读得到，最近的在前', async () => {
    await served(HERE, true, 'op-1')
    await served(HERE, false, 'op-1')
    const changes = contractView(ctx, HERE).servedChanges
    expect(changes.map(item => item.served)).toEqual([false, true])
    expect(changes[0]?.by).toBe('op-1')
  })

  it('只报这个场所的：别处的接单史与这块面板无关', async () => {
    await served(ELSEWHERE, true, 'op-1')
    await served(HERE, true, 'op-1')
    expect(contractView(ctx, HERE).servedChanges).toHaveLength(1)
    expect(contractView(ctx, ELSEWHERE).servedChanges.map(item => item.served)).toEqual([true])
  })

  /*
    **只报动作，不报状态。** 当前开着没有由通道的名单说了算（`onDuty`），这一格一个字
    都不用来推断它——两处各自回答同一个问题，就有一处会先过期。
  */
  it('一次都没按过的场所：这一格空着，而不是替 onDuty 说话', () => {
    const view = contractView(ctx, HERE)
    expect(view.servedChanges).toEqual([])
    expect(view.onDuty).toBe(true)
  })

  it('认不出按的人就不写「谁」——不猜', async () => {
    await served(HERE, true)
    expect(contractView(ctx, HERE).servedChanges[0]).toMatchObject({ served: true })
    expect(contractView(ctx, HERE).servedChanges[0]?.by).toBeUndefined()
  })
})
