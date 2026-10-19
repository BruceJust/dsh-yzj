/**
 * 中断通知要能被应答 —— 请人回一个词的话，回那个词就得落到卡上（卡片三定律②）。
 *
 * 2026-10-19 在 3090 上实测到：回合因模型超时中断，通知说「回复『继续』我接着做」，对着
 * 这条通知回「继续」什么都没发生——它没登记成任务卡的投影，也不带句柄，只有回复更早那条
 * 受理回执才认。这里跑真的 `runTurn`（假的只有 agent：它的回合以一次错误结束）。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { YzjRunResult } from '@yzj-next/bridge'
import { YzjCards } from '@yzj-next/cards'
import { YzjGraph } from '@yzj-next/graph'
import { taskCard, taskFamily } from '@yzj-next/objects'
import { YzjChannelClient } from '../src/client.ts'
import { YzjOrchestrator } from '../src/orchestrator.ts'
import { outboundFamily } from '../src/outbound.ts'
import type { YzjGroup, YzjMessage, YzjTopicRoute } from '../src/protocol.ts'
import { ChannelState } from '../src/state.ts'

const ROUTE: YzjTopicRoute = {
  accountKey: 'acct-1', accountOrgId: 'org-1', accountOpenId: 'op-1',
  conversationKind: 'direct', groupId: 'g-1', groupName: '私聊', placeKey: 'yzj-dm-g-1',
  channelKey: 'c', topicRootId: 'm-root', topicKey: 'yzj-topic-1', topicLabel: 't',
  generation: 1, sessionId: 's-1', title: 't',
}
const GROUP: YzjGroup = { groupId: 'g-1', groupName: '私聊', lastMsgId: '', lastMsgSendTime: '' }
const TRIGGER: YzjMessage = {
  msgId: 'm-trigger', content: '@next 整理一下上周的回款', fromOpenId: 'op-1', msgType: 'text', sendTime: '', param: {},
}

let ctx: Context
let cards: YzjCards
let orchestrator: YzjOrchestrator
let sent: { msgId: string; content: string }[]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-interrupt-'))
  ctx = new Context()
  const graph = new YzjGraph(ctx, { root })
  graph.defineFamily(outboundFamily)
  graph.defineFamily(taskFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(taskCard)
  sent = []
  ctx.provide('yzjBridge', {
    run: async (command: readonly string[]): Promise<YzjRunResult> => {
      const msgId = `sent-${String(sent.length + 1)}`
      sent.push({ msgId, content: command[command.indexOf('--content') + 1] ?? '' })
      return { ok: true, exitCode: 0, stdout: '', stderr: '', json: { msgId, groupId: 'g-1' }, truncated: false, timedOut: false, durationMs: 1 }
    },
  })
  // 一个回合以模型超时结束的 agent：别的都不做。
  const events: { seq: number; type: string; data: unknown }[] = []
  const agent = {
    session: { id: 's-1', get seq() { return events.length }, events },
    whenIdle: async () => undefined,
    followup: () => {
      events.push({ seq: events.length, type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'Request timed out.' } } } })
    },
    cancel: () => undefined,
    dispose: async () => undefined,
  }
  ctx.provide('agents', { get: () => agent })
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

describe('中断通知', () => {
  it('对着中断通知回「继续」，落到这件任务的卡上', async () => {
    await (orchestrator as unknown as {
      runTurn(group: YzjGroup, trigger: YzjMessage, route: YzjTopicRoute, context: readonly YzjMessage[]): Promise<void>
    }).runTurn(GROUP, TRIGGER, ROUTE, [])

    const notice = sent.find(one => one.content.startsWith('【Agent中断】'))
    expect(notice).toBeDefined()
    const projection = cards.cardForAnchor(notice?.msgId ?? '')
    expect(projection?.cardRef.kind).toBe('task')
    // 消息载句柄：通知里写的就是它投影的那张卡。
    expect(notice?.content).toContain(`[card#task:${projection?.cardRef.id ?? ''}]`)
    expect(cards.resolveKeyword(projection!.cardRef, '继续')).toMatchObject({ actionId: 'resume' })
  })
})
