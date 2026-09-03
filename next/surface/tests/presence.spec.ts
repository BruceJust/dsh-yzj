/**
 * 在岗图景上桌面 (决策 #63)：锚定条在按下之前说清由谁接单；合同面板说清本实例的范围与
 * 同侪的声明；板在多实例下如实说明镜像行（P1.5 已物化）。
 *
 * 每一格都从通道的同一个谓词读，不在桌面这一侧再算一遍——两处算出两个答案的那一天，
 * 桌面就是撒谎的那一个。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { commitmentFamily, taskFamily, waitingFamily } from '@yzj-next/objects'
import type { PresenceView } from '@yzj-next/channel'
import { boardFrame, contractView, placeView } from '../src/rpc.ts'

const PLACE = 'yzj-group-g1'
let ctx: Context
let presence: PresenceView
let peers: { openId: string; name: string; lastSeen: number }[]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-presence-surface-'))
  ctx = new Context()
  const graph = new YzjGraph(ctx, { root })
  for (const family of [commitmentFamily, taskFamily, waitingFamily]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  new YzjCards(ctx)
  presence = { self: 'off', peers: [] }
  peers = []
  ctx.provide('yzjTopics', {
    tree: () => [],
    topicOf: () => undefined,
    aliases: () => ['@next'],
    conversations: () => [{
      groupId: 'g1', placeKey: PLACE, name: '830 项目', type: 2, kind: 'group',
      lastMsgTime: 1, preview: '', unread: 0, onDuty: false, selfChat: false,
    }],
    messagesInPlace: async () => Promise.resolve([]),
    markRead: () => undefined,
    presenceIn: () => presence,
    peers: () => peers,
  })
})

describe('群视图：锚定条的材料', () => {
  it('本实例不在岗、同侪对群在岗：视图带着它——锚定条才说得出「由谁接单」', async () => {
    presence = { self: 'off', peers: [{ openId: 'op-zhang', name: '张三', since: 1 }] }
    const view = await placeView(ctx, PLACE, 20)
    expect(view.onDuty).toBe(false)
    expect(view.presence?.peers.map(peer => peer.name)).toEqual(['张三'])
  })

  it('私聊没有在岗图景：对端唯一，无歧义', async () => {
    const view = await placeView(ctx, 'yzj-dm-d1', 20)
    expect(view.presence).toBeUndefined()
  })
})

describe('合同面板：范围与同侪', () => {
  it('对群在岗而声明帖没发出去，面板拿得到这个事实（selfAnchor 缺席）', () => {
    presence = { self: 'all', peers: [] }
    const view = contractView(ctx, PLACE)
    expect(view.presence).toEqual({ self: 'all', peers: [] })
  })

  it('仅本人：不声明、不算在岗，面板照实说', () => {
    presence = { self: 'self', peers: [{ openId: 'op-zhang', name: '张三', since: 1 }] }
    expect(contractView(ctx, PLACE).presence?.self).toBe('self')
  })
})

describe('合同面板：「我的 agent 为什么没接」可从让位账作答', () => {
  it('这个场所的让位按时间倒序，带着让给了谁、静默还是有帖', async () => {
    await ctx.yzjGraph.append({
      type: 'presence/yielded',
      data: { placeKey: PLACE, triggerAnchor: 'yzj:m-1', reason: 'speaker-instance', toOperatorOpenId: 'op-zhang' },
      actor: { kind: 'system' },
    })
    await ctx.yzjGraph.append({
      type: 'presence/yielded',
      data: { placeKey: PLACE, triggerAnchor: 'yzj:m-2', reason: 'ack-order', toOperatorOpenId: 'op-zhang', retractAnchor: 'y-1' },
      actor: { kind: 'system' },
    })
    await ctx.yzjGraph.append({
      type: 'presence/yielded',
      data: { placeKey: 'yzj-group-elsewhere', triggerAnchor: 'yzj:m-3', reason: 'presence' },
      actor: { kind: 'system' },
    })
    const view = contractView(ctx, PLACE)
    expect(view.yields.map(item => [item.reason, item.to, item.loud])).toEqual([
      ['ack-order', 'op-zhang', true],
      ['speaker-instance', 'op-zhang', false],
    ])
  })
})

describe('承诺板：P1 明标降级', () => {
  it('没有观察到同侪实例时，板上没有那句话——它只在多实例部署下出现', () => {
    expect(boardFrame(ctx).mirrorNote).toBeUndefined()
  })

  it('观察到同侪实例：板如实说镜像行是滞后镜像、只看不改，并点名是谁的真身不在这里', () => {
    peers = [{ openId: 'op-zhang', name: '张三', lastSeen: 1 }]
    const note = boardFrame(ctx).mirrorNote
    expect(note).toContain('镜像')
    expect(note).toContain('云小助（张三）')
  })
})
