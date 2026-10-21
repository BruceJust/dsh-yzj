/**
 * 原话里的期限 → 一个时刻 (律五「时间以原话为真身」)。
 *
 * 期限照人说出口的样子存、照原话上屏（「明天下班前」「下周五」「8/20」）。这里只回答一件
 * 事：它什么时候算过期、和别的期限谁先谁后。锚点是**这句话说出口的那一刻**——「明天」是
 * 说的那天的明天，不是今天的明天。
 *
 * 宁空勿错：认不出就不给时刻。认不出的期限不算逾期、不参与「越近越先」，原话照样显示。
 *
 * 不用 `Date.parse`：它把「8/20」读成 2001 年 8 月 20 日（那一条从此永远逾期、永远排第一），
 * 又读不懂「下周五」——实测 3090 上的期限大半就是这么说的。
 */

const DAY = 24 * 60 * 60 * 1000

const WEEKDAY: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 末: 7,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
}

/** 那一天的本地零点。 */
function dayStart(at: number): Date {
  const day = new Date(at)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate())
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days)
}

/** 一天之中的截止时刻：说了几点就几点，「下班前」是 18 点，没说就是那天结束。 */
function timeOf(text: string): { readonly hour: number; readonly minute: number } | undefined {
  const clock = /(\d{1,2})[:：](\d{2})/u.exec(text)
  const pm = /下午|晚上|今晚|明晚|傍晚/u.test(text)
  if (clock !== null) {
    const hour = Number(clock[1])
    return { hour: pm && hour < 12 ? hour + 12 : hour, minute: Number(clock[2]) }
  }
  const spoken = /(\d{1,2})\s*点(半)?/u.exec(text)
  if (spoken !== null) {
    const hour = Number(spoken[1])
    return { hour: pm && hour < 12 ? hour + 12 : hour, minute: spoken[2] === undefined ? 0 : 30 }
  }
  if (/下班/u.test(text)) return { hour: 18, minute: 0 }
  if (/中午|午饭|上午/u.test(text)) return { hour: 12, minute: 0 }
  if (/早上|明早|今早/u.test(text)) return { hour: 10, minute: 0 }
  if (/下午/u.test(text)) return { hour: 18, minute: 0 }
  return undefined
}

/** 说的是哪一天。认不出返回 undefined。 */
function dayOf(text: string, anchor: number): Date | undefined {
  const today = dayStart(anchor)

  const full = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/u.exec(text)
  if (full !== null) return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]))

  const monthDay = /(\d{1,2})\s*[/月.-]\s*(\d{1,2})\s*[日号]?/u.exec(text)
  if (monthDay !== null) {
    const month = Number(monthDay[1]) - 1
    const date = Number(monthDay[2])
    if (month < 0 || month > 11 || date < 1 || date > 31) return undefined
    const sameYear = new Date(today.getFullYear(), month, date)
    // 十二月底说「1/5」，说的是明年。离得近的过去日期照实算（说了就是那天，过了就是逾期）。
    return today.getTime() - sameYear.getTime() > 180 * DAY
      ? new Date(today.getFullYear() + 1, month, date)
      : sameYear
  }

  const within = /(\d{1,3})\s*(?:个)?\s*(天|日|周|星期|礼拜)\s*(?:内|后|之内|以内)/u.exec(text)
  if (within !== null) {
    const count = Number(within[1])
    return addDays(today, within[2] === '天' || within[2] === '日' ? count : count * 7)
  }

  const dateOnly = /(\d{1,2})\s*[号日]/u.exec(text)
  if (dateOnly !== null) {
    const date = Number(dateOnly[1])
    if (date < 1 || date > 31) return undefined
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), date)
    return thisMonth < today ? new Date(today.getFullYear(), today.getMonth() + 1, date) : thisMonth
  }

  if (/大后天/u.test(text)) return addDays(today, 3)
  if (/后天/u.test(text)) return addDays(today, 2)
  if (/明天|明日|明早|明晚/u.test(text)) return addDays(today, 1)
  if (/今天|今日|今晚|今早|今儿/u.test(text)) return today

  // 周从周一算起。getDay：周日 = 0。
  const monday = addDays(today, -((today.getDay() + 6) % 7))
  const weekday = /(下下|下个?|这个?|本)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天末1-7])/u.exec(text)
  if (weekday !== null) {
    const which = WEEKDAY[weekday[2] ?? ''] ?? 7
    const ahead = weekday[1]?.startsWith('下下') === true ? 2 : weekday[1]?.startsWith('下') === true ? 1 : 0
    const day = addDays(monday, ahead * 7 + which - 1)
    // 周六说「周五前」，说的是下一个周五。
    return ahead === 0 && day < today ? addDays(day, 7) : day
  }
  if (/下下(?:个)?(?:周|星期|礼拜)/u.test(text)) return addDays(monday, 20)
  if (/下(?:个)?(?:周|星期|礼拜)/u.test(text)) return addDays(monday, 13)
  if (/(?:这|本)(?:个)?(?:周|星期|礼拜)/u.test(text)) return addDays(monday, 6)

  if (/下(?:个)?月底/u.test(text)) return new Date(today.getFullYear(), today.getMonth() + 2, 0)
  if (/月底|月末/u.test(text)) return new Date(today.getFullYear(), today.getMonth() + 1, 0)
  if (/年底|年末/u.test(text)) return new Date(today.getFullYear(), 11, 31)

  // 只说了「下班前」「今晚」这类时刻：那就是当天。
  if (timeOf(text) !== undefined) return today
  return undefined
}

/**
 * 原话期限对应的截止时刻（毫秒）。`anchor` 是这句话说出口的时刻。
 * 认不出返回 undefined——宁空勿错。
 */
export function resolveDue(spoken: string | undefined, anchor: number): number | undefined {
  const text = (spoken ?? '').trim()
  if (text === '' || !Number.isFinite(anchor)) return undefined
  // 机器写的完整时刻（带时分、可能带时区）：那就是它本身。
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/u.test(text)) {
    const exact = Date.parse(text)
    return Number.isFinite(exact) ? exact : undefined
  }
  const day = dayOf(text, anchor)
  if (day === undefined || Number.isNaN(day.getTime())) return undefined
  const time = timeOf(text)
  return time === undefined
    ? addDays(day, 1).getTime() - 1
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute).getTime()
}

/** 原话期限是不是已经过了。认不出的不算逾期。 */
export function isPastDue(spoken: string | undefined, anchor: number, now: number): boolean {
  const at = resolveDue(spoken, anchor)
  return at !== undefined && at < now
}
