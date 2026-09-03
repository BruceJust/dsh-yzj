/**
 * 零新场所（决策 #64）在桌面上的形状：私条长在裁决卡下、「我的判断」是承诺板的第三取景框、
 * 右栏账本律、D10 一个开关管整层、组织侧右栏组件树里没有私账组件（分派，不是过滤）。
 */

// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { commitmentFamily, createCommitmentCard, taskFamily, waitingFamily } from '@yzj-next/objects'
import { YzjPledger, createDesk, fileVerdict, pledge } from '@yzj-next/pledger'
import { applySurfaceRpc, boardFrame, cardsFor, fusedWindow } from '../src/rpc.ts'
import { YzjJudg } from '../src/client/Judg.tsx'
import { YzjRightColumn } from '../src/client/RightColumn.tsx'
import { currentJudgSelection, popFrame, pushFrame, setFrame, setJudgSelection } from '../src/client/store.ts'
import type { SurfaceInject } from '../src/client/rpc.ts'

/** 渲染成文本再断言——和 v2 的 tsx 用例同一把尺。 */
async function rendered(node: React.ReactNode): Promise<string> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(node); await new Promise(resolve => setTimeout(resolve, 40)) })
  return host.textContent ?? ''
}

const OPERATOR = { kind: 'operator' as const, openId: 'op-1' }
const TOPIC = 'yzj-topic-1'
let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let pledger: YzjPledger

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-judg-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: join(root, 'graph') })
  for (const family of [commitmentFamily, taskFamily, waitingFamily]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  cards.setDesktopActor(OPERATOR, '我')
  pledger = new YzjPledger(ctx, { root: join(root, 'pledger') })
  await pledger.open('op-1')
  ctx.provide('yzjPledgerDesk', createDesk(ctx))
  ctx.on('yzj-cards/verdict-settled', (payload) => { void fileVerdict(ctx, payload) })
  ctx.provide('yzjTopics', {
    tree: () => [{ place: { placeKey: 'yzj-group-g1', groupName: '群' }, topics: [TOPIC_DESCRIPTOR] }],
    topicOf: (sessionId: string) => (sessionId === TOPIC_DESCRIPTOR.sessionId ? TOPIC_DESCRIPTOR : undefined),
    aliases: () => ['@next'],
    conversations: () => [],
    peers: () => [],
    presenceIn: () => ({ self: 'off' as const, peers: [] }),
    messagesFor: async () => Promise.resolve([]),
  })
  setFrame({ kind: 'session' })
  setJudgSelection(undefined)
})

const TOPIC_DESCRIPTOR = {
  topicKey: TOPIC, sessionId: 'session-yzj-next-1', placeKey: 'yzj-group-g1', groupId: 'g1', groupName: '群',
  topicRootId: 'r', label: '竞品对比', generation: 1, conversationKind: 'group' as const,
}

async function accepted(id = 'cmt-1'): Promise<void> {
  await graph.append({ type: 'commitment/opened', data: { commitmentId: id, what: '竞品对比 · 评审表', executor: { kind: 'agent', topicKey: TOPIC }, sourceAnchor: `yzj:${id}`, topicKey: TOPIC, idemKey: `cmt:${id}` }, actor: OPERATOR })
  await graph.append({ type: 'commitment/delivered', data: { commitmentId: id, delivery: { claim: '交付了', at: Date.now() } }, actor: { kind: 'agent' } })
  await cards.act({ kind: 'commitment', id }, 'accept', OPERATOR, 'desktop')
  await new Promise(resolve => setTimeout(resolve, 20))
}

describe('私条长在裁决卡下（接缝⑤）', () => {
  it('押过之后，那张卡的 strips 里有一条押；文本投影里没有', async () => {
    await accepted()
    await pledge(ctx, { topicKey: TOPIC, text: '明早一次过' })
    const card = cardsFor(ctx, TOPIC_DESCRIPTOR).find(one => one.id === 'cmt-1')
    expect(card?.strips?.map(strip => strip.kind)).toEqual(['pledge'])
    expect(cards.renderText({ kind: 'commitment', id: 'cmt-1' })?.body).not.toContain('明早一次过')
  })

  it('发现路 = 占位文字：最近裁决没押过时会话窗带 privateHint，押过就没有', async () => {
    await accepted()
    applySurfaceRpc(ctx, 20)
    expect((await fusedWindow(ctx, TOPIC_DESCRIPTOR.sessionId, 20)).privateHint).toContain('押：')
    await pledge(ctx, { topicKey: TOPIC, text: 'x' })
    expect((await fusedWindow(ctx, TOPIC_DESCRIPTOR.sessionId, 20)).privateHint).toBeUndefined()
  })
})

describe('「我的判断」= 承诺板的第三取景框', () => {
  it('板上带「我裁决的」入口；晨报行只在你定了那句之后有数', async () => {
    applySurfaceRpc(ctx, 20)
    expect(boardFrame(ctx).judgEntry).toBe(true)
    expect(boardFrame(ctx).judgMorning).toBeUndefined()
    const desk = ctx.get('yzjPledgerDesk')
    await desk?.setClause('morning')
    expect(boardFrame(ctx).judgMorning).toBe(0)
  })

  it('D10 隐身档：整层不在——入口不画、私条不长、晨报行不出', async () => {
    await accepted()
    await pledge(ctx, { topicKey: TOPIC, text: 'CANARY' })
    applySurfaceRpc(ctx, 20, true)
    expect(boardFrame(ctx).judgEntry).toBeUndefined()
    expect(cardsFor(ctx, TOPIC_DESCRIPTOR).find(one => one.id === 'cmt-1')?.strips).toBeUndefined()
    expect((await fusedWindow(ctx, TOPIC_DESCRIPTOR.sessionId, 20)).privateHint).toBeUndefined()
    applySurfaceRpc(ctx, 20, false)
    expect(cardsFor(ctx, TOPIC_DESCRIPTOR).find(one => one.id === 'cmt-1')?.strips).toHaveLength(1)
  })
})

describe('账本律：右栏 = f(当前会话, tab)', () => {
  it('组织侧右栏组件树的 import 闭包里没有私账组件——分派，不是过滤', () => {
    const client = join(__dirname, '..', 'src', 'client')
    const PRIVATE = /^(Judg|JudgObjectFace|JudgContract)\.tsx$/u
    const seen = new Set<string>()
    const walk = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      const source = readFileSync(join(client, file), 'utf8')
      for (const match of source.matchAll(/from '\.\/([^']+)'/gu)) {
        const next = match[1] ?? ''
        if (/\.(tsx|ts)$/u.test(next)) walk(next)
      }
    }
    walk('ObjectFace.tsx')
    expect([...seen].filter(file => PRIVATE.test(file))).toEqual([])
    expect(readFileSync(join(client, 'RightColumn.tsx'), 'utf8')).toContain("frame.kind === 'judg'")
    void dirname
  })

  it('切离「我的判断」即毁选中态：push / pop / set 三条路都算', () => {
    setFrame({ kind: 'session' })
    pushFrame({ kind: 'judg' }, 0)
    setJudgSelection({ kind: 'calibration', id: 'c-1' })
    popFrame()
    expect(currentJudgSelection()).toBeUndefined()
    setFrame({ kind: 'judg' })
    setJudgSelection({ kind: 'calibration', id: 'c-2' })
    setFrame({ kind: 'board' })
    expect(currentJudgSelection()).toBeUndefined()
  })
})

describe('取景框渲染：组头是原料，不是分数', () => {
  it('组头写「没被推翻」不写「成立」；空态说清押是你的动词', async () => {
    await accepted()
    const inject = {
      judg: async () => {
        const desk = ctx.get('yzjPledgerDesk')
        const view = desk?.judg()
        return view === undefined ? undefined : { ...view, destroyPhrase: desk?.destroyPhrase ?? '' }
      },
      judgEvidence: async () => undefined,
      objectPreview: async () => undefined,
      objects: async () => undefined,
      markSeen: async () => undefined,
      judgExport: async () => undefined,
    } as unknown as SurfaceInject
    const text = await rendered(<YzjJudg inject={inject} back={() => undefined} />)
    expect(text).toContain('没被推翻')
    expect(text).not.toContain('成立')
    expect(text).toContain('没有分数、没有排名、没有别人的账')
    setFrame({ kind: 'judg' })
    expect(await rendered(<YzjRightColumn inject={inject} />)).toContain('当时的样子')
  })
})
