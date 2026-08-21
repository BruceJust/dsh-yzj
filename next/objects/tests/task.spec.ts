/**
 * Task, conflict, waiting and process-summary specs — the acceptance loop and
 * the two objects that exist to make silence impossible.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor, type GraphViewer } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { conflictCard, applyConflictTools, type ConflictState } from '../src/task/conflict.ts'
import { taskCard, taskFamily, type TaskState } from '../src/task/task.ts'
import { waitingCard, waitingFamily, waitingIdFor, type WaitingState } from '../src/task/waiting.ts'
import { processSummary } from '../src/summary.ts'
import type { TurnBinding } from '../src/turns.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const VIEWER: GraphViewer = { kind: 'operator', openId: 'op-1' }
const TOPIC = 'yzj-topic-1'

const BINDING: TurnBinding = {
  viewer: VIEWER,
  decider: 'op-1',
  accountKey: 'acct-1',
  accountOpenId: 'op-1',
  accountOrgId: 'org-1',
  topicKey: TOPIC,
  placeKey: 'yzj-group-g1',
  messageId: 'msg-1',
}

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<{ content: string; conflictId?: string }>
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let tools: Map<string, CapturedTool>

const EXEC = { agent: { session: { id: 'session-1' } } }

function taskState(id: string): TaskState | undefined {
  return graph.rawObject('task', id)?.state as unknown as TaskState | undefined
}

async function openTerminalTask(id = 'tsk-1'): Promise<string> {
  await graph.append({
    type: 'task/opened',
    data: { taskId: id, what: '改价格页', topicKey: TOPIC, sourceAnchor: 'yzj:msg-1' },
    actor: OPERATOR,
  })
  await graph.append({
    type: 'task/terminal',
    data: {
      taskId: id, summary: '已更新两处报价',
      artifacts: [{ uri: 'yzj://doc/d1', placeKey: 'yzj-kb-1', title: '价格页' }],
    },
    actor: { kind: 'agent' },
  })
  return id
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-task-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(taskFamily)
  graph.defineFamily(waitingFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(taskCard)
  cards.register(waitingCard)
  cards.register(conflictCard)
  ctx.provide('yzjTurns', { bindingFor: () => BINDING, defaultBinding: () => BINDING })
  const captured: CapturedTool[] = []
  ctx.provide('tools', {
    register: (definition: CapturedTool) => { captured.push(definition); return () => undefined },
  })
  applyConflictTools(ctx)
  tools = new Map(captured.map(tool => [tool.name, tool]))
})

describe('acceptance and rework', () => {
  it('treats a finished task as waiting for acceptance, not as done', async () => {
    const id = await openTerminalTask()
    expect(cards.pending(VIEWER).map(object => object.id)).toEqual([id])
    expect(cards.renderText({ kind: 'task', id })?.body).toContain('待验收')
  })

  it('accepts it and stops offering the verbs', async () => {
    const id = await openTerminalTask()
    await cards.act({ kind: 'task', id }, 'accept', OPERATOR, 'yzj-text')
    expect(taskState(id)).toMatchObject({ status: 'accepted', acceptedBy: 'op-1' })
    expect(cards.pending(VIEWER)).toEqual([])
  })

  it('counts rework rounds and keeps the reason — the learning loop raw material', async () => {
    const id = await openTerminalTask()
    await cards.act({ kind: 'task', id }, 'reject', OPERATOR, 'yzj-text', '价格口径用错了')
    expect(taskState(id)).toMatchObject({ status: 'rework', round: 1, reason: '价格口径用错了' })

    // A second pass that is rejected again increments rather than resets.
    await graph.append({
      type: 'task/terminal', data: { taskId: id, summary: '再改一版', artifacts: [] },
      actor: { kind: 'agent' },
    })
    await cards.act({ kind: 'task', id }, 'reject', OPERATOR, 'yzj-text', '还是不对')
    expect(taskState(id)?.round).toBe(2)
  })

  it('refuses a rejection with no reason at the card level', async () => {
    const id = await openTerminalTask()
    await cards.act({ kind: 'task', id }, 'reject', OPERATOR, 'yzj-text')
    expect(taskState(id)?.reason).toBe('未说明原因')
  })
})

/**
 * A failed turn produces nothing to accept. Before this verb existed, the only
 * way such a task could leave the inbox was to be ACCEPTED — signing off on a
 * result that does not exist — so the inbox filled with tasks reading 进行中
 * that nothing was working on.
 */
describe('the death a failed task needs', () => {
  it('voids an open task without counting it as rework', async () => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 'tsk-dead', what: '查一下', topicKey: TOPIC, sourceAnchor: 'yzj:msg-9' },
      actor: OPERATOR,
    })
    await cards.act({ kind: 'task', id: 'tsk-dead' }, 'void', OPERATOR, 'desktop', '模型连不上')
    expect(taskState('tsk-dead')).toMatchObject({
      status: 'voided', reason: '模型连不上', voidedBy: 'op-1',
    })
    expect(taskState('tsk-dead')?.round).toBeUndefined()
  })

  it('is reachable from OPEN, which is where the zombies actually are', async () => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 'tsk-open', what: '查一下', topicKey: TOPIC, sourceAnchor: 'yzj:msg-8' },
      actor: OPERATOR,
    })
    const state = taskState('tsk-open') as TaskState
    const verbs = taskCard.actions.filter(action => action.available?.(state) !== false)
    expect(verbs.map(action => action.id)).toEqual(['void'])
  })

  it('is terminal: the board stops asking about it', async () => {
    const id = await openTerminalTask('tsk-void')
    expect(cards.pending(VIEWER).map(object => object.id)).toContain(id)
    await cards.act({ kind: 'task', id }, 'void', OPERATOR, 'desktop', '需求撤了')
    expect(cards.pending(VIEWER)).toEqual([])
    expect(cards.renderText({ kind: 'task', id })?.body).toContain('已作废')
  })
})

describe('conflict visibility', () => {
  it('flags a contradiction once and pauses for a decision', async () => {
    const result = await tools.get('conflict_flag')?.execute({
      note: '价格改回原值与正在做的调价相反',
      inflight: '把价格改成 99',
      incoming: '改回 128',
    }, EXEC)
    const conflictId = String(result?.conflictId)
    expect(graph.rawObject('conflict', conflictId)).toBeDefined()
    expect(result?.content).toContain('暂停')

    const again = await tools.get('conflict_flag')?.execute({
      note: 'x', inflight: 'y', incoming: 'z',
    }, EXEC)
    expect(again?.content).toContain('已经亮出过')
    expect(graph.rawEvents(['conflict/flagged'])).toHaveLength(1)
  })

  it('resolves either way and echoes which side won', async () => {
    const result = await tools.get('conflict_flag')?.execute({
      note: 'n', inflight: 'a', incoming: 'b',
    }, EXEC)
    const conflictId = String(result?.conflictId)
    const acted = await cards.act({ kind: 'conflict', id: conflictId }, 'cancel', OPERATOR, 'yzj-text')
    expect(acted.echoText).toContain('改按新指令')
    const state = graph.rawObject('conflict', conflictId)?.state as unknown as ConflictState
    expect(state).toMatchObject({ status: 'resolved', resolution: 'cancel' })
  })
})

describe('waiting', () => {
  it('keeps escalation non-terminal — louder is not finished', async () => {
    const waitingId = waitingIdFor('topic', '等张锐的分析')
    await graph.append({
      type: 'waiting/opened',
      data: {
        waitingId, kind: 'third-party', what: '等张锐的分析',
        waitedFor: 'p-9', openedAt: Date.now() - 3 * 60 * 60_000, topicKey: TOPIC,
      },
      actor: { kind: 'agent' },
    })
    await graph.append({
      type: 'waiting/escalated',
      data: { waitingId, escalations: 1, detail: '已超期一天' },
      actor: { kind: 'system' },
    })
    const state = graph.rawObject('waiting', waitingId)?.state as unknown as WaitingState
    expect(state.status).toBe('escalated')
    expect(cards.pending(VIEWER).map(object => object.id)).toContain(waitingId)
    expect(cards.renderText({ kind: 'waiting', id: waitingId })?.body).toContain('已等 3 小时')
  })
})

describe('process summary', () => {
  it('says nothing when nothing happened worth summarizing', () => {
    expect(processSummary(ctx, { topicKey: TOPIC, viewer: VIEWER })).toBeUndefined()
  })

  it('projects what was produced and what is still waited on, for free', async () => {
    await graph.append({
      type: 'lineage/produced',
      data: {
        topicKey: TOPIC,
        artifact: { uri: 'yzj://doc/d1', placeKey: 'yzj-kb-1', title: '价格页 v2' },
        action: '新建文档', toolName: 'yzj_doc_create',
      },
      actor: { kind: 'agent' },
    })
    await graph.append({
      type: 'waiting/opened',
      data: {
        waitingId: 'wtg-1', kind: 'third-party', what: '等法务确认口径',
        openedAt: Date.now(), topicKey: TOPIC,
      },
      actor: { kind: 'agent' },
    })

    const summary = processSummary(ctx, { topicKey: TOPIC, viewer: VIEWER })
    expect(summary).toContain('新建文档：价格页 v2')
    expect(summary).toContain('yzj://doc/d1')
    expect(summary).toContain('等法务确认口径')
  })

  it('ignores another topic\'s work', async () => {
    await graph.append({
      type: 'lineage/produced',
      data: {
        topicKey: 'other-topic',
        artifact: { uri: 'yzj://doc/x', placeKey: 'yzj-kb-1' },
        action: '新建文档',
      },
      actor: { kind: 'agent' },
    })
    expect(processSummary(ctx, { topicKey: TOPIC, viewer: VIEWER })).toBeUndefined()
  })
})

/**
 * 墓碑律：终局是吸收态 (变更记录 #47).
 *
 * Found in the production log, not in a fixture: `opened → voided → terminal`.
 * A turn timed out, the task was voided — the honest death for work nobody
 * delivered — and then the turn finished late and appended `terminal`, putting
 * a task the operator had been told was dead back into the inbox as 待验收.
 */
describe('a settled task stays settled', () => {
  let ctx: Context
  let graph: YzjGraph

  beforeEach(async () => {
    ctx = new Context()
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-tomb-')) })
    graph.defineFamily(taskFamily)
    await graph.selectAccount('acct-1')
  })

  const open = async (): Promise<void> => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 't-1', what: '改价格页', topicKey: 'yzj-topic-1', sourceAnchor: 'yzj:m-1' },
      actor: { kind: 'agent' },
    })
  }
  const status = (): string => String((graph.rawObject('task', 't-1')?.state as { status?: string })?.status)

  it('does not let a late terminal resurrect a voided task', async () => {
    await open()
    await graph.append({
      type: 'task/voided',
      data: { taskId: 't-1', reason: '回合超时', voidedBy: 'op-1' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    await graph.append({
      type: 'task/terminal',
      data: { taskId: 't-1', summary: '其实我做完了', artifacts: [] },
      actor: { kind: 'agent' },
    })
    expect(status()).toBe('voided')
  })

  it('does not let a late terminal reopen an accepted task', async () => {
    await open()
    await graph.append({
      type: 'task/terminal', data: { taskId: 't-1', summary: '好了', artifacts: [] },
      actor: { kind: 'agent' },
    })
    await graph.append({
      type: 'task/accepted', data: { taskId: 't-1', acceptedBy: 'op-1' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    await graph.append({
      type: 'task/terminal', data: { taskId: 't-1', summary: '又跑了一遍', artifacts: [] },
      actor: { kind: 'agent' },
    })
    expect(status()).toBe('accepted')
  })

  it('still lets the operator change their mind — 打回 reopens an accepted task', async () => {
    await open()
    await graph.append({
      type: 'task/terminal', data: { taskId: 't-1', summary: '好了', artifacts: [] },
      actor: { kind: 'agent' },
    })
    await graph.append({
      type: 'task/accepted', data: { taskId: 't-1', acceptedBy: 'op-1' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    await graph.append({
      type: 'task/rejected',
      data: { taskId: 't-1', round: 1, reason: '数字不对', artifacts: [], rejectedBy: 'op-1' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    expect(status()).toBe('rework')
  })
})

describe('中断：载体断了，意图没断（实测缺陷）', () => {
  const ID = 'tsk-broken'
  const openTask = async (what: string): Promise<void> => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: ID, what, topicKey: TOPIC, sourceAnchor: 'yzj:msg-1' },
      actor: OPERATOR,
    })
  }
  const interrupt = async (): Promise<void> => {
    await graph.append({
      type: 'task/interrupted',
      data: { taskId: ID, reason: 'OpenAI API error (502)' },
      actor: { kind: 'system' },
    })
  }
  const resumeAction = taskCard.actions.find(action => action.id === 'resume')
  const voidAction = taskCard.actions.find(action => action.id === 'void')

  it('keeps the task answerable instead of burying it', async () => {
    await openTask('把那个 zip 拆开看看')
    await interrupt()
    const state = taskState(ID)
    expect(state?.status).toBe('interrupted')
    /*
      现场：502 之后任务被作废,意图随载体一起死了——触发消息被忘掉,唯一的
      出路是私下推它一把,而那时答案已经无处可发。中断必须是**可应答**的。
    */
    expect(taskCard.isResolved(state as never)).toBe(false)
    expect(resumeAction?.available?.(state as never)).toBe(true)
  })

  it('offers 继续 only where it means something', async () => {
    await openTask('普通任务')
    expect(resumeAction?.available?.(taskState(ID) as never)).toBe(false)
    await graph.append({
      type: 'task/terminal', data: { taskId: ID, summary: '做完了', artifacts: [] },
      actor: { kind: 'agent' },
    })
    expect(resumeAction?.available?.(taskState(ID) as never)).toBe(false)
  })

  it('still lets somebody give up on an interrupted task', async () => {
    await openTask('要放弃的')
    await interrupt()
    // 「继续」不能是中断状态唯一的出口,否则它就成了另一种死胡同。
    expect(voidAction?.available?.(taskState(ID) as never)).toBe(true)
  })

  it('resuming puts it back to open', async () => {
    await openTask('继续这件事')
    await interrupt()
    await cards.act({ kind: 'task', id: ID }, 'resume', OPERATOR, 'desktop')
    expect(taskState(ID)?.status).toBe('open')
    expect(taskState(ID)?.resumedBy).toBe('op-1')
  })
})

/**
 * 验收卡 —— 可应答对象家族第六员 (v4.14 交付即出卡；v3.8r 三条收紧)。
 *
 * 「找不到验收项」的病根不是它滚走了，是**它长得不像一个等你的东西**。可应答检验
 * 当年点名了确认、裁决、租约、询问，唯独漏了验收——于是终态回帖只是一段话，而一段
 * 话没有脸。
 */
describe('验收卡：第六员', () => {
  it('说得出自己是双动词验收，而不是等着视图按类型认它', async () => {
    const id = await openTerminalTask()
    const demand = cards.demandOf(graph.rawObject('task', id) as never)
    expect(demand?.layer).toBe('blocking')
    expect(demand?.mode).toBe('two-verb-acceptance')
    expect(demand?.label).toContain('已更新两处报价')
  })

  /**
   * 中断不是验收。
   *
   * 没有交付可验，人要答的是「还做不做」——那是待答询问。把两者说成同一种，等于请人
   * 去验收一份不存在的产出，正是此前修过的僵尸问题。
   */
  it('中断走的是待答询问，不是验收', async () => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 'tk-i', what: '解压那个 zip', topicKey: TOPIC, sourceAnchor: 'yzj:m' },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'task/interrupted', data: { taskId: 'tk-i', reason: '模型 502' },
      actor: { kind: 'system' },
    })
    const demand = cards.demandOf(graph.rawObject('task', 'tk-i') as never)
    expect(demand?.mode).toBe('open-question')
    expect(demand?.badge).toBe('待继续')
  })

  /**
   * 失败/超时/空回合根本走不到终态——所以「只有有交付的完成终态出验收卡」在数据这
   * 一层是结构性成立的：作废了的任务连 demand 都没有。
   */
  it('作废掉的任务不出卡——没人该去验收一份不存在的产出', async () => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 'tk-v', what: '超时那件', topicKey: TOPIC, sourceAnchor: 'yzj:m' },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'task/voided', data: { taskId: 'tk-v', reason: '任务超时，已取消', voidedBy: 'system' },
      actor: { kind: 'system' },
    })
    expect(cards.demandOf(graph.rawObject('task', 'tk-v') as never)).toBeUndefined()
    expect(cards.pending(VIEWER).map(object => object.id)).not.toContain('tk-v')
  })
})

/**
 * 验收权 = 委派者 ∪ 操作者 (v3.8r 收紧③)。
 *
 * 「有 openId」从来不是一道检验——它放行了房间里的每一个人。委派者验收自己委派的活
 * 是主权本义；操作者是这条会话的主人。别人不是。
 */
describe('谁能验收', () => {
  const COLLEAGUE: GraphActor = { kind: 'operator', openId: 'p-9' }
  const STRANGER: GraphActor = { kind: 'operator', openId: 'p-77' }

  async function delegated(): Promise<string> {
    await graph.append({
      type: 'task/opened',
      data: {
        taskId: 'tk-d', what: '拉三家竞品', topicKey: TOPIC, sourceAnchor: 'yzj:m',
        delegatedBy: 'p-9', operator: 'op-1',
      },
      actor: { kind: 'agent' },
    })
    await graph.append({
      type: 'task/terminal', data: { taskId: 'tk-d', summary: '拉到了', artifacts: [] },
      actor: { kind: 'agent' },
    })
    return 'tk-d'
  }

  it('委派它的那位同事可以验收自己委派的活', async () => {
    const id = await delegated()
    const result = await cards.act({ kind: 'task', id }, 'accept', COLLEAGUE, 'yzj-text')
    expect(result.outcome).toBe('applied')
    expect(taskState(id)?.acceptedBy).toBe('p-9')
  })

  it('操作者本人也可以——这条会话是他的', async () => {
    const id = await delegated()
    expect((await cards.act({ kind: 'task', id }, 'accept', OPERATOR, 'desktop')).outcome)
      .toBe('applied')
  })

  it('同一个群里的旁人不能——「在场」不等于「有权」', async () => {
    const id = await delegated()
    const result = await cards.act({ kind: 'task', id }, 'accept', STRANGER, 'yzj-text')
    expect(result.outcome).toBe('unauthorized')
    expect(taskState(id)?.status).toBe('terminal')
  })

  it('打回与作废走同一道门——它们同样是对这件活的裁决', async () => {
    const id = await delegated()
    expect((await cards.act({ kind: 'task', id }, 'reject', STRANGER, 'yzj-text', '不行')).outcome)
      .toBe('unauthorized')
    expect((await cards.act({ kind: 'task', id }, 'void', STRANGER, 'yzj-text', '算了')).outcome)
      .toBe('unauthorized')
  })

  /**
   * 两个字段都没记的老任务退回旧行为。
   *
   * **一张没人能答的卡本身就是一种失败**——而它会发生在那些正等着被验收的历史任务
   * 上，也就是最不该在这次改动里失去出路的那一批。
   */
  it('没记下委派者的老任务仍然答得动', async () => {
    const id = await openTerminalTask('tk-old')
    expect((await cards.act({ kind: 'task', id }, 'accept', STRANGER, 'yzj-text')).outcome)
      .toBe('applied')
  })
})
