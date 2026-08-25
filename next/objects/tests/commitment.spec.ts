/**
 * Commitment specs. The rules under test are the ones that decide whether the
 * commitment board is worth looking at: what earns a record, what collapses
 * onto one object, what an observed reply does, and how a commitment dies when
 * nobody ever accepted it.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { createCommitmentCard } from '../src/commitment/card.ts'
import {
  commitmentFamily, commitmentIdFor, earnsCommitment, processFamily,
  type CommitmentState,
} from '../src/commitment/family.ts'
import { applyCommitmentTools } from '../src/commitment/tools.ts'
import type { TurnBinding } from '../src/turns.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }

const BINDING: TurnBinding = {
  viewer: { kind: 'place', placeKey: 'yzj-group-g1' },
  decider: 'op-1',
  accountKey: 'acct-1',
  accountOpenId: 'op-1',
  accountOrgId: 'org-1',
  topicKey: 'yzj-topic-1',
  placeKey: 'yzj-group-g1',
  audience: ['yzj-group-g1'],
  messageId: 'msg-1',
}

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<{ content: string; commitmentId?: string }>
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let tools: Map<string, CapturedTool>

const EXEC = { agent: { session: { id: 'session-1' } } }

function stateOf(id: string): CommitmentState | undefined {
  return graph.rawObject('commitment', id)?.state as unknown as CommitmentState | undefined
}

function commitments(): CommitmentState[] {
  return graph.query({ kind: 'operator', openId: 'op-1' }, { kind: 'commitment' })
    .map(object => object.state as unknown as CommitmentState)
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-commitment-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  graph.defineFamily(processFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  ctx.provide('yzjTurns', { bindingFor: () => BINDING, defaultBinding: () => BINDING })
  const captured: CapturedTool[] = []
  ctx.provide('tools', {
    register: (definition: CapturedTool) => { captured.push(definition); return () => undefined },
  })
  applyCommitmentTools(ctx)
  tools = new Map(captured.map(tool => [tool.name, tool]))
})

describe('evidence promotion', () => {
  it('books one utterance once, not once per executor', () => {
    // Caught live: "登记一下：返修数据分析由张锐负责" produced TWO commitments —
    // the human one the tool registered, and an agent one the turn promoted on
    // top of it. The source anchor is what makes them the same utterance, so
    // the orchestrator skips promotion when one already exists for it.
    const anchor = 'yzj:msg-1'
    const first = commitmentIdFor(anchor, '返修数据分析')
    const second = commitmentIdFor(anchor, '返修数据分析')
    expect(first).toBe(second)
  })

  it('mints a record for a write, a stated deadline, or explicit delegation — and nothing else', () => {
    // "Ask for one number" must not produce the whole family package: the
    // commitment pool IS the evidence base, and trivia destroys the signal.
    expect(earnsCommitment({ hadWriteAction: false, delegationLanguage: false })).toBe(false)
    expect(earnsCommitment({ hadWriteAction: true, delegationLanguage: false })).toBe(true)
    expect(earnsCommitment({ hadWriteAction: false, delegationLanguage: true })).toBe(true)
    expect(earnsCommitment({ hadWriteAction: false, delegationLanguage: false, explicitDue: '明天' }))
      .toBe(true)
  })
})

describe('commitment_register', () => {
  it('records a human executor with the audience of the utterance that registered it', async () => {
    const result = await tools.get('commitment_register')?.execute({
      what: '把漏水的事转给老贺', executorOpenId: 'p-9', executorName: '张锐', due: '明天下班前',
    }, EXEC)

    const state = stateOf(String(result?.commitmentId))
    expect(state).toMatchObject({
      status: 'open', what: '把漏水的事转给老贺', due: '明天下班前',
      executor: { kind: 'human', openId: 'p-9', name: '张锐' },
    })
    // The manager frame and the listener-set rule are the same rule.
    expect(graph.rawObject('commitment', String(result?.commitmentId))?.audience)
      .toEqual(['yzj-group-g1'])
  })

  /*
    **谁派的这条活，得写在这条活上。**

    家族的 reduce 会把出生事件的 actor 盖成 `delegatedBy`，而这条路径的 actor 是
    agent——登记是人说的、agent 记的。于是委派者一直是空的，后果是「欠我的」应收账簿
    永远空着：我让 agent 登记的每一条别人的活，方向轴都判成「我旁观的」。
  */
  it('把委派者记在承诺上：登记是人说的，agent 只是记', async () => {
    const result = await tools.get('commitment_register')?.execute({
      what: '核对一版竞品定价', executorOpenId: 'p-9', executorName: '张锐',
    }, EXEC)
    // `decider` = 这一回合里「谁有权答它开出来的卡」，在群里就是 @ 它的那个人。
    expect(stateOf(String(result?.commitmentId))?.delegatedBy).toBe('op-1')
  })

  it('collapses the same utterance registered twice onto one object', async () => {
    const first = await tools.get('commitment_register')?.execute({ what: '出周报' }, EXEC)
    const second = await tools.get('commitment_register')?.execute({ what: '出周报' }, EXEC)
    expect(second?.commitmentId).toBe(first?.commitmentId)
    expect(second?.content).toContain('未重复创建')
    expect(commitments()).toHaveLength(1)
  })

  it('does not collapse two different promises from the same message', async () => {
    await tools.get('commitment_register')?.execute({ what: '出周报' }, EXEC)
    await tools.get('commitment_register')?.execute({ what: '对一下发票' }, EXEC)
    expect(commitments()).toHaveLength(2)
  })

  it('marks an inferred parent goal for correction rather than asserting it', async () => {
    const inferred = await tools.get('commitment_register')?.execute({
      what: 'a', parentGoalRef: 'yzj://doc/goal-1', inferred: true,
    }, EXEC)
    expect(stateOf(String(inferred?.commitmentId))?.attachedVia).toBe('inferred')
    expect(inferred?.content).toContain('推断')
    expect(cards.renderText({ kind: 'commitment', id: String(inferred?.commitmentId) })?.body)
      .toContain('可回复「改挂')
  })

  it('leaves the parent out entirely when none was given', async () => {
    const result = await tools.get('commitment_register')?.execute({ what: 'a' }, EXEC)
    expect(stateOf(String(result?.commitmentId))?.parentGoalRef).toBeUndefined()
  })

  it('defaults to an agent executor bound to this topic when no person is named', async () => {
    const result = await tools.get('commitment_register')?.execute({ what: '我来查' }, EXEC)
    expect(stateOf(String(result?.commitmentId))?.executor)
      .toEqual({ kind: 'agent', topicKey: 'yzj-topic-1' })
  })
})

describe('commitment_receipt', () => {
  async function open(what = '发分析'): Promise<string> {
    const result = await tools.get('commitment_register')?.execute({ what, executorOpenId: 'p-9' }, EXEC)
    return String(result?.commitmentId)
  }

  it('applies a deadline change immediately and asks for it to be announced', async () => {
    const id = await open()
    const result = await tools.get('commitment_receipt')?.execute({
      commitmentId: id, text: '明天给', newDue: '明天',
    }, EXEC)

    expect(stateOf(id)).toMatchObject({ status: 'open', due: '明天', lastReceipt: '明天给' })
    expect(result?.content).toContain('公示')
    expect(graph.rawEvents(['receipt/recorded'])).toHaveLength(1)
  })

  /**
   * 话语门：**生效即出卡** (v4.21 第一档⑥)。
   *
   * 「立刻生效、不进 proposed 的等待区」这一条不变——话语门本属「默认生效可纠」类，
   * 没有第二道确认。变的是**生效成什么**：此前一句「分析发了」直接把承诺判成终态，
   * 而说这句话的人和要认这份交付的人是两个人。
   */
  it('回执说做完了 = 记下交付主张并等验收，不是直接判终态', async () => {
    const id = await open()
    await tools.get('commitment_receipt')?.execute({ commitmentId: id, text: '分析发了', completed: true }, EXEC)
    const state = stateOf(id) as { status?: string; delivery?: { claim?: string; anchor?: string } }
    expect(state.status).toBe('open')
    expect(state.delivery?.claim).toBe('分析发了')
    // 交付锚：纯话语回执锚回执本身——被验收的是这个**主张**。
    expect(state.delivery?.anchor).toBeDefined()
  })

  it('says so plainly when the commitment does not exist', async () => {
    const result = await tools.get('commitment_receipt')?.execute({
      commitmentId: 'cmt-nope', text: 'x',
    }, EXEC)
    expect(result?.content).toContain('找不到')
  })
})

describe('the card verbs', () => {
  /**
   * 执行者说「完成」= **主张交付**，不是终态 (v4.21 第一档⑥「验收断链接通」)。
   *
   * 「他说做完了」和「我认了这份交付」是两个人的两次判断，此前被压成同一件事：执行者
   * 按一下，系统直接判终态，而**委派的人从来没有被问过**。板上那条人执行的行因此是
   * 一条断头路——登记有呼吸（登记消息投进场所、对方能回执），交付却没有验收落座。
   */
  it('执行者说完成 = 主张交付，承诺仍然欠着，等验收', async () => {
    const id = commitmentIdFor('yzj:msg-1', '出周报')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: '出周报', sourceAnchor: 'yzj:msg-1',
        executor: { kind: 'human', openId: 'p-9' }, audience: ['yzj-group-g1'],
      },
      actor: OPERATOR,
    })
    const result = await cards.act(
      { kind: 'commitment', id }, 'done', { kind: 'person', openId: 'p-9' }, 'yzj-text',
    )
    expect(result.outcome).toBe('applied')
    /*
      **仍然是 open**：在有人验收之前，这件事确实还欠着——这句话一个字都不用改，
      所以也不必新增一个状态去审那 55 处判终态的代码。
    */
    expect(stateOf(id)?.status).toBe('open')
    expect((stateOf(id) as { delivery?: unknown }).delivery).toBeDefined()
  })

  it('交付被主张之后，卡换上双动词的脸；验收才是终态', async () => {
    const id = commitmentIdFor('yzj:msg-2', '核对数据')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: '核对数据', sourceAnchor: 'yzj:msg-2',
        executor: { kind: 'human', openId: 'p-9' }, audience: ['yzj-group-g1'],
      },
      actor: OPERATOR,
    })
    await cards.act({ kind: 'commitment', id }, 'done', { kind: 'person', openId: 'p-9' }, 'yzj-text')
    // 委派者（出生事件的 actor）验收 —— 这一格由 reduce 从内核记的 actor 盖上。
    expect((stateOf(id) as { delegatedBy?: string }).delegatedBy).toBe(OPERATOR.openId)
    const accepted = await cards.act(
      { kind: 'commitment', id }, 'accept', OPERATOR, 'yzj-text',
    )
    expect(accepted.outcome).toBe('applied')
    expect(stateOf(id)?.status).toBe('closed')
    expect(stateOf(id)?.cause).toBe('accepted')
  })

  /**
   * 打回 ≠ 作废。
   *
   * 作废是「这件事不做了」，打回是「这件事还没做好」——两者混成一个按钮，等于让一次
   * 质量判断顺手杀掉一条承诺。拒收 → 返工 → 再验收在**同一条**上循环，轮次可见。
   */
  it('打回让承诺回到在跟，交付主张撤回，轮次 +1', async () => {
    const id = commitmentIdFor('yzj:msg-3', '出方案')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: '出方案', sourceAnchor: 'yzj:msg-3',
        executor: { kind: 'human', openId: 'p-9' }, audience: ['yzj-group-g1'],
      },
      actor: OPERATOR,
    })
    await cards.act({ kind: 'commitment', id }, 'done', { kind: 'person', openId: 'p-9' }, 'yzj-text')
    const back = await cards.act(
      { kind: 'commitment', id }, 'reject', OPERATOR, 'yzj-text', '数据口径不对',
    )
    expect(back.outcome).toBe('applied')
    expect(stateOf(id)?.status).toBe('open')
    /*
      合并式 reduce 只会新增与覆盖、不会删除，所以「把交付主张变回不存在」要显式写。
      不写的话，被打回的活会一直挂着一份「等你验收」的假信号。
    */
    expect((stateOf(id) as { delivery?: unknown }).delivery).toBeUndefined()
    expect(stateOf(id)?.round).toBe(1)
  })

  /**
   * **轮次要活过一轮返工** —— 「拒收→返工→再验收同卡循环，轮次可见」。
   *
   * 打回会把交付主张变回不存在（否则被打回的活一直挂着假的待验收信号），于是下一次
   * 主张时那个轮次**必须从别处读回来**。读错地方的后果是安静的：第二版交付上不再写
   * 「已返工 1 轮」，验收的人看不出这是重交的——而「轮次在卡上可见」正是这个循环存在
   * 的意义。
   */
  it('打回之后再交付，轮次仍然写在卡上', async () => {
    const id = commitmentIdFor('yzj:msg-5', '改口径')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: '改口径', sourceAnchor: 'yzj:msg-5',
        executor: { kind: 'human', openId: 'p-9' }, audience: ['yzj-group-g1'],
      },
      actor: OPERATOR,
    })
    await cards.act({ kind: 'commitment', id }, 'done', { kind: 'person', openId: 'p-9' }, 'yzj-text')
    await cards.act({ kind: 'commitment', id }, 'reject', OPERATOR, 'yzj-text', '口径还是不对')
    await cards.act({ kind: 'commitment', id }, 'done', { kind: 'person', openId: 'p-9' }, 'yzj-text')

    expect((stateOf(id) as { delivery?: { round?: number } }).delivery?.round).toBe(1)
    expect(cards.renderText({ kind: 'commitment', id })?.body).toContain('已返工 1 轮')
  })

  /**
   * 自己欠自己的活，说一句「完成」就该结束。
   *
   * 主张的人就是要验收的那个人时，再请他按一次「验收」是同一个主权时刻收两次费——
   * 和提案裁决确认后不再弹第二张确认卡同一条道理。
   */
  it('主张的人就是验收的人时，主张即验收', async () => {
    const id = commitmentIdFor('yzj:msg-4', '自己的活')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: '自己的活', sourceAnchor: 'yzj:msg-4',
        executor: { kind: 'human', openId: OPERATOR.openId }, audience: ['yzj-group-g1'],
      },
      actor: OPERATOR,
    })
    await cards.act({ kind: 'commitment', id }, 'done', OPERATOR, 'yzj-text')
    expect(stateOf(id)?.status).toBe('closed')
  })

  it('voids a commitment nobody ever accepted, with the reason on the record', async () => {
    const id = commitmentIdFor('yzj:msg-1', '对宏迈的发票')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what: '对宏迈的发票', sourceAnchor: 'yzj:msg-1',
        executor: { kind: 'human', openId: 'p-9' },
      },
      actor: OPERATOR,
    })
    await cards.act({ kind: 'commitment', id }, 'void', OPERATOR, 'desktop', '对方不认这笔账')
    expect(stateOf(id)).toMatchObject({ status: 'voided', cause: '对方不认这笔账' })
    // Voided is terminal: the board must not keep showing it as outstanding.
    expect(cards.pending({ kind: 'operator', openId: 'op-1' })).toEqual([])
  })
})

/**
 * 出生时刻 · 语境继承 (v4.8).
 *
 * 挂接引用是语境的属性. Work started inside a topic that already serves a goal
 * serves that goal too, and most attachment should therefore cost zero
 * operations. Inheritance is NOT inference — it is a fact about where the work
 * was born — so it is marked as its own provenance and shown in the ack.
 */
describe('a new commitment inherits the goal its context already serves', () => {
  it('records the topic it was promised in, whoever ends up doing it', async () => {
    // The load-bearing fact. Without it `goalOfTopic` could only ever see
    // agent-executed rows — and the tool that feeds it writes human ones, so
    // inheritance was structurally unreachable in production.
    const result = await tools.get('commitment_register')?.execute({
      what: '张锐出结论', executorOpenId: 'p-9', executorName: '张锐',
    }, EXEC)
    const state = graph.rawObject('commitment', String(result?.commitmentId))?.state as
      { topicKey?: string } | undefined
    expect(state?.topicKey).toBe('yzj-topic-1')
  })

  const goalOf = (id: string): { ref?: string; via?: string } => {
    const state = graph.rawObject('commitment', id)?.state as
      { parentGoalRef?: string; attachedVia?: string } | undefined
    return { ref: state?.parentGoalRef, via: state?.attachedVia }
  }

  it('inherits when the topic already has exactly one goal in play', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'existing', what: '已有的活', sourceAnchor: 'a',
        parentGoalRef: 'yzj://doc/goal-q3', attachedVia: 'explicit',
        // The shape `commitment_register` ACTUALLY writes: a human executor,
        // with the topic recorded on the commitment itself. Seeding an
        // agent-executor row proved inheritance for a shape the tool under
        // test never produces.
        topicKey: 'yzj-topic-1',
        executor: { kind: 'human', openId: 'p-1', name: '别人' },
      },
      actor: { kind: 'agent' },
    })
    const result = await tools.get('commitment_register')?.execute({
      what: '新来的活', executorOpenId: 'p-9', executorName: '张锐',
    }, EXEC)
    expect(goalOf(String(result?.commitmentId))).toEqual({
      ref: 'yzj://doc/goal-q3', via: 'inherited',
    })
    // 继承亮在 ack 里，才可能被纠正。
    expect(result?.content).toContain('语境继承')
  })

  it('inherits nothing when the context is ambiguous — 宁空勿错', async () => {
    for (const [id, ref] of [['a', 'yzj://doc/goal-1'], ['b', 'yzj://doc/goal-2']]) {
      await graph.append({
        type: 'commitment/opened',
        data: {
          commitmentId: id as string, what: 'x', sourceAnchor: 'a',
          parentGoalRef: ref as string, attachedVia: 'explicit',
          topicKey: 'yzj-topic-1',
          executor: { kind: 'human', openId: 'p-1' },
        },
        actor: { kind: 'agent' },
      })
    }
    const result = await tools.get('commitment_register')?.execute({
      what: '两个目标之间', executorOpenId: 'p-9',
    }, EXEC)
    expect(goalOf(String(result?.commitmentId)).ref).toBeUndefined()
  })

  it('leaves work unattached when the context serves nothing — 未挂是合法状态', async () => {
    const result = await tools.get('commitment_register')?.execute({
      what: '把仓库钥匙给老贺', executorOpenId: 'p-9',
    }, EXEC)
    expect(goalOf(String(result?.commitmentId))).toEqual({ ref: undefined, via: undefined })
    // No note either: nothing was attached, so there is nothing to correct.
    expect(result?.content).not.toContain('语境继承')
  })

  it('lets an explicit reference beat the context', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'existing', what: 'x', sourceAnchor: 'a',
        parentGoalRef: 'yzj://doc/goal-context', attachedVia: 'explicit',
        topicKey: 'yzj-topic-1',
        executor: { kind: 'human', openId: 'p-1' },
      },
      actor: { kind: 'agent' },
    })
    const result = await tools.get('commitment_register')?.execute({
      what: '说了别的目标', executorOpenId: 'p-9', parentGoalRef: 'yzj://doc/goal-said',
    }, EXEC)
    expect(goalOf(String(result?.commitmentId))).toEqual({
      ref: 'yzj://doc/goal-said', via: 'explicit',
    })
  })
})

/**
 * 移出目标之后，卡片不能往群里发一句光秃秃的「承 」.
 *
 * The fold is a merge, so detaching writes an EMPTY string rather than
 * deleting the key — and this projection is what gets POSTED into a
 * colleague's group. `x === undefined` is the natural check every future
 * reader writes, which is exactly why the empty case has to be handled here
 * rather than trusted to callers.
 */
describe('a detached commitment renders no goal line', () => {
  it('drops the 承 line when the reference was cleared, not just when absent', () => {
    const card = createCommitmentCard(ctx)
    const base = {
      commitmentId: 'c1', status: 'open' as const, what: '返修数据分析',
      executor: { kind: 'human' as const, openId: 'p-9', name: '张锐' },
      sourceAnchor: 'yzj:m-1',
    }
    const detached = card.renderText({ ...base, parentGoalRef: '' })
    expect(detached.body).not.toContain('承 ')
    const absent = card.renderText(base)
    expect(absent.body).toBe(detached.body)
    /*
      投给操作者本人时照旧印出来——他看的是自己那一份分区。读不出名字就退回链接，
      那是三态里「标题可见 ∧ 正文不可读」的那一态。
    */
    const attached = card.renderText({ ...base, parentGoalRef: 'yzj://doc/g' })
    expect(attached.body).toContain('承 yzj://doc/g')
  })
})

/**
 * 修理动词族的**话语兜底** —— 提案归 agent，签发归人 (v3.15 裁决②).
 *
 * 这三个动词此前在 agent 手上根本不存在，而一个**只能在承诺板上按**的动词是一种违规
 * 能力（凡只能在一个面上获得的能力就是违规能力）。裁决把「没有的动词就说没有、指回
 * 按钮」定性为**诚实的过渡态，非终态**——正确形态是对象寻址 + agent 提案 + 确认卡。
 *
 * 确认那一段不必新造：它们是普通写工具，走守卫本来那道门（`WRITE_SPECS` 里锁着）。
 * 这里锁的是另外两件：**图上写对了**，以及**主权谓词在工具这一侧也拦得住**——只在
 * 界面上不画而工具照收，等于给模型开一条绕过主权的路，而这条路本来就是为模型开的。
 */
describe('作废/顺延/移交：话语兜底', () => {
  const open = async (id: string, actor = OPERATOR): Promise<void> => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id,
        what: '探针一条',
        executor: { kind: 'human', openId: 'u-li', name: '李婷' },
        sourceAnchor: `yzj:${id}`,
      },
      actor,
    })
  }
  const stateOf = (id: string): Record<string, unknown> =>
    (graph.rawObject('commitment', id)?.state ?? {}) as Record<string, unknown>

  it('作废写的是墓碑，不是一条回执', async () => {
    await open('c1')
    const result = await tools.get('commitment_void')?.execute(
      { commitmentId: 'c1', reason: '测试探针，清理' }, EXEC,
    ) as { content: string }
    expect(stateOf('c1').status).toBe('voided')
    expect(result.content).toContain('墓碑')
  })

  /*
    **期限用他说的那句话**，不是解析出来的日期：把人说过的话改写成时间戳，是拿我们的
    解析冒充他的承诺（时间透镜两层规则）。
  */
  it('顺延改的是当初说出口的那个日子，原话原样存', async () => {
    await open('c2')
    await tools.get('commitment_postpone')?.execute({ commitmentId: 'c2', due: '下周五' }, EXEC)
    expect(stateOf('c2').due).toBe('下周五')
    expect(stateOf('c2').status).toBe('open')
  })

  it('移交换人不换承诺——出生边与回执都还在这一条上', async () => {
    await open('c3')
    await tools.get('commitment_handoff')?.execute(
      { commitmentId: 'c3', openId: 'u-zhang', name: '张锐' }, EXEC,
    )
    expect((stateOf('c3').executor as { openId?: string }).openId).toBe('u-zhang')
    expect(stateOf('c3').sourceAnchor).toBe('yzj:c3')
  })

  /*
    **主权谓词在工具这一侧也拦得住。**

    渲染不画、端点会拒，可模型手上这条路是另开的一扇门——它要是照收，主权就只是一层
    皮肤。拒绝要说清归谁，并指出仍走得通的那条：不禁言。
  */
  it.each([
    ['作废', 'commitment_void', { commitmentId: 'c9' }],
    ['顺延', 'commitment_postpone', { commitmentId: 'c9', due: '下周五' }],
    ['移交', 'commitment_handoff', { commitmentId: 'c9', openId: 'u-x' }],
  ])('%s 别人登记的那条：agent 拒绝，图上一个字不写', async (_verb, tool, args) => {
    await open('c9', { kind: 'operator', openId: 'u-someone-else' })
    const result = await tools.get(tool)?.execute(args, EXEC) as { content: string }
    /*
      **不执行，也不静默** (v3.14r②)：静默忽略是这套设计里最大的罪，公开驳斥是社交
      羞辱，**指路 + 可选转达拟稿**是唯一正解。所以这句话里必须同时有「归谁」和
      「那条走得通的路」——而拟稿不是代发，那一下仍然是人按的。
    */
    expect(result.content).toContain('登记这条承诺的人')
    expect(result.content).toContain('直接问他')
    expect(result.content).toContain('你亲自发')
    expect(stateOf('c9').status).toBe('open')
    expect(stateOf('c9').due).toBeUndefined()
  })

  it('已经结束的那条，说清楚为什么不做，而不是照写一笔', async () => {
    await open('c4')
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c4', cause: 'done' }, actor: OPERATOR,
    })
    const result = await tools.get('commitment_postpone')?.execute(
      { commitmentId: 'c4', due: '下周五' }, EXEC,
    ) as { content: string }
    expect(result.content).toContain('已经完成')
    expect(stateOf('c4').due).toBeUndefined()
  })
})

/**
 * 谁能按这张卡上的哪一颗 —— **验收权借得到，隐私主权借不到**。
 *
 * 这一组是自审时补的，而它差点没被补上：委派者一落到实处（`delegatedBy` 现在真的有值
 * 了），`ownsCommitment` 那条「老数据放行」的分支就不再触发——于是**过去靠一个空字段
 * 撑着的每一条权限都要重新回答一遍**。回答错的方向有两个，这一组把它们分开钉住。
 */
describe('卡上的主权边界', () => {
  const card = (): { actions: readonly { id: string; allowedActors?: (actor: { openId?: string }, state: CommitmentState) => boolean }[] } =>
    createCommitmentCard(ctx) as never
  const may = (id: string, openId: string, state: Partial<CommitmentState>): boolean => {
    const action = card().actions.find(one => one.id === id)
    if (action?.allowedActors === undefined) throw new Error(`没有这颗按钮：${id}`)
    return action.allowedActors({ openId }, { executor: { kind: 'agent' }, ...state } as CommitmentState)
  }

  beforeEach(() => { cards.setDesktopActor({ kind: 'operator', openId: 'op-me' }) })

  it('委派者能验收', () => {
    expect(may('accept', 'op-a', { delegatedBy: 'op-a' })).toBe(true)
  })

  /*
    §5.2 的 ∪ 操作者。此前它从来没被真的实现过——空字段替它挡着。委派者一有值，一条
    同事委派的活，操作者就会在自己的桌面上按不动。
  */
  it('跑这台桌面的人也能验收', () => {
    expect(may('accept', 'op-me', { delegatedBy: 'op-a' })).toBe(true)
  })

  it('路人按不动', () => {
    expect(may('accept', 'op-x', { delegatedBy: 'op-a' })).toBe(false)
    expect(may('reject', 'op-x', { delegatedBy: 'op-a' })).toBe(false)
  })

  /*
    **另一个方向**：公示是 owner 的隐私主权，不是可借的权限。让操作者能替同事把一条
    私下登记的活写进全组可读的目标文档，是一次真泄漏——而它只差一次「顺手统一」。
  */
  it('公示/不公示只归 owner —— 操作者那一半在这里不适用', () => {
    const open = { delegatedBy: 'op-a', status: 'open' as const, parentGoalRef: 'https://y/doc/q3' }
    expect(may('publish', 'op-a', open)).toBe(true)
    expect(may('publish', 'op-me', open)).toBe(false)
    expect(may('unpublish', 'op-me', open)).toBe(false)
  })

  it('老数据没有委派者时仍然放行 —— 一条谁都动不了的承诺更坏', () => {
    expect(may('accept', 'op-x', {})).toBe(true)
  })
})

