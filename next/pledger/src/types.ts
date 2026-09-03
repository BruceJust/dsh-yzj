/**
 * 私账层的公共契约 —— 自知（决策 #64 / 分册 v3.1）。三个形状把宪法写成类型：
 * {@link PledgerViewer} 只有一个住客；{@link AnchoredText} 是唯一携锚形态（私账存照片
 * 不存链接）；{@link JudgWindow} 必填（全史聚合在 API 上不可构造）。
 */
import type { JsonValue, ObjectRef } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

export const PLEDGER_ENVELOPE_VERSION = 1
/** 3 —— v3.0 词汇收缩：旧快照（v2 形状）一律作废重折。 */
export const PLEDGER_FOLD_VERSION = 3

/** 谁在看。只有一个住客：这个账本的读取面上没有「别人」这个参数。 */
export interface PledgerViewer {
  readonly kind: 'operator'
  readonly openId: string
}

/** 指向组织图的锚。只做三件事：一跳回 / 活性探测 / 幂等键——取内容非法。 */
export interface OrgAnchor {
  readonly kind: string
  readonly id: string
  readonly graphSeq?: number
}

/** 立此存照律的唯一携锚形态：文本必填、时刻必填、锚可空。 */
export interface AnchoredText {
  readonly text: string
  readonly at: string
  readonly anchor?: OrgAnchor
}

export function anchorKey(anchor: OrgAnchor): string {
  return `${anchor.kind}:${anchor.id}`
}

/** 照片写成纯 JSON——逐字段展开，多一个键都进不来（组织侧内容没有位置）。 */
export function anchoredJson(one: AnchoredText): JsonValue {
  return {
    text: one.text,
    at: one.at,
    ...(one.anchor === undefined
      ? {}
      : {
        anchor: {
          kind: one.anchor.kind,
          id: one.anchor.id,
          ...(one.anchor.graphSeq === undefined ? {} : { graphSeq: one.anchor.graphSeq }),
        },
      }),
  }
}

export function snapshot(text: string, anchor?: OrgAnchor, at: number = Date.now()): AnchoredText {
  return { text, at: new Date(at).toISOString(), ...(anchor === undefined ? {} : { anchor }) }
}

/** 从落盘的 JSON 读回一张照片。读不出文本就说实话，不给空串。 */
export function anchoredOf(value: JsonValue | undefined): AnchoredText {
  const record = asRecord(value)
  const inner = asRecord(record?.anchor)
  const kind = asString(inner?.kind)
  const id = asString(inner?.id)
  const graphSeq = inner?.graphSeq
  return {
    text: asString(record?.text) ?? '（这一段没有留下快照）',
    at: asString(record?.at) ?? '',
    ...(kind === undefined || id === undefined
      ? {}
      : { anchor: { kind, id, ...(typeof graphSeq === 'number' ? { graphSeq } : {}) } }),
  }
}

/** 锚此刻还在不在——返回状态不返回内容；`unknown` 不显形（答不出就不吓人）。 */
export type PremiseState = 'live' | 'changed' | 'unknown'

/** 归因四格。人自己下，agent 不代下。 */
export type Attribution = 'q1' | 'q2' | 'q3' | 'q4'

export const ATTRIBUTION_LABEL: Readonly<Record<Attribution, string>> = {
  q1: '对了 · 因判断',
  q2: '对了 · 因运气',
  q3: '错了 · 因判断',
  q4: '错了 · 因世界',
}

/**
 * 候选注 —— 静态常量表，只给证据与假设，不给心理判词（§4.3）。
 * 第三格引用「当时就在卡上」的那一条，由渲染层从 `then[1]` 取标题填进 `{X}`。
 */
export const ATTRIBUTION_NOTE: Readonly<Record<Attribution, string>> = {
  q1: '你当时看到的，就是后来发生的',
  q2: '结果是好的，但不是因为你当时看到的那些',
  q3: '「{X}」当时就在卡上',
  q4: '后来的事，当时看不到',
}

/** 回执三处出生（§4.2）——由比值的分子定义。 */
export type ReceiptType = 'pledged' | 'reversed' | 'vindicated'

export const RECEIPT_TYPE_LABEL: Readonly<Record<ReceiptType, string>> = {
  pledged: '押过的',
  reversed: '同意了，被现实推翻',
  vindicated: '没同意，被现实印证',
}

/** 软合同私账句的 key（P1 三句 + 租约出口私记）。> 5 句押面板门。 */
export type ClauseKey = 'spread' | 'mirror' | 'morning' | 'lease'

export const CLAUSE_TEXT: Readonly<Record<Exclude<ClauseKey, 'lease'>, string>> = {
  spread: '以后验收前，先把要求和交付摆给我看',
  mirror: '以后验收前，给我看我上次在这类事上的结果',
  morning: '每天早上告诉我有几条结果等着看',
}

/** 组头原料的滚动窗——必填。没有「不限」这个取值。 */
export interface JudgWindow {
  readonly days: number
}

export const DEFAULT_WINDOW: JudgWindow = { days: 90 }

export interface PledgerAppendInput<D = JsonValue> {
  readonly type: string
  readonly data: D
  /** 人签发的一律 `operator`；回执与归档由 `system` 写——它们不是意见，是配对。 */
  readonly actor: { readonly kind: 'operator' | 'agent' | 'system'; readonly openId?: string }
}

export type PledgerRef = ObjectRef
