/**
 * 可应答分类学、会话决断条、逐级兑付 —— v4.14/v4.15 的规格。
 *
 * 这个文件锁的每一条，都对应一种**安静地错**：
 *
 * - **枚举名册**：一族一段查询，漏一族不报错，只是那件事从此不出现。差距简报就
 *   这样在收件箱里缺席过。所以这里有一条用例注册了一个此前从未存在的家族，什么
 *   代码都不改，它必须自己出现在条上——那是「家族即接口」唯一能被证明的方式。
 * - **可纠升格成待答**：把一条逾期承诺塞进决断条，人就得为每个默认值签一次字，
 *   零维护当场阵亡。所以「什么**不**进条」和「什么进条」一样重要。
 * - **不可兑付的信号**：徽标说「有事等你」却不说在哪，就是 UI 自己开的幽灵承诺。
 *   每一层的每一个计数、每一个徽标，这里都要求它能指到下一级的一个具体去处。
 * - **上卷**：话题里的待答堆到群顶，群顶就变成第二个收件箱。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, z, type GraphFamily } from '@yzj-next/graph'
import { YzjCards, type CardDefinition } from '@yzj-next/cards'
import {
  approvalCard, approvalFamily, assessmentCard, assessmentFamily, commitmentCard,
  commitmentFamily, conflictCard, createProposalCard, proposalFamily, taskCard, taskFamily,
  waitingCard, waitingFamily,
} from '@yzj-next/objects'
import type { TopicDescriptor } from '@yzj-next/channel'
import { cardsFor, inboxView, placeView } from '../src/rpc.ts'
import { barOf, chipsOf } from '../src/client/DecisionBar.tsx'
import type { StreamCard } from '../src/client/rpc.ts'

const TOPIC: TopicDescriptor = {
  topicKey: 'yzj-topic-a', sessionId: 'session-a', placeKey: 'yzj-group-g1', groupId: 'g1',
  groupName: '财务组', topicRootId: 'root-a', label: '对账', generation: 1,
  conversationKind: 'group',
}
/** 同一个群里的另一件事 —— 「只收本语境直属」考的就是它。 */
const OTHER: TopicDescriptor = {
  ...TOPIC, topicKey: 'yzj-topic-b', sessionId: 'session-b', topicRootId: 'root-b', label: '发票',
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-decision-')) })
  for (const family of [
    approvalFamily, taskFamily, waitingFamily, commitmentFamily, proposalFamily, assessmentFamily,
  ]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(approvalCard)
  cards.register(taskCard)
  cards.register(waitingCard)
  cards.register(conflictCard)
  cards.register(commitmentCard)
  cards.register(assessmentCard)
  cards.register(createProposalCard(ctx))
  ctx.provide('yzjTopics', {
    topicOf: (id: string) => [TOPIC, OTHER].find(topic => topic.sessionId === id),
    tree: () => [{
      place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName },
      topics: [TOPIC, OTHER],
    }],
    messagesFor: async () => Promise.resolve([]),
    messagesInPlace: async () => Promise.resolve([]),
    sendToPlace: async () => Promise.resolve({}),
    conversations: () => [],
    markRead: () => undefined,
    aliases: () => ['@next'],
  })
})

// ---------------------------------------------------------------------------
// 各家族出场
// ---------------------------------------------------------------------------

const approval = async (id = 'ap-1', topicKey = TOPIC.topicKey): Promise<void> => {
  await graph.append({
    type: 'approval/opened',
    data: {
      approvalId: id, toolName: 'yzj_doc_create', reason: '新建价格页', level: 'standard',
      args: {}, argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 60_000,
      topicKey, placeKey: TOPIC.placeKey, audience: [TOPIC.placeKey],
    },
    actor: { kind: 'agent' },
  })
}

const delivered = async (id = 'tk-1', topicKey = TOPIC.topicKey): Promise<void> => {
  await graph.append({
    type: 'task/opened',
    data: {
      taskId: id, what: '把三家竞品拉一遍', topicKey, sourceAnchor: 'yzj:m-1',
      delegatedBy: 'p-9', operator: 'op-1', audience: [TOPIC.placeKey],
    },
    actor: { kind: 'agent' },
  })
  await graph.append({
    type: 'task/terminal',
    data: { taskId: id, summary: '三家都拉到了，写在这份文档里', artifacts: [] },
    actor: { kind: 'agent' },
  })
}

const interrupted = async (id = 'tk-x'): Promise<void> => {
  await graph.append({
    type: 'task/opened',
    data: { taskId: id, what: '解压那个 zip', topicKey: TOPIC.topicKey, sourceAnchor: 'yzj:m-2' },
    actor: { kind: 'agent' },
  })
  await graph.append({
    type: 'task/interrupted',
    data: { taskId: id, reason: '模型 502' },
    actor: { kind: 'system' },
  })
}

const report = async (id = 'as-1'): Promise<void> => {
  await graph.append({
    type: 'assessment/reported',
    data: {
      assessmentId: id, goalRef: 'https://y/doc/1', goalName: 'Q3 对账', summary: '两条达成一条缺',
      lines: [{ criterion: '三家竞品各一页', verdict: 'partial', evidence: '两份文档' }],
      sourceAnchor: 'desktop:a', topicKey: TOPIC.topicKey, decider: 'op-1',
    },
    actor: { kind: 'agent' },
  })
}

const breakdown = async (id = 'pr-1'): Promise<void> => {
  await graph.append({
    type: 'proposal/opened',
    data: {
      proposalId: id, kind: 'breakdown', title: '拆解：Q3 对账',
      items: [{ what: '拉数据' }, { what: '核差异' }],
      sourceAnchor: 'desktop:a', topicKey: TOPIC.topicKey, decider: 'op-1',
    },
    actor: { kind: 'agent' },
  })
}

const signGoal = async (id = 'pr-g'): Promise<void> => {
  await graph.append({
    type: 'proposal/opened',
    data: {
      proposalId: id, kind: 'goal', title: 'Q3 对账清零', items: [{ what: 'Q3 对账清零' }],
      sourceAnchor: 'desktop:a', topicKey: TOPIC.topicKey, decider: 'op-1',
    },
    actor: { kind: 'agent' },
  })
}

const conflict = async (id = 'cf-1'): Promise<void> => {
  await graph.append({
    type: 'conflict/flagged',
    data: {
      conflictId: id, topicKey: TOPIC.topicKey, inflightAnchor: 'a', incomingAnchor: 'b',
      note: '正在改的那一段刚被要求改回去',
    },
    actor: { kind: 'agent' },
  })
}

/** 一条在跑的承诺，和一件在等别人的事——两样都**不该**进决断面。 */
const noise = async (): Promise<void> => {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: 'cm-1', what: '张锐周五给数', sourceAnchor: 'yzj:m-3',
      topicKey: TOPIC.topicKey, executor: { kind: 'human', openId: 'p-9', name: '张锐' },
      due: '2020-01-01',
    },
    actor: { kind: 'agent' },
  })
  await graph.append({
    type: 'waiting/opened',
    data: {
      waitingId: 'wt-1', what: '等财务给口径', kind: 'third-party', topicKey: TOPIC.topicKey,
      openedAt: Date.now(), scope: 's',
    },
    actor: { kind: 'agent' },
  })
}

const bar = (): ReturnType<typeof chipsOf> => chipsOf(
  cardsFor(ctx, TOPIC) as unknown as StreamCard[],
)

// ---------------------------------------------------------------------------

describe('六交互模式：模式有限，场景实例开放', () => {
  it('每一族说得出自己是哪一种，而不是由视图按类型认', async () => {
    await approval()
    await delivered()
    await interrupted()
    await report()
    await breakdown()
    await signGoal()
    await conflict()
    const modes = new Map(
      cardsFor(ctx, TOPIC).map(card => [`${card.kind}:${card.id}`, card.demand?.mode]),
    )
    expect(modes.get('approval:ap-1')).toBe('single-confirm')
    expect(modes.get('task:tk-1')).toBe('two-verb-acceptance')
    expect(modes.get('task:tk-x')).toBe('open-question')
    expect(modes.get('assessment:as-1')).toBe('multi-exit-assessment')
    expect(modes.get('proposal:pr-1')).toBe('per-item-verdict')
    expect(modes.get('proposal:pr-g')).toBe('issuance')
    expect(modes.get('conflict:cf-1')).toBe('single-confirm')
  })

  /**
   * 立目标那一条和拆解那一条，人做的动作真的不同。
   *
   * 把「签一次字」和「过一遍清单」说成同一种模式，排序、徽标、条上的字面就都得
   * 靠视图另外判一次——名册于是又回来了。
   */
  it('同一张提案卡，签发与逐条裁决分得开', async () => {
    await breakdown()
    await signGoal()
    const byId = new Map(cardsFor(ctx, TOPIC).map(card => [card.id, card.demand]))
    // 字面只说是哪一件事；「签发」还是「裁决」由徽标说，而徽标是从模式推出来的。
    expect(byId.get('pr-g')?.label).toBe('Q3 对账清零')
    expect(byId.get('pr-1')?.label).toContain('2 条未裁')
    expect(chipsOf(cardsFor(ctx, TOPIC) as unknown as StreamCard[]).map(chip => chip.badge).sort())
      .toEqual(['待签发', '待裁决'])
  })

  it('冲突确认归在单答确认，但徽标仍旧自己说话', async () => {
    await conflict()
    const demand = cardsFor(ctx, TOPIC)[0]?.demand
    expect(demand?.mode).toBe('single-confirm')
    // 模式相同、等的东西不同：颜色可以一样，字不能一样。
    expect(demand?.badge).toBe('冲突待裁')
    expect(demand?.label).toBe('正在改的那一段刚被要求改回去')
  })

  it('每一个注册在案的卡都自己声明了 demand——兜底是安全网，不是主路', () => {
    for (const type of cards.types()) {
      expect(
        typeof (cards.definitionOf(type) as CardDefinition | undefined)?.demand,
        `${type} 没有声明自己在等什么`,
      ).toBe('function')
    }
  })
})

describe('全局三层定律：什么不进决断面', () => {
  it('逾期的承诺与等着别人的事都不进条——它们是信号，动词就近', async () => {
    await noise()
    expect(bar()).toEqual([])
  })

  it('但它们仍然出现在收件箱的留意层里，不是被藏起来', async () => {
    await noise()
    const row = inboxView(ctx).places[0]?.topics.find(item => item.sessionId === TOPIC.sessionId)
    // 「等待中」是它此刻最响的那件事；而它没有 demand，所以决断层收不到它。
    expect(row?.tone).toBe('waiting')
    expect(row?.demand).toBeUndefined()
  })

  it('一条已答的卡立刻从条上消失——答完即溶', async () => {
    await approval()
    expect(bar()).toHaveLength(1)
    await graph.append({
      type: 'approval/decided',
      data: { approvalId: 'ap-1', status: 'approved', decidedBy: 'op-1' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    expect(bar()).toEqual([])
  })
})

describe('家族即接口：增员零改动收编', () => {
  /**
   * 这一条是整个分类学存在的理由。
   *
   * 注册一个**这套代码从没见过**的家族（转办认领——设计里押在采纳门后的那一员），
   * 一行视图代码都不改，它必须自己出现在决断条上、出现在收件箱里、带着自己的徽标。
   * 做不到，说明那个「抽象查询」名不副实，而下一次增员就会重演差距简报缺席的那次。
   */
  it('一个此前不存在的家族，注册即出现在条上与收件箱里', async () => {
    const handoffFamily: GraphFamily = {
      kind: 'handoff',
      events: {
        'handoff/offered': {
          schema: z.object({
            handoffId: z.string().min(1),
            what: z.string().min(1),
            topicKey: z.string().min(1),
            status: z.literal('offered').default('offered'),
          }),
        },
      },
      pendingStatuses: ['offered'],
      objectIdOf: (_type, data) => (data as { handoffId?: string }).handoffId,
    }
    const handoffCard: CardDefinition<{ handoffId: string; what: string; status: string }> = {
      type: 'handoff',
      actions: [{
        id: 'claim', label: '我接', keywords: ['我接'],
        allowedActors: actor => actor.openId !== undefined,
      }],
      isResolved: state => state.status !== 'offered',
      demand: state => ({ layer: 'blocking', mode: 'open-question', label: `转办给你：${state.what}` }),
      renderText: state => ({ body: `转办：${state.what}`, replyHints: ['我接'] }),
      apply: () => ({ events: [] }),
    }
    graph.defineFamily(handoffFamily)
    cards.register(handoffCard)
    await graph.append({
      type: 'handoff/offered',
      data: { handoffId: 'hf-1', what: '去对宏迈的发票', topicKey: TOPIC.topicKey },
      actor: { kind: 'agent' },
    })

    expect(bar().map(chip => chip.label)).toEqual(['转办给你：去对宏迈的发票'])
    const row = inboxView(ctx).places[0]?.topics.find(item => item.sessionId === TOPIC.sessionId)
    expect(row?.badge).toBe('待答')
    expect(inboxView(ctx).counts.confirm).toBe(1)
  })

  /**
   * 忘了声明 `demand` 的家族也要被收编。
   *
   * 漏声明会发生；漏显示不可以——一个在等人答却哪儿都不出现的对象，正是幽灵承诺
   * 禁令要禁的那种东西。所以缺省是**进决断面**，字面退回它自己文本投影的第一行。
   */
  it('没声明 demand 的家族按「阻塞待答」收编，字面用它自己的第一行', async () => {
    const nudgeFamily: GraphFamily = {
      kind: 'nudge',
      events: {
        'nudge/raised': {
          schema: z.object({
            nudgeId: z.string().min(1),
            topicKey: z.string().min(1),
            status: z.literal('raised').default('raised'),
          }),
        },
      },
      pendingStatuses: ['raised'],
      objectIdOf: (_type, data) => (data as { nudgeId?: string }).nudgeId,
    }
    graph.defineFamily(nudgeFamily)
    cards.register({
      type: 'nudge',
      actions: [],
      isResolved: () => false,
      renderText: () => ({ body: '【催办】宏迈那笔还没回\n第二行不该出现在 chip 上', replyHints: [] }),
      apply: () => ({ events: [] }),
    })
    await graph.append({
      type: 'nudge/raised',
      data: { nudgeId: 'ng-1', topicKey: TOPIC.topicKey },
      actor: { kind: 'agent' },
    })
    const chips = bar()
    expect(chips).toHaveLength(1)
    expect(chips[0]?.label).toBe('【催办】宏迈那笔还没回')
    expect(chips[0]?.badge).toBe('待答')
  })
})

describe('会话决断条', () => {
  it('条与流内卡是同一份数据的两次渲染，不是两次查询', async () => {
    await approval()
    await delivered()
    await noise()
    const stream = cardsFor(ctx, TOPIC)
    const chips = bar()
    // 条上的每一枚，都能在流里找到它的真身——因为它们本来就是同一个数组。
    for (const chip of chips) {
      expect(stream.some(card => card.kind === chip.kind && card.id === chip.id)).toBe(true)
    }
    expect(chips).toHaveLength(2)
  })

  it('只收本语境直属——别的话题的待答绝不上卷到这一条', async () => {
    await approval('ap-here', TOPIC.topicKey)
    await approval('ap-there', OTHER.topicKey)
    expect(bar().map(chip => chip.id)).toEqual(['ap-here'])
    expect(chipsOf(cardsFor(ctx, OTHER) as unknown as StreamCard[]).map(chip => chip.id))
      .toEqual(['ap-there'])
  })

  it('等得久的排前面——折进 +N 的必须是最新的那几件', async () => {
    await approval('ap-1')
    await approval('ap-2')
    await approval('ap-3')
    await approval('ap-4')
    const shape = barOf(cardsFor(ctx, TOPIC) as unknown as StreamCard[], 900)
    expect(shape.chips.map(chip => chip.id)).toEqual(['ap-1', 'ap-2', 'ap-3', 'ap-4'])
    // 一行封顶：并排的是等得最久的那几件，最新的那件被折进 +N。
    expect(shape.shown.map(chip => chip.id)).toEqual(['ap-1', 'ap-2', 'ap-3'])
    expect(shape.folded).toBe(1)
  })

  it('放得下就不折——条不为了像个条而先折一个', async () => {
    await approval('ap-1')
    await approval('ap-2')
    const shape = barOf(cardsFor(ctx, TOPIC) as unknown as StreamCard[], 900)
    expect(shape.folded).toBe(0)
    expect(shape.tired).toBe(false)
  })

  /**
   * 「放得下的前几个」是字面意思，不是「固定三个」。
   *
   * 实测过固定三个的样子：右栏一开，中栏被压窄，三枚 chip 挤成「待验收 农佳捷…」
   * 「待验收 抱歉，」「待验收 代」——第三枚只剩一个字，占着位置什么也没说，而它挤掉的
   * 恰恰是能让前两枚说清楚的空间。窄的时候少画几个、多折进 +N，是条**更**像指针。
   */
  it('窄下来就少并排几个，多的折进 +N——而不是三枚都挤成两个字', async () => {
    for (const index of [1, 2, 3]) await approval(`ap-${String(index)}`)
    const cardRows = cardsFor(ctx, TOPIC) as unknown as StreamCard[]
    expect(barOf(cardRows, 900).shown).toHaveLength(3)
    expect(barOf(cardRows, 700).shown).toHaveLength(2)
    expect(barOf(cardRows, 480).shown).toHaveLength(1)
    // 折起来的数目跟着走：条上说的「还有几件」永远是真的。
    expect(barOf(cardRows, 480).folded).toBe(2)
  })

  /**
   * 条长即治理信号。
   *
   * 一段会话长期挂着五件以上待答，说的不是条太短，是**审批疲劳**。所以这里锁的是
   * 那个阈值真的会被越过，而租约入口就长在越过它的时候——疲劳发生在哪，发现入口
   * 就该在哪。
   */
  it('五件起，条尾该长出租约入口', async () => {
    for (const index of [1, 2, 3, 4]) await approval(`ap-${String(index)}`)
    expect(barOf(cardsFor(ctx, TOPIC) as unknown as StreamCard[], 900).tired).toBe(false)
    await approval('ap-5')
    const shape = barOf(cardsFor(ctx, TOPIC) as unknown as StreamCard[], 900)
    expect(shape.tired).toBe(true)
    // 条还是一行：疲劳的答案是预授权，不是把清单铺开。
    expect(shape.shown).toHaveLength(3)
    expect(shape.folded).toBe(2)
  })
})

describe('逐级兑付：没有不可兑付的信号', () => {
  it('收件箱每一个非零计数，都有一个能落脚的会话', async () => {
    await approval()
    await delivered('tk-1', OTHER.topicKey)
    const inbox = inboxView(ctx)
    for (const tone of ['confirm', 'review', 'running'] as const) {
      if (inbox.counts[tone] === 0) continue
      const landing = inbox.firstOf[tone]
      expect(landing, `${tone} 有计数却没有去处`).toBeDefined()
      // 落点必须是一个真的、此刻正显示着这件事的行。
      const row = inbox.places
        .flatMap(place => place.topics)
        .find(item => item.sessionId === landing)
      expect(row?.tone).toBe(tone)
    }
  })

  it('场所徽标说的就是它下面第一行说的那句', async () => {
    await conflict()
    await delivered('tk-1', OTHER.topicKey)
    const place = inboxView(ctx).places[0]
    expect(place?.badge).toBe(place?.topics[0]?.badge)
    // 冲突排在验收前面，所以场所头上写的是冲突那一句。
    expect(place?.badge).toBe('冲突待裁')
  })

  it('话题卡徽标说出等你的那件事，而不是一句「进行中」', async () => {
    await delivered()
    const view = await placeView(ctx, TOPIC.placeKey, 20)
    const card = view.topics.find(topic => topic.topicKey === TOPIC.topicKey)
    expect(card?.badge).toBe('待验收')
    expect(card?.owes).toContain('三家都拉到了')
    // 另一个话题什么都不欠，它不该被隔壁的待答染上颜色（不上卷的另一半）。
    expect(view.topics.find(topic => topic.topicKey === OTHER.topicKey)?.owes).toBeUndefined()
  })

  it('条上每一枚 chip 都指得到一个真的对象——DOM 落点的数据前提', async () => {
    await approval()
    await report()
    const stream = cardsFor(ctx, TOPIC)
    for (const chip of bar()) {
      const anchor = `${chip.kind}:${chip.id}`
      expect(stream.map(card => `${card.kind}:${card.id}`)).toContain(anchor)
    }
  })
})
