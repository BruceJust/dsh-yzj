/** 桌面面 —— surface 消费的唯一接缝（surface → pledger，永不反向）。D10 隐身档下 surface 不取这个座位。 */
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import { familySpec } from './families.ts'
import { casebookOf, DESTROY_PHRASE, indicators, judgContract, readmeOf, type JudgContract } from './export.ts'
import { judgView, receiptRows, type JudgView, type PledgeRow, type ReceiptRow } from './judg.ts'
import {
  attribute, clearClause, clauseOn, dismiss, markSeen, noteFact, parsePrivateSay, pledge, setClause, withdraw,
} from './pledge.ts'
import { stripsFor, type Strip } from './strips.ts'
import { anchoredOf, DEFAULT_WINDOW, type AnchoredText, type Attribution, type ClauseKey, type JudgWindow, type PremiseState } from './types.ts'
import { isAlive, latestVerdictIn, verdictOn } from './verdicts.ts'

export interface EvidenceRow {
  readonly text: string
  readonly at: string
  readonly anchor?: { kind: string; id: string; graphSeq?: number }
  readonly premise: PremiseState
  readonly mark?: string
}

export interface EvidenceFace {
  readonly title: string
  readonly rows: readonly EvidenceRow[]
}

/** 入参里没有组织图 service：锚失效不蒸发内容，因为没有取内容的通道。 */
export function evidenceRowsOf(rows: readonly AnchoredText[], probe: (anchor: { kind: string; id: string }) => PremiseState): readonly EvidenceRow[] {
  return rows.map((one) => {
    const premise = one.anchor === undefined ? 'unknown' : probe(one.anchor)
    return { text: one.text, at: one.at, ...(one.anchor === undefined ? {} : { anchor: one.anchor }), premise, ...(premise === 'changed' ? { mark: '前提已变' } : {}) }
  })
}

export interface PledgerDesk {
  readonly enabled: boolean
  readonly destroyPhrase: string
  judg(window?: JudgWindow): JudgView | undefined
  stripsFor(cardKind: string, id: string, resolved: boolean): readonly Strip[]
  evidenceFor(kind: 'calibration' | 'expectation', id: string): EvidenceFace | undefined
  contract(): JudgContract
  /** 私语道出站拦截：押 / 以后…。返回 `undefined` = 不是私账动词，照常给 agent。 */
  say(topicKey: string, text: string): Promise<string | undefined>
  /** 发现路 = 占位文字：本会话最近裁决尚未押过时才有。不弹卡、不计数、不重复。 */
  placeholderFor(topicKey: string): string | undefined
  /** 引用指名押的句柄：这张卡上有你签发过、还没押过的裁决时才有；撤回过的不再给（幂等锚）。 */
  pledgeHandle(kind: string, id: string): string | undefined
  withdraw(expectationId: string, reason: string): Promise<void>
  note(text: string, about: { kind: 'verdict'; verdict: AnchoredText } | { kind: 'expectation'; expectationId: string }): Promise<string>
  attribute(calibrationId: string, cell: Attribution): Promise<void>
  dismiss(calibrationId: string): Promise<void>
  seen(calibrationIds: readonly string[]): Promise<void>
  setClause(key: Exclude<ClauseKey, 'lease'>, family?: string): Promise<string>
  clearClause(key: ClauseKey, family?: string): Promise<string>
  /** 晨报对表行：只在 `morning` 生效时有数；N = 未答且未 dismissed 的回执。 */
  morningCount(): number | undefined
  indicators(): ReturnType<typeof indicators>
  exportCasebook(): { casebook: string; readme: string } | undefined
  destroy(confirm: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjPledgerDesk?: PledgerDesk
  }
}

export function createDesk(ctx: Context): PledgerDesk {
  const probe = (anchor: { kind: string; id: string }): PremiseState => isAlive(ctx, anchor)
  const ready = (): boolean => ctx.get('yzjPledger')?.ready === true
  return {
    get enabled() { return ready() },
    destroyPhrase: DESTROY_PHRASE,
    judg: window => (ready() ? judgView(ctx, window ?? DEFAULT_WINDOW) : undefined),
    stripsFor: (cardKind, id, resolved) => stripsFor(ctx, cardKind, id, resolved),
    evidenceFor(kind, id) {
      const pledger = ctx.get('yzjPledger')
      const state = asRecord(pledger?.object(kind, id)?.state)
      if (pledger === undefined || state === undefined) return undefined
      const rows: AnchoredText[] = kind === 'expectation'
        ? [anchoredOf(state.verdict)]
        : [...(Array.isArray(state.then) ? state.then.map(anchoredOf) : []), ...(Array.isArray(state.later) ? state.later.map(anchoredOf) : [])]
      return {
        title: kind === 'expectation' ? `押 · 「${asString(state.text) ?? ''}」` : anchoredOf(state.verdict).text,
        rows: evidenceRowsOf(rows, probe),
      }
    },
    contract: () => judgContract(ctx),
    async say(topicKey, text) {
      const parsed = parsePrivateSay(text)
      if (parsed === undefined) return undefined
      if (parsed.kind === 'pledge') return pledge(ctx, { topicKey, text: parsed.text, ...(parsed.anchor === undefined ? {} : { anchor: parsed.anchor }) })
      if (parsed.key === undefined) {
        return '这句我没认出来。现在能写的三句：「以后验收前先看证据」「以后验收前给我看上次的结果」「每天早上告诉我有几条结果」。'
      }
      return parsed.off ? clearClause(ctx, parsed.key) : setClause(ctx, parsed.key)
    },
    placeholderFor(topicKey) {
      if (!ready()) return undefined
      const verdict = latestVerdictIn(ctx, topicKey)
      if (verdict === undefined) return undefined
      const pledger = ctx.get('yzjPledger')
      const pledged = pledger?.findByIdemKey(`expectation:${verdict.anchor.kind}:${verdict.anchor.id}`) !== undefined
      return pledged ? undefined : '或「押：」一句预期，可选'
    },
    pledgeHandle(kind, id) {
      if (!ready() || verdictOn(ctx, { kind, id }) === undefined) return undefined
      return ctx.get('yzjPledger')?.findByIdemKey(`expectation:${kind}:${id}`) === undefined ? `[card#${kind}:${id}]` : undefined
    },
    withdraw: (expectationId, reason) => withdraw(ctx, expectationId, reason),
    note: (text, about) => noteFact(ctx, { text, about }),
    attribute: (calibrationId, cell) => attribute(ctx, calibrationId, cell),
    dismiss: calibrationId => dismiss(ctx, calibrationId),
    seen: ids => markSeen(ctx, ids),
    setClause: (key, family) => setClause(ctx, key, family),
    clearClause: (key, family) => clearClause(ctx, key, family),
    morningCount() {
      if (!ready() || !clauseOn(ctx, 'morning')) return undefined
      return receiptRows(ctx).filter(row => row.attribution === undefined && !row.dismissed).length
    },
    indicators: () => indicators(ctx),
    exportCasebook() {
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) return undefined
      return { casebook: casebookOf(ctx), readme: readmeOf(pledger.owner) }
    },
    async destroy(confirm) {
      if (confirm !== DESTROY_PHRASE) throw new Error(`销毁是不可逆的：请原样输入「${DESTROY_PHRASE}」以确认。`)
      await ctx.get('yzjPledger')?.destroy()
    },
  }
}

export type { JudgView, PledgeRow, ReceiptRow, Strip }
export { familySpec }
