/**
 * 目标动线的规格 (v4.9 / v4.10).
 *
 * The rules under test are the ones whose breakage is SILENT — where a bug
 * produces plausible-looking rows instead of an error:
 *
 * - 确认即签发, and confirming ONE item mints one commitment, not the batch.
 * - 幽灵承诺禁令: a registration that could not be spoken is marked, never
 *   quietly kept.
 * - 语境继承 beats the single-goal heuristic, and disarming really disarms.
 * - 墓碑律: a voided commitment cannot be resurrected by a late acceptance.
 * - A report about a goal that does not exist must refuse, because appending
 *   would MINT one that no surface can remove.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YzjGraph, asRecord, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { createCommitmentCard } from '../src/commitment/card.ts'
import { commitmentFamily, processFamily, type CommitmentState } from '../src/commitment/family.ts'
import { applyCommitmentTools } from '../src/commitment/tools.ts'
import { assessmentCard } from '../src/goal/assessment-card.ts'
import { createProposalCard } from '../src/goal/proposal-card.ts'
import {
  assessmentFamily, goalCommitmentIdFor, goalContextFamily, itemsFrom, proposalFamily,
  type ProposalState,
} from '../src/goal/family.ts'
import { applyCommitmentNotify } from '../src/goal/notify.ts'
import { applyGoalTools } from '../src/goal/tools.ts'
import { goalEvidence } from '../src/goal/evidence.ts'
import { goalTitleAudience, goalTitleVisible } from '../src/goal/audience.ts'
import type { TurnBinding } from '../src/turns.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const VIEWER = { kind: 'operator' as const, openId: 'op-1' }
const GOAL = 'https://yzj.example.com/doc/q3-close'

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
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<{ content: string }>
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let tools: Map<string, CapturedTool>
let delivered: { kind: string; id: string; placeKey: string }[]
/**
 * How the card channel behaves this test.
 *
 * A mutable knob rather than a re-`provide`: cordis binds a service once per
 * context, so swapping the implementation mid-test throws — and the three
 * failure modes worth covering (landed / refused / threw) are properties of
 * one channel anyway.
 */
let channel: 'ok' | 'refuses' | 'throws'
/**
 * 这一回合是**谁问的**。
 *
 * 默认是群里有人 @ 起来的（`messageId` 在），因为绝大多数既有用例都在那条线上。
 * 桌面自发的回合把它去掉——两者的 binding 只差这一个字段，而提案投给谁全看它。
 */
let binding: TurnBinding
let proposalCard: ReturnType<typeof createProposalCard>

const EXEC = { agent: { session: { id: 'session-1' } } }

function commitment(id: string): CommitmentState | undefined {
  return graph.rawObject('commitment', id)?.state as unknown as CommitmentState | undefined
}

function proposal(id: string): ProposalState {
  return graph.rawObject('proposal', id)?.state as unknown as ProposalState
}

function commitments(): CommitmentState[] {
  return graph.query(VIEWER, { kind: 'commitment' })
    .map(object => object.state as unknown as CommitmentState)
}

/** Let the append-driven delivery listener run to completion. */
async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await new Promise(resolve => { setTimeout(resolve, 0) })
    await graph.flush()
  }
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-goal-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  for (const family of [
    commitmentFamily, processFamily, proposalFamily, assessmentFamily, goalContextFamily,
  ]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  proposalCard = createProposalCard(ctx)
  cards.register(proposalCard)
  cards.register(assessmentCard)
  cards.setDesktopActor(OPERATOR)
  binding = BINDING
  ctx.provide('yzjTurns', { bindingFor: () => binding, defaultBinding: () => binding })
  delivered = []
  channel = 'ok'
  /*
    The fake channel REGISTERS its projection, exactly as `YzjCardDelivery`
    does. Skipping that made the restart sweep untestable: "was this card ever
    actually said" is answered from the projection registry, and a channel that
    never projects looks identical to one that never delivered.
  */
  const answer = async (
    ref: { kind: string; id: string }, placeKey: string,
  ): Promise<unknown> => {
    delivered.push({ ...ref, placeKey })
    if (channel === 'throws') throw new Error('通道炸了')
    if (channel !== 'ok') return undefined
    const projection = {
      cardRef: ref, surface: 'yzj-text', msgAnchors: [`m-${String(delivered.length)}`], placeKey,
    }
    await cards.project(projection)
    return projection
  }
  ctx.provide('yzjCardChannel', {
    deliverToOperator: (ref: { kind: string; id: string }) => answer(ref, 'operator'),
    deliverToPlace: (ref: { kind: string; id: string }, placeKey: string) => answer(ref, placeKey),
    echo: () => Promise.resolve(),
  })
  const captured: CapturedTool[] = []
  ctx.provide('tools', {
    register: (definition: CapturedTool) => { captured.push(definition); return () => undefined },
  })
  applyCommitmentTools(ctx)
  applyGoalTools(ctx)
  applyCommitmentNotify(ctx)
  tools = new Map(captured.map(tool => [tool.name, tool]))
})

/** Declare a goal the way the board does, so the tests start from a real one. */
async function declareGoal(criteria?: string): Promise<string> {
  const commitmentId = goalCommitmentIdFor(GOAL)
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId,
      what: 'Q3 把对账周期压到 3 天内',
      goalRef: GOAL,
      executor: { kind: 'human', openId: 'op-1', name: '我' },
      sourceAnchor: 'desktop:board',
      idemKey: `goal:${GOAL}`,
      ...(criteria === undefined ? {} : { criteria }),
    },
    actor: OPERATOR,
  })
  return commitmentId
}

async function openBreakdown(): Promise<string> {
  await declareGoal()
  const result = await tools.get('goal_breakdown')?.execute({
    goalRef: GOAL,
    items: [
      { what: '把四个部门的模板统一', executorOpenId: 'u-li', executorName: '李婷', placeKey: 'yzj-group-g2', placeName: '财务组' },
      { what: '对账脚本跑通', executorOpenId: 'u-zhang', executorName: '张锐', due: '9/1' },
      { what: '写月结说明', executorOpenId: 'u-wang', executorName: '王磊' },
    ],
  }, EXEC) as { content: string; proposalId?: string }
  return result.proposalId as string
}

describe('拆解提案：确认即签发', () => {
  it('confirming one item mints exactly that one', async () => {
    const proposalId = await openBreakdown()
    const before = commitments().length
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '2')
    await settle()

    const minted = commitments().filter(state => state.parentGoalRef === GOAL)
    expect(minted).toHaveLength(1)
    expect(minted[0]?.what).toBe('对账脚本跑通')
    expect(minted[0]?.due).toBe('9/1')
    // 从目标语境委派：继承不是推断，出处要写在对象上。
    expect(minted[0]?.attachedVia).toBe('object-context')
    expect(commitments()).toHaveLength(before + 1)
    // The other two remain undecided — the card is still answerable.
    expect(proposal(proposalId).decisions).toEqual({ 1: 'confirmed' })
  })

  it('accumulates per-item decisions instead of replacing them', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()
    await cards.act({ kind: 'proposal', id: proposalId }, 'held', OPERATOR, 'desktop', '2')
    await cards.act({ kind: 'proposal', id: proposalId }, 'rejected', OPERATOR, 'desktop', '3')

    // A shallow merge would leave only the last one standing, and the card
    // would claim two items were never decided.
    expect(proposal(proposalId).decisions).toEqual({ 0: 'confirmed', 1: 'held', 2: 'rejected' })
    // 挂起 is "not now", so the card stays answerable rather than resolving.
    expect(proposalCard.isResolved(proposal(proposalId))).toBe(false)
  })

  it('holds nothing back once every item is confirmed or rejected', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'rejected', OPERATOR, 'desktop', '1,2,3')
    expect(proposalCard.isResolved(proposal(proposalId))).toBe(true)
  })
})

describe('幽灵承诺禁令', () => {
  it('announces the registration where the executor is, and records that it landed', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()

    const minted = commitments().find(state => state.what === '把四个部门的模板统一')
    expect(minted?.notified).toBe('sent')
    // 听众集合由这条消息确立——不是提案时就假定的。
    expect(minted?.audience).toEqual(['yzj-group-g2'])
    expect(delivered).toContainEqual({
      kind: 'commitment', id: minted?.commitmentId, placeKey: 'yzj-group-g2',
    })
  })

  it('marks a commitment 未通知 when the utterance could not be delivered', async () => {
    const proposalId = await openBreakdown()
    channel = 'refuses'
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()

    const minted = commitments().find(state => state.what === '把四个部门的模板统一')
    // 落库了但没呼吸，正是这条规则要防的失败模式：它必须响，不能静默。
    expect(minted?.notified).toBe('failed')
    // An audience nobody was spoken to would be a false claim about who knows.
    expect(minted?.audience).toBeUndefined()
  })

  it('falls back to the place the proposal was made in when no item place was given', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '2')
    await settle()
    const minted = commitments().find(state => state.what === '对账脚本跑通')
    expect(minted?.audience).toEqual(['yzj-group-g1'])
  })
})

describe('立目标提案：人签发', () => {
  it('refuses to mint without a body, and mints once the link is pasted', async () => {
    const result = await tools.get('goal_propose')?.execute({
      what: '把月结压到三天',
      successCriteria: 'T+3 出报表；差异条目 < 5',
    }, EXEC) as { content: string; proposalId?: string }
    const proposalId = result.proposalId as string

    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', undefined)
    // 目标行背后什么都没有，就是这个设计拒绝画出来的那份「我们没有的副本」。
    expect(commitments()).toHaveLength(0)
    expect(proposalCard.isResolved(proposal(proposalId))).toBe(false)

    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', GOAL)
    const goal = commitment(goalCommitmentIdFor(GOAL))
    expect(goal?.goalRef).toBe(GOAL)
    expect(goal?.criteria).toBe('T+3 出报表；差异条目 < 5')
    // A goal is owned by the person who pressed; nobody needs telling.
    expect(goal?.notified).toBeUndefined()
  })

  it('refuses a second proposal for a URI that already has a goal', async () => {
    await declareGoal()
    const result = await tools.get('goal_propose')?.execute({
      what: '再立一次',
      successCriteria: '随便',
      goalRef: GOAL,
    }, EXEC) as { content: string; proposalId?: string }
    expect(result.proposalId).toBeUndefined()
    expect(result.content).toContain('不要重立')
  })
})

describe('语境继承', () => {
  it('prefers what the conversation was armed with over what it happens to contain', async () => {
    await declareGoal()
    const other = 'https://yzj.example.com/doc/other'
    // 这个话题里已有的工作服务于另一个目标——启发式会读出它。
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'cmt-existing',
        what: '既有工作',
        executor: { kind: 'human', openId: 'u-x' },
        sourceAnchor: 'yzj:msg-0',
        topicKey: 'yzj-topic-1',
        parentGoalRef: other,
      },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'goal-context/armed',
      data: { topicKey: 'yzj-topic-1', goalRef: GOAL, goalName: 'Q3 对账' },
      actor: OPERATOR,
    })

    await tools.get('commitment_register')?.execute(
      { what: '新的一条', executorOpenId: 'u-y', executorName: '小 Y' }, EXEC,
    )
    const fresh = commitments().find(state => state.what === '新的一条')
    expect(fresh?.parentGoalRef).toBe(GOAL)
    expect(fresh?.attachedVia).toBe('inherited')
  })

  it('inherits nothing once the conversation is disarmed', async () => {
    await graph.append({
      type: 'goal-context/armed',
      data: { topicKey: 'yzj-topic-1', goalRef: GOAL },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'goal-context/cleared',
      data: { topicKey: 'yzj-topic-1' },
      actor: OPERATOR,
    })
    await tools.get('commitment_register')?.execute(
      { what: '卸载之后的一条', executorOpenId: 'u-y' }, EXEC,
    )
    // 未挂是合法状态：卸载不是错误，是一个正当的去向。
    expect(commitments().find(state => state.what === '卸载之后的一条')?.parentGoalRef)
      .toBeUndefined()
  })
})

describe('差距简报', () => {
  it('gathers criteria, child terminal states and artifacts in one reading', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()
    const child = commitments().find(state => state.what === '把四个部门的模板统一')
    await graph.append({
      type: 'lineage/produced',
      data: {
        topicKey: 'yzj-topic-1',
        artifact: {
          uri: 'https://yzj.example.com/sheet/1',
          title: '统一模板',
          kind: 'sheet',
          placeKey: 'yzj-group-g1',
        },
        action: '产出',
      },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'commitment/closed',
      data: { commitmentId: child?.commitmentId, cause: 'done' },
      actor: OPERATOR,
    })

    const evidence = goalEvidence(ctx, VIEWER, GOAL)
    expect(evidence.children).toHaveLength(1)
    expect(evidence.counts.settled).toBe(1)
    // 第二跳：目标自己不产工件,它下面的工作产。
    expect(evidence.artifacts.map(artifact => artifact.title)).toEqual(['统一模板'])
  })

  it('refuses to report on a goal that does not exist', async () => {
    const result = await tools.get('goal_report')?.execute({
      goalRef: 'https://yzj.example.com/doc/typo',
      summary: '看起来还行',
      lines: [{ criterion: 'x', verdict: 'met', evidence: 'y' }],
    }, EXEC) as { content: string }
    // append 会「创建」一个没人能删掉的幻影目标——所以必须先拦。
    expect(result.content).toContain('图上没有这个目标')
    expect(graph.query(VIEWER, { kind: 'assessment' })).toHaveLength(0)
  })

  it('acceptance closes the goal itself, and only a person can press it', async () => {
    const goalId = await declareGoal('T+3 出报表')
    await tools.get('goal_report')?.execute({
      goalRef: GOAL,
      summary: '两条达成，一条缺失',
      lines: [{ criterion: 'T+3 出报表', verdict: 'partial', evidence: 'cmt-1 已完成' }],
    }, EXEC)
    const [report] = graph.query(VIEWER, { kind: 'assessment' })
    expect(report).toBeDefined()

    const denied = await cards.act(
      { kind: 'assessment', id: report?.id ?? '' }, 'accept', { kind: 'agent' }, 'desktop',
    )
    expect(denied.outcome).toBe('unauthorized')
    expect(commitment(goalId)?.status).toBe('open')

    await cards.act({ kind: 'assessment', id: report?.id ?? '' }, 'accept', OPERATOR, 'desktop')
    expect(commitment(goalId)?.status).toBe('closed')
    expect(commitment(goalId)?.cause).toBe('accepted')
  })

  it('cannot resurrect a voided goal', async () => {
    const goalId = await declareGoal()
    await tools.get('goal_report')?.execute({
      goalRef: GOAL,
      summary: '来晚了',
      lines: [{ criterion: 'x', verdict: 'met', evidence: 'y' }],
    }, EXEC)
    const [report] = graph.query(VIEWER, { kind: 'assessment' })
    await graph.append({
      type: 'commitment/voided',
      data: { commitmentId: goalId, cause: '不做了' },
      actor: OPERATOR,
    })

    await cards.act({ kind: 'assessment', id: report?.id ?? '' }, 'accept', OPERATOR, 'desktop')
    // 墓碑律：作废是吸收态，一次迟到的验收不能把它翻回来。
    expect(commitment(goalId)?.status).toBe('voided')
  })
})

describe('编号解析', () => {
  const state = {
    proposalId: 'p', kind: 'breakdown', title: 't', status: 'open', sourceAnchor: 'a',
    items: [{ what: 'a' }, { what: 'b' }, { what: 'c' }],
    decisions: { 0: 'confirmed' },
  } as unknown as ProposalState

  it('reads the numbers a person would actually type', () => {
    expect(itemsFrom('2,3', state).indices).toEqual([1, 2])
    expect(itemsFrom('2 3', state).indices).toEqual([1, 2])
    expect(itemsFrom('2、3', state).indices).toEqual([1, 2])
    // 空 = 还没定的全部,而不是「全部」——已确认的那条不会被重新处理。
    expect(itemsFrom('', state).indices).toEqual([1, 2])
    expect(itemsFrom(undefined, state).indices).toEqual([1, 2])
  })

  it('reports what it could not read instead of guessing', () => {
    expect(itemsFrom('9', state).bad).toEqual(['9'])
    expect(itemsFrom('0', state).bad).toEqual(['0'])
    expect(itemsFrom('二', state).bad).toEqual(['二'])
  })
})

describe('提案的出口', () => {
  it('收起 retires a half-decided proposal instead of leaving a zombie', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'held', OPERATOR, 'desktop', '1,2,3')
    expect(proposalCard.isResolved(proposal(proposalId))).toBe(false)
    await cards.act({ kind: 'proposal', id: proposalId }, 'settle', OPERATOR, 'desktop')
    expect(proposalCard.isResolved(proposal(proposalId))).toBe(true)
    // 收起不会把任何条目变成谁的活。
    expect(commitments().filter(state => state.parentGoalRef === GOAL)).toHaveLength(0)
  })

  it('will not decompose a goal that has already ended', async () => {
    const goalId = await declareGoal()
    await graph.append({
      type: 'commitment/voided', data: { commitmentId: goalId, cause: '不做了' }, actor: OPERATOR,
    })
    const result = await tools.get('goal_breakdown')?.execute({
      goalRef: GOAL,
      items: [{ what: '还想往下派' }],
    }, EXEC) as { content: string }
    expect(result.content).toContain('已经结束')
  })
})

describe('提案投给问的那个人', () => {
  /*
    一个群话题的会话**同时**装着两种发问：群里 @ 的那一句，和操作者在同一个话题私语侧
    说的那一句（桌面上的 ⚡ 拆解就是后者）。两者的 binding 只差 `messageId`。

    落到群里的后果不是「多发了一条消息」：**确认之前那份清单不存在**——它既不是承诺，
    也不该是公开话语。让它出现在群里，等于替操作者当众提了个还没人裁决的议案，也正是
    幽灵承诺的预告片。
  */
  it('sends a group-triggered proposal back into the group', async () => {
    await openBreakdown()
    expect(delivered.filter(one => one.kind === 'proposal').map(one => one.placeKey))
      .toEqual(['yzj-group-g1'])
  })

  it('keeps a desk-triggered proposal in the operator\'s own chat', async () => {
    // 桌面自发：没有把这一回合叫起来的那条群消息。
    binding = { ...BINDING, messageId: undefined }
    await openBreakdown()
    expect(delivered.filter(one => one.kind === 'proposal').map(one => one.placeKey))
      .toEqual(['operator'])
  })

  /*
    卡本身两边都答得了——桌面的卡列表按 `topicKey` 取**对象**，跟文本投影投到哪儿
    无关。所以这一改只把投影从群里挪回私聊，desktop 上那张卡一动不动：挂起态仍然
    是图数据，DM 只是兜底的那一份。
  */
  it('still files the desk proposal under the topic, so the desk can answer it', async () => {
    binding = { ...BINDING, messageId: undefined }
    const proposalId = await openBreakdown()
    const object = graph.object(VIEWER, 'proposal', proposalId)
    expect(asRecord(object?.state)?.topicKey).toBe('yzj-topic-1')
  })
})

describe('代发不阻塞写入', () => {
  it('records the outcome even when the channel throws', async () => {
    const proposalId = await openBreakdown()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    channel = 'throws'
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()
    expect(commitments().find(state => state.what === '把四个部门的模板统一')?.notified)
      .toBe('failed')
    error.mockRestore()
  })
})

describe('重启补账', () => {
  it('finishes a registration whose stamp was lost to a crash', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()
    const minted = commitments().find(state => state.what === '把四个部门的模板统一')

    // 模拟崩在两次 append 之间：卡投出去了,但没来得及盖章。
    await graph.append({
      type: 'commitment/updated',
      data: { commitmentId: minted?.commitmentId, notified: undefined },
      actor: OPERATOR,
    })
    const before = delivered.length
    applyCommitmentNotify(ctx)
    await settle()

    // 有投影 = 说过了,补个章就行——绝不能再发一遍。
    expect(commitments().find(state => state.what === '把四个部门的模板统一')?.notified).toBe('sent')
    expect(delivered.length).toBe(before)
  })

  it('actually sends the one that never went out', async () => {
    await declareGoal()
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'cmt-orphan',
        what: '崩在了发出去之前',
        executor: { kind: 'human', openId: 'u-li', name: '李婷' },
        sourceAnchor: 'yzj:msg-9',
        parentGoalRef: GOAL,
        // 监听器此刻还没挂上,所以这条不会被现场处理——正是崩溃留下的形状。
        notifyPlaceKey: 'yzj-group-g2',
      },
      actor: OPERATOR,
    })
    applyCommitmentNotify(ctx)
    await settle()
    expect(commitment('cmt-orphan')?.notified).toBe('sent')
    expect(delivered).toContainEqual({ kind: 'commitment', id: 'cmt-orphan', placeKey: 'yzj-group-g2' })
  })
})

/**
 * 对抗审查查出来的那批，逐条锁住。
 *
 * 每一条都不是"读代码觉得不对"，而是跑出来的：确认两次真的会二次投递、
 * 一个链接真的会覆盖别人的目标、群里任何人真的能替操作者签发。
 */
describe('签发的边界', () => {
  it('confirming the same item twice does not mint or announce twice', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()
    const minted = commitments().find(state => state.what === '把四个部门的模板统一')
    await graph.append({
      type: 'commitment/closed',
      data: { commitmentId: minted?.commitmentId, cause: 'done' },
      actor: OPERATOR,
    })
    const before = delivered.length

    // 重叠选择正是人的答法：先「确认 1」，再「确认 1,2」。
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1,2')
    await settle()

    const again = commitment(minted?.commitmentId ?? '')
    // 二次 opened 会带着 status:'open' 把已完成的那条翻回来——不能发生。
    expect(again?.status).toBe('closed')
    // 也不能把登记消息再往群里发一遍。
    expect(delivered.filter(entry => entry.id === minted?.commitmentId)).toHaveLength(1)
    expect(delivered.length).toBe(before + 1) // 只多了第 2 条那次
    // 回执还在，说明这条确实是原来那一条，没被覆盖成一条新的。
    expect(again?.cause).toBe('done')
    // 第 2 条是新的，它该被铸出来。
    expect(commitments().find(state => state.what === '对账脚本跑通')).toBeDefined()
  })

  it('confirming a goal proposal onto an occupied URI leaves that goal alone', async () => {
    const goalId = await declareGoal('原来的标准')
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: goalId, cause: 'accepted' }, actor: OPERATOR,
    })
    const result = await tools.get('goal_propose')?.execute({
      what: '再来一次月结目标',
      successCriteria: '新的标准',
    }, EXEC) as { proposalId?: string }

    // 贴了一个已经有目标的链接（贴错文档是最常见的手滑）。
    await cards.act(
      { kind: 'proposal', id: result.proposalId as string }, 'confirmed', OPERATOR, 'desktop', GOAL,
    )
    const goal = commitment(goalId)
    expect(goal?.status).toBe('closed')
    expect(goal?.what).toBe('Q3 把对账周期压到 3 天内')
    expect(goal?.criteria).toBe('原来的标准')
  })

  it('only the person it was handed to can sign', async () => {
    const proposalId = await openBreakdown()
    const stranger = { kind: 'person' as const, openId: 'u-random' }
    const denied = await cards.act(
      { kind: 'proposal', id: proposalId }, 'confirmed', stranger, 'yzj-text', '1',
    )
    // 代发是以裁决人的名义发出去的——让路人按，等于让路人替操作者派活。
    expect(denied.outcome).toBe('unauthorized')
    expect(commitments().filter(state => state.parentGoalRef === GOAL)).toHaveLength(0)
  })

  it('does not read an ordinary sentence as a signature', async () => {
    const proposalId = await openBreakdown()
    const ref = { kind: 'proposal', id: proposalId }
    /*
      Keywords match by PREFIX (that is how 「确认 1,3」 carries its selection),
      so a loose synonym is a loaded gun. These three were measured resolving
      to `confirmed` before the list was narrowed to imperative verbs.
    */
    expect(cards.resolveKeyword(ref, '同意归同意，但先别登记')).toBeUndefined()
    expect(cards.resolveKeyword(ref, '就这样下去可不行')).toBeUndefined()
    expect(cards.resolveKeyword(ref, 'ok 我先看看再说')).toBeUndefined()
    // 真正的裁决仍然读得出来，连同它带的编号。
    expect(cards.resolveKeyword(ref, '确认 1,3')).toEqual({ actionId: 'confirmed', input: '1,3' })
    expect(cards.resolveKeyword(ref, '驳回 2')).toEqual({ actionId: 'rejected', input: '2' })
  })
})

describe('编号解析：人真的会这么打', () => {
  const state = {
    proposalId: 'p', kind: 'breakdown', title: 't', status: 'open', sourceAnchor: 'a',
    items: [{ what: 'a' }, { what: 'b' }, { what: 'c' }],
  } as unknown as ProposalState

  it('reads a range instead of silently dropping its tail', () => {
    // 「确认 1-2」原来读成 1，第 2 条被悄悄丢掉,回执却说「已记录」。
    expect(itemsFrom('1-2', state).indices).toEqual([0, 1])
    expect(itemsFrom('1到3', state).indices).toEqual([0, 1, 2])
  })

  it('reads a decorated number instead of deciding nothing', () => {
    expect(itemsFrom('第2条', state).indices).toEqual([1])
    expect(itemsFrom('第1条、第3条', state).indices).toEqual([0, 2])
  })

  it('still refuses what it genuinely cannot read', () => {
    expect(itemsFrom('二', state).indices).toEqual([])
    expect(itemsFrom('二', state).bad).toEqual(['二'])
    expect(itemsFrom('9', state).bad).toEqual(['9'])
  })
})

describe('可见域：读也要过滤', () => {
  it('does not hand a place-bound turn a goal declared privately', async () => {
    await declareGoal('9 月底前完成名单与沟通')
    const evidence = goalEvidence(ctx, { kind: 'place', placeKey: 'yzj-group-g1' }, GOAL)
    // 板上立的目标没有 audience,群里就不该读到它的名字与标准——
    // 但「这个 URI 上有个开着的目标」不是措辞,而且提问者手里本来就有这个 URI。
    expect(evidence.goalName).toBeUndefined()
    expect(evidence.criteria).toBeUndefined()
    expect(evidence.status).toBe('open')
  })
})

describe('没有可投递的会话时', () => {
  it('is born marked 未通知 rather than born silent', async () => {
    // 桌面语境：没有 placeKey,条目也没写场所——确认之后没人会被告知。
    ctx.provide('yzjTurnsDesk', undefined)
    const bare = { ...BINDING } as Record<string, unknown>
    delete bare.placeKey
    delete bare.audience
    const proposalId = 'prp-bare'
    await graph.append({
      type: 'proposal/opened',
      data: {
        proposalId,
        kind: 'breakdown',
        title: '拆解：无处可发',
        goalRef: GOAL,
        items: [{ what: '没人会知道的活', executorOpenId: 'u-li', executorName: '李婷' }],
        sourceAnchor: 'session:s1',
        decider: 'op-1',
      },
      actor: OPERATOR,
    })
    await declareGoal()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1')
    await settle()
    const minted = commitments().find(state => state.what === '没人会知道的活')
    expect(minted?.notified).toBe('failed')
    expect(minted?.notifyPlaceKey).toBeUndefined()
  })
})

describe('简报不会被下一次评估改写', () => {
  it('gives a second reading its own object', async () => {
    const goalId = await declareGoal('标准')
    await tools.get('goal_report')?.execute({
      goalRef: GOAL, summary: '第一次读', lines: [{ criterion: 'x', verdict: 'partial', evidence: 'y' }],
    }, EXEC)
    const [first] = graph.query(VIEWER, { kind: 'assessment' })
    await cards.act({ kind: 'assessment', id: first?.id ?? '' }, 'continue', OPERATOR, 'desktop')

    await tools.get('goal_report')?.execute({
      goalRef: GOAL, summary: '第二次读', lines: [{ criterion: 'x', verdict: 'met', evidence: 'z' }],
    }, EXEC)
    const all = graph.query(VIEWER, { kind: 'assessment' })
    expect(all).toHaveLength(2)
    // 第一份已经被答过了,它是历史,不该被重写成 open。
    expect(asStatus(first?.id ?? '')).toBe('continued')
    expect(commitment(goalId)?.status).toBe('open')
  })

  it('will not write a report for a goal that already ended', async () => {
    const goalId = await declareGoal()
    await graph.append({
      type: 'commitment/voided', data: { commitmentId: goalId, cause: '不做了' }, actor: OPERATOR,
    })
    const result = await tools.get('goal_report')?.execute({
      goalRef: GOAL, summary: '来晚了', lines: [{ criterion: 'x', verdict: 'met', evidence: 'y' }],
    }, EXEC) as { content: string }
    expect(result.content).toContain('已经结束')
    expect(graph.rawEvents(['assessment/reported'])).toHaveLength(0)
  })
})

describe('再问一次拆解', () => {
  it('gives a fresh proposal once the first one is settled', async () => {
    const first = await openBreakdown()
    await cards.act({ kind: 'proposal', id: first }, 'rejected', OPERATOR, 'desktop', '1,2,3')
    const again = await tools.get('goal_breakdown')?.execute({
      goalRef: GOAL,
      items: [{ what: '换个拆法' }],
    }, EXEC) as { content: string; proposalId?: string }
    // 桌面的锚是整个会话,原来这会把人挡在一张已经裁决完的卡上一整天。
    expect(again.proposalId).toBeDefined()
    expect(again.proposalId).not.toBe(first)
  })

  it('still refuses while the first one is waiting for answers', async () => {
    const first = await openBreakdown()
    const again = await tools.get('goal_breakdown')?.execute({
      goalRef: GOAL,
      items: [{ what: '换个拆法' }],
    }, EXEC) as { content: string; proposalId?: string }
    expect(again.proposalId).toBe(first)
    expect(again.content).toContain('已经递过了')
  })
})

function asStatus(id: string): string | undefined {
  const raw = graph.rawObject('assessment', id)?.state as { status?: string } | undefined
  return raw?.status
}

describe('挂接判定序（v4.9）', () => {
  it('lets a stated goal win over the context', async () => {
    await declareGoal()
    const other = 'https://yzj.example.com/doc/other'
    await graph.append({
      type: 'goal-context/armed',
      data: { topicKey: 'yzj-topic-1', goalRef: GOAL },
      actor: OPERATOR,
    })
    await tools.get('commitment_register')?.execute(
      { what: '明说挂到别处', executorOpenId: 'u-y', parentGoalRef: other }, EXEC,
    )
    const row = commitments().find(state => state.what === '明说挂到别处')
    expect(row?.parentGoalRef).toBe(other)
    expect(row?.attachedVia).toBe('explicit')
  })

  it('lets the context win over a guess', async () => {
    await declareGoal()
    await graph.append({
      type: 'goal-context/armed',
      data: { topicKey: 'yzj-topic-1', goalRef: GOAL },
      actor: OPERATOR,
    })
    const result = await tools.get('commitment_register')?.execute({
      what: '模型猜了个别的',
      executorOpenId: 'u-y',
      parentGoalRef: 'https://yzj.example.com/doc/guessed',
      inferred: true,
    }, EXEC) as { content: string }

    const row = commitments().find(state => state.what === '模型猜了个别的')
    /*
      判定序：显式 > 语境继承（确定性）> 保守推断.
      A guess used to outrank a fact somebody stated by teleporting in and
      speaking here — 错挂即汇报污染, and in the wrong direction.
    */
    expect(row?.parentGoalRef).toBe(GOAL)
    expect(row?.attachedVia).toBe('inherited')
    // ack 说的必须是实际发生的那件事。
    expect(result.content).toContain('语境继承')
    expect(result.content).not.toContain('推断')
  })

  it('still uses the guess when the context carries nothing', async () => {
    const guessed = 'https://yzj.example.com/doc/guessed'
    await tools.get('commitment_register')?.execute({
      what: '没语境时的推断',
      executorOpenId: 'u-y',
      parentGoalRef: guessed,
      inferred: true,
    }, EXEC)
    const row = commitments().find(state => state.what === '没语境时的推断')
    expect(row?.parentGoalRef).toBe(guessed)
    expect(row?.attachedVia).toBe('inferred')
  })
})

describe('签发的输入（对抗审查 #1）', () => {
  async function goalProposal(withRef?: string): Promise<string> {
    const result = await tools.get('goal_propose')?.execute({
      what: '把月结压到三天',
      successCriteria: 'T+3 出报表',
      ...(withRef === undefined ? {} : { goalRef: withRef }),
    }, EXEC) as { proposalId?: string }
    return result.proposalId as string
  }

  it('accepts a link pasted without its scheme', async () => {
    const proposalId = await goalProposal()
    await cards.act(
      { kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop',
      'www.yunzhijia.com/doc/no-scheme',
    )
    // 从云之家地址栏芯片复制出来就是没有 scheme 的——要求它等于把人推向失败。
    const minted = commitments().find(state => state.goalRef !== undefined)
    expect(minted?.goalRef).toBe('https://www.yunzhijia.com/doc/no-scheme')
  })

  it('refuses to fall back to the old link when the typed one is not a link', async () => {
    const old = 'https://yzj.example.com/doc/old'
    const proposalId = await goalProposal(old)
    await cards.act(
      { kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '我一会儿补链接',
    )
    /*
      悄悄退回旧链接是最危险的一支：人正在换文档，结果目标被立在旧的那份上,
      而回执说「已记录」。什么都不铸,卡还开着,才是诚实的结果。
    */
    expect(commitments()).toHaveLength(0)
    expect(proposalCard.isResolved(proposal(proposalId))).toBe(false)
  })

  it('still uses the link it was told when nothing is typed', async () => {
    const told = 'https://yzj.example.com/doc/told'
    const proposalId = await goalProposal(told)
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', undefined)
    expect(commitments().find(state => state.goalRef !== undefined)?.goalRef).toBe(told)
  })

  it('does not let a breakdown selection be read as a link', async () => {
    const proposalId = await openBreakdown()
    await cards.act({ kind: 'proposal', id: proposalId }, 'confirmed', OPERATOR, 'desktop', '1,3')
    await settle()
    /*
      拆解的 input 是编号。把它喂进链接解析器会读成一个坏 URL,于是每个子承诺
      都悄悄丢掉 parentGoalRef——挂接全断,而屏幕上一切正常。
    */
    const minted = commitments().filter(state => state.parentGoalRef === GOAL)
    expect(minted).toHaveLength(2)
    expect(minted.every(state => state.parentGoalRef === GOAL)).toBe(true)
  })
})

/**
 * 4h③ 当场建真身：把一件 agent 做得到的事，别再推给人。
 *
 * 「agent 建不了文档」是一次**能力误判**——`yzj_doc_create` 与
 * `yzj_doc_block_insert` 一直在工具面里。误判的代价不是少一个功能，是卡上那句话把
 * 人赶出了产品：「先去云之家建一份，再回来把链接贴上」。
 *
 * 人签发这一步一个字没变——变的只是**没有链接时给的是两条路，而不是一条作业**。
 */
describe('没有真身链接时，卡说什么', () => {
  it('给两条路：让它建，或你自己贴', async () => {
    const state = {
      proposalId: 'p1', kind: 'goal' as const, status: 'open' as const,
      title: 'Q3 对账清零', items: [{ what: 'Q3 对账清零' }], sourceAnchor: 'a',
    }
    const text = createProposalCard(ctx).renderText(state)
    expect(text.body).toContain('回一句「建一份」')
    expect(text.body).toContain('自己建完把链接')
    /*
      「建一份」不在 replyHints 里。

      那一列是**卡上的动词**，会被关键词解析成一个动作；而「建一份」是说给 agent
      听的一句话（它去建文档、写进成功标准、重新提案）。混进动词表，就成了一个点
      下去没有对应动作的承诺——正是「没有不可兑付的信号」要禁的那种。
    */
    expect(text.replyHints).not.toContain('建一份')
  })

  it('有链接时不啰嗦，只说「确认才算你签发」', async () => {
    const state = {
      proposalId: 'p1', kind: 'goal' as const, status: 'open' as const,
      title: 'Q3 对账清零', items: [{ what: 'Q3 对账清零' }], sourceAnchor: 'a',
      goalRef: 'https://y/doc/1',
    }
    const text = createProposalCard(ctx).renderText(state)
    expect(text.body).toContain('确认才算你签发')
    expect(text.body).not.toContain('建一份')
  })
})

/**
 * 目标可见域两层化 + **三态投影** —— 地基空洞的填补 (v4.22 裁决①).
 *
 * 「一个目标能被谁看见」在这套设计里**从来没有定义过**。承诺有听众集合、工件有 ACL，
 * 唯独目标——它不是图上的节点，也没有一条「谁能看见它」的边。于是每一处渲染 goalRef
 * 的地方都各自即兴，而承诺卡那一行把**原始 URI** 原样印进了每一间收到它的屋子。
 *
 * 裁决：**标题可见域 = 签发话语的听众 ∪ owner 后续提及话语的听众**（动态扩张、纯派生、
 * 零新边）。判定只做**第一级（结构化引用）**：话题装载与子承诺的 parentGoalRef。第二级
 * （自然语言提及）没做——LLM 误关联 = 凭空扩张 = 真泄漏，宁窄勿错。
 */
describe('标题可见域：动态扩张，只认结构化引用', () => {
  const OTHER_PLACE = 'yzj-group-g9'

  it('签发时没说给任何场所听，那就谁都看不见', async () => {
    await declareGoal()
    expect([...goalTitleAudience(ctx, GOAL)]).toEqual([])
  })

  /*
    **一次挂着它的登记，就是一次点名。** 那句话说给谁听，谁就知道这个目标存在了；
    系统再装作它不存在，是对着一份聊天记录说谎。
  */
  it('在一个群里登记了挂它的承诺 —— 那个群从此看得见标题', async () => {
    await declareGoal()
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-pub', what: '拉三家竞品', parentGoalRef: GOAL,
        executor: { kind: 'human', openId: 'u-1', name: '张锐' },
        sourceAnchor: 'yzj:m-2', audience: ['yzj-group-g1'],
      },
      actor: OPERATOR,
    })
    expect([...goalTitleAudience(ctx, GOAL)]).toEqual(['yzj-group-g1'])
    expect(goalTitleVisible(ctx, GOAL, { kind: 'place', placeKey: 'yzj-group-g1' })).toBe(true)
    expect(goalTitleVisible(ctx, GOAL, { kind: 'place', placeKey: OTHER_PLACE })).toBe(false)
  })

  it('装载话题也是一次结构化引用', async () => {
    await declareGoal()
    await graph.append({
      type: 'goal-context/armed',
      data: { topicKey: 'yzj-topic-9', goalRef: GOAL, audience: [OTHER_PLACE] },
      actor: OPERATOR,
    })
    expect(goalTitleVisible(ctx, GOAL, { kind: 'place', placeKey: OTHER_PLACE })).toBe(true)
  })

  // 操作者看的是自己那一份分区——这个谓词问的是**场所**能不能看见。
  it('操作者视角一律可见', async () => {
    await declareGoal()
    expect(goalTitleVisible(ctx, GOAL, { kind: 'operator', openId: 'op-1' })).toBe(true)
  })
})

describe('三态投影：承诺卡那一行「承 …」', () => {
  const card = (): ReturnType<typeof createCommitmentCard> => createCommitmentCard(ctx)
  const child = async (audience: string[]): Promise<void> => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-p', what: '拉三家竞品', parentGoalRef: GOAL,
        executor: { kind: 'human', openId: 'u-1', name: '张锐' },
        sourceAnchor: 'yzj:m-3', audience,
      },
      actor: OPERATOR,
    })
  }
  const bodyIn = (placeKey?: string): string => {
    const state = graph.rawObject('commitment', 'c-p')?.state as never
    return card().renderText(state, placeKey === undefined ? undefined : { placeKey }).body
  }

  it('标题可见 → 印**名字**，不是那串 URI', async () => {
    await declareGoal()
    await child(['yzj-group-g1'])
    expect(bodyIn('yzj-group-g1')).toContain('承 Q3 把对账周期压到 3 天内')
    expect(bodyIn('yzj-group-g1')).not.toContain(GOAL)
  })

  /*
    **标题不可见 → 整行不印。**

    不是「印个链接」——印一个 URI 等于告诉对方「这儿有个你看不到的东西」，而 URI 本身
    常常就带着名字。与「连计数不泄漏」以及明拒⑤「不用『另有 N 项你看不到』做透明装饰」
    唯一自洽的做法，就是什么都不说。
  */
  it('标题不可见 → 一个字都不印，零暗示', async () => {
    await declareGoal()
    await child(['yzj-group-g1'])
    const body = bodyIn('yzj-group-g9')
    expect(body).not.toContain('承 ')
    expect(body).not.toContain(GOAL)
    // 卡自己的事照说不误——裁掉的只是它引用的**别人**。
    expect(body).toContain('拉三家竞品')
    /*
      **投影那一行也算暗示。**

      它一个字都没提那个目标叫什么，但「这条会写进目标文档」本身就是一句关于目标的话：
      看不见那个目标的人，从这一行知道了「有一个目标，而这条活挂在它下面」。零暗示要求
      的是连这个都不给——否则裁掉了名字，却留下了它的影子。
    */
    expect(body).not.toContain('目标文档')
  })

  it('投给操作者本人时照旧全渲染', async () => {
    await declareGoal()
    await child(['yzj-group-g1'])
    expect(bodyIn()).toContain('承 Q3 把对账周期压到 3 天内')
  })
})
