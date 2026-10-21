/**
 * 账 (界面重设计 P4 · 律五 · §5.4).
 *
 * 两件安静地错的事：
 *
 * - **「说交了」冒充「交了」**：一句「发了」和一份能打开的文件在板上长得一样，人就会
 *   验收一份没见过的东西。证据要分档，而且分档只能从图上推，不能由谁去填。
 * - **原话被改写**：来龙去脉里的「怎么来的」必须是那条消息本身；找不回来就说找不回来，
 *   不拿整理过的 `what` 冒充原话。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { createCommitmentCard, commitmentFamily, taskFamily } from '@yzj-next/objects'
import { boardFrame, commitmentStory, evidenceOf } from '../src/rpc.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const TOPIC = { topicKey: 'tk-1', sessionId: 'sess-1', label: '竞品对比', groupName: '产品讨论群', placeKey: 'yzj-group-g1', groupId: 'g1' }

let ctx: Context
let graph: YzjGraph

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-ledger-')) })
  graph.defineFamily(commitmentFamily)
  graph.defineFamily(taskFamily)
  await graph.selectAccount('acct-1')
  const cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  cards.setDesktopActor({ kind: 'operator', openId: 'op-1' }, '我')
  ctx.provide('yzjTopics', {
    tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
    topicOf: () => TOPIC,
    aliases: () => ['@next'],
    presenceIn: () => ({ self: 'off' as const, peers: [] }),
    peers: () => [],
    conversations: () => [],
    messagesFor: async () => Promise.resolve([
      { msgId: 'm-born', fromOpenId: 'op-1', fromName: '我', content: '张锐，竞品对比表明天给我', msgType: 'text', time: 1_000, own: false },
    ]),
  } as never)
})

async function owed(id: string, anchor = `yzj:m-born`, executor: Record<string, string> = { kind: 'human', openId: 'u-zr', name: '张锐' }): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id, what: '竞品对比表', topicKey: TOPIC.topicKey,
      executor,
      sourceAnchor: anchor, due: '明天', delegatedBy: 'op-1',
    },
    actor: OPERATOR,
  })
}

async function delivered(id: string, claim: string): Promise<void> {
  await graph.append({
    type: 'commitment/delivered',
    data: { commitmentId: id, delivery: { claim, at: Date.now() } },
    actor: { kind: 'person', openId: 'u-zr' },
  })
}

const rowOf = (id: string) => boardFrame(ctx).rows.find(row => row.id === id)

describe('证据三档', () => {
  it('从没被碰过的不分档——它的信号是「没动静」', async () => {
    await owed('c-1')
    expect(rowOf('c-1')?.evidence).toBeUndefined()
  })

  it('只说了「发了」：话那一档', async () => {
    await owed('c-2')
    await delivered('c-2', '发群里了')
    expect(rowOf('c-2')).toMatchObject({ awaitingAcceptance: true, evidence: 'said' })
  })

  it('交付里带着链接：东西那一档', async () => {
    await owed('c-3')
    await delivered('c-3', '在这 https://www.yunzhijia.com/doc/abc')
    expect(rowOf('c-3')?.evidence).toBe('artifact')
  })

  it('它的话题在登记之后有了产出：只在云小助就是交的那双手时算东西', async () => {
    const produced = (uri: string) => graph.append({
      type: 'lineage/produced',
      data: { topicKey: TOPIC.topicKey, artifact: { uri, title: '竞品对比表', kind: 'doc', placeKey: TOPIC.placeKey }, action: '新建' },
      actor: { kind: 'agent' },
    })
    // 活归云小助：它在这个话题里写出来的，就是它交的。
    await owed('c-4', 'yzj:m-born', { kind: 'agent', topicKey: TOPIC.topicKey })
    await delivered('c-4', '好了')
    await produced('yzj://doc/1')
    expect(rowOf('c-4')?.evidence).toBe('artifact')
    // 张锐欠我的：云小助在同一个话题里写了一份，不等于张锐交了——他说的「好了」仍只是话。
    await owed('c-4b')
    await delivered('c-4b', '好了')
    await produced('yzj://doc/1b')
    expect(rowOf('c-4b')?.evidence).toBe('said')
  })

  it('平台自己记的压过一切；终态不分档', () => {
    expect(evidenceOf({ open: true, touched: true, platform: true, claim: '', artifactAfter: true })).toBe('platform')
    expect(evidenceOf({ open: false, touched: true, platform: false, claim: '发了', artifactAfter: false })).toBeUndefined()
  })
})

describe('来龙去脉', () => {
  it('怎么来的 = 那条消息本身：谁说的、什么时候、在哪', async () => {
    await owed('c-5')
    const story = await commitmentStory(ctx, 'c-5')
    expect(story?.birth).toMatchObject({ said: '张锐，竞品对比表明天给我', by: '我', at: 1_000, where: '产品讨论群' })
    expect(story?.due?.text).toBe('明天')
  })

  it('原话找不回来就不给，不拿整理过的 what 冒充', async () => {
    await owed('c-6', 'yzj:m-gone')
    const story = await commitmentStory(ctx, 'c-6')
    expect(story?.birth.said).toBeUndefined()
    expect(story?.birth.where).toBe('产品讨论群')
  })

  it('之后：每一笔标上证据档——说交了是话，产出是东西，系统记账不算证据', async () => {
    await owed('c-7')
    await graph.append({ type: 'commitment/updated', data: { commitmentId: 'c-7', notified: 'failed' }, actor: { kind: 'system' } })
    await delivered('c-7', '发了')
    await graph.append({
      type: 'lineage/produced',
      data: { topicKey: TOPIC.topicKey, artifact: { uri: 'yzj://doc/2', title: '对比表 v2', kind: 'doc', placeKey: TOPIC.placeKey }, action: '新建' },
      actor: { kind: 'agent' },
    })
    const story = await commitmentStory(ctx, 'c-7')
    expect(story?.steps.map(step => [step.grade, step.text])).toEqual([
      ['note', '登记的消息没发到对方那里——对方可能不知道'],
      ['said', '说交了：发了'],
      // 说清做了什么：「新建《对比表 v2》」，不是笼统的「产出」。
      ['artifact', '新建《对比表 v2》'],
    ])
  })

  it('在承诺板上登记的，说「承诺板」', async () => {
    await owed('c-8', 'desktop:board')
    expect((await commitmentStory(ctx, 'c-8'))?.birth.where).toBe('承诺页')
  })
})
