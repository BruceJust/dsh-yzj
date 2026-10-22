/**
 * 私聊、自聊是一个活很久的话题 —— 「一个话题 = 一件活」在这里不成立.
 *
 * 2026-10-21 在 3090 自聊里实测：问一句「我有几个个人知识库」，交回来的【过程摘要】写着三次
 * 「写入文档内容」和一条「顺延承诺期限 → 已放行」——都是同一个自聊里更早几件活干的。摘要按
 * 话题摘，私聊的话题从不换。同一个假设还藏在 `/done` `/reject` 里：话题里有两件等验收，
 * 它挑查询顺序里的第一件替人收口。
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
import { YzjOrchestrator } from '../src/orchestrator.ts'
import { outboundFamily } from '../src/outbound.ts'
import { YzjPoller } from '../src/poller.ts'
import type { YzjGroup, YzjMessage, YzjTopicRoute } from '../src/protocol.ts'
import { ChannelState } from '../src/state.ts'

const ROUTE: YzjTopicRoute = {
  accountKey: 'acct-1', accountOrgId: 'org-1', accountOpenId: 'op-1',
  conversationKind: 'direct', groupId: 'g-1', groupName: '我 · 审批通道', placeKey: 'yzj-dm-g-1',
  channelKey: 'c', topicRootId: 'm-root', topicKey: 'yzj-topic-self', topicLabel: 't',
  generation: 1, sessionId: 's-1', title: 't',
}
const GROUP: YzjGroup = { groupId: 'g-1', groupName: '我 · 审批通道', lastMsgId: '', lastMsgSendTime: '' }
const OPERATOR = { kind: 'operator' as const, openId: 'op-1' }

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let orchestrator: YzjOrchestrator
let posted: string[]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-long-topic-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(outboundFamily)
  graph.defineFamily(taskFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(taskCard)
  posted = []
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
      whenIdle: async () => undefined,
      followup: (message: unknown) => {
        events.push({ seq: events.length, type: 'user/message', data: message })
        events.push({ seq: events.length, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '2 个：我的知识、AI速记知识库。' }] } } })
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

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5))

describe('交付的摘要只摘这件活', () => {
  it('同一个自聊里更早那件活建的文档，不算进这一句的产出', async () => {
    await graph.append({
      type: 'lineage/produced',
      data: {
        topicKey: ROUTE.topicKey,
        artifact: { uri: 'https://kb/doc/1', placeKey: 'yzj-kb-1', title: '把云之家 CLI 的日程能力盘清楚' },
        action: '新建文档', toolName: 'yzj_doc_create',
      },
      actor: { kind: 'agent' },
    })
    await tick()
    const trigger: YzjMessage = {
      msgId: 'm-kb', content: '@next 我有几个个人知识库？', fromOpenId: 'op-1', msgType: 'text', sendTime: '', param: {},
    }
    await (orchestrator as unknown as {
      runTurn(group: YzjGroup, trigger: YzjMessage, route: YzjTopicRoute, context: readonly YzjMessage[]): Promise<void>
    }).runTurn(GROUP, trigger, ROUTE, [])

    const reply = posted.find(line => line.includes('2 个：我的知识'))
    expect(reply).toBeDefined()
    expect(reply).not.toContain('过程摘要')
    expect(reply).not.toContain('日程能力')
  })
})

describe('话题里不止一件等验收：IM 动词不替人挑', () => {
  const poller = (): { settleTask(route: YzjTopicRoute, verb: 'done' | 'reject', argument: string, actor: string): Promise<string> } =>
    new YzjPoller(ctx, {} as never, {} as never, orchestrator, {} as never, {} as never, () => undefined) as never

  async function delivered(taskId: string, what: string): Promise<void> {
    await graph.append({
      type: 'task/opened',
      data: { taskId, what, topicKey: ROUTE.topicKey, sourceAnchor: `yzj:${taskId}`, delegatedBy: 'op-1', operator: 'op-1' },
      actor: { kind: 'agent' },
    })
    await graph.append({ type: 'task/terminal', data: { taskId, summary: '好了', artifacts: [] }, actor: { kind: 'agent' } })
  }
  const status = (taskId: string): string | undefined => asString(asRecord(graph.rawObject('task', taskId)?.state)?.status)

  it('两件都等着：说清是哪两件、怎么点名，一件都不动', async () => {
    await delivered('tsk-a', '@next 一句话报到')
    await delivered('tsk-b', '@next 我有几个个人知识库？')
    const answer = await poller().settleTask(ROUTE, 'done', '', 'op-1')
    expect(answer).toContain('有 2 件活等验收，不替你猜')
    expect(answer).toContain('· @next 一句话报到')
    expect(answer).toContain('· @next 我有几个个人知识库？')
    expect([status('tsk-a'), status('tsk-b')]).toEqual(['terminal', 'terminal'])
    expect(cards.pending(OPERATOR).map(object => object.id).sort()).toEqual(['tsk-a', 'tsk-b'])
  })

  it('只有一件：照旧收口', async () => {
    await delivered('tsk-a', '@next 一句话报到')
    await poller().settleTask(ROUTE, 'done', '', 'op-1')
    expect(status('tsk-a')).toBe('accepted')
  })
})
