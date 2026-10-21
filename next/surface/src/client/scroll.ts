/**
 * 回到离开时的位置 —— 「返回」的全部承诺 (D13②)。
 *
 * 等内容长够了再设：一屏刚挂上时列表还没读回来，此刻设下的位置会被静静地钳到当时的
 * 最大值（通常是 0），人回来就在顶上。最多等两秒，之后滚动归人。
 */

import { useEffect, useRef, type RefObject } from 'react'

export function useRestoreScroll(ref: RefObject<HTMLElement | null>, restoreScroll: number | undefined): void {
  const restored = useRef(false)
  useEffect(() => {
    if (restoreScroll === undefined || restored.current) return undefined
    const node = ref.current
    if (node === null) return undefined
    let done = false
    let tick: ReturnType<typeof setTimeout> | undefined
    const attempt = (): void => {
      if (done) return
      if (node.scrollHeight - node.clientHeight >= restoreScroll) {
        node.scrollTop = restoreScroll
        restored.current = true
        done = true
        return
      }
      tick = setTimeout(attempt, 60)
    }
    attempt()
    const giveUp = setTimeout(() => { done = true }, 2_000)
    return () => {
      done = true
      if (tick !== undefined) clearTimeout(tick)
      clearTimeout(giveUp)
    }
  }, [ref, restoreScroll])
}
