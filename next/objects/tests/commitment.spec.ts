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
import { commitmentCard } from '../src/commitment/card.ts'
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
  cards.register(commitmentCard)
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

  it('closes the commitment when the reply says it is done', async () => {
    const id = await open()
    await tools.get('commitment_receipt')?.execute({ commitmentId: id, text: '分析发了', completed: true }, EXEC)
    expect(stateOf(id)).toMatchObject({ status: 'closed', cause: 'receipt' })
  })

  it('says so plainly when the commitment does not exist', async () => {
    const result = await tools.get('commitment_receipt')?.execute({
      commitmentId: 'cmt-nope', text: 'x',
    }, EXEC)
    expect(result?.content).toContain('找不到')
  })
})

describe('the card verbs', () => {
  it('lets anyone in the audience report it done — not only the operator', async () => {
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
    const base = {
      commitmentId: 'c1', status: 'open' as const, what: '返修数据分析',
      executor: { kind: 'human' as const, openId: 'p-9', name: '张锐' },
      sourceAnchor: 'yzj:m-1',
    }
    const detached = commitmentCard.renderText({ ...base, parentGoalRef: '' })
    expect(detached.body).not.toContain('承 ')
    const absent = commitmentCard.renderText(base)
    expect(absent.body).toBe(detached.body)
    const attached = commitmentCard.renderText({ ...base, parentGoalRef: 'yzj://doc/g' })
    expect(attached.body).toContain('承 yzj://doc/g')
  })
})
