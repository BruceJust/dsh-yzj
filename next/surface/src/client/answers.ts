/**
 * 撤回窗 —— 每一次回答先「待生效」5 秒 (界面重设计 律七).
 *
 * 键盘作答带来速度，速度带来按错；而图上的回答是追加的、会投到云之家、会触发真的写入。
 * 所以回答先停在**本机**：卡立刻收成一行、「要你」立刻少一件，按 `Z` 能撤回；5 秒后才
 * 真的落账。撤回窗里撤回的回答**在图上什么都没留下**——它从来没有离开过这台机器。
 *
 * 和「先答先赢」的关系：窗里的回答还不是回答。这 5 秒里别处（云之家、DM）先答了，就以
 * 别处为准——那张卡轮询回来已经是答过的，这里静静地丢掉本机那一份，吸收行写明是在哪答的。
 *
 * 页面在窗里关掉时，`pagehide` 把待生效的立刻提交：人按下去的那一刻意思已经表达了，
 * 悄悄丢掉它比晚 5 秒生效坏得多。
 */

import { setAnswering } from './store.ts'

export const UNDO_MS = 5_000

/** 一次回答：一张卡上的一笔或几笔（逐条裁决「定下这 N 处」是一窗多笔）。 */
export interface Answer {
  readonly kind: string
  readonly id: string
  readonly steps: readonly { readonly actionId: string; readonly input?: string; readonly dwellMs?: number }[]
  /** 吸收行上的那句话，用人的话说你做了什么：「你确认了 · 写入 12 条…」。 */
  readonly said: string
}

export interface Staged extends Answer {
  readonly deadline: number
  /** 已经在往图上写了——这时候撤不回了，但卡也不该先弹回「要你」。 */
  readonly landing: boolean
}

/** 真的落账。由作答的那一处给：它拿着通道，也知道落完要刷新什么。 */
export type Commit = (answer: Answer) => Promise<void>

let staged: readonly Staged[] = []
const commits = new Map<string, Commit>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

const keyOf = (ref: { readonly kind: string; readonly id: string }): string => `${ref.kind}:${ref.id}`

function publish(next: readonly Staged[]): void {
  staged = next
  // 左栏、浮动指针读的是地址：它们只需要知道「这件已经答了」。
  setAnswering(next.map(entry => ({ kind: entry.kind, id: entry.id })))
  for (const listener of listeners) listener()
}

export function stagedNow(): readonly Staged[] {
  return staged
}

export function subscribeStaged(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function stagedOf(ref: { readonly kind: string; readonly id: string }): Staged | undefined {
  return staged.find(entry => entry.kind === ref.kind && entry.id === ref.id)
}

/** 答一件：进窗，5 秒后落账。同一张卡在窗里再按一次不算第二次回答。 */
export function stage(answer: Answer, commit: Commit, now = Date.now()): void {
  const key = keyOf(answer)
  if (commits.has(key)) return
  install()
  commits.set(key, commit)
  timers.set(key, setTimeout(() => { void land(key) }, UNDO_MS))
  publish([...staged, { ...answer, deadline: now + UNDO_MS, landing: false }])
}

async function land(key: string): Promise<void> {
  const entry = staged.find(one => keyOf(one) === key)
  const commit = commits.get(key)
  clearTimeout(timers.get(key))
  timers.delete(key)
  if (entry === undefined || commit === undefined || entry.landing) return
  publish(staged.map(one => (keyOf(one) === key ? { ...one, landing: true } : one)))
  try {
    await commit(entry)
  } finally {
    commits.delete(key)
    publish(staged.filter(one => keyOf(one) !== key))
  }
}

/** 撤回。已经在落账的撤不回——那一刻它已经离开这台机器了。 */
export function undo(ref: { readonly kind: string; readonly id: string }): boolean {
  const key = keyOf(ref)
  const entry = staged.find(one => keyOf(one) === key)
  if (entry === undefined || entry.landing) return false
  clearTimeout(timers.get(key))
  timers.delete(key)
  commits.delete(key)
  publish(staged.filter(one => keyOf(one) !== key))
  return true
}

/** `Z`：撤回最近答的那一件。 */
export function undoLatest(): Staged | undefined {
  const latest = [...staged].reverse().find(one => !one.landing)
  if (latest === undefined) return undefined
  return undo(latest) ? latest : undefined
}

/**
 * 别处先答了：本机这一份不再提交。
 *
 * 不是撤回——人没有改主意，只是有人更快。吸收行会照着图上那一次写「在云之家里答的」。
 */
export function dropAnsweredElsewhere(resolved: readonly { readonly kind: string; readonly id: string }[]): void {
  const gone = new Set(resolved.map(keyOf))
  const lost = staged.filter(one => !one.landing && gone.has(keyOf(one)))
  if (lost.length === 0) return
  for (const one of lost) {
    const key = keyOf(one)
    clearTimeout(timers.get(key))
    timers.delete(key)
    commits.delete(key)
  }
  publish(staged.filter(one => !lost.includes(one)))
}

/** 立刻落账全部（页面要走了）。 */
export function flushAnswers(): void {
  for (const one of staged) void land(keyOf(one))
}

let installed = false

/** `Z` 与 `pagehide` 只装一次，第一次有人作答时才装。 */
function install(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('pagehide', flushAnswers)
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'z' && event.key !== 'Z') return
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
    const target = event.target as HTMLElement | null
    if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return
    if (undoLatest() !== undefined) event.preventDefault()
  })
}

/** 测试用：回到没人答过的样子。 */
export function resetAnswers(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  commits.clear()
  publish([])
}

/* ——— 卡上的键：数字答、V 看 —— 哪张卡是「当前」的由中栏定，卡只管自己怎么答 ——— */

/** 一张卡交出来的键盘入口。返回 true = 这个键它认了。 */
export type CardKeys = (key: string) => boolean

const cardKeys = new Map<string, CardKeys>()

export function registerCardKeys(anchor: string, handler: CardKeys): () => void {
  cardKeys.set(anchor, handler)
  return () => { if (cardKeys.get(anchor) === handler) cardKeys.delete(anchor) }
}

export function pressOnCard(anchor: string, key: string): boolean {
  return cardKeys.get(anchor)?.(key) ?? false
}
