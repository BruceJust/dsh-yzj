// @vitest-environment jsdom
/**
 * 对象面账本律 —— **右栏 = f(当前会话, tab)** (分册 v2.2 断言㉙㉚).
 *
 * 右栏没有自己的身份：它是当前会话的物的投影，切会话即整体重算。这一份盯四件事：
 *
 * - **账本随会话整体切换**，靠**路由分派**而不是条件过滤——过滤器会被绕过，分派
 *   不会：组织侧右栏的组件树里根本没有私账组件，它**画不出来**。
 * - **残留面 = 第四泄漏口**：选中态切离私账**即毁非隐藏**，切回是默认态。
 * - **三 tab 归属恒定**：资源那一格在两个账本里是**同一个组件**。
 * - **回真身 = 会话级导航**，不是在这一栏里就地打开组织侧的活视图。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjRightColumn } from '../src/client/RightColumn.tsx'
import {
  currentVaultSelection, popFrame, pushFrame, setFrame, setVaultSelection,
} from '../src/client/store.ts'
import type { SurfaceInject } from '../src/client/rpc.ts'

function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => { createRoot(container).render(node) })
  return container
}

function fakeInject(calls: string[]): SurfaceInject {
  return {
    objects: async (sessionId?: string) => {
      calls.push(`objects:${sessionId ?? ''}`)
      return {
        current: [],
        memory: [],
        resources: [{ uri: 'https://yzj.example/doc/a', title: '组织侧的一份材料', action: '产出', placeKey: 'g1', time: 1 }],
      }
    },
    vaultEvidence: async (kind?: string, id?: string) => {
      calls.push(`evidence:${kind ?? ''}:${id ?? ''}`)
      return {
        title: id === undefined ? '这条预期的出处' : `这条判例的证据（${id}）`,
        rows: [{
          text: '竞品对比表',
          at: '2026-09-01T04:53:10.890Z',
          anchor: { kind: 'commitment', id: 'c-1' },
          premise: 'live' as const,
        }],
        note: '备料不定案——归因那一格由你自己下。',
      }
    },
    objectPreview: async (kind: string, id: string) => {
      calls.push(`preview:${kind}:${id}`)
      return { alive: true, title: '竞品对比表', lines: ['状态：closed'], sessionId: 'ses-1' }
    },
  } as unknown as SurfaceInject
}

beforeEach(() => {
  document.body.innerHTML = ''
  setFrame({ kind: 'session' })
  setVaultSelection(undefined)
})

describe('㉙ 账本随会话整体切换 · 残留面 = 第四泄漏口', () => {
  it('组织侧右栏的**整棵**组件树里没有一个私账组件 —— 分派，不是过滤', async () => {
    /*
      **过滤器会被绕过，分派不会**（PTD-25 同款刀法）。

      有人给右栏加一个新字段、忘了补一条 `if`，私账内容就上了组织侧的屏；而
      `ObjectFace` 根本 import 不到私账组件，它**画不出来**。

      这一条走**传递闭包**，不是一跳：初稿扫的是一张手写的四个文件的清单，于是
      `ObjectFace` 新引一个自己带私账的邻居时，这条断言不会红——**一个覆盖面会
      随代码增长而缩小的守卫，是在替未来的违规做掩护**。
    */
    const dir = join(process.cwd(), 'next/surface/src/client/')
    const seen = new Set<string>()
    const queue = ['ObjectFace.tsx']
    const PRIVATE = /^(Vault|VaultObjectFace|VaultContract|PrivateCard)/
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (seen.has(file)) continue
      seen.add(file)
      // 私账组件出现在闭包里即红——报出的是**文件名本身**，好让人一眼看见是谁引进来的。
      expect({ inOrgTree: file }).not.toMatchObject({ inOrgTree: expect.stringMatching(PRIVATE) })
      const source = await readFile(`${dir}${file}`, 'utf8')
      for (const match of source.matchAll(/from '\.\/([\w.]+)'/g)) {
        const name = match[1] as string
        if (name.endsWith('.css')) continue
        queue.push(name.endsWith('.tsx') || name.endsWith('.ts') ? name : `${name}.tsx`)
      }
    }
    // 闭包要真的走出去过——否则「零命中」可能只是因为一步都没走。
    expect(seen.size).toBeGreaterThan(3)
    expect(seen).toContain('ResourceTab.tsx')
  })

  it('资源那一格两侧是**同一个模块**，不是两份长得像的实现', async () => {
    /*
      「跨账本恒定格」如果靠两份代码各自保持一致，它就只是**暂时**一致。

      所以这一条断的是 import：两棵树引的必须是同一个文件。
    */
    const dir = join(process.cwd(), 'next/surface/src/client/')
    for (const file of ['ObjectFace.tsx', 'VaultObjectFace.tsx']) {
      const source = await readFile(`${dir}${file}`, 'utf8')
      expect(source).toContain("from './ResourceTab.tsx'")
    }
  })

  it('切离私账即毁：右栏零私账内容，切回是默认态而不是上次选中', async () => {
    const calls: string[] = []
    setFrame({ kind: 'vault' })
    setVaultSelection({ kind: 'calibration', id: 'cal-9' })
    const root = render(<YzjRightColumn inject={fakeInject(calls)} openSession={() => {}} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(root.textContent).toContain('这条判例的证据（cal-9）')

    // 切到任意组织侧会话：右栏整体换树，私账内容一个字都不剩。
    act(() => { setFrame({ kind: 'session' }) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(root.textContent).not.toContain('cal-9')
    expect(root.textContent).not.toContain('竞品对比表')
    /*
      **即毁，不是隐藏**：选中态本身没了。

      不做「切回恢复上次选中」的贴心——在私账域，**便利与泄漏常常是同一个实现**。
    */
    expect(currentVaultSelection()).toBeUndefined()

    act(() => { setFrame({ kind: 'vault' }) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    // 切回 = 默认态（待对表首项备料）重新出发。
    expect(root.textContent).toContain('这条预期的出处')
    expect(root.textContent).not.toContain('cal-9')
  })

  it('每一条离开金库的路都过同一个销毁点 —— push / pop / set 三条都算', () => {
    /*
      **换账本只有一处机械时刻**，这条断言把它钉住。

      `setFrame` 里那一行清选中态之所以够用，前提是**没有第二条换 frame 的路**：
      `pushFrame` 与 `popFrame` 都在自己内部调 `setFrame`。哪天有人加一条绕过去的
      捷径，这一条会红——而不是等到某次投屏时被人看见。
    */
    const routes: { name: string; enter(): void; leave(): void }[] = [
      {
        name: 'setFrame 直接切走',
        enter: () => { setFrame({ kind: 'vault' }) },
        leave: () => { setFrame({ kind: 'session' }) },
      },
      {
        name: 'pushFrame 压进别的 frame',
        enter: () => { setFrame({ kind: 'vault' }) },
        leave: () => { pushFrame({ kind: 'board' }, 0) },
      },
      {
        // 从会话推进金库，再弹回去——`popFrame` 是**第三条**换 frame 的路。
        name: 'popFrame 弹回来路',
        enter: () => { setFrame({ kind: 'session' }); pushFrame({ kind: 'vault' }, 0) },
        leave: () => { popFrame() },
      },
    ]
    for (const route of routes) {
      route.enter()
      setVaultSelection({ kind: 'calibration', id: 'cal-x' })
      expect({ route: route.name, held: currentVaultSelection() !== undefined })
        .toEqual({ route: route.name, held: true })
      route.leave()
      expect({ route: route.name, held: currentVaultSelection() !== undefined })
        .toEqual({ route: route.name, held: false })
    }
  })

  it('三 tab：资源是跨账本恒定格，两个账本里渲染的是同一个组件', async () => {
    const calls: string[] = []
    setFrame({ kind: 'vault' })
    const root = render(<YzjRightColumn inject={fakeInject(calls)} openSession={() => {}} />)
    await act(async () => { await Promise.resolve() })
    for (const label of ['当前', '记忆', '资源']) expect(root.textContent).toContain(label)

    // 记忆那一格在金库语境里永远为空，而且说清为什么。
    const memory = [...root.querySelectorAll('button')].find(one => one.textContent?.startsWith('记忆'))
    await act(async () => { (memory as HTMLButtonElement).click() })
    expect(root.textContent).toContain('永远为空')
    expect(root.textContent).toContain('永不入记忆库')

    // 资源那一格读的是**不带会话**的那一次查询 —— 组织侧的全局浏览器。
    const resources = [...root.querySelectorAll('button')].find(one => one.textContent?.startsWith('资源'))
    await act(async () => { (resources as HTMLButtonElement).click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(calls).toContain('objects:')
    expect(root.textContent).toContain('组织侧的一份材料')
    // 单向可见：私账语境看得见组织的物；反过来永远不成立。
    expect(root.textContent).toContain('单向可见')
  })

  it('回真身是会话级导航 —— 不在这一栏里就地打开组织侧的活视图', async () => {
    const calls: string[] = []
    const opened: string[] = []
    setFrame({ kind: 'vault' })
    const root = render(
      <YzjRightColumn inject={fakeInject(calls)} openSession={(id) => { opened.push(id) }} />,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const jump = [...root.querySelectorAll('button')].find(one => one.textContent?.startsWith('回真身'))
    expect(jump).toBeDefined()
    await act(async () => { (jump as HTMLButtonElement).click() })
    /*
      一跳 = **整屏换账本**。面板内嵌打开真身 = 在私账的屏幕里长出组织侧的活视图，
      那是账本混排的第一步，禁。
    */
    expect(opened).toEqual(['ses-1'])
  })
})
