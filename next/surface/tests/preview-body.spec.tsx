// @vitest-environment jsdom
/**
 * 预览里画出来的那一块 —— 文件预览实测（2026-10-21）发现的几处，钉成规格。
 *
 * - 画不了的说为什么、门就在那句话下面；不把内部缓存路径当答案（律一）。
 * - 截过的文本，不管画成哪种样子都说截了。
 * - 带脚本的网页先说「只画出静态的样子」，免得人以为原件坏了。
 * - 沉浸时只有字按阅读宽收窄；图、网页、表格给整个框。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactPreview } from '../src/client/PreviewPanel.tsx'
import { rememberAttachment, type PreviewTarget } from '../src/client/preview.ts'
import type { AttachmentBodyWire, SurfaceInject } from '../src/client/rpc.ts'

let root: Root | undefined
let host: HTMLElement | undefined

const saveAttachment = vi.fn(async () => ({ savedTo: '/Users/me/Downloads/模板.xlsx' }))
const inject = {
  attachment: vi.fn(async () => undefined),
  saveAttachment,
} as unknown as SurfaceInject

function show(title: string, body: AttachmentBodyWire, stage: 'aside' | 'immersive' = 'aside'): HTMLElement {
  const fileId = `f-${title}`
  rememberAttachment(fileId, body)
  const target: PreviewTarget = { key: `att:${fileId}`, title, fileId, origin: 'im' }
  host = document.createElement('div')
  document.body.append(host)
  const mounted = createRoot(host)
  root = mounted
  act(() => { mounted.render(<ArtifactPreview target={target} stage={stage} inject={inject} />) })
  return host
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  saveAttachment.mockClear()
})

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  host?.remove()
  root = undefined
})

describe('画不了的', () => {
  it('说为什么，门就在下面；屏上没有缓存路径', async () => {
    const view = show('模板.xlsx', { kind: 'binary', why: 'Excel 表格这里看不了' })
    expect(view.textContent).toContain('Excel 表格这里看不了。')
    expect(view.textContent).not.toMatch(/attachments|\.dsh-next|已经取到本地/u)
    const door = [...view.querySelectorAll('button')].find(button => button.textContent === '下载到本机')
    expect(door).toBeDefined()
    await act(async () => { door?.click() })
    expect(saveAttachment).toHaveBeenCalledWith('f-模板.xlsx', '模板.xlsx')
    expect(view.textContent).toContain('已下载到：/Users/me/Downloads/模板.xlsx')
  })
})

describe('截过的、带脚本的', () => {
  it('md 截了也说截了——不只纯文本那一路说', () => {
    const view = show('长文.md', { kind: 'text', text: '# 头', size: 300_000, clipped: true })
    expect(view.querySelector('iframe')).not.toBeNull()
    expect(view.textContent).toContain('太长了，只显示了前面一段')
  })

  it('带脚本的网页先说只画出静态的样子', () => {
    const view = show('proto.html', { kind: 'text', text: '<script>x()</script>', size: 20, clipped: false, scripted: true })
    expect(view.textContent).toContain('这页带脚本，这里只画出静态的样子')
    expect(view.querySelector('iframe')?.getAttribute('sandbox')).toBe('')
  })

  it('不带脚本的网页不多说一句', () => {
    const view = show('a.html', { kind: 'text', text: '<p>静态</p>', size: 12, clipped: false })
    expect(view.textContent).not.toContain('带脚本')
  })
})

describe('沉浸的宽度', () => {
  it('字按阅读宽；图和网页给整个框', () => {
    const md = show('a.md', { kind: 'text', text: '# 头', size: 4, clipped: false }, 'immersive')
    const mdBody = md.querySelector('iframe')?.parentElement
    act(() => { root?.unmount() }); root = undefined
    const page = show('b.html', { kind: 'text', text: '<p/>', size: 4, clipped: false }, 'immersive')
    const pageBody = page.querySelector('iframe')?.parentElement
    expect(mdBody?.className.split(' ')).toHaveLength(1)
    expect(pageBody?.className.split(' ')).toHaveLength(2)
  })

  it('沉浸与退出用图标，不用字符记号', () => {
    const view = show('c.md', { kind: 'text', text: 'x', size: 1, clipped: false })
    expect(view.textContent).not.toMatch(/[⤢⤡]/u)
    expect(view.querySelector('button[title^="沉浸阅读"] svg')).not.toBeNull()
  })
})
