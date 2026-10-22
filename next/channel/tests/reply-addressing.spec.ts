/**
 * 回复谁，就是在跟谁说 —— 回复你自己从桌面发的话，不是在叫云小助.
 *
 * 云小助用操作者的账号说话，操作者从桌面发的话也走同一个发送口，两者都记在出站登记里
 * （回声抑制要的就是「我们发的」）。可「回复它 = 叫云小助」问的是另一件事。评审
 * 2026-08-19 把桌面发送那一路改成了问「是不是云小助说的」，另外两路还在问「是不是我们发的」：
 *
 * - 回复键：自聊里回自己的一句，发送键写「发出 · 交给云小助」，服务端却按普通消息发——
 *   键上的话没兑现（实测 2026-10-21）；
 * - 入站：群里同事回复操作者从桌面发的一句话，被当成在叫云小助，云小助接了单。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { repliesToAgentIn } from '../src/poller.ts'
import { outboundFingerprint, type YzjMessage } from '../src/protocol.ts'
import { ChannelState } from '../src/state.ts'
import { YzjTopicReader } from '../src/topics.ts'

let state: ChannelState

beforeEach(async () => {
  state = new ChannelState(join(await mkdtemp(join(tmpdir(), 'yzj-reply-')), 'state.json'))
  await state.load()
  state.selectAccount('acct-1')
  // 一句云小助说的，一句操作者从桌面发的。
  state.registerOutbound('n1', 'g-1', outboundFingerprint('g-1', '星期四'), 'agent')
  state.confirmOutbound('n1', 'm-agent')
  state.registerOutbound('n2', 'g-1', outboundFingerprint('g-1', '可以再加上日期吗'), 'desk')
  state.confirmOutbound('n2', 'm-desk')
})

const reply = (to: string): YzjMessage => ({
  msgId: 'm-new', content: '完成了', fromOpenId: 'p-colleague', msgType: 'text', sendTime: '', param: { replyMsgId: to },
})

describe('入站：回复的是云小助的话才算叫它', () => {
  it('回云小助那句：叫它；回操作者从桌面发的那句：没叫', () => {
    expect(repliesToAgentIn(state, reply('m-agent'))).toBe(true)
    expect(repliesToAgentIn(state, reply('m-desk'))).toBe(false)
    expect(repliesToAgentIn(state, { ...reply('m-x'), param: { replyMsgId: 'm-x', replyRootMsgId: 'm-agent' } })).toBe(true)
  })
})

describe('桌面：回复键知道回的是谁', () => {
  it('两句都是「我们发的」，只有云小助那句是「云小助说的」', async () => {
    const messages = [
      { msgId: 'm-agent', content: '星期四', fromOpenId: 'op', msgType: 'text', sendTime: '2026-10-22 10:30:00.000', param: {} },
      { msgId: 'm-desk', content: '可以再加上日期吗', fromOpenId: 'op', msgType: 'text', sendTime: '2026-10-22 10:31:00.000', param: {} },
    ]
    const client = {
      messages: async () => messages,
      olderPage: async () => ({ messages: [], more: false }),
      usersByOpenId: async () => [],
    }
    const topics = new YzjTopicReader(
      {} as never, client as never, state, 'op', 'org',
      async () => '', async () => ({ ignited: false }), async () => ({ ignited: false }),
      () => true, [], async () => ({ served: true }) as never,
      await mkdtemp(join(tmpdir(), 'yzj-reply-ws-')),
      { of: () => ({ self: 'off', peers: [] }) as never, peers: () => [] },
    )
    const read = await topics.messagesInPlace('yzj-group-g-1')
    const flags = Object.fromEntries(read.map(message => [message.msgId, { own: message.own, agent: message.agent }]))
    expect(flags).toEqual({
      'm-agent': { own: true, agent: true },
      'm-desk': { own: true, agent: false },
    })
  })
})
