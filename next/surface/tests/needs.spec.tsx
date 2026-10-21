// @vitest-environment jsdom
/**
 * 「要你」逐条 —— 界面重设计 律二 的规格。
 *
 * 锁的是三种安静的错：
 *
 * - **退化成待办清单**：把默认生效可纠的、信号层的也塞进来，人就得为每个默认值签一次
 *   字——「这不是帮我干活，是给我找事」（9/1）。所以只收阻塞层。
 * - **只说有几件，不说谁在等**：一条「要你」就是一个被你卡住的人。人执行的交付，等的是
 *   那个人；其余是 agent。
 * - **按新旧排**：最急的是快到期的、等得最久的，不是最新的。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  approvalCard, approvalFamily, createCommitmentCard, commitmentFamily, taskCard, taskFamily,
  waitingCard, waitingFamily, SIGNATURE_AGENT,
} from '@yzj-next/objects'
import type { TopicDescriptor } from '@yzj-next/channel'
import { inboxView } from '../src/rpc.ts'
import { YzjSidebar } from '../src/client/Sidebar.tsx'
import type { InboxView, SurfaceInject } from '../src/client/rpc.ts'
import { AGENT, plainError, turnErrorLine, waitLine } from '../src/client/words.ts'
import { currentLanding, landOn, setAnswering } from '../src/client/store.ts'

const TOPIC: TopicDescriptor = {
  topicKey: 'yzj-topic-a', sessionId: 'session-a', placeKey: 'yzj-group-g1', groupId: 'g1',
  groupName: '产品讨论群', topicRootId: 'root-a', label: '竞品对比表', generation: 1,
  conversationKind: 'group',
}

let ctx: Context
let graph: YzjGraph

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-needs-')) })
  for (const family of [approvalFamily, taskFamily, waitingFamily, commitmentFamily]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  const cards = new YzjCards(ctx)
  cards.register(approvalCard)
  cards.register(taskCard)
  cards.register(waitingCard)
  cards.register(createCommitmentCard(ctx))
  ctx.provide('yzjTopics', {
    topicOf: (id: string) => (id === TOPIC.sessionId ? TOPIC : undefined),
    tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
    messagesFor: async () => Promise.resolve([]),
    messagesInPlace: async () => Promise.resolve([]),
    sendToPlace: async () => Promise.resolve({}),
    conversations: () => [],
    markRead: () => undefined,
    aliases: () => ['@next'],
    presenceIn: () => ({ self: 'off' as const, peers: [] }),
    peers: () => [],
  })
})

const approval = async (id: string, sessionAnchor?: string): Promise<void> => {
  await graph.append({
    type: 'approval/opened',
    data: {
      approvalId: id, toolName: 'yzj_sheet_record_create', reason: `写入 · ${id}`, level: 'standard',
      args: {}, argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 600_000,
      ...(sessionAnchor === undefined ? { topicKey: TOPIC.topicKey } : { sessionAnchor }),
      placeKey: TOPIC.placeKey, audience: [TOPIC.placeKey],
    },
    actor: { kind: 'agent' },
  })
}

/** 李婷交了、等你验收——人执行的交付，等你的是她。 */
const humanDelivery = async (id: string, due?: string): Promise<void> => {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id, what: 'Q3 复盘材料初稿', sourceAnchor: `yzj:${id}`, topicKey: TOPIC.topicKey,
      executor: { kind: 'human', openId: 'p-lt', name: '李婷' }, ...(due === undefined ? {} : { due }),
    },
    actor: { kind: 'agent' },
  })
  await graph.append({
    type: 'commitment/delivered',
    data: { commitmentId: id, delivery: { claim: 'Q3 复盘材料初稿交了', at: Date.now() } },
    actor: { kind: 'agent' },
  })
}

describe('「要你」逐条：服务端投影', () => {
  it('只收阻塞层——在跑的承诺、等着别人的事都不进来', async () => {
    await approval('ap-1')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'cm-quiet', what: '张锐周五给数', sourceAnchor: 'yzj:m-3', topicKey: TOPIC.topicKey,
        executor: { kind: 'human', openId: 'p-9', name: '张锐' }, due: '2020-01-01',
      },
      actor: { kind: 'agent' },
    })
    await graph.append({
      type: 'waiting/opened',
      data: {
        waitingId: 'wt-1', what: '等财务给口径', kind: 'third-party', topicKey: TOPIC.topicKey,
        openedAt: Date.now(), scope: 's', placeKey: TOPIC.placeKey, audience: [TOPIC.placeKey],
      },
      actor: { kind: 'agent' },
    })
    const needs = inboxView(ctx).needs
    expect(needs.map(need => need.ref.id)).toEqual(['ap-1'])
    expect(needs[0]).toMatchObject({
      verb: '确认', label: '写入 · ap-1', where: '竞品对比表', placeName: '产品讨论群',
      sessionId: TOPIC.sessionId, waiting: SIGNATURE_AGENT,
    })
  })

  it('人执行的交付，等你的是那个人；动词是「验收」', async () => {
    await humanDelivery('cm-lt')
    const need = inboxView(ctx).needs[0]
    expect(need).toMatchObject({ verb: '验收', waiting: '李婷' })
  })

  it('快到期的排最前，其余等得越久越前——不按新旧', async () => {
    await approval('ap-old')
    await approval('ap-new')
    const soon = new Date(Date.now() + 3 * 60 * 60_000).toISOString()
    await humanDelivery('cm-soon', soon)
    expect(inboxView(ctx).needs.map(need => need.ref.id)).toEqual(['cm-soon', 'ap-old', 'ap-new'])
    // 屏上只写原话；解析只用来排序。
    expect(inboxView(ctx).needs[0]?.due).toEqual({ text: soon, ts: Date.parse(soon) })
  })

  it('本地会话里升起的确认也在，落点是那个会话', async () => {
    await approval('ap-local', 'session-local')
    expect(inboxView(ctx).needs[0]).toMatchObject({ sessionId: 'session-local', where: '本地会话' })
  })
})

describe('屏上的公共说法', () => {
  it('agent 在屏上的名字就是出站落款里的那个名字', () => {
    expect(AGENT).toBe(SIGNATURE_AGENT)
  })

  it('等了多久按人说话的粒度说；刚开口的不报「0 分钟」', () => {
    const now = 1_000_000_000
    expect(waitLine('李婷', now - 13 * 3_600_000, now)).toBe('李婷等你 13 小时')
    expect(waitLine(AGENT, now - 5 * 60_000, now)).toBe(`${AGENT}等你 5 分钟`)
    expect(waitLine(AGENT, now - 10_000, now)).toBe(`${AGENT}在等你`)
  })

  it('宿主的原始报错翻成人话，不贴 JSON', () => {
    const raw = 'yzj channel messages for 6a60 failed: {"error":{"code":10000429,"message":"API error: code=10000429, 请求过于频繁","subtype":"api_error","type":"api"},"identity":"user","success":false}'
    expect(plainError(raw)).toEqual({ text: '云之家暂时限流', retrying: true })
    expect(plainError('transport request failed: error decoding response body').retrying).toBe(true)
    // 已经是人话的原样放行：宿主的拒绝理由是写给人看的。
    expect(plainError('这条承诺已经完成了，不能再顺延').text).toBe('这条承诺已经完成了，不能再顺延')
  })

  it('一轮没答完：模型的错不说成云之家的错，每句都带下一步', () => {
    expect(turnErrorLine('llm-pi-ai: request timed out after 10000ms')).toBe(`${AGENT}这一轮没连上模型，没答完——再说一句会重试。`)
    expect(turnErrorLine('llm-pi-ai: 429 Too Many Requests')).toContain('模型那边正忙')
    expect(turnErrorLine('401 Unauthorized: invalid api key')).toContain('钥匙不对')
    // 3090 实测的原话：钥匙从没填过，不是填错了。
    expect(turnErrorLine('llm-pi-ai: no credential for provider route "grok"; its profile resolves GROK_API_KEY, which is not set'))
      .toBe(`还没填模型的钥匙，${AGENT}这一轮没答完——到设置里填一下。`)
    expect(turnErrorLine('Error: maximum context length exceeded')).toContain('新话题')
    expect(turnErrorLine('AbortError: aborted')).toBe('这一轮停下了。')
    const odd = turnErrorLine('llm-pi-ai: Error: something odd happened in the provider adapter layer today')
    expect(odd).toContain('something odd')
    expect(odd).not.toContain('llm-pi-ai')
    expect(turnErrorLine('')).toBe(`${AGENT}这一轮没答完——再说一句会重试。`)
  })
})

/* ——— 左栏：逐条、谁在等、N 键 ——— */

const NOW = Date.now()
const VIEW: InboxView = {
  needs: [
    {
      ref: { kind: 'approval', id: 'ap-1' }, sessionId: 'session-a', verb: '确认', label: '写入 12 条到竞品对比表',
      where: '竞品对比表', placeName: '产品讨论群', since: NOW - 5 * 60_000, waiting: AGENT,
    },
    {
      ref: { kind: 'commitment', id: 'cm-lt' }, sessionId: 'session-b', verb: '验收', label: 'Q3 复盘材料初稿',
      where: '李婷', since: NOW - 13 * 3_600_000, waiting: '李婷',
    },
  ],
  running: [],
  counts: { confirm: 1, review: 1, running: 0 },
  firstOf: {},
  places: [],
  topicSessionIds: ['session-a', 'session-b'],
  commitments: { open: 3, overdue: 1, toAssess: 0 },
  conversations: [],
}

describe('左栏「要你」', () => {
  let host: HTMLDivElement
  let root: Root
  const opened: string[] = []

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe(): void {} disconnect(): void {} }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    opened.length = 0
  })
  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    landOn(undefined)
    setAnswering([])
    vi.useRealTimers()
  })

  const mount = async (
    sessions: { ids: string[]; byId: Record<string, { displayTitle?: string; running?: boolean; updatedAt?: number }> } = { ids: [], byId: {} },
    view: InboxView = VIEW,
  ): Promise<void> => {
    const inject = new Proxy({}, {
      get: (_target, name) => async () => Promise.resolve(name === 'inbox' ? view : undefined),
    }) as SurfaceInject
    await act(async () => {
      root.render(
        <YzjSidebar
          inject={inject}
          useSessions={selector => selector({ ...sessions, current: 'session-z' })}
          open={(id) => { opened.push(id) }}
          startSession={() => undefined}
          sessionActions={{ rename: async () => Promise.resolve() }}
          workspaces={{ items: [] }}
        />,
      )
      await Promise.resolve()
    })
  }

  it('每一条：动词在前、事情在后，第二行写谁在等', async () => {
    await mount()
    const rows = [...host.querySelectorAll('section[aria-label="要你"] button')].map(row => row.textContent)
    expect(rows[0]).toContain('确认写入 12 条到竞品对比表')
    expect(rows[0]).toContain(`${AGENT}等你 5 分钟`)
    expect(rows[1]).toContain('验收Q3 复盘材料初稿')
    expect(rows[1]).toContain('李婷等你 13 小时')
  })

  it('点一条，落在那张卡上', async () => {
    await mount()
    const row = host.querySelector('section[aria-label="要你"] button')
    act(() => { (row as HTMLButtonElement).click() })
    expect(opened).toEqual(['session-a'])
    expect(currentLanding()).toEqual({ sessionId: 'session-a', kind: 'approval', id: 'ap-1' })
  })

  it('N 跨群跳到下一件——连按是一件件往下走', async () => {
    await mount()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' })) })
    expect(opened).toEqual(['session-a'])
    expect(currentLanding()?.id).toBe('ap-1')
  })

  it('输入框里按 N 是在打字，不是跳转', async () => {
    await mount()
    const box = document.createElement('textarea')
    document.body.append(box)
    act(() => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true })) })
    expect(opened).toEqual([])
    box.remove()
  })

  it('本地会话在跑一回合，也在「运行中」——不报它不知道的时长', async () => {
    await mount({
      ids: ['local-1', 'local-2', 'session-a'],
      byId: {
        'local-1': { displayTitle: '整理周报', running: true, updatedAt: Date.now() },
        'local-2': { displayTitle: '没在跑的', running: false, updatedAt: Date.now() },
        // 话题会话归图上的活管，不在这里重复列。
        'session-a': { displayTitle: '竞品对比', running: true, updatedAt: Date.now() },
      },
    })
    const rows = [...host.querySelectorAll('section[aria-label="运行中"] button')].map(row => row.textContent ?? '')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('整理周报')
    expect(rows[0]).toContain('本地 · 在跑')
    expect(rows[0]).not.toMatch(/在跑 \d/u)
  })

  it('活开着、却没有一回合在跑：说「停着」，不转圈', async () => {
    const since = Date.now() - 11 * 3_600_000
    await mount(
      { ids: ['session-a'], byId: { 'session-a': { displayTitle: '查知识库', running: false, updatedAt: since } } },
      { ...VIEW, running: [{ sessionId: 'session-a', title: '帮我看下我有哪些知识库', placeName: 'dsh-2', since }] },
    )
    const section = host.querySelector('section[aria-label="运行中"]')
    expect(section?.textContent).toContain('停着 · 11 小时没动')
    expect(section?.querySelector('[aria-label="在跑"], [aria-label="可能卡住了"]')).toBeNull()
    expect(section?.querySelector('[aria-label="停着"]')).not.toBeNull()
  })

  it('撤回窗里答过的那件，立刻不在「要你」里', async () => {
    await mount()
    act(() => { setAnswering([{ kind: 'approval', id: 'ap-1' }]) })
    const rows = [...host.querySelectorAll('section[aria-label="要你"] button')].map(row => row.textContent)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('Q3 复盘材料初稿')
  })
})
