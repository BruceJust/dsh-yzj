/**
 * 立目标：owner 是**一个可核对的人**，不是一串字。
 *
 * 这一组存在的理由是一条实测里抓到的谎：「欠我的」透镜第一屏九行全是**我自己立的
 * 目标**，而真正的应收（李婷、张锐那几条）一条都不在。病根不在透镜——透镜读的是
 * `direction`，`direction` 读的是执行者的 openId，而立目标那一步把执行者写成了一个
 * 凭空的 `'op-1'`：界面上写着「留空 = 我」，账上记的是一个陌生人。
 *
 * 所以这里钉的不是字段形状，是**方向轴的结论**：我留空立的目标，必须落在「我欠的」。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { createCommitmentCard, commitmentFamily, goalCommitmentIdFor } from '@yzj-next/objects'
import { applySurfaceRpc, boardFrame } from '../src/rpc.ts'

const ME: GraphActor = { kind: 'operator', openId: 'op-me' }
const GOAL = 'https://yzj.example.com/doc/q3'

type Handler = (endpoint: string, payload: unknown) => Promise<
  { ok: true; value: unknown } | { ok: false; error: { message: string } }
>

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let call: Handler
/** 这一趟 CLI 怎么回话。用例各自换掉它——真身这一段全部的风险都在这里。 */
let bridge: (command: readonly string[]) => { ok: boolean; json?: unknown; stderr?: string }

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-declare-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  ctx.provide('yzjBridge', { run: async (...args: unknown[]) => bridge(args[0] as string[]) })
  ctx.provide('yzjTopics', {
    tree: () => [],
    topicOf: () => undefined,
    aliases: () => ['@next'],
    conversations: () => [],
  })
  cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  // 通道拿到身份时给的两样东西：我是谁，以及我叫什么。
  cards.setDesktopActor(ME, '代少兵')
  bridge = () => ({ ok: true, json: [] })
  let captured: Handler | undefined
  ctx.provide('connection', {
    rpc: { handle: (_path: string, fn: Handler) => { captured = fn } },
  })
  applySurfaceRpc(ctx, 40)
  await new Promise(resolve => { setTimeout(resolve, 1) })
  if (captured === undefined) throw new Error('RPC handler 没有被注册')
  call = captured
})

const declare = async (extra: Record<string, unknown> = {}): Promise<
  { ok: true; value: unknown } | { ok: false; error: { message: string } }
> => call('declare-goal', { what: 'Q3 对账', goalRef: GOAL, ...extra })

const goalRow = (): { who: string; direction: string } | undefined => {
  const row = boardFrame(ctx).rows.find(one => one.isGoal === GOAL)
  return row === undefined ? undefined : { who: row.who, direction: row.direction }
}

describe('立目标的 owner', () => {
  /*
    **这一条就是那次实测的复现。**

    留空 = 我。此前记下的执行者是 `'op-1'`，于是方向轴判成「别人欠我的」——我自己
    立的目标，出现在应收账簿里。
  */
  it('留空 = 我：执行者是我本人，落在「我欠的」', async () => {
    expect(await declare()).toMatchObject({ ok: true })
    const object = graph.rawObject('commitment', goalCommitmentIdFor(GOAL))
    expect((object?.state as { executor?: { openId?: string; name?: string } })?.executor)
      .toEqual({ kind: 'human', openId: 'op-me', name: '代少兵' })
    expect(goalRow()).toEqual({ who: '代少兵', direction: 'mine' })
  })

  it('选中的人才算指定：openId 是通讯录里那个人的', async () => {
    expect(await declare({ ownerOpenId: 'u-li', ownerName: '李婷' })).toMatchObject({ ok: true })
    // 交出去的目标确实是「别人欠我的」——这一格现在名副其实。
    expect(goalRow()).toEqual({ who: '李婷', direction: 'owed-to-me' })
  })

  /*
    **名字不能当 id。** 通讯录里有五位李婷，在「名字即 openId」的记法里她们是同一个人，
    而这条承诺日后归谁、谁看得见、谁能修，全靠这个 id。
  */
  it('只给名字、没有选中的人：拒绝，且什么都没写', async () => {
    const result = await declare({ ownerName: '李婷' })
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: { message: string } }).error.message).toContain('李婷')
    expect(graph.rawObject('commitment', goalCommitmentIdFor(GOAL))).toBeUndefined()
  })

  /*
    身份未知时「留空 = 我」这句话没有指称：我是谁还没有答案。宁可这一刻立不了，也不
    往账本里写一个占位符——上一版就是这么写下 `'op-1'` 的。
  */
  it('还不知道我是谁：拒绝，而不是编一个 id', async () => {
    cards.setDesktopActor({ kind: 'operator' })
    const result = await declare()
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: { message: string } }).error.message).toContain('身份')
    expect(graph.rawObject('commitment', goalCommitmentIdFor(GOAL))).toBeUndefined()
  })
})

/**
 * 真身：**人选落点，系统建文档** (v4.8 立目标；技术方案「真身行经既有 sheet/doc 工具 +
 * 确认流创建」)。
 *
 * 这张表此前只有一个链接输入框——你先离开这个产品、去云之家建一个文档、复制链接、回来
 * 粘上。**把人当成两个系统之间的集成层**，正是这套东西声称要消灭的那种损耗；而它站在
 * 一句早已被推翻的前提上（「agent 建不了云之家文档」）。
 */
describe('真身建在云之家', () => {
  it('列知识库：把「是不是个人的」一并带出来 —— 选它意味着别人打不开这个目标', async () => {
    bridge = () => ({ ok: true, json: [
      { id: 'kb-1', name: '我的知识', visibility: 2 },
      { id: 'kb-2', name: '财务共享库', visibility: 1 },
    ] })
    const result = await call('workspaces', {})
    expect(result).toMatchObject({ ok: true })
    expect((result as { value: { workspaces: unknown[] } }).value.workspaces).toEqual([
      { id: 'kb-1', name: '我的知识', personal: true },
      { id: 'kb-2', name: '财务共享库', personal: false },
    ])
  })

  it('建真身：回的是能打开的那条链接，标准一并写进正文', async () => {
    const seen: string[][] = []
    bridge = (command) => {
      seen.push([...command])
      return command[1] === 'create' ? { ok: true, json: { id: 'doc-9' } } : { ok: true, json: {} }
    }
    const result = await call('create-goal-body', {
      workspace: 'kb-2', title: 'Q3 对账', criteria: 'T+3 出报表',
    })
    expect((result as { value: { url: string } }).value.url)
      .toBe('https://www.yunzhijia.com/knowledge/lingee/#/store/doc/doc-9')
    expect(seen[0]).toEqual(['doc', 'create', '--workspace', 'kb-2', '--title', 'Q3 对账'])
    // 标准写进真身：评估是回真身里读它的，只活在图里的标准没人能拿去对账。
    expect(seen[1]?.slice(0, 4)).toEqual(['doc', 'block', 'insert', '--id'])
    expect(seen[1]?.[6]).toContain('T+3 出报表')
  })

  /*
    **半成功要说成半成功。** 文档建出来了、正文没写进去——把它报成失败，人会再建一份，
    于是同一个目标有了两个真身；报成成功，日后评估读不到标准而没人知道为什么。
  */
  it('正文没写进去：链接照给，但把这件事说出来', async () => {
    bridge = (command) => (command[1] === 'create'
      ? { ok: true, json: { id: 'doc-9' } }
      : { ok: false, stderr: '正文接口拒绝' })
    const result = await call('create-goal-body', {
      workspace: 'kb-2', title: 'Q3 对账', criteria: 'T+3 出报表',
    })
    const value = (result as { value: { url: string; note?: string } }).value
    expect(value.url).toContain('doc-9')
    expect(value.note).toContain('没能写进正文')
  })

  /*
    **建了一个找不回来的文档，比没建更坏。** 目标会挂在一个空链接上，而板上那一行看起来
    一切正常——真身之变律里最难查的那一种：引用还在，指向的东西不存在。
  */
  it('云之家没回传 id：算失败，不回一个空链接', async () => {
    bridge = () => ({ ok: true, json: { title: 'Q3 对账' } })
    const result = await call('create-goal-body', { workspace: 'kb-2', title: 'Q3 对账' })
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: { message: string } }).error.message).toContain('id')
  })

  it('CLI 失败就说失败 —— 不把一次故障说成「没有知识库」', async () => {
    bridge = () => ({ ok: false, stderr: 'token 过期' })
    expect(await call('workspaces', {})).toMatchObject({ ok: false })
    expect(await call('create-goal-body', { workspace: 'kb-2', title: 'x' })).toMatchObject({ ok: false })
  })

  it('少了知识库或标题就说少了什么', async () => {
    expect(await call('create-goal-body', { title: 'x' })).toMatchObject({ ok: false })
    expect(await call('create-goal-body', { workspace: 'kb-1' })).toMatchObject({ ok: false })
  })
})

/**
 * 执行者选择的第②层：**近处候选，每个带出处**（v4.24 选项集三层）。
 *
 * 此前这一格只有两层——agent 恒首位，然后直接掉进全组织通讯录搜索。于是最常见的那次
 * 委派（就是刚才那个目标里的那个人）也要重新打一遍名字，而**打字是在重新回忆一件系统
 * 已经知道的事**。
 *
 * 三条来源都是事实，不是推测；出处是硬要求——一个说不出自己为什么在这里的候选，和
 * 「系统觉得你想找谁」没有区别，而后者正是「人选不推导」禁止的东西。
 */
describe('近处候选', () => {
  const person = async (id: string, openId: string, name: string, extra: Record<string, unknown> = {}): Promise<void> => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: `活 ${id}`, sourceAnchor: `yzj:${id}`,
        executor: { kind: 'human', openId, name }, delegatedBy: 'op-me', ...extra,
      },
      actor: ME,
    })
  }
  const candidates = async (goalRef?: string): Promise<{ name: string; why: string }[]> => {
    const result = await call('delegate-candidates', goalRef === undefined ? {} : { goalRef })
    return (result as { value: { candidates: { name: string; why: string }[] } }).value.candidates
  }

  it('这个目标里已经有他的活 —— 排在最前，出处说得出口', async () => {
    await person('c1', 'u-li', '李婷', { parentGoalRef: GOAL })
    await person('c2', 'u-zhang', '张锐')
    const rows = await candidates(GOAL)
    expect(rows[0]).toEqual({ openId: 'u-li', name: '李婷', why: '这个目标里已经有他的活' })
    expect(rows[1]?.why).toBe('你最近委派过他')
  })

  /*
    **只算我委派的。** 别人委派给别人的活不是我的事实——把它摆进我的候选里，就是拿
    「这个人存在」冒充「这个人和你有关」。
  */
  it('别人委派的不算我的近处', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c9', what: '别人的活', sourceAnchor: 'yzj:c9',
        executor: { kind: 'human', openId: 'u-x', name: '某人' }, delegatedBy: 'u-other',
      },
      actor: { kind: 'operator', openId: 'u-other' },
    })
    expect(await candidates()).toEqual([])
  })

  it('一个候选都没有就是空的 —— 第一次用这个产品的人本来就没有近处', async () => {
    expect(await candidates()).toEqual([])
  })

  it('我自己不进候选 —— 委派给自己不是委派', async () => {
    await person('c3', 'op-me', '我')
    expect(await candidates()).toEqual([])
  })
})

