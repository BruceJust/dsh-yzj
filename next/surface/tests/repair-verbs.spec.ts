/**
 * 修理动词族，从端点到图 (v4.12).
 *
 * 这一组测的不是状态机（那在 objects 里已经锁过），是**真正跑在生产上的那个
 * handler**：payload 解析、守卫、以及它到底往图上写了什么。做法是给一个假的
 * connection 把 `rpc.handle` 注册的那个函数抓下来直接调 —— 抓的是生产代码
 * 本身，不是它的复制品。
 *
 * 为什么这一组必须存在：合并是**吸收态**、移交换的是执行者、目标作废会让底下
 * 一片承诺进入「父目标已结束」。这三个都是不可逆或半不可逆的写，在真实承诺
 * 上「点一下看看」是不负责任的；而没测就交出去，等于把验证成本推给用户。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  assessmentCard, assessmentFamily, createCommitmentCard, commitmentFamily, goalCommitmentIdFor,
} from '@yzj-next/objects'
import { applySurfaceRpc, boardFrame, goalPageFrame } from '../src/rpc.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const GOAL = 'https://yzj.example.com/doc/q3'

const TOPICS = [
  { topicKey: 'tk-1', sessionId: 'sess-1', label: '统一模板', groupName: '财务组', placeKey: 'yzj-group-g1', groupId: 'g1' },
]

type Handler = (endpoint: string, payload: unknown) => Promise<
  { ok: true; value: unknown } | { ok: false; error: string }
>

let ctx: Context
let graph: YzjGraph
let call: Handler

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-repair-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  graph.defineFamily(assessmentFamily)
  await graph.selectAccount('acct-1')
  ctx.provide('yzjTopics', {
    tree: () => [{ place: { placeKey: 'yzj-group-g1', groupName: '财务组' }, topics: TOPICS }],
    topicOf: (sessionId: string) => TOPICS.find(topic => topic.sessionId === sessionId),
    aliases: () => ['@next'],
    conversations: () => [],
  })
  /*
    真的卡服务，不是一个只会答 `desktopActor` 的替身。

    决断层读的是它——「谁还在等人答」由各家族自己声明。替身能让这几条用例过，
    代价是它们再也测不到「一件等着人答的事有没有出现在该出现的地方」。
  */
  const cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  cards.register(assessmentCard)
  cards.setDesktopActor(OPERATOR)
  /*
    假的 connection，只干一件事:把生产注册的那个 handler 接住。

    比把 switch 拆成一堆导出函数好——拆出来测的是拆出来的东西,而真正会在
    线上被调用的是这一个;它俩之间的每一次漂移都发生在没人看的地方。
  */
  let captured: Handler | undefined
  ctx.provide('connection', {
    rpc: { handle: (_path: string, fn: Handler) => { captured = fn } },
  })
  applySurfaceRpc(ctx, 40)
  // `ctx.inject` 的回调在服务就位后的下一拍才跑——注册发生在那里面。
  await new Promise(resolve => { setTimeout(resolve, 1) })
  if (captured === undefined) throw new Error('RPC handler 没有被注册')
  call = captured
})

async function goal(): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: goalCommitmentIdFor(GOAL),
      what: 'Q3 对账',
      goalRef: GOAL,
      executor: { kind: 'human', openId: 'op-1', name: '我' },
      sourceAnchor: 'desktop:board',
      idemKey: `goal:${GOAL}`,
    },
    actor: OPERATOR,
  })
}

async function child(id: string, what: string, due?: string): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id,
      what,
      executor: { kind: 'human', openId: 'u-li', name: '李婷' },
      sourceAnchor: `yzj:${id}`,
      topicKey: 'tk-1',
      parentGoalRef: GOAL,
      ...(due === undefined ? {} : { due }),
    },
    actor: OPERATOR,
  })
}

const stateOf = (id: string): Record<string, unknown> =>
  (graph.rawObject('commitment', id)?.state ?? {}) as Record<string, unknown>

describe('顺延期限：改的是当初说出口的那个日子', () => {
  it('写进图，并且写的就是那个新日子', async () => {
    await goal()
    await child('c1', '统一模板', '2026-08-01')
    const result = await call('postpone-commitment', { id: 'c1', due: '2026-09-05' })
    expect(result.ok).toBe(true)
    expect(stateOf('c1').due).toBe('2026-09-05')
    // 顺延不是完成也不是作废——它还在跟。
    expect(stateOf('c1').status).toBe('open')
  })

  it('已经结束的事改期限没有意义，拒绝而不是静默写一笔', async () => {
    await goal()
    await child('c1', '统一模板')
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'done' }, actor: OPERATOR,
    })
    const result = await call('postpone-commitment', { id: 'c1', due: '2026-09-05' })
    expect(result.ok).toBe(false)
    expect(stateOf('c1').due).toBeUndefined()
  })

  it('少了参数就说少了什么', async () => {
    expect(await call('postpone-commitment', { id: 'c1' })).toMatchObject({ ok: false })
    expect(await call('postpone-commitment', { due: '2026-09-05' })).toMatchObject({ ok: false })
  })

  it('图上没有这条就不要凭空造一条出来', async () => {
    // `append` 对未知 id 会**新建**对象——所以缺了这道守卫，一个打错的 id
    // 会凭空长出一条没人认识的承诺，而且任何界面都删不掉它。
    const result = await call('postpone-commitment', { id: 'nope', due: '2026-09-05' })
    expect(result.ok).toBe(false)
    expect(graph.rawObject('commitment', 'nope')).toBeUndefined()
  })
})

describe('合并：不自动合，但必须能手动合', () => {
  it('被合掉的那条进坟墓，留下的那条不动', async () => {
    await goal()
    await child('c1', '对账脚本')
    await child('c2', '对账脚本（重复登记）')
    const result = await call('merge-commitment', { id: 'c2', into: 'c1' })
    expect(result.ok).toBe(true)
    expect(stateOf('c2').status).toBe('merged')
    expect(stateOf('c2').mergedInto).toBe('c1')
    expect(stateOf('c1').status).toBe('open')
  })

  it('墓碑律：合掉之后再没有动词能把它唤醒', async () => {
    await goal()
    await child('c1', '对账脚本')
    await child('c2', '重复的那条')
    await call('merge-commitment', { id: 'c2', into: 'c1' })
    // 一句迟到的「完成」、一次顺延、再合一次——都不该让它复活。
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c2', cause: 'done' }, actor: OPERATOR,
    })
    expect(stateOf('c2').status).toBe('merged')
    expect(await call('postpone-commitment', { id: 'c2', due: '2026-09-05' })).toMatchObject({ ok: false })
  })

  it('不能合并到自己身上', async () => {
    await goal()
    await child('c1', '对账脚本')
    expect(await call('merge-commitment', { id: 'c1', into: 'c1' })).toMatchObject({ ok: false })
    expect(stateOf('c1').status).toBe('open')
  })

  it('要合并进去的那条必须真的存在', async () => {
    await goal()
    await child('c1', '对账脚本')
    const result = await call('merge-commitment', { id: 'c1', into: 'ghost' })
    expect(result.ok).toBe(false)
    // 合并到一个不存在的 id，等于把这条扔进虚空。
    expect(stateOf('c1').status).toBe('open')
    expect(graph.rawObject('commitment', 'ghost')).toBeUndefined()
  })

  it('合并之后它从「在跟」里退出，但目标下的历史还看得见', async () => {
    await goal()
    await child('c1', '对账脚本')
    await child('c2', '重复的那条')
    await call('merge-commitment', { id: 'c2', into: 'c1' })
    const page = goalPageFrame(ctx, GOAL)
    expect(page?.goal.counts.open).toBe(1)
    expect(page?.goal.children.map(row => row.id)).toContain('c2')
  })
})

describe('移交：换人，不换承诺', () => {
  it('执行者变了，而这条承诺还是这一条', async () => {
    await goal()
    await child('c1', '统一模板', '2026-08-30')
    const before = graph.rawObject('commitment', 'c1')?.createdSeq
    const result = await call('handoff-commitment', { id: 'c1', openId: 'u-zhang', name: '张锐' })
    expect(result.ok).toBe(true)
    expect(stateOf('c1').executor).toMatchObject({ kind: 'human', openId: 'u-zhang', name: '张锐' })
    /*
      出生边、期限、挂接、状态一个都不能掉——移交如果实现成「作废旧的、新建
      一条」，这些就全留在一条没人再看的记录上了，而它们正是这条承诺可信的
      全部理由。
    */
    expect(graph.rawObject('commitment', 'c1')?.createdSeq).toBe(before)
    expect(stateOf('c1').due).toBe('2026-08-30')
    expect(stateOf('c1').parentGoalRef).toBe(GOAL)
    expect(stateOf('c1').sourceAnchor).toBe('yzj:c1')
    expect(stateOf('c1').status).toBe('open')
  })

  it('名字可以不给——openId 才是身份', async () => {
    await goal()
    await child('c1', '统一模板')
    expect(await call('handoff-commitment', { id: 'c1', openId: 'u-zhang' })).toMatchObject({ ok: true })
    expect(stateOf('c1').executor).toMatchObject({ kind: 'human', openId: 'u-zhang' })
  })

  it('没有新执行者就不算移交', async () => {
    await goal()
    await child('c1', '统一模板')
    expect(await call('handoff-commitment', { id: 'c1' })).toMatchObject({ ok: false })
  })

  it('已经结束的事不能移交——没有东西可交', async () => {
    await goal()
    await child('c1', '统一模板')
    await graph.append({
      type: 'commitment/voided', data: { commitmentId: 'c1', cause: '不做了' }, actor: OPERATOR,
    })
    expect(await call('handoff-commitment', { id: 'c1', openId: 'u-zhang' })).toMatchObject({ ok: false })
    expect(stateOf('c1').status).toBe('voided')
  })

  it('移交之后，板上这一行归到新执行者名下', async () => {
    await goal()
    await child('c1', '统一模板')
    await call('handoff-commitment', { id: 'c1', openId: 'u-zhang', name: '张锐' })
    expect(goalPageFrame(ctx, GOAL)?.goal.children[0]?.who).toBe('张锐')
  })
})

describe('目标作废：有死法，但级联是人的判断', () => {
  it('目标进终态，底下的事显形但一条都没被动过', async () => {
    await goal()
    await child('c1', '统一模板')
    await child('c2', '对账脚本')
    const result = await call('void-commitment', {
      id: goalCommitmentIdFor(GOAL), reason: '不做了',
    })
    expect(result.ok).toBe(true)
    const page = goalPageFrame(ctx, GOAL)
    expect(page?.retired).toBe(true)
    expect(page?.goal.children.every(row => row.parentRetired === true)).toBe(true)
    // **一条都没被自动作废**——摩擦保留在这里。
    expect(page?.goal.children.every(row => row.status === 'open')).toBe(true)
  })

  it('「全部作废」是人按的那一下，按了才动', async () => {
    await goal()
    await child('c1', '统一模板')
    await child('c2', '对账脚本')
    await call('void-commitment', { id: goalCommitmentIdFor(GOAL), reason: '不做了' })
    for (const id of ['c1', 'c2']) {
      expect(await call('void-commitment', { id, reason: '父目标已结束' })).toMatchObject({ ok: true })
    }
    expect(goalPageFrame(ctx, GOAL)?.goal.counts.open).toBe(0)
  })

  it('「全部移出改挂」把它们送回无归属，而不是杀掉', async () => {
    await goal()
    await child('c1', '统一模板')
    await child('c2', '对账脚本')
    await call('void-commitment', { id: goalCommitmentIdFor(GOAL), reason: '不做了' })
    const result = await call('unlink-commitments', { ids: ['c1', 'c2'] })
    expect(result.ok).toBe(true)
    // 还活着,只是不再挂在这个目标下——未挂是合法状态。
    expect(stateOf('c1').status).toBe('open')
    /*
      追加式日志里删不掉一个字段,所以「抹掉引用」写的是空串——而读的那一路
      (`asString`)把空串读成「没有」。两边必须一致:只锁原始状态会把一个实现
      细节焊死,只锁读出来的又看不出它是怎么被抹掉的,所以两条都锁。
    */
    expect(stateOf('c1').parentGoalRef).toBe('')
    const board = boardFrame(ctx)
    expect([...board.unattached.map(row => row.id)].sort()).toEqual(['c1', 'c2'])
    // 不能长出一个以空串为键的幽灵分组。
    expect(board.goals.map(entry => entry.goalRef)).not.toContain('')
    expect(goalPageFrame(ctx, GOAL)).toBeUndefined()
  })

  it('目标已经作废了就不能再作废一次', async () => {
    await goal()
    await child('c1', '统一模板')
    await call('void-commitment', { id: goalCommitmentIdFor(GOAL), reason: '不做了' })
    expect(await call('void-commitment', { id: goalCommitmentIdFor(GOAL) })).toMatchObject({ ok: false })
  })
})

describe('目标页端点', () => {
  it('板上没有的目标，端点说没有，而不是回一个空壳', async () => {
    expect(await call('goal-page', { goalRef: 'https://x/none' })).toMatchObject({ ok: false })
  })

  it('少了 goalRef 就说少了', async () => {
    expect(await call('goal-page', {})).toMatchObject({ ok: false })
  })
})

/**
 * 动词主权 —— **无主权的动词不渲染，端点也不收** (v4.22 裁决②).
 *
 * 设计把 v4.21 的板行「修理按钮全行渲染」点名成了这条裁决的**第一违规者**：主权法则
 * 缺位时，实现者必然用「全给」填空。而只在界面上不画、端点照收，等于把主权做成一层
 * 皮肤——绕过它只需要一次直接调用，而这条通道本来就对模型开着。所以两条一起锁。
 *
 * 席位夹具按**四席位**造（v3.14 工程条款：凡按可见域/主权渲染的视图，fixture 必含
 * owner／执行者／跨域执行者／旁观者）——这里够得着的是前两个：登记它的人（owner，
 * 也就是桌面操作者）与执行它的人（李婷）。
 */
describe('动词主权 = 节点主权的派生', () => {
  /** 别人登记的一条活：owner 是李婷，桌面操作者只是看得见它。 */
  async function theirs(id = 'c9'): Promise<void> {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id,
        what: '别人登记的活',
        executor: { kind: 'human', openId: 'u-zhang', name: '张锐' },
        sourceAnchor: `yzj:${id}`,
        topicKey: 'tk-1',
        parentGoalRef: GOAL,
      },
      // 出生事件的 actor 就是 owner —— reduce 会把它盖成 delegatedBy。
      actor: { kind: 'operator', openId: 'u-li' },
    })
  }

  it('自己登记的那条，动词照旧归自己——板上不下发「归谁管」', async () => {
    await goal()
    await child('c1', '统一模板')
    const row = boardFrame(ctx).goals[0]?.children.find(one => one.id === 'c1')
    // 等于本人时省略：绝大多数行都归你自己，全印一遍会把要说清的那几行淹掉。
    expect(row?.stewardedBy).toBeUndefined()
  })

  it('别人登记的那条，板上说得出它归谁管', async () => {
    await goal()
    // 名字取自登记时抄下的那份名录——李婷得先在某处以执行者身份出现过。
    await child('c1', '统一模板')
    await theirs()
    const row = boardFrame(ctx).goals[0]?.children.find(one => one.id === 'c9')
    expect(row?.stewardedBy).toBe('李婷')
  })

  /*
    **不猜，宁可难看。**

    名录里查不到那个 openId 时印 openId 本身，而不是编一个称呼、也不是把这一格
    悄悄省掉——省掉的后果是那一行看起来「归我管」，而它的动词恰恰不会渲染。
  */
  it('名录里没有那个人时印 openId，不省略也不编', async () => {
    await goal()
    await theirs()
    const row = boardFrame(ctx).goals[0]?.children.find(one => one.id === 'c9')
    expect(row?.stewardedBy).toBe('u-li')
  })

  /*
    端点是另一半。UI 不渲染只是不造按钮——真正挡住的是这里，否则「不渲染」只是一层
    皮肤：文本通道、模型、任何一次直接调用都能绕过去。
  */
  it.each([
    ['顺延', 'postpone-commitment', { id: 'c9', due: '2026-09-05' }],
    ['作废', 'void-commitment', { id: 'c9' }],
    ['移交', 'handoff-commitment', { id: 'c9', openId: 'u-x', name: '某人' }],
    ['摘除', 'unlink-commitments', { ids: ['c9'] }],
  ])('%s 别人登记的那条，端点拒绝并说清归谁', async (_verb, endpoint, payload) => {
    await goal()
    await theirs()
    const result = await call(endpoint, payload)
    expect(result.ok).toBe(false)
    expect((result as { error?: { message?: string } }).error?.message)
      .toContain('登记这条承诺的人')
    // 拒绝不禁言：那条仍然走得通的路要说出来（指路 + 可选转达拟稿，v3.14r②）。
    expect((result as { error?: { message?: string } }).error?.message)
      .toContain('直接问他')
  })

  it('拒绝之后图上一个字没写', async () => {
    await goal()
    await theirs()
    const before = stateOf('c9').status
    await call('void-commitment', { id: 'c9' })
    expect(stateOf('c9').status).toBe(before)
    expect(stateOf('c9').due).toBeUndefined()
  })
})
