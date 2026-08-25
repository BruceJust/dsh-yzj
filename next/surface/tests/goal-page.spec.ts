/**
 * 目标页的规格 (v4.12 §7.6).
 *
 * 这一页最容易长歪的地方不是渲染，是**它开始存自己的状态**。所以锁住的都是
 * 「它必须仍然只是一个派生查询」这件事的各个侧面：
 *
 * - 和承诺板**同一个查询**——两级缩放一旦各查各的，迟早各说各话；
 * - **三值状态**是推导出来的，不是字段——「没消息」不等于「没问题」，而一条
 *   登记完就再没动静的人类承诺，和一条有回执有产物的，在「进行中」三个字底下
 *   长得一模一样；
 * - **空态三义**分家——在跑 / 停摆 / 空转，合并即谎言；
 * - **真身之变**要能显形——过期的结论比没有结论更危险，它看起来仍然成立；
 * - **作废不级联**——目标死了不等于底下每件事都该停，那是人的判断（摩擦保留）。
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
import { boardFrame, goalPageFrame } from '../src/rpc.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const GOAL = 'https://yzj.example.com/doc/q3'

const TOPICS = [
  { topicKey: 'tk-1', sessionId: 'sess-1', label: '统一模板', groupName: '财务组', placeKey: 'yzj-group-g1', groupId: 'g1' },
]

let ctx: Context
let graph: YzjGraph

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-goalpage-'))
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
  cards.register(createCommitmentCard(ctx))
  cards.register(assessmentCard)
  ctx.provide('yzjTopics', {
    tree: () => [{ place: { placeKey: 'yzj-group-g1', groupName: '财务组' }, topics: TOPICS }],
    topicOf: (sessionId: string) => TOPICS.find(topic => topic.sessionId === sessionId),
    aliases: () => ['@next'],
    conversations: () => [],
  })
})

async function goal(criteria?: string): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: goalCommitmentIdFor(GOAL),
      what: 'Q3 对账',
      goalRef: GOAL,
      executor: { kind: 'human', openId: 'op-1', name: '我' },
      sourceAnchor: 'desktop:board',
      idemKey: `goal:${GOAL}`,
      ...(criteria === undefined ? {} : { criteria }),
    },
    actor: OPERATOR,
  })
}

async function child(id: string, what: string, opts: { agent?: boolean } = {}): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id,
      what,
      executor: opts.agent === true
        ? { kind: 'agent', topicKey: 'tk-1' }
        : { kind: 'human', openId: 'u-li', name: '李婷' },
      sourceAnchor: `yzj:${id}`,
      topicKey: 'tk-1',
      parentGoalRef: GOAL,
    },
    actor: OPERATOR,
  })
}

/** 任何一次「后来又发生了什么」——回执是最常见的那一种。 */
async function stir(id: string, receipt = '在做了'): Promise<void> {
  await graph.append({
    type: 'commitment/updated',
    data: { commitmentId: id, lastReceipt: receipt },
    actor: OPERATOR,
  })
}

describe('第二缩放级别，不是第二个数据源', () => {
  it('读的是承诺板算出来的那一份', async () => {
    await goal()
    await child('c1', '统一模板')
    const board = boardFrame(ctx).goals.find(entry => entry.goalRef === GOAL)
    const page = goalPageFrame(ctx, GOAL)
    expect(page?.goal.children.map(row => row.id)).toEqual(board?.children.map(row => row.id))
    expect(page?.goal.counts).toEqual(board?.counts)
  })

  it('板上没有的目标，页面也不假装有', () => {
    expect(goalPageFrame(ctx, 'https://yzj.example.com/doc/nope')).toBeUndefined()
  })
})

describe('三值状态：没消息不等于没问题', () => {
  it('登记完再没动静 = 无信号，并说出它从什么时候起没信号', async () => {
    await goal()
    await child('c1', '统一模板')
    const [row] = goalPageFrame(ctx, GOAL)?.goal.children ?? []
    expect(row?.signal).toBe('silent')
    expect(row?.lastSignalAt).toBeGreaterThan(0)
  })

  it('有过后续就是有证据——观察型承诺才不会被画成确定性', async () => {
    await goal()
    await child('c1', '统一模板')
    await stir('c1')
    expect(goalPageFrame(ctx, GOAL)?.goal.children[0]?.signal).toBe('evidence')
  })
})

describe('空态三义分家：合并即谎言', () => {
  it('一条子承诺都没有 = 空转（不是「暂无进展」）', async () => {
    await goal()
    expect(goalPageFrame(ctx, GOAL)?.pulse).toBe('idle')
  })

  it('有事挂着但没有一条动过 = 停摆', async () => {
    await goal()
    await child('c1', '统一模板')
    await child('c2', '对账脚本')
    expect(goalPageFrame(ctx, GOAL)?.pulse).toBe('stalled')
  })

  it('有一条在动就是在跑', async () => {
    await goal()
    await child('c1', '统一模板')
    await child('c2', '对账脚本')
    await stir('c2')
    expect(goalPageFrame(ctx, GOAL)?.pulse).toBe('running')
  })

  it('停滞天数从图上最后一次动静读出来，不是谁去打的卡', async () => {
    await goal()
    await child('c1', '统一模板')
    const page = goalPageFrame(ctx, GOAL)
    expect(page?.staleDays).toBe(0)
    expect(page?.goal.lastActivityAt).toBeGreaterThan(0)
  })
})

describe('真身之变：过期的结论看起来仍然成立', () => {
  const report = async (basis?: string): Promise<void> => {
    await graph.append({
      type: 'assessment/reported',
      data: {
        assessmentId: `as-${basis ?? 'none'}`,
        goalRef: GOAL,
        summary: '两条达成，一条缺',
        sourceAnchor: 'desktop:eval',
        lines: [],
        ...(basis === undefined ? {} : { criteriaBasis: basis }),
      },
      actor: OPERATOR,
    })
  }

  it('标准改过而简报还是照着旧版写的——显形', async () => {
    await goal('三家竞品各一页')
    await report('两家竞品各一页')
    expect(goalPageFrame(ctx, GOAL)?.goal.criteriaDrifted).toBe(true)
  })

  it('标准没变就不喊——假警报的代价是下次真变了没人看', async () => {
    await goal('三家竞品各一页')
    await report('三家竞品各一页')
    expect(goalPageFrame(ctx, GOAL)?.goal.criteriaDrifted).toBeUndefined()
  })

  it('没记基准的老简报不参与比对——把「不知道」说成「变了」也是撒谎', async () => {
    await goal('三家竞品各一页')
    await report()
    expect(goalPageFrame(ctx, GOAL)?.goal.criteriaDrifted).toBeUndefined()
  })
})

describe('目标有死法，但不替人做级联', () => {
  const retire = async (): Promise<void> => {
    await graph.append({
      type: 'commitment/voided',
      data: { commitmentId: goalCommitmentIdFor(GOAL), cause: '不做了' },
      actor: OPERATOR,
    })
  }

  it('目标作废之后，底下的事显形但不自动作废', async () => {
    await goal()
    await child('c1', '统一模板')
    await retire()
    const page = goalPageFrame(ctx, GOAL)
    expect(page?.retired).toBe(true)
    // 显形:这条自己带着那句话——换个地方看它也带着。
    expect(page?.goal.children[0]?.parentRetired).toBe(true)
    // 但它还活着:停不停是人的判断,不是系统替他按的。
    expect(page?.goal.children[0]?.status).toBe('open')
  })

  it('已经结束的子承诺不再顶着「父目标已结束」——它已经没有下一步了', async () => {
    await goal()
    await child('c1', '统一模板')
    await graph.append({
      type: 'commitment/closed',
      data: { commitmentId: 'c1', cause: 'done' },
      actor: OPERATOR,
    })
    await retire()
    expect(goalPageFrame(ctx, GOAL)?.goal.children[0]?.parentRetired).toBeUndefined()
  })
})

describe('决断层是过滤投影，不是复制列表', () => {
  it('没有可应答的东西时就说没有，而不是把执行清单再列一遍', async () => {
    await goal()
    await child('c1', '统一模板', { agent: true })
    expect(goalPageFrame(ctx, GOAL)?.decisions).toEqual([])
  })

  /*
    一份没答的差距简报此前会从两处一起消失:收件箱不提它(那张表压根没读
    assessment),决断层是那张表的过滤投影,自然也不提。「agent 备料、验收权
    在你」的后半句,得先让人看得见才成立。
  */
  it('没答的差距简报要出现在决断层——它正等着人验收', async () => {
    await goal('三家竞品各一页')
    await child('c1', '统一模板')
    await graph.append({
      type: 'assessment/reported',
      data: {
        assessmentId: 'as-1',
        goalRef: GOAL,
        goalName: 'Q3 对账',
        summary: '两条达成，一条缺',
        sourceAnchor: 'desktop:eval',
        topicKey: 'tk-1',
        lines: [],
      },
      actor: OPERATOR,
    })
    const decisions = goalPageFrame(ctx, GOAL)?.decisions ?? []
    expect(decisions.some(item => item.preview.includes('差距简报'))).toBe(true)
    expect(decisions.some(item => item.tone === 'review')).toBe(true)
  })

  it('答过的简报不再占着决断层——它已经不等人了', async () => {
    await goal('三家竞品各一页')
    await child('c1', '统一模板')
    await graph.append({
      type: 'assessment/reported',
      data: {
        assessmentId: 'as-1', goalRef: GOAL, summary: '两条达成', sourceAnchor: 'desktop:eval',
        topicKey: 'tk-1', lines: [],
      },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'assessment/closed',
      data: { assessmentId: 'as-1', status: 'accepted' },
      actor: OPERATOR,
    })
    const decisions = goalPageFrame(ctx, GOAL)?.decisions ?? []
    expect(decisions.some(item => item.preview.includes('差距简报'))).toBe(false)
  })
})

/**
 * **查看者样本律** —— 样本律第三条 (v4.22 裁决④).
 *
 * 出生故事律的第一条对偶是空状态样本，第三条是**查看者**：凡按可见域/主权渲染的视图，
 * fixture 必含**四席位**并对每席跑渲染断言。理由写在走查结论里——「N 人 N 渲染」只造
 * 一个查看者的 demo 就是**采样偏差的视角版**（v4.22 走查实证：此前 demo 只造了 1.5 人）。
 *
 * 四席位：owner（签发它的人）／执行者（干活的人）／跨域执行者（干活但看不到正文的人）／
 * 旁观者（既不欠也不被欠，但看得见）。
 */
describe('四席位：一页 N 个查看者 N 种渲染', () => {
  const SEATS = {
    owner: 'op-1',
    executor: 'u-li',
    crossDomain: 'u-zhang',
    bystander: 'u-wang',
  } as const

  /** 一个目标，两条活：owner 委派给李婷、张锐各一条，王磊只是看得见。 */
  async function department(): Promise<void> {
    await goal()
    for (const [id, what, openId, name] of [
      ['c-li', '统一模板', 'u-li', '李婷'],
      ['c-zhang', '对账脚本', 'u-zhang', '张锐'],
    ] as const) {
      await graph.append({
        type: 'commitment/opened',
        data: {
          commitmentId: id,
          what,
          executor: { kind: 'human', openId, name },
          sourceAnchor: `yzj:${id}`,
          topicKey: 'tk-1',
          parentGoalRef: GOAL,
        },
        actor: OPERATOR,
      })
    }
  }

  const asSeat = (openId: string): void => {
    ctx.yzjCards.setDesktopActor({ kind: 'operator', openId })
  }

  it('owner 席：三条都在切片里 —— 我委派的也算我的', async () => {
    await department()
    asSeat(SEATS.owner)
    const view = goalPageFrame(ctx, GOAL)
    /*
      **这一条最容易实现错。** 把切片实现成「我执行的」一册，一个把整个目标拆下去、
      自己一件不做的 owner 打开页面会看见一个空切片——而那一屏上每一件事都是他的事。
    */
    expect(view?.mySlice.sort()).toEqual(['c-li', 'c-zhang'])
  })

  it('执行者席：只有自己那一条在切片里', async () => {
    await department()
    asSeat(SEATS.executor)
    expect(goalPageFrame(ctx, GOAL)?.mySlice).toEqual(['c-li'])
  })

  it('跨域执行者席：也只有自己那一条', async () => {
    await department()
    asSeat(SEATS.crossDomain)
    expect(goalPageFrame(ctx, GOAL)?.mySlice).toEqual(['c-zhang'])
  })

  /*
    **旁观者的切片是空的，而页面不是空的。**

    既不欠也不被欠是一种真实关系（板 = 可见域的并集，组织透明是特性不是缺陷）。切片空
    不该让这一页看起来像坏了——所以执行清单照旧有三行，只是没有哪一行需要顶到前面。
  */
  it('旁观者席：切片是空的，但执行清单一条不少', async () => {
    await department()
    asSeat(SEATS.bystander)
    const view = goalPageFrame(ctx, GOAL)
    expect(view?.mySlice).toEqual([])
    expect(view?.goal.children).toHaveLength(2)
  })

  /*
    切片是**排列**不是过滤：每一席看到的行数一样多，不一样的只是哪些被顶到前面。
    多一个筛子就是多一个要维护的视图，而这一页的合法增量里没有那一条。
  */
  it('四席看到的行数一样多 —— 切片只改顺序，不改事实', async () => {
    await department()
    const counts = Object.values(SEATS).map((openId) => {
      asSeat(openId)
      return goalPageFrame(ctx, GOAL)?.goal.children.length
    })
    expect(counts).toEqual([2, 2, 2, 2])
  })
})
