/**
 * 一条承诺此刻怎么读 —— 承诺页与目标页共用的那几条判断 (界面重设计 §5.4 · 律五).
 *
 * 一行只亮一个信号，一行最多一个颜色；今天条的数从同一个判断里数出来。两页各算一遍，
 * 迟早有一页说「逾期」而另一页说「等你」。
 */

import type { BoardEventWire, BoardRowWire } from './rpc.ts'
import { AGENT, dueDayText } from './words.ts'

const SOON_MS = 36 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000
/** 多久没动静才算不对劲——和服务端判「过时」的 `STALE_MS` 同一个三天。 */
const QUIET_MS = 3 * DAY_MS

/** 「多久没动了」的人话。刻意粗：只到天/小时——精确的数字会让人以为它精确。 */
export function sinceText(at: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 60) return '刚刚'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时`
  return `${String(Math.floor(hours / 24))} 天`
}

/**
 * 催一下的拟稿 —— 一句能直接发出去的话：带上当初那件事和那句原话期限，不替人定调。
 */
export function nudgeDraft(row: { what: string; due?: { text: string }; overdue: boolean }): string {
  const said = row.due?.text?.trim() ?? ''
  const when = said === ''
    ? ''
    : row.overdue ? `（当时说的是${said}，已经过了）` : `（当时说的是${said}）`
  return `问一下「${row.what}」这条现在到哪一步了${when}`
}

/** 一条结束了的，结束在什么上。转手和作废分开说：一个是黄了，一个是换人了。 */
export function settledLabel(row: { status: string; transferredTo?: string }): string {
  if (row.status === 'closed') return '完成了'
  if (row.status === 'voided') return '作废了'
  if (row.status === 'merged') return '合并了'
  if (row.status === 'transferred') return row.transferredTo === undefined ? '转手了' : `转给了${row.transferredTo}`
  return row.status
}

/* ——— 一行一个信号 ——— */

export type SignalKey = 'wait' | 'said' | 'late' | 'declined' | 'unheard' | 'quiet' | 'soon' | 'doing' | 'normal' | 'done'

export interface RowSignal {
  readonly key: SignalKey
  readonly text: string
  /** 只有 late 和 need 上色；其余都是墨色。一行最多一个颜色。 */
  readonly tone: 'late' | 'need' | 'warn' | 'quiet'
}

/** 这条现在等的是不是你：验收人是你（服务端在你就是验收人时不发 `acceptor`），且归你管。 */
export const onMe = (row: BoardRowWire): boolean => row.acceptor === undefined && row.stewardedBy === undefined

/**
 * 这一行静态时只亮的那一个信号。
 *
 * 顺序就是律五那条：逾期 › 等你 › 说交了没见到 › 没动静 › 快到期 › 在做 › 正常——只有
 * 一处改动：**交了的、等你验收的排在逾期前面**。对方已经交了，球在你这边；再说「逾期」
 * 是在催一个已经交了的人。
 */
export function signalOf(row: BoardRowWire, now: number = Date.now()): RowSignal {
  if (row.status !== 'open') return { key: 'done', text: settledLabel(row), tone: 'quiet' }
  if (row.awaitingAcceptance === true && onMe(row)) {
    return row.evidence === 'said'
      ? { key: 'said', text: '说交了 · 没见到东西', tone: 'need' }
      : { key: 'wait', text: row.evidence === 'platform' ? '交了 · 平台记了' : row.evidence === 'artifact' ? '交了 · 有东西' : '交了 · 等你验收', tone: 'need' }
  }
  if (row.overdue) {
    const days = row.due?.ts === undefined ? 0 : Math.floor((now - row.due.ts) / DAY_MS)
    return { key: 'late', text: days >= 1 ? `逾期 ${String(days)} 天` : '逾期', tone: 'late' }
  }
  if (row.awaitingAcceptance === true) return { key: 'doing', text: `交了 · 等${row.acceptor ?? row.stewardedBy ?? '对方'}验收`, tone: 'quiet' }
  if (row.acceptance?.state === 'declined') return { key: 'declined', text: '对方没接', tone: 'need' }
  if (row.notified === 'failed') return { key: 'unheard', text: '对方还不知道', tone: 'need' }
  /*
    没动静要**够久**才算：刚登记五分钟、还没人碰过，是正常的，不是不对劲。门槛和服务端
    判「过时」的是同一个三天（工作日的量级）；没到门槛的照常落进「其余 N 件正常」。
  */
  if ((row.signal === 'silent' || row.signal === 'stale') && now - row.lastSignalAt > QUIET_MS) {
    return { key: 'quiet', text: `${sinceText(row.lastSignalAt, now)}没动静`, tone: 'warn' }
  }
  if (row.due?.ts !== undefined && row.due.ts >= now && row.due.ts - now < SOON_MS) {
    return { key: 'soon', text: `${row.due.text}到期`, tone: 'warn' }
  }
  if (row.executorKind === 'agent') return { key: 'doing', text: `${AGENT}在做`, tone: 'quiet' }
  if (row.evidence !== undefined) return { key: 'doing', text: row.evidence === 'said' ? '在做' : '在做 · 有东西', tone: 'quiet' }
  return { key: 'normal', text: row.due?.text ?? '', tone: 'quiet' }
}

/** 不对劲的那几种：默认摊开。其余收进「其余 N 件正常」。 */
export const UNUSUAL: ReadonlySet<SignalKey> = new Set(['wait', 'said', 'late', 'declined', 'unheard', 'quiet', 'soon'])

/**
 * 正常的那几件收起来时那颗按钮怎么说。正常的**总是**收：一组里全是正常的也收——
 * 七十条全摊开就又是一堵墙 (R9)。上面有不对劲的才说「其余」；只有一件时不收，
 * 收起来那颗按钮和那一行一样高，白让人多点一下。
 */
export function foldNormalText(normal: number, unusual: number): string {
  return unusual === 0 ? `${String(normal)} 件都正常` : `其余 ${String(normal)} 件正常`
}

/** 今天条的四颗数：逾期、等你、说交了没见到、没动静。 */
export type TodayKey = 'late' | 'wait' | 'said' | 'quiet'

export const TODAY_OF: Partial<Record<SignalKey, TodayKey>> = {
  late: 'late', wait: 'wait', declined: 'wait', unheard: 'wait', said: 'said', quiet: 'quiet',
}

export function todayOf(rows: readonly BoardRowWire[], now: number = Date.now()): Record<TodayKey, number> {
  const out: Record<TodayKey, number> = { late: 0, wait: 0, said: 0, quiet: 0 }
  for (const row of rows) {
    const key = TODAY_OF[signalOf(row, now).key]
    if (key !== undefined) out[key] += 1
  }
  return out
}

export const TODAY_LABEL: Record<TodayKey, (n: number) => string> = {
  late: n => `${String(n)} 逾期`,
  wait: n => `${String(n)} 等你`,
  said: n => `${String(n)} 说交了，没见到东西`,
  quiet: n => `${String(n)} 没动静`,
}

/** 行的第二行：谁欠谁 · 在哪 ·（换了组织轴时）为哪个目标。 */
export function rowSub(row: BoardRowWire, goalLabel?: string): string {
  const who = row.executorKind === 'agent' ? AGENT : row.who
  return [
    row.direction === 'owed-to-me'
      ? `${who}欠你`
      : row.direction === 'mine'
        ? row.acceptor === undefined ? '你自己定的' : `你欠${row.acceptor}`
        : `${who}${row.acceptor === undefined ? '' : ` → ${row.acceptor}`}`,
    row.placeName,
    goalLabel,
  ].filter((part): part is string => part !== undefined && part !== '').join(' · ')
}

/**
 * 目标连名字都没有时叫什么。链接的最后一段如果是个 id（`6a880632ecd3…`），它不是名字——
 * 说「没有名字的目标」，不把一串 id 当标题摆上屏。
 */
export function goalTitleOf(ref: string): string {
  const named = (word: string): string => (
    word === '' || /^[0-9a-f]{12,}$/iu.test(word) || /^[A-Za-z0-9_-]{20,}$/u.test(word) ? '没有名字的目标' : word
  )
  try {
    const last = new URL(ref.replace('#/', '')).pathname.split('/').filter(part => part !== '').at(-1)
    return named(last === undefined ? '' : decodeURIComponent(last))
  } catch {
    // 不是链接：它本身可能就是个名字。
    return named(ref.trim())
  }
}

/**
 * 今天条上那颗会：「明天 14:00 竞品评审会 · 材料 2/3 就绪」。
 *
 * 只给挂了要准备的事的会——一场什么都没挂的会不是今天要你知道的事，它在日历里；
 * 往会上挂东西是跟云小助说一句「把 X 挂到明天的评审会」。就绪 = 那件留下了东西或者
 * 办完了；作废了的不算在分母里。
 */
export function eventChipText(event: BoardEventWire, now: number = Date.now()): string | undefined {
  const counted = event.prepares.filter(prep => prep.status !== 'voided')
  if (counted.length === 0) return undefined
  const ready = counted.filter(prep => prep.status === 'closed' || prep.artifacts.length > 0).length
  const when = event.startAt === 0 ? '' : `${dueDayText(event.startAt, now)} `
  return `${when}${event.title} · 材料 ${String(ready)}/${String(counted.length)} 就绪`
}
