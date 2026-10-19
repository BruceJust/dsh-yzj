/**
 * 通道这一侧的账（技术方案-下一代ERP账本 E0）：授权追得到人的那个字段在哪里出生，以及
 * agent 对外说的每一句话在日志里恰好留一行。
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { YzjRunResult } from '@yzj-next/bridge'
import { YzjGraph, type GraphEvent } from '@yzj-next/graph'
import type { TurnBinding } from '@yzj-next/objects'
import { YzjChannelClient } from '../src/client.ts'
import { YzjOrchestrator } from '../src/orchestrator.ts'
import { contentDigest, outboundFamily, recordOutbound } from '../src/outbound.ts'
import type { YzjMessage, YzjTopicRoute } from '../src/protocol.ts'
import { ChannelState } from '../src/state.ts'

const ROUTE: YzjTopicRoute = {
  accountKey: 'acct-1', accountOrgId: 'org-1', accountOpenId: 'op-1',
  conversationKind: 'group', groupId: 'g-1', groupName: '群', placeKey: 'yzj-group-g-1',
  channelKey: 'c', topicRootId: 'm-root', topicKey: 'yzj-topic-1', topicLabel: 't',
  generation: 1, sessionId: 's-1', title: 't',
}

const message = (fromOpenId: string): YzjMessage => ({
  msgId: 'm-1', content: '@next 建个文档', fromOpenId, msgType: 'text', sendTime: '', param: {},
})

/** `bindingOf` is the one place a turn's authority is born; reach it directly. */
function bindingOf(trigger: YzjMessage): TurnBinding {
  const orchestrator = new YzjOrchestrator(new Context(), {} as never, {} as never, {} as never)
  return (orchestrator as unknown as { bindingOf(route: YzjTopicRoute, trigger: YzjMessage): TurnBinding })
    .bindingOf(ROUTE, trigger)
}

describe('接纳消息的发送者 (§13.3-2)', () => {
  it('回合绑定记下发消息的人——不是能答卡的人', () => {
    const binding = bindingOf(message('u-asker'))
    expect(binding).toMatchObject({ messageId: 'm-1', senderOpenId: 'u-asker', decider: 'op-1' })
  })

  it('发送者为空串就是缺失：宁可多问一次，也不放出一次无主的写', () => {
    expect(bindingOf(message(''))).not.toHaveProperty('senderOpenId')
  })
})

// #14
describe('agent 出站 (§13.5)', () => {
  let root: string
  let ctx: Context
  let graph: YzjGraph
  let reply: Record<string, unknown> | 'fail'

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'yzj-next-outbound-'))
    reply = { msgId: 'sent-1', groupId: 'g-1' }
    ctx = new Context()
    graph = new YzjGraph(ctx, { root })
    graph.defineFamily(outboundFamily)
    await graph.selectAccount('acct-1')
    ctx.provide('yzjBridge', {
      run: async (): Promise<YzjRunResult> => Promise.resolve(reply === 'fail'
        ? { ok: false, exitCode: 1, stdout: '', stderr: 'boom', json: undefined, truncated: false, timedOut: false, durationMs: 1 }
        : { ok: true, exitCode: 0, stdout: '', stderr: '', json: reply, truncated: false, timedOut: false, durationMs: 1 }),
    })
  })

  function client(onSent = (posted: Parameters<typeof recordOutbound>[1]) => recordOutbound(ctx, posted)): YzjChannelClient {
    const state = new ChannelState(join(root, 'channel-state.json'))
    void state.load()
    state.selectAccount('acct-1')
    const instance = new YzjChannelClient(ctx, state, 5_000, onSent)
    instance.pinIdentity({ orgId: 'org-1', openId: 'op-1', name: 'Bruce' })
    return instance
  }
  const posted = (): readonly GraphEvent[] => graph.rawEvents(['outbound/posted'])

  it('origin=agent 发送成功恰好一行，日志里没有正文；传了 admission 记消息', async () => {
    await client().send({ groupId: 'g-1' }, '季度复盘已建好', 'm-1', 'agent', { messageId: 'm-1', senderOpenId: 'u-asker' })
    expect(posted()).toHaveLength(1)
    const line = posted()[0]
    expect(line?.actor).toEqual({ kind: 'agent' })
    expect(line?.data).toMatchObject({
      msgId: 'sent-1', groupId: 'g-1', replyMsgId: 'm-1',
      authority: { kind: 'message', messageId: 'm-1', senderOpenId: 'u-asker' },
    })
    // 摘要是**签过名**的那段正文——发出去的就是它。
    expect((line?.data as { contentDigest: string }).contentDigest)
      .toBe(contentDigest('季度复盘已建好\n\n—— 云小助（Bruce）'))
    expect(await readFile(join(root, 'acct-1', 'graph.jsonl'), 'utf8')).not.toContain('季度复盘')
  })

  it('没传 admission 是主动发言，记本实例钉住的操作者；私聊没有回包 groupId 时取发送目标', async () => {
    reply = { msgId: 'sent-2' }
    await client().send({ toOpenId: 'u-2' }, '在岗')
    expect(posted()[0]?.data).toMatchObject({
      msgId: 'sent-2', groupId: 'dm:u-2', authority: { kind: 'operator', openId: 'op-1', via: 'proactive' },
    })
    expect(posted()[0]?.data).not.toHaveProperty('replyMsgId')
  })

  it("origin=desk 是人自己在说话：零行；没拿到 msgId 或发送失败：零行", async () => {
    await client().send({ groupId: 'g-1' }, '我自己说', undefined, 'desk')
    reply = {}
    await client().send({ groupId: 'g-1' }, '没有回执')
    reply = 'fail'
    await expect(client().send({ groupId: 'g-1' }, '发不出去')).rejects.toThrow()
    expect(posted()).toHaveLength(0)
  })

  it('记不上账只报错，不让发送变成失败——消息已经在场所里了', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sent = await client(() => Promise.reject(new Error('disk full'))).send({ groupId: 'g-1' }, '照样发出')
    expect(sent.msgId).toBe('sent-1')
    expect(error).toHaveBeenCalledWith('[yzj-next-channel] failed to record an outbound message', expect.anything())
    error.mockRestore()
  })
})
