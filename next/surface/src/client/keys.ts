/**
 * 全站键盘 (界面重设计 §8 · 律八) —— 一张表、一条 Esc 链、一个返回。
 *
 * 各屏自己的键（卡上的数字、J/K、N）还住在各屏：它们要读那一屏的状态。这里只放跨屏的
 * 那几样：⌘K、`?`、Esc。Esc 只有一条链——关预览 › 取消选中 › 回到原处——由各屏登记
 * 「回到原处」去哪；各屏各写一个 Esc，就会有一下 Esc 同时关掉预览又退回上一屏。
 */

import { useEffect } from 'react'
import { closePreview, previewSnapshot } from './preview.ts'
import { currentJudgSelection, currentSpotlight, setJudgSelection, setSpotlight } from './store.ts'

export const KEYMAP: readonly { readonly keys: string; readonly does: string }[] = [
  { keys: '⌘K', does: '跳到群、人、文件、承诺、目标，或做一件事' },
  { keys: 'N', does: '下一件要你的，跨群也行' },
  { keys: '1  2  3', does: '回答当前这张卡——和在云之家里回 1 / 2 一样' },
  { keys: 'Z', does: '撤回刚才的回答（5 秒内）' },
  { keys: 'V', does: '并排看当前这张卡交的东西' },
  { keys: 'J  K', does: '下一个 / 上一个：卡、承诺行' },
  { keys: '⏎', does: '打开选中的那一行；逐条定的卡选满后一次定下' },
  { keys: '/', does: '到输入框' },
  { keys: '⌘.', does: '在输入框里换听众' },
  { keys: 'Esc', does: '关预览 › 取消选中 › 回到原处' },
  { keys: '?', does: '这张表' },
]

/** 正在打字：键是字，不是命令。 */
export function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  return node !== null && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(node.tagName))
}

/** 有一层盖在上面（选择条、规则面板、菜单）：Esc 归它自己。 */
function covered(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="menu"]') !== null
}

/* ——— 回到原处：每一屏登记自己的返回 ——— */

let back: (() => void) | undefined

/** 这一屏在台上时，Esc 的最后一步走它的返回。 */
export function useBackKey(fn: (() => void) | undefined): void {
  useEffect(() => {
    back = fn
    return () => { if (back === fn) back = undefined }
  }, [fn])
}

/** Esc 链：关预览 › 取消选中 › 回到原处。做了一件就停。 */
export function escape(): boolean {
  const preview = previewSnapshot()
  if (preview.target !== undefined && preview.stage === 'aside') { closePreview(); return true }
  if (currentSpotlight() !== undefined) { setSpotlight(undefined); return true }
  if (currentJudgSelection() !== undefined) { setJudgSelection(undefined); return true }
  if (back !== undefined) { back(); return true }
  return false
}

/* ——— ⌘K 与 `?` 那一层 ——— */

export type PaletteMode = 'closed' | 'search' | 'help' | 'auto'

let palette: PaletteMode = 'closed'
const paletteListeners = new Set<() => void>()

export function paletteMode(): PaletteMode {
  return palette
}

export function openPalette(mode: PaletteMode): void {
  if (palette === mode) return
  palette = mode
  for (const listener of paletteListeners) listener()
}

export function subscribePalette(listener: () => void): () => void {
  paletteListeners.add(listener)
  return () => { paletteListeners.delete(listener) }
}

/** 今天从哪一刻算起：本地的零点。 */
export function startOfToday(now: number = Date.now()): number {
  const day = new Date(now)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
}

/** 全站那几个键。装一次（⌘K 那一层挂上时）。 */
export function onGlobalKey(event: KeyboardEvent): void {
  if (event.isComposing || event.defaultPrevented) return
  if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
    event.preventDefault()
    openPalette(palette === 'search' ? 'closed' : 'search')
    return
  }
  if (palette !== 'closed') return
  if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || covered()) return
  if (event.key === '?') {
    event.preventDefault()
    openPalette('help')
    return
  }
  if (event.key === 'Escape' && escape()) event.preventDefault()
}
