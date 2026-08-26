/**
 * 移交闭环谱 —— **一条义务经手三个人，每一步都问「别处看见了什么」**。
 *
 * 这一组不是覆盖率，是**形状**。移交的既有测试全是横向的：端点写对没有、状态转对没有、
 * 文案说对没有——而这一天里真正逮到的东西全长在纵线上，无一例外是**组合缺陷**：
 *
 * - `transferred` 是终态（对的）+ 目标计数数所有终态（本来也对）= **一条义务每移交一次，
 *   目标就凭空多一格完成度**，而那个数字正是拿去对账、拿去判「该评估了」的；
 * - 吸收态留档（对的）+ 验收卡在终态收口（也对）= 一份等着你验收的交付，被一次移交
 *   **无声吞掉**；
 * - 作废/合并留了一扇 reopen（对的）+ 移交照抄那扇门（看起来也对）= 重开旧边之后，
 *   两条 open 边说着同一件事，两个人各自以为归自己。
 *
 * 每一条单独看都对。所以下面的断言一律是**跨层**的：做了 A 之后，B 面上该看见什么。
 *
 * ## 四条不变量（第一性）
 *
 * 移交的存在理由只有一句：**人走了，事没走**。把它拆成可证伪的四条：
 *
 * - **不重不漏**：任一时刻，这件事恰好欠在一个人身上（open 边恒为 1）。
 * - **史不丢**：旧边的回执与轨迹留在原处，血缘能从链尾一路走回最初那条。
 * - **听众即那句话的听众**：不并集、不继承——这正是边变异模型解不了的那一问。
 * - **零维护**：移交之后，板、计数、方向轴、真身全自动对，没有一个字段等着谁去更新。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  createCommitmentCard, commitmentFamily, goalCommitmentIdFor, goalEvidence, pendingDecisionsOn,
  type CommitmentState,
} from '@yzj-next/objects'
import { applySurfaceRpc, boardFrame, goalPageFrame } from '../src/rpc.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const GOAL = 'https://yzj.example.com/doc/q3'

type Handler = (endpoint: string, payload: unknown) => Promise<
  { ok: true; value: unknown } | { ok: false; error: { message: string } }
>

let ctx: Context
let graph: YzjGraph
let call: Handler
let posted: { placeKey: string; text: string }[]

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-hloop-')) })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  posted = []
  ctx.provide('yzjTopics', {
    tree: () => [],
    topicOf: () => undefined,
    aliases: () => ['@next'],
    conversations: () => [],
    sendInPlace: async (placeKey: string, text: string) => {
      posted.push({ placeKey, text })
      return { msgId: `m-${String(posted.length)}`, ignited: false }
    },
  })
  const cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  cards.setDesktopActor(OPERATOR, '我')
  let captured: Handler | undefined
  ctx.provide('connection', {
    rpc: { handle: (_path: string, fn: Handler) => { captured = fn } },
  })
  applySurfaceRpc(ctx, 40)
  await new Promise(resolve => { setTimeout(resolve, 1) })
  if (captured === undefined) throw new Error('RPC handler 没有被注册')
  call = captured
})

const stateOf = (id: string): CommitmentState =>
  graph.rawObject('commitment', id)?.state as unknown as CommitmentState

/** 图上此刻还在跟的那些边。「不重不漏」量的就是它。 */
const openEdges = (): string[] => [...graph.query(OPERATOR, { kind: 'commitment' })]
  .filter(object => asString(asRecord(object.state)?.status) === 'open')
  .filter(object => asString(asRecord(object.state)?.goalRef) === undefined)
  .map(object => object.id)

async function openGoal(): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: goalCommitmentIdFor(GOAL), what: 'Q3 对账', goalRef: GOAL,
      executor: { kind: 'human', openId: 'op-1', name: '我' },
      sourceAnchor: 'desktop:board', criteria: '三家竞品各出一页',
    },
    actor: OPERATOR,
  })
}

/** 最初那一条：李婷在财务群里被登记。 */
async function firstEdge(): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: 'c1', what: '统一模板', sourceAnchor: 'yzj:m-0',
      executor: { kind: 'human', openId: 'u-li', name: '李婷' },
      audience: ['yzj-group-g1'], parentGoalRef: GOAL, due: '下周三前',
    },
    actor: OPERATOR,
  })
}

/** 说一句移交话语，落在 `placeKey`。回的是新签发出来的那条边。 */
async function handoff(
  from: string, to: { openId: string; name: string }, placeKey: string,
): Promise<string | undefined> {
  const result = await call('send-in-place', {
    placeKey,
    text: `${to.name}，「统一模板」这条现在转给你了。`,
    handoff: { fromCommitmentId: from, openId: to.openId, name: to.name },
  }) as { value: { toCommitmentId?: string } }
  return result.value.toCommitmentId
}

describe('不变量①：不重不漏 —— 任一时刻恰好欠在一个人身上', () => {
  it('两次转手之后，还在跟的仍然只有一条', async () => {
    await openGoal()
    await firstEdge()
    expect(openEdges()).toEqual(['c1'])

    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    expect(openEdges()).toEqual([second])

    const third = await handoff(second, { openId: 'u-wang', name: '王五' }, 'yzj-dm-d1') as string
    expect(openEdges()).toEqual([third])
    expect(stateOf(third).executor).toMatchObject({ openId: 'u-wang' })
  })

  /*
    **移交没有 reopen**（决策 #59）。作废与合并各留了一扇门，因为它们是**结束**；移交
    不是结束，这条义务此刻正在链尾活着。重开旧边 = 两条 open 边说着同一件事，而两个人
    各自以为归自己——不重不漏当场破掉。
  */
  it('旧边重开不了 —— 「移交回来」是再签发一条新边，不是把死的那条挖出来', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    await graph.append({
      type: 'commitment/reopened', data: { commitmentId: 'c1', cause: '想拿回来' }, actor: OPERATOR,
    })
    expect(stateOf('c1').status).toBe('transferred')
    expect(openEdges()).toEqual([second])
  })

  /*
    墓碑律的移交面：老执行者在原来那个群里回一句「做完了」，不该把旧边复活成一条在跑的活。
  */
  it('迟到的话动不了旧边', async () => {
    await openGoal()
    await firstEdge()
    await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2')
    await graph.append({
      type: 'commitment/delivered',
      data: { commitmentId: 'c1', delivery: { claim: '我做完了', at: Date.now() } },
      actor: { kind: 'person', openId: 'u-li' },
    })
    expect(stateOf('c1').status).toBe('transferred')
    expect(stateOf('c1').delivery).toBeUndefined()
  })
})

describe('不变量②：史不丢 —— 血缘能从链尾走回最初那条', () => {
  it('三个人一条链，一路走得回去', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    const third = await handoff(second, { openId: 'u-wang', name: '王五' }, 'yzj-dm-d1') as string

    expect(stateOf(third).transferredFrom?.commitmentId).toBe(second)
    expect(stateOf(second).transferredFrom?.commitmentId).toBe('c1')
    expect(stateOf('c1').transferredFrom).toBeUndefined()
    // 反向也走得通：每一条旧边说得出自己交给了谁。
    expect(stateOf('c1').transferredTo?.commitmentId).toBe(second)
    expect(stateOf(second).transferredTo?.executor).toMatchObject({ openId: 'u-wang' })
  })

  /*
    **回执与轨迹留在旧边**，不跟着走：那是这条吸收态存在的一半理由。跟着走的话，新执行者
    会背上一份不是他交的东西。
  */
  it('旧边上的回执留在旧边，新边从头开始', async () => {
    await openGoal()
    await firstEdge()
    await graph.append({
      type: 'commitment/updated',
      data: { commitmentId: 'c1', lastReceipt: '李婷说在弄了', acceptance: { state: 'accepted', at: 1 } },
      actor: OPERATOR,
    })
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    expect(stateOf('c1').lastReceipt).toBe('李婷说在弄了')
    expect(stateOf(second).lastReceipt).toBeUndefined()
    // 受领三态**重启**：张锐还没答应过任何事（v4.24 全套条款零特例）。
    expect(stateOf(second).acceptance).toBeUndefined()
  })

  it('这件事本身继承下来：事项、原话期限、挂的哪个目标', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    expect(stateOf(second).what).toBe('统一模板')
    expect(stateOf(second).due).toBe('下周三前')
    expect(stateOf(second).parentGoalRef).toBe(GOAL)
    /*
      **挂接继承要明标**（v3.19r①）：不写的话新边落进「无归属」组，而目标页上那条活会
      凭空消失——一次移交被渲染成一次静默摘除。
    */
    expect(stateOf(second).attachedVia).toBe('inherited')
  })
})

describe('不变量③：听众 = 那句话的听众', () => {
  it('新边只带新场所，旧边的那批人不跟着走', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    expect(graph.rawObject('commitment', second)?.audience).toEqual(['yzj-group-g2'])
    expect(graph.rawObject('commitment', 'c1')?.audience).toEqual(['yzj-group-g1'])
  })

  /*
    **三方知情 = 零新机制**：新执行者听见出生话语，旧执行者听见解除告知（他本来就在那批
    听众里），owner 是说话的那个人。三个人各自都在至少一条消息的听众里。
  */
  it('每个受影响的人都在某一条消息的听众里', async () => {
    await openGoal()
    await firstEdge()
    await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2')
    // 新场所：那句移交话语。
    expect(posted.find(one => one.placeKey === 'yzj-group-g2')?.text).toContain('张锐')
    // 旧场所：解除告知。
    const notice = posted.find(one => one.placeKey === 'yzj-group-g1')
    expect(notice?.text).toContain('统一模板')
    expect(notice?.text).toContain('留在原处')
  })
})

/**
 * 不变量④：**零维护** —— 移交之后没有任何字段等着谁去更新。
 *
 * 这一节是这次 review 抓到最狠的那一处的复现：`transferred` 是终态（对的）+ 目标计数
 * 数所有终态（本来也对）= 一条义务每移交一次，目标就凭空多一格完成度。
 */
describe('不变量④：零维护 —— 板与计数自动就是对的', () => {
  it('义务线：转手两次，目标底下仍然只有一条义务', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    await handoff(second, { openId: 'u-wang', name: '王五' }, 'yzj-dm-d1')

    const counts = boardFrame(ctx).goals.find(one => one.goalRef === GOAL)?.counts
    // 1 在跟、0 已了——不是「1 在跟 + 2 已了」。
    expect(counts).toEqual({ open: 1, overdue: 0, settled: 0 })

    const evidence = goalEvidence(ctx, OPERATOR, GOAL)
    expect(evidence.counts).toEqual({ open: 1, overdue: 0, settled: 0 })
    // 差距简报遍历的是义务线：同一件事不列三遍。
    expect(evidence.obligationLine).toHaveLength(1)
    // 而全量仍在，留档看得见。
    expect(evidence.children).toHaveLength(3)
  })

  /*
    **「该评估了」不该被移交提前触发**：子承诺全部终态才建议评估，而转手过的那条不是
    一条终态的义务——它的义务还在跑。
  */
  it('转手不会让目标看起来「全部完成、该评估了」', async () => {
    await openGoal()
    await firstEdge()
    await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2')
    const inbox = await call('inbox', {}) as { value: { commitments: { toAssess?: number } } }
    expect(inbox.value.commitments.toAssess ?? 0).toBe(0)
  })

  it('板上两条都看得见：旧的说得出去向，新的在跟', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    const children = goalPageFrame(ctx, GOAL)?.goal.children ?? []
    expect(children.find(one => one.id === 'c1')?.transferredTo).toBe('张锐')
    expect(children.find(one => one.id === second)?.status).toBe('open')
  })

  /*
    **方向轴自动跟着走**：转手之后「欠我的」指向新执行者，而旧的那条不再是一笔应收。
  */
  it('方向轴：应收挪到新执行者名下', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    const rows = boardFrame(ctx).rows
    expect(rows.find(one => one.id === second)?.direction).toBe('owed-to-me')
    expect(rows.find(one => one.id === second)?.who).toBe('张锐')
    expect(rows.find(one => one.id === 'c1')?.status).toBe('transferred')
  })
})

/**
 * **移交不吞裁决**（v3.19r③）—— 绝不静默丢失律的移交面。
 *
 * 旧边一转吸收态，挂在它上面的验收卡就收口了：一份「他交了、等你验收」的交付会被一次
 * 移交无声地吞掉——没人拒绝过它，也没人接受过它，它只是不见了。
 */
describe('移交不吞裁决', () => {
  it('旧边上等着裁决的东西，移交之前说得出来', async () => {
    await openGoal()
    await firstEdge()
    await graph.append({
      type: 'commitment/delivered',
      data: { commitmentId: 'c1', delivery: { claim: '模板初稿在这儿', at: Date.now() } },
      actor: { kind: 'person', openId: 'u-li' },
    })
    const result = await call('handoff-context', { id: 'c1' }) as {
      value: { pending: string[] }
    }
    expect(result.value.pending).toHaveLength(1)
    expect(result.value.pending[0]).toContain('待验收')
    expect(result.value.pending[0]).toContain('模板初稿在这儿')
  })

  it('没有待裁决的东西时，不无中生有一句警告', async () => {
    await openGoal()
    await firstEdge()
    const result = await call('handoff-context', { id: 'c1' }) as { value: { pending: string[] } }
    expect(result.value.pending).toEqual([])
  })

  /*
    **不阻塞**：换人是 owner 的主权。这一条钉的是「亮出来 ≠ 拦住」——设计明确说不设门。
  */
  it('亮出来之后照样移交得了 —— 这不是一道门', async () => {
    await openGoal()
    await firstEdge()
    await graph.append({
      type: 'commitment/delivered',
      data: { commitmentId: 'c1', delivery: { claim: '初稿', at: Date.now() } },
      actor: { kind: 'person', openId: 'u-li' },
    })
    expect(pendingDecisionsOn(stateOf('c1'))).toHaveLength(1)
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2')
    expect(second).toBeDefined()
  })
})

/**
 * **可见域** —— 边变异模型解不了、而分叉模型一句话答完的那一维。
 *
 * 「这条边的听众是谁」在边变异模型里没有答案（两次登记性话语的并集是个泥潭），而听众
 * 集合是整套东西的地基：它决定谁看得见这件事。分叉之后答案是平凡的——各自那次话语的
 * 听众——但**平凡不等于自动正确**，得能看见它的后果。
 *
 * 最能说明问题的是**移交进私聊**：原来群里的人从此看不见这件事在哪儿、进展如何。那是
 * 一次真实的可见性收缩，也正是 owner 选私聊时买到的东西。
 */
describe('可见域：新边只对新场所可见', () => {
  const inPlace = (placeKey: string): string[] =>
    [...graph.query({ kind: 'place', placeKey }, { kind: 'commitment' })].map(one => one.id)

  it('移交进私聊之后，旧群里看不见新边；私聊里看不见旧边', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-dm-d1') as string

    expect(inPlace('yzj-group-g1')).toContain('c1')
    expect(inPlace('yzj-group-g1')).not.toContain(second)

    expect(inPlace('yzj-dm-d1')).toContain(second)
    expect(inPlace('yzj-dm-d1')).not.toContain('c1')
  })

  /*
    **旧群里那条不会变成一条无声消失的活**：它还在，而且说得出自己转给了谁。可见性收缩
    的是「新边的进展」，不是「这件事发生过」——后者被抹掉才是撒谎。
  */
  it('旧群仍然看得见「这件事转走了」，只是看不到之后的进展', async () => {
    await openGoal()
    await firstEdge()
    await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-dm-d1')
    const seen = graph.object({ kind: 'place', placeKey: 'yzj-group-g1' }, 'commitment', 'c1')
    expect(asString(asRecord(seen?.state)?.status)).toBe('transferred')
    expect(asRecord(asRecord(seen?.state)?.transferredTo)).toBeDefined()
  })

  /*
    owner 看得见全部：他是这两次话语的发话人，两条边的听众里都有他这一头。
  */
  it('owner 两条都看得见 —— 他本来就是说话的那个人', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-dm-d1') as string
    const mine = [...graph.query(OPERATOR, { kind: 'commitment' })].map(one => one.id)
    expect(mine).toContain('c1')
    expect(mine).toContain(second)
  })
})

/**
 * **决断层**：转手之后旧边不再占「需要你答」的位置。
 *
 * 一条已经转走的活还在决断条上等人答，是这套设计点名的那种失败：条长即审批疲劳，而条上
 * 那一项此刻根本没有可答的东西。
 */
describe('决断层：旧边不再要人答', () => {
  it('转手之后旧边收口，新边接着要人跟', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    const rows = boardFrame(ctx).rows
    // 「催得动」是「还需要有人做点什么」最直接的可观察形态。
    expect(rows.find(one => one.id === 'c1')?.remindable).toBe(false)
    expect(rows.find(one => one.id === second)?.remindable).toBe(true)
  })
})

/**
 * 闭环：新边**走得完整条命**。一个只能出生、不能被催、不能交付的新边，等于把移交做成了
 * 一次单程票——而承诺板全部的价值在于每一环既可见又可动。
 */
describe('闭环：接手的那条能走完一整圈', () => {
  it('催 → 顺延 → 交付 → 验收，一环不缺', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string

    // 催：要有可催的判据（听众非空）。
    expect(boardFrame(ctx).rows.find(one => one.id === second)?.remindable).toBe(true)
    // 顺延：改的是当初说出口的那个日子。
    expect(await call('postpone-commitment', { id: second, due: '下下周一' }))
      .toMatchObject({ ok: true })
    expect(stateOf(second).due).toBe('下下周一')
    // 交付 → 等验收（承诺仍然 open：在有人验收之前它确实还欠着）。
    await graph.append({
      type: 'commitment/delivered',
      data: { commitmentId: second, delivery: { claim: '做完了', at: Date.now() } },
      actor: { kind: 'person', openId: 'u-zhang' },
    })
    expect(stateOf(second).status).toBe('open')
    expect(boardFrame(ctx).rows.find(one => one.id === second)?.awaitingAcceptance).toBe(true)
    // 验收：终态。
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: second, cause: 'accepted' }, actor: OPERATOR,
    })
    expect(stateOf(second).status).toBe('closed')

    // 一圈走完，目标的账仍然是一条义务：1 已了，0 在跟。
    expect(boardFrame(ctx).goals.find(one => one.goalRef === GOAL)?.counts)
      .toEqual({ open: 0, overdue: 0, settled: 1 })
  })

  it('接手的那条还能再移交 —— 链没有长度上限', async () => {
    await openGoal()
    await firstEdge()
    const second = await handoff('c1', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    const context = await call('handoff-context', { id: second }) as {
      ok: boolean; value: { executor?: { openId: string }; placeKey?: string }
    }
    expect(context.ok).toBe(true)
    // 预选当前值读的是**新边**的现任与现场所，不是最初那条的。
    expect(context.value.executor).toMatchObject({ openId: 'u-zhang' })
    expect(context.value.placeKey).toBe('yzj-group-g2')
  })

  /*
    **转包出来的那条被移交时，血缘不能断**：它仍然挂在我那条底下，责任链没有因为换人
    而变浅。
  */
  it('转包出来的边移交之后，仍然挂在父承诺底下', async () => {
    await openGoal()
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-sub', what: '统一模板', sourceAnchor: 'yzj:m-0',
        executor: { kind: 'human', openId: 'u-li', name: '李婷' },
        audience: ['yzj-group-g1'], parentGoalRef: GOAL, parentCommitmentId: 'c-mine',
      },
      actor: OPERATOR,
    })
    const second = await handoff('c-sub', { openId: 'u-zhang', name: '张锐' }, 'yzj-group-g2') as string
    expect(stateOf(second).parentCommitmentId).toBe('c-mine')
  })
})
