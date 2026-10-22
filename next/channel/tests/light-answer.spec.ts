/**
 * 轻问律：问一句、答一句，不出验收卡 (设计 §F-read：问一个数得一个数，不产生任务生命周期).
 *
 * 云之家里没有「轻问」那一格可选，每句 @ 都先 ack 认领，活是先开的。答完一看，这一回合在
 * 世界上什么都没动——那就没有东西可验收。3090 上 38 次验收里 35 次是纯问答，中位数等了
 * 17 天才被成批按掉；两个月前那件「帮我看下我有哪些知识库」就是这么挂在「要你」里的。
 *
 * 这里跑真的 `runTurn`，假的只有 agent——它在回合中间可以往图上留东西（写、请示、记住）。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { YzjRunResult } from '@yzj-next/bridge'
import { YzjCards } from '@yzj-next/cards'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { approvalFamily, taskCard, taskFamily } from '@yzj-next/objects'
import { YzjChannelClient } from '../src/client.ts'
import { YzjOrchestrator, touchedWorld } from '../src/orchestrator.ts'
import { outboundFamily } from '../src/outbound.ts'
import type { YzjGroup, YzjMessage, YzjTopicRoute } from '../src/protocol.ts'
import { ChannelState, type Redo } from '../src/state.ts'

const ROUTE: YzjTopicRoute = {
  accountKey: 'acct-1', accountOrgId: 'org-1', accountOpenId: 'op-1',
  conversationKind: 'group', groupId: 'g-1', groupName: 'dsh-2', placeKey: 'yzj-group-g-1',
  channelKey: 'c', topicRootId: 'm-root', topicKey: 'yzj-topic-1', topicLabel: 't',
  generation: 1, sessionId: 's-1', title: 't',
}
const GROUP: YzjGroup = { groupId: 'g-1', groupName: 'dsh-2', lastMsgId: '', lastMsgSendTime: '' }
const OPERATOR = { kind: 'operator' as const, openId: 'op-1' }

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let orchestrator: YzjOrchestrator
let posted: string[]
/** 回合中间云小助在图上留下的东西；undefined = 只说话。 */
let sideEffect: ((trigger: string) => Promise<unknown>) | undefined
let pending: Promise<unknown> | undefined

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-light-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(outboundFamily)
  graph.defineFamily(taskFamily)
  graph.defineFamily(approvalFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(taskCard)
  posted = []
  sideEffect = undefined
  pending = undefined
  ctx.provide('yzjBridge', {
    run: async (command: readonly string[]): Promise<YzjRunResult> => {
      posted.push(command.join(' '))
      return { ok: true, exitCode: 0, stdout: '', stderr: '', json: { msgId: `sent-${String(posted.length)}`, groupId: 'g-1' }, truncated: false, timedOut: false, durationMs: 1 }
    },
  })
  const events: { seq: number; type: string; data: unknown }[] = []
  ctx.provide('agents', {
    get: () => ({
      session: { id: 's-1', get seq() { return events.length }, events },
      whenIdle: async () => { await pending },
      followup: (message: { content: { text: string }[] }) => {
        events.push({ seq: events.length, type: 'user/message', data: message })
        pending = sideEffect?.(message.content[0]?.text ?? '')
        events.push({ seq: events.length, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '星期四。' }] } } })
        events.push({ seq: events.length, type: 'turn/end', data: { reason: { kind: 'done' } } })
      },
      cancel: () => undefined,
      dispose: async () => undefined,
    }),
  })
  const state = new ChannelState(join(root, 'channel-state.json'))
  await state.load()
  state.selectAccount('acct-1')
  const client = new YzjChannelClient(ctx, state, 5_000)
  client.pinIdentity({ orgId: 'org-1', openId: 'op-1', name: 'Bruce' })
  orchestrator = new YzjOrchestrator(ctx, client, state, {
    maxReplyChars: 3_500, taskTimeoutMs: 60_000, idleTimeoutMs: 60_000,
  } as never)
})

afterEach(async () => {
  await orchestrator.dispose()
})

const approvalIn = (topicKey: string, approvalId: string): Record<string, unknown> => ({
  approvalId, toolName: 'yzj_doc_delete', reason: '删除知识库文档', level: 'standard', args: {},
  argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 60_000, topicKey,
})

async function ask(content: string, msgId = 'm-ask', redo?: Redo): Promise<Record<string, unknown> | undefined> {
  const trigger: YzjMessage = { msgId, content, fromOpenId: 'op-1', msgType: 'text', sendTime: '', param: {} }
  await (orchestrator as unknown as {
    runTurn(group: YzjGroup, trigger: YzjMessage, route: YzjTopicRoute, context: readonly YzjMessage[], claim?: unknown, redo?: Redo): Promise<void>
  }).runTurn(GROUP, trigger, ROUTE, [], undefined, redo)
  const task = graph.query(OPERATOR, { kind: 'task' }).find(object => asString(asRecord(object.state)?.sourceAnchor) === `yzj:${msgId}`)
  return asRecord(task?.state)
}

describe('问一句、答一句', () => {
  it('落成「已答复」：不进「要你」，回帖不请人验收，答错了照样能打回', async () => {
    const task = await ask('@next 今天星期几？')
    expect(task).toMatchObject({ status: 'answered', summary: '星期四。' })
    expect(cards.pending(OPERATOR)).toEqual([])
    const reply = posted.find(line => line.includes('星期四。')) ?? ''
    expect(reply).toContain('不对就回复「打回 <原因>」')
    expect(reply).not.toContain('定终态')
    // 打回：它就成了一件要验收的活。
    const id = asString(task?.taskId) ?? ''
    expect(cards.resolveKeyword({ kind: 'task', id }, '打回 是周三')).toEqual({ actionId: 'reject', input: '是周三' })
    await cards.act({ kind: 'task', id }, 'reject', OPERATOR, 'yzj-text', '是周三')
    expect(asString(asRecord(graph.rawObject('task', id)?.state)?.status)).toBe('rework')
  })
})

describe('动了世界的，才要人验收', () => {
  it('回合里要动手写（请示过一次写入）：待验收', async () => {
    sideEffect = () => graph.append({
      type: 'approval/opened',
      data: approvalIn(ROUTE.topicKey, 'apv-1'),
      actor: { kind: 'agent' },
    })
    expect(await ask('@next 把那个测试文档删掉')).toMatchObject({ status: 'terminal' })
    expect(cards.pending(OPERATOR).map(object => object.kind)).toEqual(['task'])
  })

  it('委派的话（「你来负责」）：待验收——这是一件活，不是一个问题', async () => {
    expect(await ask('@next 竞品分析你来负责，周五前给我')).toMatchObject({ status: 'terminal' })
  })

  it('打回之后的那一版：待验收——人已经在判这件活了', async () => {
    const first = await ask('@next 今天星期几？', 'm-redo')
    const taskId = asString(first?.taskId) ?? ''
    await cards.act({ kind: 'task', id: taskId }, 'reject', OPERATOR, 'yzj-text', '是周三')
    expect(await ask('@next 今天星期几？', 'm-redo', { taskId, round: 1, reason: '是周三' })).toMatchObject({ status: 'terminal', round: 1 })
  })
})

describe('「留下了东西」的判据', () => {
  const since = (): number => Date.now() - 1

  it('挂在这个话题上、或者指着这一句的，都算；别的话题的不算', async () => {
    const start = since()
    await graph.append({ type: 'approval/opened', data: approvalIn('yzj-topic-other', 'apv-2'), actor: { kind: 'agent' } })
    expect(touchedWorld(ctx, ROUTE.topicKey, 'yzj:m-1', start)).toBe(false)
    // 记住了一条：记忆按场所存，可它指着这一句。
    await graph.append({
      type: 'memory/distilled',
      data: { memoryId: 'mem-1', axis: 'place', sourceAnchors: ['yzj:m-1'], summary: '对外数字要注明口径', scope: ROUTE.placeKey, status: 'live' },
      actor: { kind: 'agent' },
    })
    expect(touchedWorld(ctx, ROUTE.topicKey, 'yzj:m-1', start)).toBe(true)
  })
})
