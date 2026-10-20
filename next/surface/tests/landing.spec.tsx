// @vitest-environment jsdom
/**
 * 带着卡进来的，落在卡上 —— 中栏这一头 (v4.14 逐级兑付的最后一跳).
 *
 * 2026-10-20 桌面实测：点「待验收」进了话题，落在最后一条消息上，验收按钮在第一条。
 * 服务端那一半（卡排在它发问的地方、落点带着卡）在 decision.spec；这里跑真的中栏：
 * 窗口画出来之后，那张卡被滚到视野中央、闪一下，落点被取走，之后不再被拽回底部。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YzjConversationColumn } from '../src/client/ConversationColumn.tsx'
import type { FusedWindowWire, StreamCard, SurfaceInject } from '../src/client/rpc.ts'
import { currentLanding, landOn } from '../src/client/store.ts'

const CARD: StreamCard = {
  kind: 'task', id: 'tk-1', resolved: false, at: 9_000, seq: 9,
  state: { taskId: 'tk-1', what: '整理回款', status: 'terminal', summary: '交了' },
  demand: { layer: 'blocking', mode: 'two-verb-acceptance', label: '交了', badge: '待验收' },
  actions: [{ id: 'accept', label: '验收', needsInput: false, available: true }],
}

function windowWith(cards: StreamCard[]): FusedWindowWire {
  return {
    messages: [1_000, 9_500, 12_000].map(time => ({
      msgId: `m-${String(time)}`, fromOpenId: 'p-9', fromName: '张锐', content: `第 ${String(time)} 毫秒那句`,
      msgType: 'text', time, own: false,
    })),
    chips: [], cards, artifacts: [],
  }
}

/** 中栏只用得到 inject 的一小部分；其余一律「没有」。 */
function injectFor(window_: FusedWindowWire): SurfaceInject {
  const known: Record<string, unknown> = { fused: window_, model: {} }
  return new Proxy({}, {
    get: (_target, name) => async () => Promise.resolve(known[String(name)]),
  }) as SurfaceInject
}

/**
 * 宿主给的快照是稳定的引用。假的若每次返回 undefined，`?? []` 每一帧都是新数组，流跟着
 * 每一帧重算——「落点变了才落」这件事就被掩盖成了「每一帧都落」。
 */
const SNAPSHOT = { nodes: [], running: false } as const

let host: HTMLElement
let root: Root
let scrolled: Element[]

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  scrolled = []
  // jsdom 不排版，也就没有 scrollIntoView 和 ResizeObserver。记下滚到了谁。
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this) }
  globalThis.ResizeObserver ??= class {
    observe(): void { /* 不排版就没有尺寸可报 */ }
    unobserve(): void { /* 同上 */ }
    disconnect(): void { /* 同上 */ }
  }
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  landOn(undefined)
})

async function mount(sessionId: string, window_: FusedWindowWire): Promise<void> {
  await act(async () => {
    root.render(
      <YzjConversationColumn
        sessionId={sessionId}
        useSession={selector => selector(SNAPSHOT)}
        inject={injectFor(window_)}
        prompt={async () => Promise.resolve(undefined)}
        openSession={() => undefined}
        openDetails={() => undefined}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 40))
  })
}

const cardNode = (): Element | undefined => [...host.querySelectorAll('[data-card]')]
  .find(node => node.getAttribute('data-card') === 'task:tk-1')

describe('中栏的落点', () => {
  it('带着卡进来：窗口画出来之后滚到那张卡、闪一下，落点被取走', async () => {
    landOn({ sessionId: 's-1', kind: 'task', id: 'tk-1' })
    await mount('s-1', windowWith([CARD]))
    expect(cardNode()).toBeDefined()
    expect(scrolled).toEqual([cardNode()])
    expect(cardNode()?.getAttribute('data-flash')).toBe('1')
    expect(currentLanding()).toBeUndefined()
  })

  it('已经站在这个话题里，再点一次「待验收」也落过去——会话 id 没变，落点自己会说', async () => {
    await mount('s-1', windowWith([CARD]))
    expect(scrolled).toEqual([])
    await act(async () => { landOn({ sessionId: 's-1', kind: 'task', id: 'tk-1' }) })
    expect(scrolled).toEqual([cardNode()])
  })

  it('不带卡进来的，不去碰任何一张卡', async () => {
    await mount('s-1', windowWith([CARD]))
    expect(scrolled).toEqual([])
  })

  it('落点是别的会话的：不在这里兑现，也不在这里丢掉', async () => {
    landOn({ sessionId: 's-2', kind: 'task', id: 'tk-1' })
    await mount('s-1', windowWith([CARD]))
    expect(scrolled).toEqual([])
    expect(currentLanding()).toEqual({ sessionId: 's-2', kind: 'task', id: 'tk-1' })
  })

  it('窗口画出来了那张卡却不在：说一声，不留一个永远兑现不了的落点', async () => {
    landOn({ sessionId: 's-1', kind: 'task', id: 'tk-gone' })
    await mount('s-1', windowWith([CARD]))
    expect(scrolled).toEqual([])
    expect(currentLanding()).toBeUndefined()
    expect(host.textContent).toContain('等你的那张卡不在这个话题里了')
  })
})
