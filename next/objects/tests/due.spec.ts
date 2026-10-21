/**
 * 原话期限 → 时刻 (律五「时间以原话为真身」)。
 *
 * 锚点是说出口的那一刻；认不出就不给时刻。实测 3090 上的期限：「下周五」×56、「周五 18:00」、
 * 「2026-09-05」——此前 `Date.parse` 只认得最后一种，又把「8/20」读成 2001 年。
 */

import { describe, expect, it } from 'vitest'
import { isPastDue, resolveDue } from '../src/commitment/due.ts'

/** 2026-10-21 周三 10:00（本地）。 */
const SAID = new Date(2026, 9, 21, 10, 0).getTime()
const endOf = (year: number, month: number, date: number): number => new Date(year, month - 1, date + 1).getTime() - 1
const at = (year: number, month: number, date: number, hour: number, minute = 0): number => new Date(year, month - 1, date, hour, minute).getTime()

describe('resolveDue', () => {
  it('3090 上真实出现的说法', () => {
    expect(resolveDue('下周五', SAID)).toBe(endOf(2026, 10, 30))
    expect(resolveDue('周五 18:00', SAID)).toBe(at(2026, 10, 23, 18))
    expect(resolveDue('2026-09-05', SAID)).toBe(endOf(2026, 9, 5))
  })

  it('机器写的完整时刻原样采用', () => {
    expect(resolveDue('2026-10-21T13:00:00.000Z', SAID)).toBe(Date.parse('2026-10-21T13:00:00.000Z'))
  })

  it('「8/20」是今年的 8 月 20 日，不是 2001 年', () => {
    expect(resolveDue('8/20', SAID)).toBe(endOf(2026, 8, 20))
    // 十二月底说「1/5」，说的是明年。
    expect(resolveDue('1/5', new Date(2026, 11, 28).getTime())).toBe(endOf(2027, 1, 5))
  })

  it('相对说法以说出口的那天为准', () => {
    expect(resolveDue('明天下班前', SAID)).toBe(at(2026, 10, 22, 18))
    expect(resolveDue('今晚', SAID)).toBe(endOf(2026, 10, 21))
    expect(resolveDue('后天', SAID)).toBe(endOf(2026, 10, 23))
    expect(resolveDue('25号', SAID)).toBe(endOf(2026, 10, 25))
    expect(resolveDue('20号', SAID)).toBe(endOf(2026, 11, 20))
    expect(resolveDue('3天内', SAID)).toBe(endOf(2026, 10, 24))
    expect(resolveDue('5日内', SAID)).toBe(endOf(2026, 10, 26))
    expect(resolveDue('月底', SAID)).toBe(endOf(2026, 10, 31))
    expect(resolveDue('下周', SAID)).toBe(endOf(2026, 11, 1))
    expect(resolveDue('10月30日下午3点', SAID)).toBe(at(2026, 10, 30, 15))
    expect(resolveDue('下班前', SAID)).toBe(at(2026, 10, 21, 18))
  })

  it('周几：已经过去的这一周几，说的是下一个', () => {
    expect(resolveDue('周一', SAID)).toBe(endOf(2026, 10, 26))
    expect(resolveDue('周五前', SAID)).toBe(endOf(2026, 10, 23))
    expect(resolveDue('周日', SAID)).toBe(endOf(2026, 10, 25))
  })

  it('认不出的不给时刻，也就不算逾期', () => {
    for (const vague of ['尽快', '有空的时候', '', '下个版本']) expect(resolveDue(vague, SAID)).toBeUndefined()
    expect(isPastDue('尽快', SAID, SAID + 365 * 86_400_000)).toBe(false)
    expect(isPastDue(undefined, SAID, SAID)).toBe(false)
  })

  it('过没过期：按截止时刻比', () => {
    expect(isPastDue('明天下班前', SAID, at(2026, 10, 22, 17, 59))).toBe(false)
    expect(isPastDue('明天下班前', SAID, at(2026, 10, 22, 18, 1))).toBe(true)
  })
})
