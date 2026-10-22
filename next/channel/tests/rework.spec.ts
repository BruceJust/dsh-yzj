/**
 * 返工闭环：打回 = 一句新吩咐，落在同一张卡上.
 *
 * 2026-10-21 在 3090 上实测到：一件 8/18 被打回的活在「运行中」挂了两个月。打回只记下
 * 了理由，云小助从没被叫回去改；「返工中」这张卡上一个动词都没有；人在话题里说「完成了」，
 * 云小助答「好，这件事就算完成了」，图上什么都没动。
 *
 * 这里跑真的 `runTurn`（假的只有 agent）。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { YzjRunResult } from '@yzj-next/bridge'
import { YzjCards } from '@yzj-next/cards'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { taskCard, taskFamily } from '@yzj-next/objects'
import { YzjChannelClient } from '../src/client.ts'
import { CHANNEL_PROMPT, YzjOrchestrator, redoNote } from '../src/orchestrator.ts'
import { outboundFamily } from '../src/outbound.ts'
import { ACK_PREFIX, ackText } from '../src/presence.ts'
import type { YzjGroup, YzjMessage, YzjTopicRoute } from '../src/protocol.ts'
import { ChannelState, type Redo } from '../src/state.ts'

const ROUTE: YzjTopicRoute = {
  accountKey: 'acct-1', accountOrgId: 'org-1', accountOpenId: 'op-1',
  conversationKind: 'direct', groupId: 'g-1', groupName: '私聊', placeKey: 'yzj-dm-g-1',
  channelKey: 'c', topicRootId: 'm-root', topicKey: 'yzj-topic-1', topicLabel: 't',
  generation: 1, sessionId: 's-1', title: 't',
}
const GROUP: YzjGroup = { groupId: 'g-1', groupName: '私聊', lastMsgId: '', lastMsgSendTime: '' }
const TRIGGER: YzjMessage = {
  msgId: 'm-trigger', content: '@next 帮我看下我有哪些知识库', fromOpenId: 'op-1', msgType: 'text', sendTime: '', param: {},
}
const TASK = 'tsk-kb'

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let state: ChannelState
let orchestrator: YzjOrchestrator
let prompts: string[]
/** 发进云之家的每一条（命令行拼起来）。 */
let posted: string[]
/** 下一个回合怎么收：说一句话，还是以错误结束。 */
let nextTurn: { text: string } | { error: string }

type Runner = {
  runTurn(
    group: YzjGroup, trigger: YzjMessage, route: YzjTopicRoute, context: readonly YzjMessage[],
    claim?: unknown, redo?: Redo,
  ): Promise<void>
}
const run = (redo?: Redo): Promise<void> => (orchestrator as unknown as Runner)
  .runTurn(GROUP, TRIGGER, ROUTE, [], undefined, redo)
const task = (): Record<string, unknown> | undefined => asRecord(graph.rawObject('task', TASK)?.state)
/** 等排上的那一回合跑完（`dispose` 会让还没开始的回合直接不跑）。 */
const settled = async (): Promise<void> => {
  await (orchestrator as unknown as { queues: Map<string, Promise<void>> }).queues.get(ROUTE.topicKey)
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-rework-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(outboundFamily)
  graph.defineFamily(taskFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(taskCard)
  let sent = 0
  posted = []
  ctx.provide('yzjBridge', {
    run: async (command: readonly string[]): Promise<YzjRunResult> => {
      posted.push(command.join(' '))
      sent += 1
      return { ok: true, exitCode: 0, stdout: '', stderr: '', json: { msgId: `sent-${String(sent)}`, groupId: 'g-1' }, truncated: false, timedOut: false, durationMs: 1 }
    },
  })
  prompts = []
  nextTurn = { text: '现在能看到 108 个知识库。' }
  const events: { seq: number; type: string; data: unknown }[] = []
  const agent = {
    session: { id: 's-1', get seq() { return events.length }, events },
    whenIdle: async () => undefined,
    followup: (message: { content: { text: string }[] }) => {
      prompts.push(message.content[0]?.text ?? '')
      // 会话里记下这句话（带来源）——重放守卫就是认它的。
      events.push({ seq: events.length, type: 'user/message', data: message })
      if ('error' in nextTurn) {
        events.push({ seq: events.length, type: 'turn/end', data: { reason: { kind: 'error', error: { message: nextTurn.error } } } })
        return
      }
      events.push({ seq: events.length, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: nextTurn.text }] } } })
      events.push({ seq: events.length, type: 'turn/end', data: { reason: { kind: 'done' } } })
    },
    cancel: () => undefined,
    dispose: async () => undefined,
  }
  ctx.provide('agents', { get: () => agent })
  state = new ChannelState(join(root, 'channel-state.json'))
  await state.load()
  state.selectAccount('acct-1')
  const client = new YzjChannelClient(ctx, state, 5_000)
  client.pinIdentity({ orgId: 'org-1', openId: 'op-1', name: 'Bruce' })
  orchestrator = new YzjOrchestrator(ctx, client, state, {
    maxReplyChars: 3_500, taskTimeoutMs: 60_000, idleTimeoutMs: 60_000,
  } as never)

  // 一件交过、被打回的活。
  await graph.append({
    type: 'task/opened',
    data: { taskId: TASK, what: TRIGGER.content, topicKey: ROUTE.topicKey, sourceAnchor: `yzj:${TRIGGER.msgId}`, delegatedBy: 'op-1', operator: 'op-1' },
    actor: { kind: 'agent' },
  })
  await graph.append({ type: 'task/terminal', data: { taskId: TASK, summary: '40 个知识库', artifacts: [] }, actor: { kind: 'agent' } })
  await cards.act({ kind: 'task', id: TASK }, 'reject', { kind: 'operator', openId: 'op-1' }, 'desktop', '口径不对，要按可编辑权限重新数')
})

afterEach(async () => {
  await orchestrator.dispose()
})

describe('打回之后', () => {
  it('云小助被叫回去改，听得到打回的原话；改完交回同一张卡', async () => {
    expect(task()?.status).toBe('rework')
    await run({ taskId: TASK, round: 1, reason: '口径不对，要按可编辑权限重新数' })

    expect(prompts[0]).toContain('【打回 · 第 1 轮】')
    expect(prompts[0]).toContain('「口径不对，要按可编辑权限重新数」')
    // 没有开第二件活：交付落回原来那张卡，轮次留着。
    expect(graph.query({ kind: 'operator', openId: 'op-1' }, { kind: 'task' }).map(object => object.id)).toEqual([TASK])
    expect(task()).toMatchObject({ status: 'terminal', summary: '现在能看到 108 个知识库。', round: 1 })
    expect(cards.pending({ kind: 'operator', openId: 'op-1' }).map(object => object.id)).toEqual([TASK])
    // 群里看得出这是一次返工、照着哪句改——不是又一件新活的「已接收，正在处理」。
    expect(posted[0]).toContain('【Agent】已接收打回（第 1 轮）：「口径不对，要按可编辑权限重新数」——按这句改，改完交回这张卡。[card#task:tsk-kb]')
  })

  it('同一句话再跑一回：没人要的是重放（拦），人要的是重做（放）', async () => {
    await run()
    await run()
    expect(prompts).toHaveLength(1)
    await run({ taskId: TASK, round: 1, reason: '口径不对' })
    expect(prompts).toHaveLength(2)
  })

  it('返工这一回合断了：停在「可继续」，续跑地址带着打回的原话', async () => {
    nextTurn = { error: 'Request timed out.' }
    await run({ taskId: TASK, round: 1, reason: '口径不对' })
    expect(task()?.status).toBe('interrupted')
    expect(state.resumable(TASK)?.redo).toEqual({ taskId: TASK, round: 1, reason: '口径不对' })
    // 卡上：接着改、就这样收了、作废——没有一条死路。云之家里的号和桌面按钮同一个字。
    const text = cards.renderText({ kind: 'task', id: TASK })
    expect(text?.replyHints).toEqual(['接着改', '就这样收了', '作废 <原因>'])
    expect(text?.numbered).toEqual(['就这样收了', '接着改'])
    expect(cards.resolveKeyword({ kind: 'task', id: TASK }, '接着改')).toEqual({ actionId: 'resume' })
  })

  it('继续：带着打回的原话接着改', async () => {
    nextTurn = { error: 'Request timed out.' }
    await run({ taskId: TASK, round: 1, reason: '口径不对' })
    nextTurn = { text: '改好了。' }
    expect(await orchestrator.resumeTask(TASK)).toBe(true)
    await settled()
    expect(prompts.at(-1)).toContain('【打回 · 第 1 轮】')
    expect(asString(task()?.summary)).toBe('改好了。')
  })
})

describe('中断后的「继续」', () => {
  /*
    此前续跑把原话原样排回去，撞上重放守卫，回一句「为避免重复写入，本次没有自动重跑」
    就收工——中断通知说「回复『继续』我接着做」，回了也不做。
  */
  it('从没交付过的活断了，「继续」真的接着做，交在同一张卡上', async () => {
    const fresh: YzjMessage = { ...TRIGGER, msgId: 'm-fresh', content: '@next 整理回款' }
    nextTurn = { error: 'Request timed out.' }
    await (orchestrator as unknown as Runner).runTurn(GROUP, fresh, ROUTE, [])
    const id = graph.query({ kind: 'operator', openId: 'op-1' }, { kind: 'task', status: ['interrupted'] })
      .map(object => object.id).find(candidate => candidate !== TASK) ?? ''
    expect(id).not.toBe('')
    await cards.act({ kind: 'task', id }, 'resume', { kind: 'operator', openId: 'op-1' }, 'desktop')
    nextTurn = { text: '回款整理好了。' }
    expect(await orchestrator.resumeTask(id)).toBe(true)
    await settled()
    expect(prompts.at(-1)).toContain('【继续】')
    expect(asRecord(graph.rawObject('task', id)?.state)).toMatchObject({ status: 'terminal', summary: '回款整理好了。' })
  })
})

describe('云小助说话算话', () => {
  it('它知道收不收口不归它定，人说「完成了」时指向卡', () => {
    expect(CHANNEL_PROMPT).toContain('你改不了任务的状态')
    expect(CHANNEL_PROMPT).toContain('就这样收了')
  })

  it('打回没说原因：先问清哪里不对', () => {
    expect(redoNote({ taskId: TASK, round: 2, reason: '未说明原因' })).toContain('先问清楚哪里不对')
    expect(redoNote({ taskId: TASK })).toContain('【继续】')
    expect(redoNote(undefined)).toBe('')
  })

  it('回执和吩咐说的是同一件事：继续是继续，没说原因的打回先问', () => {
    expect(ackText(TASK, { taskId: TASK })).toBe('【Agent】已接收「继续」，接着做。[card#task:tsk-kb]')
    expect(ackText(TASK, { taskId: TASK, round: 2, reason: '未说明原因' })).toContain('没说哪里不对——先问清楚再改')
    // 前缀不变：同侪仍认得出这是一条 ack。
    expect(ackText(TASK, { taskId: TASK, round: 1, reason: 'x' }).startsWith(ACK_PREFIX)).toBe(true)
  })
})
