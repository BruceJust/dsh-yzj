/**
 * 一个刷新器 (界面重设计 §5.8) —— 有人在看的面 5 秒刷一次，窗口在后台 30 秒一次。
 *
 * 云之家没有推送，看到的新鲜度全靠轮询。各面各写一个 `setInterval`，节奏就各是各的：
 * 左栏 5 秒、承诺 6 秒、会前那一眼 30 秒——同一件事在三处变化的时刻错开，人看到的是
 * 「这里已经验收了，那里还说等你」。窗口切到后台还照常 5 秒一次，是在替没人看的屏烧
 * 云之家的限流额度。
 *
 * 所以只有一处定节奏：上一次回来了才排下一次（慢的那次不会被下一次追尾），回到前台时
 * 立刻补一次，然后按前台的拍子走。
 */

import { useEffect } from 'react'

export const VISIBLE_MS = 5_000
export const HIDDEN_MS = 30_000

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/** 此刻该隔多久再刷一次。`slow` 给本来就不必勤刷的面（比如会前那一眼）。 */
export function pollEvery(isHidden: boolean, slow = false): number {
  if (isHidden) return HIDDEN_MS
  return slow ? HIDDEN_MS : VISIBLE_MS
}

/**
 * 挂着就刷：立刻一次，之后按拍子；回到前台立刻补一次。`active` 为假时整个停下。
 * `refresh` 变了（换了会话、换了目标）就从头来。
 */
export function usePoll(refresh: () => unknown, options: { readonly active?: boolean; readonly slow?: boolean } = {}): void {
  const { active = true, slow = false } = options
  useEffect(() => {
    if (!active) return undefined
    let alive = true
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      if (!alive || running) return
      timer = undefined
      running = true
      let pending: unknown
      try { pending = refresh() } catch { pending = undefined }
      void Promise.resolve(pending)
        .catch(() => undefined)
        .finally(() => {
          running = false
          if (alive) timer = setTimeout(tick, pollEvery(hidden(), slow))
        })
    }
    const onVisible = (): void => {
      if (hidden() || running) return
      if (timer !== undefined) clearTimeout(timer)
      tick()
    }
    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, active, slow])
}

/**
 * 一次没读成的窗，不许抹掉上次读到的话 (§5.8 读不到 ≠ 没有)。
 *
 * 服务端读云之家失败时回 `messages: []` 加一句 `staleReason`。照单全收，屏上那条「读不到」
 * 底下就是一片空白——人看到的是话被删了。所以：同一处、这一次没读成、上一次读到过，就
 * 留着上一次的话，`kept` 告诉说明条该说「下面是上次读到的」。有意不取的（演示中的自聊）
 * 不留：留着就是把要藏的东西又摆回去。
 */
export function keepLastMessages<T extends {
  readonly messages: readonly unknown[]
  readonly staleReason?: string
  readonly withheld?: boolean
}>(previous: T | undefined, next: T): T & { readonly kept?: true } {
  if (previous === undefined || next.staleReason === undefined || next.withheld === true) return next
  if (next.messages.length > 0 || previous.messages.length === 0) return next
  return { ...next, messages: previous.messages, kept: true }
}
