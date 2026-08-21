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
import {
  assessmentCard, assessmentFamily, commitmentCard, commitmentFamily, goalCommitmentIdFor,
} from '@yzj-next/objects'
import { boardFrame, inboxView } from '../src/rpc.ts'

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
