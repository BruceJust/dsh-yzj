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
/*
  通道那一头的两份名录，用例各自换掉。

  **是换内容，不是换服务**：cordis 的 `provide` 一个上下文只认一次，第二次会抛
  「已经注册过」——所以假通道读的是这两个变量，而不是被整个替换掉。
*/
let places: unknown[] = []
let conversations: unknown[] = []

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-declare-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  ctx.provide('yzjBridge', { run: async (...args: unknown[]) => bridge(args[0] as string[]) })
  places = []
  conversations = []
  ctx.provide('yzjTopics', {
    tree: () => places,
    topicOf: () => undefined,
    aliases: () => ['@next'],
    presenceIn: () => ({ self: 'off' as const, peers: [] }),
    peers: () => [],
    conversations: () => conversations,
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

  /*
    **撤回过的委派不是候选。** 作废掉的那条是「这次不算数了」，摆进候选等于拿一次被收回
    的决定冒充一条事实——实测就撞见了：今早修掉的那批占位行全是作废状态，于是候选里出现
    了一个叫「我」的人。
  */
  it('作废掉的那次委派不再算数', async () => {
    await person('c8', 'u-gone', '走掉的人')
    await graph.append({
      type: 'commitment/voided', data: { commitmentId: 'c8', cause: '不做了' }, actor: ME,
    })
    expect(await candidates()).toEqual([])
  })

  /*
    **转手过的那一条：人还是候选，出处得说对**（决策 #59）。

    移交是一次真的、发生过的委派，所以它和已完成的那些同一档——不进撤回名单。可这条边
    已经转走了，再说「这个目标里已经有他的活」就是假话，而出处正是这一层候选存在的全部
    理由：一个说不出自己为什么在这里的候选，等于「系统觉得你想找谁」。
  */
  it('移交走的那条：还算「最近委派过」，但不再算「这个目标里有他的活」', async () => {
    await person('c4', 'u-zhang', '张锐', { parentGoalRef: GOAL })
    await graph.append({
      type: 'commitment/transferred',
      data: {
        commitmentId: 'c4',
        transferredTo: {
          commitmentId: 'c5',
          executor: { kind: 'human', openId: 'u-other', name: '王五' },
          at: Date.now(),
        },
      },
      actor: ME,
    })
    const rows = await candidates()
    expect(rows.find(one => one.openId === 'u-zhang')?.why).toBe('你最近委派过他')
  })

  it('一个候选都没有就是空的 —— 第一次用这个产品的人本来就没有近处', async () => {
    expect(await candidates()).toEqual([])
  })

  it('我自己不进候选 —— 委派给自己不是委派', async () => {
    await person('c3', 'op-me', '我')
    expect(await candidates()).toEqual([])
  })
})

/**
 * **委派第②维的选项集：场所，不是「已经存在的话题」**（v4.24）。
 *
 * 这一组钉两件事，它们是同一次误设计的两半：
 *
 * ① 落点必须是**会话本身**。此前这一屏列的是图上已有的话题，于是最常见的一次委派根本
 *    无从落地——目标刚定下来要派给张三，那个群里还一个话题都没有，那个群压根不在列表
 *    上。倒因为果了：**话题是委派的产物，不是委派的前提**。
 * ② 事实可以缩小选项集，**装作知道不行**。给人委派时此前列的是我所有的群，不管那个人
 *    在不在——最容易的一次误操作就是把「张锐负责 X」说进一个张锐根本不在的群：听众集合
 *    缺了他那一头（最小听众不变量），而群里其他人以为这事已经说好了。平台没有群成员
 *    列表 API，「他在不在」答不了；答得了的是「**他在这个群里有过登记吗**」。
 */
describe('委派落点的选项集', () => {
  const registered = async (id: string, openId: string, place: string): Promise<void> => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: `活 ${id}`, sourceAnchor: `yzj:${id}`,
        executor: { kind: 'human', openId, name: '张锐' }, audience: [place],
      },
      actor: ME,
    })
  }
  type Room = {
    placeKey: string; name: string; kind: string; known: boolean; theirDm: boolean
    onDuty?: boolean; topics: { sessionId: string; label: string }[]
  }
  const rooms = async (who?: { openId: string; name: string }): Promise<Room[]> => {
    const result = await call('delegate-rooms', who ?? {})
    return (result as { value: { rooms: Room[] } }).value.rooms
  }
  /** 会话列表：一个群、一个和张锐的私聊，外加一个助手号和自聊。 */
  const withConversations = (): void => {
    places = [{
      place: { placeKey: 'yzj-group-g1', groupName: '财务群' },
      topics: [{ sessionId: 'sess-1', label: '统一模板' }],
    }]
    conversations = [
      { placeKey: 'yzj-group-g1', name: '财务群', kind: 'group', onDuty: true, selfChat: false },
      { placeKey: 'yzj-group-g2', name: '产品讨论群', kind: 'group', onDuty: false, selfChat: false },
      { placeKey: 'yzj-dm-d1', name: '张锐', kind: 'direct', onDuty: true, selfChat: false },
      { placeKey: 'yzj-app-a1', name: '云之家小助手', kind: 'assistant', onDuty: false, selfChat: false },
      { placeKey: 'yzj-dm-me', name: '我', kind: 'direct', onDuty: true, selfChat: true },
    ]
  }

  /*
    **一个还没长出任何话题的群也是落点。** 这一条就是这次修的那个病：此前这个群不在
    列表上，于是「派给张三」这件最常见的事在界面上无处可落。
  */
  it('群与私聊都在，话题挂在场所底下', async () => {
    withConversations()
    const list = await rooms()
    expect(list.map(room => room.name)).toEqual(['财务群', '产品讨论群', '张锐'])
    expect(list.find(room => room.name === '财务群')?.topics)
      .toEqual([{ sessionId: 'sess-1', label: '统一模板' }])
    // 一个话题都没有的群照样在——它是场所，不是话题的容器。
    expect(list.find(room => room.name === '产品讨论群')?.topics).toEqual([])
  })

  /*
    两类会话不摆出来，都是**事实排除**：助手号那一头没有人会读到委派；自聊的听众只有
    我自己，一条登记在那儿的委派必然违反最小听众不变量。
  */
  it('助手号与自聊不在选项集里 —— 那儿的委派没有人接得住', async () => {
    withConversations()
    const list = await rooms()
    expect(list.some(room => room.kind === 'assistant')).toBe(false)
    expect(list.some(room => room.name === '我')).toBe(false)
  })

  it('他在哪儿有过登记，就标哪儿 —— 这是事实，不是成员名单', async () => {
    withConversations()
    await registered('c1', 'u-zhang', 'yzj-group-g1')
    await registered('c2', 'u-other', 'yzj-group-g2')
    const list = await rooms({ openId: 'u-zhang', name: '张锐' })
    expect(list.find(room => room.name === '财务群')?.known).toBe(true)
    // 别人在那儿登记过，不算他在那儿。
    expect(list.find(room => room.name === '产品讨论群')?.known).toBe(false)
  })

  /*
    **没有事实就是没有事实**：那时选项集收敛到私聊 + 新建，而界面要把这句话说出来
    （收敛本身是可见的设计事实）——不是默默列出一堆群让人以为都合适。
  */
  it('从没在任何群里登记过：一个都不标 known，而不是「都算」', async () => {
    withConversations()
    await registered('c1', 'u-zhang', 'yzj-group-g1')
    expect((await rooms({ openId: 'u-never', name: '谁' })).some(room => room.known)).toBe(false)
  })

  it('和他的私聊按名字认 —— 平台不给私聊对面的 openId', async () => {
    withConversations()
    const list = await rooms({ openId: 'u-zhang', name: '张锐' })
    expect(list.filter(room => room.theirDm).map(room => room.placeKey)).toEqual(['yzj-dm-d1'])
    // 没说是谁的时候，一个私聊都不该被认成「和他的」。
    expect((await rooms()).some(room => room.theirDm)).toBe(false)
  })

  it('接单与否是事实，读不到就缺席 —— 缺席 ≠ 没接单', async () => {
    withConversations()
    const list = await rooms()
    expect(list.find(room => room.name === '财务群')?.onDuty).toBe(true)
    expect(list.find(room => room.name === '产品讨论群')?.onDuty).toBe(false)
  })

  /*
    会话列表只读最近若干页，图上的话题却记着更早的场所。少了这一边的后果是「明明有那间
    屋子，选不着」——而它恰恰是那种老场所：有历史，最近没说话。
  */
  it('只在图上、不在最近会话里的场所也要出现，且不谎报接单', async () => {
    places = [{
      place: { placeKey: 'yzj-group-old', groupName: '去年的项目群' },
      topics: [{ sessionId: 'sess-old', label: '收尾' }],
    }]
    const list = await rooms()
    expect(list.map(room => room.name)).toEqual(['去年的项目群'])
    expect(list[0]?.onDuty).toBeUndefined()
  })
})

