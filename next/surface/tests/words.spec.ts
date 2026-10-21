/**
 * 回执说人话 (§5.8 · 律一)。
 *
 * 卡服务的回执是写给云之家那一头的：「⚠️ 已于 10/21 10:02 在云之家由 op-1a2b 选择「approve」
 * 并执行，本次应答未生效。」——账号 id 和动作 id 原样上屏，人读不懂。
 */

import { describe, expect, it } from 'vitest'
import { dueDayText, receiptLine } from '../src/client/words.ts'

describe('receiptLine', () => {
  it('别处先答了：说别处先答了，不贴账号 id 和动作 id', () => {
    const line = receiptLine({ outcome: 'superseded', receipt: '⚠️ 已于 2026/10/21 10:02:00 在云之家由 op-1a2b 选择「approve」并执行，本次应答未生效。' }, '')
    expect(line).toBe('别处已经先答了，这次没生效——卡上写着是谁、在哪答的。')
    expect(line).not.toMatch(/op-|approve/u)
  })

  it('不归你定、重复按、状态变了，各说各的', () => {
    expect(receiptLine({ outcome: 'unauthorized', receipt: '你不是这张卡的决策人，本次应答已记录但未生效。' }, '')).toBe('这件不归你定，这次没生效。')
    expect(receiptLine({ outcome: 'duplicate', receipt: '…' }, '')).toBe('已经按你的选择办过了。')
    expect(receiptLine({ outcome: 'superseded', receipt: '这张卡当前状态不接受「收回」，本次应答已记录但未生效。' }, '')).toBe('这张卡现在不接受这个回答了，这次没生效。')
  })

  it('通道那头的错照人话说；什么都没有就用调用方给的那句', () => {
    expect(receiptLine({ outcome: 'failed', receipt: '工作台这边没响应，再试一次。' }, '没收回来')).toBe('工作台这边没响应，再试一次。')
    expect(receiptLine(undefined, '没收回来，再试一次。')).toBe('没收回来，再试一次。')
  })
})

describe('dueDayText', () => {
  // 2026-10-21 周三 10:00
  const NOW = new Date(2026, 9, 21, 10, 0).getTime()
  const endOf = (m: number, d: number): number => new Date(2026, m - 1, d + 1).getTime() - 1

  it('近的说今天、明天、后天、周几；远的写日子；说了几点就带上', () => {
    expect(dueDayText(endOf(10, 21), NOW)).toBe('今天')
    expect(dueDayText(new Date(2026, 9, 22, 18, 0).getTime(), NOW)).toBe('明天 18:00')
    expect(dueDayText(endOf(10, 23), NOW)).toBe('后天')
    expect(dueDayText(endOf(10, 24), NOW)).toBe('周六')
    expect(dueDayText(endOf(10, 30), NOW)).toBe('10/30 周五')
  })
})
