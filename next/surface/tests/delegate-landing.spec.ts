/**
 * 委派落地 —— **三条出站路，一条登记纪律**（v4.24 场所选项集）。
 *
 * 「在哪儿说」此前只有一个答案：一个**已经存在的话题**。倒因为果了——话题是委派的
 * 产物，不是委派的前提。目标刚定下来要派给张三，那个群里通常一个话题都没有，于是最
 * 常见的一次委派在界面上无处可落。
 *
 * 落点补齐之后，出站路从一条变成三条（话题里说的、主楼里说的、开新私聊说的），而
 * **登记那一半必须三条一样**。这一组盯的就是那个「一样」：
 *
 * - 发出去了才落库（`msgId` 是那句话真的出去了的唯一证据）；
 * - 听众集合就是这句话落在的那个场所，不从别处推导；
 * - 认不出登记骨架就**不登记**——分类来自先验，抽取失败时那句话照常在群里，由 agent
 *   像观察任何一句话那样去观察它。宁可退回旧路，也不拿一个猜出来的事由，去登记一条
 *   挂在同事名下的承诺。
 *
 * 这三条各自都很容易在某一条路上被漏掉，而漏掉了没有任何东西会报错：话在群里，板上
 * 不长行；或者反过来，板上长出一条谁都没听说过的承诺。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { createCommitmentCard, commitmentFamily } from '@yzj-next/objects'
import { applySurfaceRpc } from '../src/rpc.ts'

const ME: GraphActor = { kind: 'operator', openId: 'op-me' }
const GOAL = 'https://yzj.example.com/doc/q3'
/** 骨架填好的那一句。传送门给的就是这个句式，人只填两个空。 */
const SAID = '@next 登记承诺：把三家定价页整理成对比表，张锐负责，周三前。'
const REGISTER = { openId: 'u-zhang', name: '张锐' }

type Handler = (endpoint: string, payload: unknown) => Promise<
  { ok: true; value: unknown } | { ok: false; error: { message: string } }
>

let ctx: Context
let graph: YzjGraph
let call: Handler
/** 这一趟出站怎么回话。用例各自换掉——「发出去了没有」全部的风险都在这里。 */
let sent: { msgId?: string; ignited: boolean; placeKey?: string; sessionId?: string }
let seen: { placeKey?: string; openId?: string; text: string }[]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-landing-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  sent = { msgId: 'm-1', ignited: true }
  seen = []
  ctx.provide('yzjTopics', {
    tree: () => [],
    conversations: () => [],
    aliases: () => ['@next'],
    topicOf: (sessionId: string) => (sessionId === 'sess-1'
      ? {
        topicKey: 'tk-1', sessionId: 'sess-1', label: '定价',
        placeKey: 'yzj-group-g1', groupId: 'g1', groupName: '产品讨论群',
      }
      : undefined),
    sendToPlace: async (_id: string, text: string) => {
      seen.push({ placeKey: 'yzj-group-g1', text })
      return { ...(sent.msgId === undefined ? {} : { msgId: sent.msgId }) }
    },
    sendInPlace: async (placeKey: string, text: string) => {
      seen.push({ placeKey, text })
      return sent
    },
    sendToPerson: async (openId: string, text: string) => {
      seen.push({ openId, text })
      return sent
    },
  })
  const cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  cards.setDesktopActor(ME, '代少兵')
  let captured: Handler | undefined
  ctx.provide('connection', {
    rpc: { handle: (_path: string, fn: Handler) => { captured = fn } },
  })
  applySurfaceRpc(ctx, 40)
  await new Promise(resolve => { setTimeout(resolve, 1) })
  if (captured === undefined) throw new Error('RPC handler 没有被注册')
  call = captured
})

/** 图上现在有哪些承诺（不含目标那一类）。 */
const born = (): {
  what?: string; audience?: readonly string[]; topicKey?: string
  parentGoalRef?: string; executor?: { name?: string }
}[] => [...graph.query(ME, { kind: 'commitment' })].map(object => ({
  ...(object.state as Record<string, never>),
  audience: object.audience,
}))

describe('主楼委派：话题是产物，不是前提', () => {
  /*
    **这一条就是那次误设计的复现。**

    「委派可以落在主楼」和「登记先验发送即落库」两件各自正确的事，合起来此前是撒谎的：
    主楼这条路根本不带先验，那句话发出去只是一句普通消息——话在群里，板上不长行。
  */
  it('在群主楼说的登记话语，一样落库；听众就是这个场所', async () => {
    expect(await call('send-in-place', {
      placeKey: 'yzj-group-g2', text: SAID, register: REGISTER,
    })).toMatchObject({ ok: true })
    const rows = born()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.what).toBe('把三家定价页整理成对比表')
    expect(rows[0]?.executor?.name).toBe('张锐')
    expect(rows[0]?.audience).toEqual(['yzj-group-g2'])
    /*
      **没有 topicKey 是如实，不是缺失。** 这句话刚说出口，话题（如果点着了）是它的
      产物而不是它的容器；编一个出来的话，板上那一跳会通向一个不存在的窗口。
    */
    expect(rows[0]?.topicKey).toBeUndefined()
  })

  it('带着目标来的，承诺就挂在那个目标下面（语境继承）', async () => {
    await call('send-in-place', {
      placeKey: 'yzj-group-g2', text: SAID, register: { ...REGISTER, goalRef: GOAL },
    })
    expect(born()[0]?.parentGoalRef).toBe(GOAL)
  })

  /*
    **发不出去就什么都没发生。** 反过来的话，一次失败的委派会在板上长出一条谁都没听说
    过的承诺——而那个人从来没被告知过。
  */
  it('平台没回 msgId：不落库', async () => {
    sent = { ignited: false }
    await call('send-in-place', { placeKey: 'yzj-group-g2', text: SAID, register: REGISTER })
    expect(born()).toHaveLength(0)
  })

  /*
    分类来自先验，这里只做**抽取**。句子改到认不出骨架就认不出——那句话照常发出去，
    由 agent 像观察任何一句话那样去观察它。
  */
  it('认不出登记骨架：话照发，但不登记', async () => {
    await call('send-in-place', {
      placeKey: 'yzj-group-g2', text: '@next 这事你看看谁来做合适', register: REGISTER,
    })
    expect(seen).toHaveLength(1)
    expect(born()).toHaveLength(0)
  })

  it('留白没填就不算填过 —— 不拿「〔要做什么〕」去登记一条挂在同事名下的活', async () => {
    await call('send-in-place', {
      placeKey: 'yzj-group-g2',
      text: '@next 登记承诺：〔要做什么〕，张锐负责，〔什么时候前〕。',
      register: REGISTER,
    })
    expect(born()).toHaveLength(0)
  })

  it('没有先验的普通发言不登记 —— 委派是对话的特例，不是对话的全部', async () => {
    await call('send-in-place', { placeKey: 'yzj-group-g2', text: SAID })
    expect(seen).toHaveLength(1)
    expect(born()).toHaveLength(0)
  })
})

describe('话题里说的那一条，行为不变', () => {
  it('挂进正在跑的话题：topicKey 与 audience 都来自那个话题', async () => {
    expect(await call('send-to-place', {
      sessionId: 'sess-1', text: SAID, register: REGISTER,
    })).toMatchObject({ ok: true })
    const rows = born()
    expect(rows[0]?.topicKey).toBe('tk-1')
    expect(rows[0]?.audience).toEqual(['yzj-group-g1'])
  })
})

describe('开新私聊：出生就是第一句话', () => {
  it('平台回了落点，就用那个落点登记', async () => {
    sent = { msgId: 'm-2', ignited: false, placeKey: 'yzj-dm-d9' }
    const result = await call('send-to-person', {
      openId: 'u-zhang', text: SAID, register: REGISTER,
    })
    expect(result).toMatchObject({ ok: true })
    expect(seen[0]?.openId).toBe('u-zhang')
    expect(born()[0]?.audience).toEqual(['yzj-dm-d9'])
  })

  /*
    **没有场所的承诺是幽灵承诺的另一种形状**：板上有一行，而它属于哪间屋子、谁听见过
    这句话，一个字都答不上来。宁可这一条不落库——那句话已经在对方窗口里，人看得见。
  */
  it('平台没给出落点：不登记', async () => {
    sent = { msgId: 'm-2', ignited: false }
    await call('send-to-person', { openId: 'u-zhang', text: SAID, register: REGISTER })
    expect(born()).toHaveLength(0)
  })

  it('少了是谁或说什么，就说少了什么', async () => {
    expect(await call('send-to-person', { text: SAID })).toMatchObject({ ok: false })
    expect(await call('send-to-person', { openId: 'u-zhang' })).toMatchObject({ ok: false })
  })
})
