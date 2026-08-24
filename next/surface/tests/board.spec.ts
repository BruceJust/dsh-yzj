/**
 * 承诺板 GOALS 投影的规格 (v4.9).
 *
 * The board is a QUERY, which is what lets it be honest for free — and also
 * what makes its bugs quiet. Every rule here fails by showing a plausible
 * number rather than an error:
 *
 * - a human-owed commitment must have a session to hop to (过程一跳可达);
 * - 产出 is the SECOND hop and must not double-count or leak across goals;
 * - 未通知 has to reach the screen, because a silent one is the ghost the
 *   whole rule exists to prevent;
 * - counts are a signal — never a completion, and never a percentage.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { nudgeDraft, sinceText } from '../src/client/Board.tsx'
import {
  assessmentCard, assessmentFamily, commitmentCard, commitmentFamily, eventFamily,
  goalCommitmentIdFor,
} from '@yzj-next/objects'
import { sendErrand, takeErrand } from '../src/client/store.ts'
import { boardFrame, bySignal, eventsToday, inboxView } from '../src/rpc.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const GOAL = 'https://yzj.example.com/doc/q3'
const OTHER = 'https://yzj.example.com/doc/q4'

let ctx: Context
let graph: YzjGraph

/** Two topics in one place, so the artifact hop has somewhere to go wrong. */
const TOPICS = [
  { topicKey: 'tk-1', sessionId: 'sess-1', label: '统一模板', groupName: '财务组', placeKey: 'yzj-group-g1', groupId: 'g1' },
  { topicKey: 'tk-2', sessionId: 'sess-2', label: '对账脚本', groupName: '财务组', placeKey: 'yzj-group-g1', groupId: 'g1' },
]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-board-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  graph.defineFamily(assessmentFamily)
  await graph.selectAccount('acct-1')
  /*
    决断层就是卡注册表 (v4.15 家族即接口)。

    「需要你」读的是「谁还在等人答」这个抽象查询,而回答它的是各家族自己声明的
    `demand`。所以一个不挂卡注册表的夹具测的是另一套系统——那里没有任何东西
    能说出自己在等什么。
  */
  const cards = new YzjCards(ctx)
  cards.register(commitmentCard)
  cards.register(assessmentCard)
  ctx.provide('yzjTopics', {
    tree: () => [{
      place: { placeKey: 'yzj-group-g1', groupName: '财务组' },
      topics: TOPICS,
    }],
    topicOf: (sessionId: string) => TOPICS.find(topic => topic.sessionId === sessionId),
    aliases: () => ['@next'],
    conversations: () => [],
  })
})

async function goal(ref = GOAL, criteria?: string): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: goalCommitmentIdFor(ref),
      what: `目标 ${ref.slice(-2)}`,
      goalRef: ref,
      executor: { kind: 'human', openId: 'op-1', name: '我' },
      sourceAnchor: 'desktop:board',
      idemKey: `goal:${ref}`,
      ...(criteria === undefined ? {} : { criteria }),
    },
    actor: OPERATOR,
  })
}

async function child(input: {
  id: string
  what: string
  topicKey?: string
  parentGoalRef?: string
  notified?: 'sent' | 'failed'
  lastReceipt?: string
  agent?: boolean
}): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: input.id,
      what: input.what,
      executor: input.agent === true
        ? { kind: 'agent', topicKey: input.topicKey ?? 'tk-1' }
        : { kind: 'human', openId: 'u-li', name: '李婷' },
      sourceAnchor: `yzj:${input.id}`,
      ...(input.topicKey === undefined ? {} : { topicKey: input.topicKey }),
      ...(input.parentGoalRef === undefined ? {} : { parentGoalRef: input.parentGoalRef }),
    },
    actor: OPERATOR,
  })
  // `notified` is only ever written by the delivery listener, AFTER the
  // commitment exists — seeding it on `opened` would test a shape production
  // never produces (and zod would silently drop it, so the test would pass for
  // the wrong reason).
  if (input.notified !== undefined || input.lastReceipt !== undefined) {
    await graph.append({
      type: 'commitment/updated',
      data: {
        commitmentId: input.id,
        ...(input.notified === undefined ? {} : { notified: input.notified }),
        ...(input.lastReceipt === undefined ? {} : { lastReceipt: input.lastReceipt }),
      },
      actor: OPERATOR,
    })
  }
}

async function produced(
  topicKey: string, uri: string, title: string, taskId?: string,
): Promise<void> {
  await graph.append({
    type: 'lineage/produced',
    data: {
      topicKey,
      artifact: { uri, title, kind: 'sheet', placeKey: 'yzj-group-g1' },
      action: '产出',
      // 带上「哪件活留下的」才算精确归属 (v3.10 4h⑤)。
      ...(taskId === undefined ? {} : { taskId }),
    },
    actor: OPERATOR,
  })
}

describe('过程一跳可达', () => {
  it('gives a human-owed commitment the session it was promised in', async () => {
    await goal()
    await child({ id: 'c1', what: '统一模板', topicKey: 'tk-1', parentGoalRef: GOAL })
    const [row] = boardFrame(ctx).goals[0]?.children ?? []
    /*
      Reading `executor.topicKey` alone matched only agent rows, so the 「打开」
      button — the entire 一跳可达 affordance — was missing on exactly the
      commitments the board exists for.
    */
    expect(row?.sessionId).toBe('sess-1')
    expect(row?.placeName).toBe('财务组')
  })

  it('carries one line of progress and never more', async () => {
    await goal()
    await child({
      id: 'c1', what: '统一模板', topicKey: 'tk-1', parentGoalRef: GOAL, lastReceipt: '模板发了',
    })
    const [row] = boardFrame(ctx).goals[0]?.children ?? []
    expect(row?.progress).toBe('模板发了')
  })
})

describe('产出归集：第二跳', () => {
  it('collects what the goal\'s own work produced, deduplicated', async () => {
    await goal()
    await child({ id: 'c1', what: '统一模板', topicKey: 'tk-1', parentGoalRef: GOAL })
    await child({ id: 'c2', what: '对账脚本', topicKey: 'tk-2', parentGoalRef: GOAL })
    await produced('tk-1', 'https://s/1', '模板')
    await produced('tk-2', 'https://s/2', '脚本')
    // The same artifact seen through two children must count once.
    await produced('tk-2', 'https://s/1', '模板')

    const [entry] = boardFrame(ctx).goals
    expect(entry?.artifacts.map(artifact => artifact.title).sort()).toEqual(['模板', '脚本'])
  })

  it('does not leak another goal\'s output into this one', async () => {
    await goal(GOAL)
    await goal(OTHER)
    await child({ id: 'c1', what: '本目标', topicKey: 'tk-1', parentGoalRef: GOAL })
    await child({ id: 'c2', what: '别的目标', topicKey: 'tk-2', parentGoalRef: OTHER })
    await produced('tk-1', 'https://s/1', '我的')
    await produced('tk-2', 'https://s/2', '别人的')

    const frame = boardFrame(ctx)
    const mine = frame.goals.find(entry => entry.goalRef === GOAL)
    const theirs = frame.goals.find(entry => entry.goalRef === OTHER)
    expect(mine?.artifacts.map(artifact => artifact.title)).toEqual(['我的'])
    expect(theirs?.artifacts.map(artifact => artifact.title)).toEqual(['别人的'])
  })

  it('leaves an un-worked goal with an empty harvest rather than everything', async () => {
    await goal()
    await produced('tk-1', 'https://s/1', '无关产出')
    expect(boardFrame(ctx).goals[0]?.artifacts).toEqual([])
  })
})

describe('未通知必须上屏', () => {
  it('surfaces a registration that was never spoken', async () => {
    await goal()
    await child({ id: 'c1', what: '没人知道的活', topicKey: 'tk-1', parentGoalRef: GOAL, notified: 'failed' })
    await child({ id: 'c2', what: '说过了的活', topicKey: 'tk-2', parentGoalRef: GOAL, notified: 'sent' })
    const children = boardFrame(ctx).goals[0]?.children ?? []
    expect(children.find(row => row.id === 'c1')?.notified).toBe('failed')
    expect(children.find(row => row.id === 'c2')?.notified).toBe('sent')
  })
})

describe('聚合是信号不是状态', () => {
  it('counts children without ever closing the parent', async () => {
    await goal(GOAL, 'T+3 出报表')
    await child({ id: 'c1', what: '一', topicKey: 'tk-1', parentGoalRef: GOAL })
    await child({ id: 'c2', what: '二', topicKey: 'tk-2', parentGoalRef: GOAL })
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c2', cause: 'done' }, actor: OPERATOR,
    })

    const [entry] = boardFrame(ctx).goals
    expect(entry?.counts).toEqual({ open: 1, overdue: 0, settled: 1 })
    // Every child settled would still leave the goal open: 终态永远是人工验收。
    expect(entry?.row?.status).toBe('open')
    expect(entry?.criteria).toBe('T+3 出报表')
  })

  it('shows the newest gap report, answered or not', async () => {
    await goal()
    await graph.append({
      type: 'assessment/reported',
      data: {
        assessmentId: 'asm-1',
        goalRef: GOAL,
        summary: '一条缺失',
        lines: [{ criterion: 'T+3', verdict: 'missing', evidence: '没有任何承诺覆盖这一条' }],
        sourceAnchor: 'session:s1',
      },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'assessment/closed',
      data: { assessmentId: 'asm-1', status: 'continued' },
      actor: OPERATOR,
    })
    const report = boardFrame(ctx).goals[0]?.assessment
    // Hiding it the moment it is answered would make the row look un-assessed
    // one second after somebody assessed it.
    expect(report?.status).toBe('continued')
    expect(report?.lines[0]?.verdict).toBe('missing')
  })
})

describe('未挂是合法状态', () => {
  it('keeps unattached work visible instead of forcing it under a goal', async () => {
    await goal()
    await child({ id: 'c1', what: '不服务于任何目标', topicKey: 'tk-1' })
    const frame = boardFrame(ctx)
    expect(frame.unattached.map(row => row.id)).toEqual(['c1'])
    expect(frame.goals[0]?.children).toEqual([])
  })
})

describe('挂接出处只属于真的挂着的行', () => {
  it('does not label an unattached row with how it was once attached', async () => {
    await goal()
    await child({ id: 'c1', what: '曾经挂过', topicKey: 'tk-1', parentGoalRef: GOAL })
    // 移出：更正即追加,引用清空但出处留在事件里。
    await graph.append({
      type: 'commitment/updated',
      data: { commitmentId: 'c1', parentGoalRef: '', attachedVia: 'detached' },
      actor: OPERATOR,
    })
    const [row] = boardFrame(ctx).unattached
    expect(row?.id).toBe('c1')
    // 空引用不是「没有这个键」——折叠是合并,所以板子必须把空串也当没挂。
    expect(row?.goalRef).toBeUndefined()
  })
})

describe('该评估了：评估触发的推那一半（v4.10）', () => {
  it('counts a goal whose children have all settled', async () => {
    await goal()
    await child({ id: 'c1', what: '一', topicKey: 'tk-1', parentGoalRef: GOAL })
    await child({ id: 'c2', what: '二', topicKey: 'tk-2', parentGoalRef: GOAL })
    expect(inboxView(ctx).commitments.toAssess).toBe(0)

    for (const id of ['c1', 'c2']) {
      await graph.append({
        type: 'commitment/closed', data: { commitmentId: id, cause: 'done' }, actor: OPERATOR,
      })
    }
    // 子承诺全部终态的那一刻,正是写差距简报的时候。
    expect(inboxView(ctx).commitments.toAssess).toBe(1)
  })

  it('does not call a goal with no work yet "ready to assess"', async () => {
    await goal()
    // 刚立的目标不是「做完了」,是「还没开始」——把它推进注意力是纯噪音。
    expect(inboxView(ctx).commitments.toAssess).toBe(0)
  })

  it('stops counting once the goal itself is accepted', async () => {
    await goal()
    await child({ id: 'c1', what: '一', topicKey: 'tk-1', parentGoalRef: GOAL })
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'done' }, actor: OPERATOR,
    })
    expect(inboxView(ctx).commitments.toAssess).toBe(1)
    await graph.append({
      type: 'commitment/closed',
      data: { commitmentId: goalCommitmentIdFor(GOAL), cause: 'accepted' },
      actor: OPERATOR,
    })
    expect(inboxView(ctx).commitments.toAssess).toBe(0)
  })
})

describe('收件箱的承诺计数（改过循环，锁住）', () => {
  it('counts only what is still owed, and only real overdue dates', async () => {
    await goal()
    await child({ id: 'c1', what: '开着的', topicKey: 'tk-1' })
    await child({ id: 'c2', what: '开着且逾期', topicKey: 'tk-2' })
    await graph.append({
      type: 'commitment/updated', data: { commitmentId: 'c2', due: '2020-01-02' }, actor: OPERATOR,
    })
    await child({ id: 'c3', what: '模糊期限不算逾期', topicKey: 'tk-1' })
    await graph.append({
      type: 'commitment/updated', data: { commitmentId: 'c3', due: '下周' }, actor: OPERATOR,
    })
    await child({ id: 'c4', what: '已了', topicKey: 'tk-2' })
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c4', cause: 'done' }, actor: OPERATOR,
    })

    const counts = inboxView(ctx).commitments
    // 目标本身也是一条承诺,它开着,所以算在内。
    expect(counts.open).toBe(4)
    expect(counts.overdue).toBe(1)
  })
})

describe('产出归属：精确是常态，共用是兜底（对抗审查 #2 · v3.10 4h⑤收紧）', () => {
  it('marks output it cannot attribute instead of claiming it', async () => {
    await goal(GOAL)
    await goal(OTHER)
    // 群话题里的常态：先登记一条给 A，后来又登记一条给 B，同一个会话。
    await child({ id: 'c1', what: '服务 A', topicKey: 'tk-1', parentGoalRef: GOAL })
    await child({ id: 'c2', what: '服务 B', topicKey: 'tk-1', parentGoalRef: OTHER })
    await produced('tk-1', 'https://s/1', '说不清归谁的产出')
    await child({ id: 'c3', what: '只服务 A', topicKey: 'tk-2', parentGoalRef: GOAL })
    await produced('tk-2', 'https://s/2', 'A 的活留下的', 'tsk-a')

    const frame = boardFrame(ctx)
    const mine = frame.goals.find(entry => entry.goalRef === GOAL)
    const shared = mine?.artifacts.find(artifact => artifact.title === '说不清归谁的产出')
    const own = mine?.artifacts.find(artifact => artifact.title === 'A 的活留下的')
    // 丢掉是丢真数据,独占是说假话——标出来才两样都不是。
    expect(shared?.shared).toBe(true)
    expect(own?.shared).toBeUndefined()
    const theirs = frame.goals.find(entry => entry.goalRef === OTHER)
    expect(theirs?.artifacts.find(a => a.title === '说不清归谁的产出')?.shared).toBe(true)
  })

  /**
   * 「共用」判的是**这条边说不说得清出处**，不是「这个话题恰好挂了几个目标」。
   *
   * 旧规则里，一个此刻只服务一个目标的会话，产出会被当成精确归属——而那只是**碰巧
   * 为真**：明天在同一个会话里给第二个目标登记一条，昨天那份产出就无声地变成了两个
   * 目标共有的，而板上不会有任何变化提示。判据换成边自己带不带 `taskId`，同一份数据
   * 的结论就不再随别处的登记而漂移。
   */
  it('说不出是哪件活留下的，就算这个话题只服务一个目标也是共用', async () => {
    await goal(GOAL)
    await child({ id: 'c1', what: '只服务 A', topicKey: 'tk-1', parentGoalRef: GOAL })
    await produced('tk-1', 'https://s/1', '不知出处', undefined)
    await produced('tk-1', 'https://s/2', '知道出处', 'tsk-a')
    const mine = boardFrame(ctx).goals.find(entry => entry.goalRef === GOAL)
    expect(mine?.artifacts.find(a => a.title === '不知出处')?.shared).toBe(true)
    expect(mine?.artifacts.find(a => a.title === '知道出处')?.shared).toBeUndefined()
  })
})

describe('最新的那份简报（对抗审查 #3）', () => {
  it('ranks reports by when they were written, not when they were answered', async () => {
    await goal()
    const report = async (id: string, summary: string): Promise<void> => {
      await graph.append({
        type: 'assessment/reported',
        data: {
          assessmentId: id,
          goalRef: GOAL,
          summary,
          lines: [{ criterion: 'x', verdict: 'missing', evidence: 'y' }],
          sourceAnchor: `session:${id}`,
        },
        actor: OPERATOR,
      })
    }
    await report('asm-jan', '一月：全缺')
    await report('asm-mar', '三月：已达成')
    expect(boardFrame(ctx).goals[0]?.assessment?.summary).toBe('三月：已达成')

    // 翻回去在一月那张卡上按「继续」——那只是回答了一份旧材料。
    await graph.append({
      type: 'assessment/closed',
      data: { assessmentId: 'asm-jan', status: 'continued' },
      actor: OPERATOR,
    })
    /*
      按 updatedAt 排序会让一月复活：板上换成一月的结论,而每条早就补完的缺口
      都重新长出一个「变委派 ↗」,把人送去派一件二月就做完的活。
    */
    expect(boardFrame(ctx).goals[0]?.assessment?.summary).toBe('三月：已达成')
  })
})

/**
 * 今天的会 —— 事件枢纽在板上的那一段 (§5.6).
 *
 * 三条要锁的，都是「它可能变成第二个日历」的样子：
 *
 * - **只读今天、且只读还没开完的**：昨天的会没有会前可言；范围一放大，这一段就长成
 *   一个日程列表，而云之家里已经有一个够用的了；
 * - **就绪度是推的**：没有任何人维护它，承诺一变它就变；
 * - **图上没见过的会，说的是「还没挂过东西」**，不是「没准备好」——两者差着一个
 *   「我们根本还没参与」。
 */
describe('板上的今天', () => {
  const dayStart = new Date()
  dayStart.setHours(9, 0, 0, 0)
  const NOW = dayStart.getTime()

  const calendar = (rows: unknown[]): void => {
    ctx.provide('yzjBridge', {
      run: (command: string[]) => Promise.resolve(
        command[1] === 'event' && command[2] === 'list'
          ? { ok: true, json: rows }
          : { ok: true, json: {} },
      ),
    })
  }

  it('开完的会不进——会前那一眼对它没有意义', async () => {
    calendar([
      { id: 'ev-past', title: '早上开完的', startDate: NOW - 7200_000, endDate: NOW - 3600_000 },
      { id: 'ev-next', title: '下午那场', startDate: NOW + 3600_000, endDate: NOW + 7200_000 },
    ])
    const events = await eventsToday(ctx, NOW)
    expect(events.map(event => event.eventId)).toEqual(['ev-next'])
  })

  it('图上没见过的会，说的是「还没挂过东西」', async () => {
    calendar([{ id: 'ev-new', title: '新会', startDate: NOW + 3600_000, endDate: NOW + 7200_000 }])
    const [event] = await eventsToday(ctx, NOW)
    expect(event?.known).toBe(false)
    expect(event?.readinessLine).toContain('还没挂')
    expect(event?.prepares).toEqual([])
  })

  it('挂上活之后，就绪度跟着承诺走——没有人维护它', async () => {
    graph.defineFamily(eventFamily)
    await graph.append({
      type: 'event/observed', data: { eventId: 'ev-1', title: '对齐会' }, actor: OPERATOR,
    })
    await child({ id: 'c1', what: '拉数据', topicKey: 'tk-ev' })
    await graph.append({
      type: 'event/linked', data: { eventId: 'ev-1', commitmentId: 'c1' }, actor: OPERATOR,
    })
    calendar([{ id: 'ev-1', title: '对齐会', startDate: NOW + 3600_000, endDate: NOW + 7200_000 }])
    expect((await eventsToday(ctx, NOW))[0]?.readiness).toBe('none')
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'done' }, actor: OPERATOR,
    })
    // 一个 event/* 事件都没有再追加，就绪度已经变了。
    expect((await eventsToday(ctx, NOW))[0]?.readiness).toBe('ready')
  })

  it('通道不在就是空段，不把整块板拖住', async () => {
    expect(await eventsToday(ctx, NOW)).toEqual([])
  })
})

/**
 * 一场会不是一个目标 —— 传送门带的东西要分清 (自审).
 *
 * 「为此会准备」和「委派」共用同一个传送门组件，可它们落地之后的后果完全不同：目标
 * 要**装载语境**（那个话题里登记的承诺从此继承它），一场会**什么都不装载**。不分开的
 * 后果不是标签写错了——是会的 id 会被当成 goalRef 写进 `goal-context`，然后那个话题里
 * 每一条新承诺都挂上一个根本不是目标的 URI，而没有任何地方会报错。
 */
describe('传送门带的是什么', () => {
  it('errand 说得出自己带的是目标还是会', () => {
    sendErrand({ subject: 'event', goalRef: 'yzj://event/e1', goalName: '对齐会', voice: 'place' })
    const carried = takeErrand()
    expect(carried?.subject).toBe('event')
    // 取走即消费——跳进来一次就没了，不会留给下一个会话。
    expect(takeErrand()).toBeUndefined()
  })

  it('目标那一路照旧', () => {
    sendErrand({ subject: 'goal', goalRef: GOAL, goalName: 'Q3 对账', voice: 'place' })
    expect(takeErrand()?.subject).toBe('goal')
  })
})


/**
 * 催办的拟稿 (v4.21 第一档①「催办统一」).
 *
 * 这颗按钮此前是**一键借身**：点一下，系统以操作者的名义把承诺卡重新投进那个群。省下
 * 的是打字，付出的是「谁在说话」不再由说话的人决定——群里看到的是你在催，而你只点了
 * 一颗按钮，甚至没看见催出去的是什么。换成拟稿之后，这段文字是**要被人看着发出去的**，
 * 所以它得经得起看。
 */
describe('催办拟稿', () => {
  it('带上当初那句原话 —— 催的是一条承诺，不是一个 id', () => {
    const text = nudgeDraft({ what: '拉三家竞品各一页', due: { text: '本周内' }, overdue: false })
    expect(text).toContain('拉三家竞品各一页')
    // 「那件事怎么样了」要对方回头翻记录才知道问的是哪一件——那份翻找正是催办要消掉的。
    expect(text).not.toBe('问一下这条现在到哪一步了')
  })

  it('期限用当初说的那句话，不改写成日期', () => {
    /*
      时间透镜两层规则：话语原文是真身，时间戳只是解析投影。把人说过的「下周初」改写成
      一个具体日期再发给他，是拿我们的解析冒充他的承诺。
    */
    const text = nudgeDraft({ what: '出结论', due: { text: '下周初' }, overdue: false })
    expect(text).toContain('下周初')
  })

  it('逾期了就说过了，没期限就不提期限', () => {
    expect(nudgeDraft({ what: 'X', due: { text: '周五' }, overdue: true })).toContain('已经过了')
    const none = nudgeDraft({ what: 'X', overdue: false })
    expect(none).not.toContain('当时说的是')
    expect(none).not.toContain('undefined')
  })

  it('不替人定调 —— 语气是发话人自己的事', () => {
    /*
      「请尽快」「麻烦了」是社交决策。拟稿只把事实摆上，剩下的留给他改——
      这正是主权性摩擦该保留的那一部分。
    */
    const text = nudgeDraft({ what: 'X', due: { text: '周五' }, overdue: true })
    for (const tone of ['请尽快', '麻烦', '辛苦', '催']) expect(text).not.toContain(tone)
  })
})


/**
 * 组内信号序 (v4.21)：**异常浮起，正常安静**。
 *
 * 板是账本的对账面，合法增量只有「对账排列 + 一跳指路 + 就近动词」——「3 分钟知道
 * 哪里不对劲」这件事**由排列满足，不由聚合满足**（聚合归收件箱，板不设决断条）。
 * 所以这个比较器不是排版偏好，它就是板的主要功能本身。
 */
describe('信号序', () => {
  const NOW = 1_700_000_000_000
  const row = (over: Partial<Record<string, unknown>>): never => ({
    id: 'x', what: 'x', executorKind: 'human', who: '张锐', overdue: false,
    status: 'open', remindable: false, signal: 'evidence', lastSignalAt: NOW,
    inferredGoal: false, ...over,
  }) as never

  const order = (rows: unknown[]): string[] =>
    [...rows as never[]].sort(bySignal(NOW)).map(r => (r as { id: string }).id)

  it('逾期 > 无信号 > 过时 > 今日到期 > 在跑 > 终态', () => {
    expect(order([
      row({ id: 'done', status: 'closed' }),
      row({ id: 'running' }),
      row({ id: 'today', due: { text: '今天', ts: NOW + 3_600_000 } }),
      row({ id: 'stale', signal: 'stale' }),
      row({ id: 'silent', signal: 'silent' }),
      row({ id: 'late', overdue: true }),
    ])).toEqual(['late', 'silent', 'stale', 'today', 'running', 'done'])
  })

  it('无戳的行沉底，但不消失', () => {
    /*
      看不出时间不等于这件事不存在。它落到普通「在跑」档——排在今日到期之后，
      但排在终态之前，而且**一定还在列表里**。
    */
    const ids = order([
      row({ id: 'done', status: 'closed' }),
      row({ id: 'vague', due: { text: '下周初' } }),
      row({ id: 'today', due: { text: '今天', ts: NOW + 3_600_000 } }),
    ])
    expect(ids).toEqual(['today', 'vague', 'done'])
    expect(ids).toContain('vague')
  })

  it('同档之内，账龄越老越靠前', () => {
    // 账龄折进排序权重，不做独立结构。
    expect(order([
      row({ id: 'fresh', signal: 'silent', lastSignalAt: NOW - 1_000 }),
      row({ id: 'old', signal: 'silent', lastSignalAt: NOW - 9_000_000 }),
    ])).toEqual(['old', 'fresh'])
  })

  it('终态一律沉底 —— 板浮起的是正在滑掉的东西，不是一份完整档案', () => {
    expect(order([
      row({ id: 'settled-late', status: 'closed', overdue: true, signal: 'silent' }),
      row({ id: 'open-fine' }),
    ])).toEqual(['open-fine', 'settled-late'])
  })
})

describe('账龄的人话', () => {
  const NOW = 1_700_000_000_000
  it('刻意只到天/小时 —— 精确的数字会让人以为它精确', () => {
    expect(sinceText(NOW - 30 * 60_000, NOW)).toBe('刚刚')
    expect(sinceText(NOW - 5 * 3_600_000, NOW)).toBe('5 小时')
    expect(sinceText(NOW - 3 * 24 * 3_600_000, NOW)).toBe('3 天')
  })
})
