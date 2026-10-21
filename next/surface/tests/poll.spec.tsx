// @vitest-environment jsdom
/**
 * 一个刷新器 (界面重设计 P5 · §5.8).
 *
 * - **有人在看 5 秒，后台 30 秒**；本来就慢的面（会前那一眼）一直 30 秒。
 * - **上一次没回来，不排下一次**：慢的那次不会被下一次追尾。
 * - **停下就是停下**：`active` 为假、卸下之后不再刷。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_MS, VISIBLE_MS, pollEvery, usePoll } from '../src/client/poll.ts'

function Probe(props: { refresh: () => unknown; active?: boolean; slow?: boolean }): null {
  usePoll(props.refresh, { active: props.active, slow: props.slow })
  return null
}

describe('pollEvery', () => {
  it('前台 5 秒、后台 30 秒，慢面一直 30 秒', () => {
    expect(pollEvery(false)).toBe(VISIBLE_MS)
    expect(pollEvery(true)).toBe(HIDDEN_MS)
    expect(pollEvery(false, true)).toBe(HIDDEN_MS)
    expect(VISIBLE_MS).toBe(5_000)
    expect(HIDDEN_MS).toBe(30_000)
  })
})

let root: Root | undefined

function render(node: React.ReactNode): { unmount: () => void } {
  const host = document.createElement('div')
  document.body.append(host)
  const mounted = createRoot(host)
  root = mounted
  act(() => { mounted.render(node) })
  return { unmount: () => { act(() => { mounted.unmount() }); root = undefined } }
}

describe('usePoll', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
  })
  afterEach(() => {
    if (root !== undefined) { const mounted = root; act(() => { mounted.unmount() }); root = undefined }
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('挂上立刻一次，之后每 5 秒一次；卸下就停', async () => {
    const refresh = vi.fn(async () => undefined)
    const view = render(<Probe refresh={refresh} />)
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(VISIBLE_MS) })
    expect(refresh).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(VISIBLE_MS * 3) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('上一次没回来，不排下一次', async () => {
    let finish: () => void = () => undefined
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<Probe refresh={refresh} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(VISIBLE_MS * 4) })
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(VISIBLE_MS) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('active 为假时一次也不刷', async () => {
    const refresh = vi.fn(async () => undefined)
    render(<Probe refresh={refresh} active={false} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(HIDDEN_MS) })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('慢面 30 秒一次', async () => {
    const refresh = vi.fn(async () => undefined)
    render(<Probe refresh={refresh} slow />)
    await act(async () => { await vi.advanceTimersByTimeAsync(VISIBLE_MS * 2) })
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(HIDDEN_MS) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
