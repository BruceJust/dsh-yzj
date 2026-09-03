/** 「我的判断」取景框——与承诺板同构（§5）：组织轴 = 裁决族，组头 = 2×2 + 两分母（近 90 天派生，零存储），行 = 押 / 回执；无判词，按裁决数降序。 */
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import { familyLabel, familySpec } from './families.ts'
import {
  anchoredOf, ATTRIBUTION_LABEL,
  type AnchoredText, type Attribution, type JudgWindow, type PremiseState, type ReceiptType,
} from './types.ts'
import { filedVerdicts, isAlive } from './verdicts.ts'

/** 组头：2×2 + 两分母。全数值——这里没有「成立」，只有「没被推翻」。 */
export interface FamilyHead {
  readonly family: string
  readonly label: string
  readonly count: number
  readonly agree: number
  readonly notReversed: number
  readonly reversed: number
  readonly diverged: number
  readonly vindicated: number
  readonly wrong: number
  readonly pending: number
  /** 中位停留（毫秒）；没有测到就是 0。 */
  readonly dwellMs: number
  /** 中位等你多久（毫秒）。 */
  readonly waitMs: number
  readonly clauses: boolean
  readonly leasable: boolean
}

export interface PledgeRow {
  readonly kind: 'pledge'
  readonly expectationId: string
  readonly family: string
  readonly text: string
  readonly verdict: AnchoredText
  readonly checkpointText: string
  readonly checkpointTs?: number
  readonly status: 'testing' | 'due' | 'settled' | 'withdrawn'
  readonly premise: PremiseState
  readonly bornAt: number
  readonly reason?: string
}

export interface ReceiptRow {
  readonly kind: 'receipt'
  readonly calibrationId: string
  readonly family: string
  readonly type: ReceiptType
  readonly verdict: AnchoredText
  readonly then: readonly AnchoredText[]
  readonly later: readonly AnchoredText[]
  readonly attribution?: Attribution
  readonly attributionLabel?: string
  readonly dismissed: boolean
  readonly seen: boolean
  readonly at: number
}

export interface JudgGroup {
  readonly head: FamilyHead
  readonly rows: readonly (PledgeRow | ReceiptRow)[]
}

export interface JudgView {
  readonly owner?: string
  readonly directory?: string
  readonly window: JudgWindow
  readonly groups: readonly JudgGroup[]
  /** 从没押过、也没有回执：取景框空态要说清「押是你的动词，系统不会来问」。 */
  readonly empty: boolean
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

export function receiptRows(ctx: Context): readonly ReceiptRow[] {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return []
  const out: ReceiptRow[] = []
  for (const object of pledger.query('calibration')) {
    const state = asRecord(object.state)
    // v2 形状的旧行（无 type / then）不上屏：历史册只作拆除对照，旧账在原件里，不在这一页。
    if (state === undefined || !Array.isArray(state.then) || familySpec(asString(state.family) ?? '') === undefined) continue
    const attribution = asString(state.attribution) as Attribution | undefined
    const status = asString(state.status)
    out.push({
      kind: 'receipt',
      calibrationId: object.id,
      family: asString(state.family) ?? '',
      type: (asString(state.type) ?? 'pledged') as ReceiptType,
      verdict: anchoredOf(state.verdict),
      then: Array.isArray(state.then) ? state.then.map(anchoredOf) : [],
      later: Array.isArray(state.later) ? state.later.map(anchoredOf) : [],
      ...(status === 'answered' && attribution !== undefined
        ? { attribution, attributionLabel: ATTRIBUTION_LABEL[attribution] }
        : {}),
      dismissed: status === 'dismissed',
      seen: state.seen === true,
      at: object.createdAt,
    })
  }
  return out.sort((left, right) => right.at - left.at)
}

export function pledgeRows(ctx: Context, now: number): readonly PledgeRow[] {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return []
  const settledAnchors = new Set(receiptRows(ctx).map(row => `${row.verdict.anchor?.kind ?? ''}:${row.verdict.anchor?.id ?? ''}`))
  const out: PledgeRow[] = []
  for (const object of pledger.query('expectation')) {
    const state = asRecord(object.state)
    if (state === undefined || familySpec(asString(state.family) ?? '') === undefined || asRecord(state.checkpoint) === undefined) continue
    const verdict = anchoredOf(state.verdict)
    const checkpoint = asRecord(state.checkpoint)
    const ts = checkpoint?.ts
    const withdrawn = asString(state.status) === 'withdrawn'
    const key = `${verdict.anchor?.kind ?? ''}:${verdict.anchor?.id ?? ''}`
    out.push({
      kind: 'pledge',
      expectationId: object.id,
      family: asString(state.family) ?? '',
      text: asString(state.text) ?? '',
      verdict,
      checkpointText: asString(checkpoint?.text) ?? '没有定时间',
      ...(typeof ts === 'number' ? { checkpointTs: ts } : {}),
      status: withdrawn ? 'withdrawn' : settledAnchors.has(key) ? 'settled' : typeof ts === 'number' && ts <= now ? 'due' : 'testing',
      premise: withdrawn || verdict.anchor === undefined ? 'unknown' : isAlive(ctx, verdict.anchor),
      bornAt: object.createdAt,
      ...(asString(state.reason) === undefined ? {} : { reason: asString(state.reason) as string }),
    })
  }
  return out.sort((left, right) => right.bornAt - left.bornAt)
}

export function judgView(ctx: Context, window: JudgWindow, now = Date.now()): JudgView {
  const pledger = ctx.get('yzjPledger')
  const since = now - window.days * 24 * 60 * 60 * 1000
  const verdicts = filedVerdicts(ctx).filter(one => one.at >= since)
  const receipts = receiptRows(ctx)
  const pledges = pledgeRows(ctx, now)
  const families = new Set<string>([...verdicts.map(one => one.family), ...receipts.map(one => one.family), ...pledges.map(one => one.family)])
  const groups: JudgGroup[] = []
  for (const family of families) {
    if (family === '') continue
    const mine = verdicts.filter(one => one.family === family)
    const inWindow = receipts.filter(one => one.family === family && one.at >= since && !one.dismissed)
    const agree = mine.filter(one => one.agree).length
    const diverged = mine.length - agree
    const reversed = inWindow.filter(one => one.type === 'reversed').length
    const vindicated = inWindow.filter(one => one.type === 'vindicated').length
    const spec = familySpec(family)
    groups.push({
      head: {
        family,
        label: familyLabel(family),
        count: mine.length,
        agree,
        notReversed: Math.max(0, agree - reversed),
        reversed,
        diverged,
        vindicated,
        // 「错」在 P1 没有结构性来源，如实为 0——待定 = 没同意的减去已印证的。
        wrong: 0,
        pending: Math.max(0, diverged - vindicated),
        dwellMs: median(mine.map(one => one.dwellMs).filter((one): one is number => one !== undefined)),
        waitMs: median(mine.map(one => one.waitMs).filter((one): one is number => one !== undefined)),
        clauses: spec?.clauses === true,
        leasable: spec?.leasable === true,
      },
      rows: [
        ...pledges.filter(one => one.family === family && one.status !== 'settled'),
        ...receipts.filter(one => one.family === family),
      ],
    })
  }
  groups.sort((left, right) => right.head.count - left.head.count)
  return {
    ...(pledger?.owner === undefined ? {} : { owner: pledger.owner }),
    ...(pledger?.directory === undefined ? {} : { directory: pledger.directory }),
    window,
    groups,
    empty: pledges.length === 0 && receipts.length === 0,
  }
}
