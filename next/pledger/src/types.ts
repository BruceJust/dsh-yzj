/**
 * Public contracts of the private ledger (金库).
 *
 * **组织的图记承诺的一生，金库记你的判断的一生——两本账，两种可见性，永不合流。**
 *
 * Three shapes in this file carry the whole constitution, and each is a TYPE
 * rather than a runtime check on purpose (分册 §6 私账三特有律):
 *
 * - {@link PledgerViewer} has ONE inhabitant. A place viewer is not rejected —
 *   it cannot be spelled. 断言⑨ 「viewer 单态」 is discharged by this line.
 * - {@link PatternWindow} makes the rolling window a REQUIRED parameter, so a
 *   "judgement score over all history" is not a query somebody forgot to
 *   forbid: it is a call that does not typecheck (断言⑤ / PTD-5).
 * - {@link OrgAnchor} points OUT of this ledger and nothing points back. The
 *   organization graph's event schemas carry no pledger field, which is the
 *   other half of the single-direction double lock (PTD-4).
 */

import type { JsonValue, ObjectRef } from '@yzj-next/graph'

/** Envelope version of one pledger log line. */
export const PLEDGER_ENVELOPE_VERSION = 1

/**
 * Fold version of the pledger materialization cache.
 *
 * Same rule as the graph kernel's: **any change that affects a fold result
 * bumps this by one.** A snapshot whose `fv` does not match is treated as
 * absent — one full replay costs O(log); one lying cache has no upper bound.
 */
export const PLEDGER_FOLD_VERSION = 1

/**
 * Who is asking. **Single-state on purpose** (分册 §6 特有律②).
 *
 * There is no `place` variant, and there is no way to add one without changing
 * this line: the ledger's read path takes no viewer argument at all, and the
 * only identity it can be opened under is the operator whose directory it is.
 * That is why 断言⑨ reads「place viewer 构造 pledger 查询 = API 层不可达」rather
 * than「place viewer 得到空结果」.
 */
export interface PledgerViewer {
  readonly kind: 'operator'
  readonly openId: string
}

/**
 * An anchor INTO the organization graph. The only direction that exists.
 *
 * `label` is a snapshot of what the object was called at the moment the
 * private ledger wrote it down. It is not a cache to be kept fresh — it is
 * what keeps a judgement legible after its anchor is tombstoned (数据律「真身
 * 之变」的私账形态：投影断链显形，判例文字仍在——判例是你的史，锚失效不蒸发内容).
 */
export interface OrgAnchor {
  /** Organization-graph object kind, e.g. `commitment` / `assessment`. */
  readonly kind: string
  readonly id: string
  /** The organization-graph sequence this anchor was taken at, when known. */
  readonly graphSeq?: number
  /** What it was called then. Never refreshed; see above. */
  readonly label?: string
}

/** Render one organization anchor as its flat key. */
export function anchorKey(anchor: OrgAnchor): string {
  return `${anchor.kind}:${anchor.id}`
}

/**
 * 事实源三分 (v1.1 §3) —— where a fact that closes a loop may come from.
 *
 * ① `org` 图内结构性事实 —— 结构匹配优先，「结构性判定先于语义判定」既有纪律；
 * ② `noted` 人工补登 —— 图外事实的唯一入口（「跟踪≠监工」对私账适用）；
 * ③ ambient 语义识别 —— **押门，P1 不做**：它没有构造函数，所以断言⑮ 的「路径
 *    不存在」是一句关于类型的话，不是一句关于纪律的话。
 */
export type FactRef =
  | { readonly source: 'org'; readonly anchor: OrgAnchor; readonly why: StructuralWhy }
  | { readonly source: 'noted'; readonly factId: string }

/** Which structural rule matched. Shown on the receipt, so the pairing is auditable. */
export type StructuralWhy =
  /** The very thing you accepted came back. */
  | 'reopened'
  /** New work was born under the same goal, pointing back at where you decided. */
  | 'lineage'
  /** A gap report was written on the same goal afterwards. */
  | 'assessed'

/** Render one fact reference as its flat key — half of the calibration anchor. */
export function factKey(fact: FactRef): string {
  return fact.source === 'org' ? `org:${anchorKey(fact.anchor)}` : `noted:${fact.factId}`
}

/**
 * 归因四格 —— 人自己下，agent 不代下 (§4).
 *
 * The four cells guard against exactly two self-deceptions, which is why they
 * are four and not three: mistaking luck for skill (q2 disguised as q1), and
 * blaming the world for a misjudgement (q3 disguised as q4).
 */
export type Attribution = 'q1' | 'q2' | 'q3' | 'q4'

/** What each cell says. Rendered wherever a case is shown; one source of truth. */
export const ATTRIBUTION_LABEL: Readonly<Record<Attribution, string>> = {
  q1: '对了 · 因判断',
  q2: '对了 · 因运气',
  q3: '错了 · 因判断',
  q4: '错了 · 因世界',
}

/**
 * 三档位定律 (§4 换挡台) —— every proposal family has three.
 *
 * `lease` 全自动 ← `default` agent 提案、人裁决 → `weight` 人先手、agent 补充。
 * 负重档是「你先拆，我再补」，产婆术的可调节形态——它补的是温水剧场的另一半：
 * 生成侧萎缩（拆解提案越好，人越不练拆解）。
 */
export type Gear = 'lease' | 'default' | 'weight'

/** Where a shift was signed. Recorded so「换挡也是裁决」has a place of origin. */
export type GearEntry = 'tail' | 'vault'

/**
 * 提案族 —— an OPEN registry, three families in P1 (§4 / §9).
 *
 * Deliberately a plain string rather than a union: the design's own rule is
 * 「模式有限，场景实例开放」, and a closed enum here would mean a new proposal
 * family cannot ship without editing the private ledger's vocabulary.
 */
export type ProposalFamily = string

/** One proposal family the gear bench knows how to talk about. */
export interface FamilySpec {
  readonly family: ProposalFamily
  readonly label: string
  /** One line saying what this family's proposals actually are. */
  readonly what: string
  /** Card kinds whose desktop verdicts belong to this family. */
  readonly cardKinds: readonly string[]
}

/**
 * 模式的滚动窗口 —— **必填** (PTD-5).
 *
 * 「判断力得分」在 API 上不可构造：没有窗口参数的模式查询不是被拒绝的调用，
 * 是不存在的重载。判例永续（日志全量在），模式滚动（窗口只在查询层）——滚动
 * 是派生窗口不是删除，而金库照现在的你，不给人建档案。
 */
export interface PatternWindow {
  /** How many days back the window reaches. */
  readonly days: number
}

/** The default window every vault projection uses. 90 days, stated once. */
export const DEFAULT_PATTERN_WINDOW: PatternWindow = { days: 90 }

/** One expectation, as the vault renders it. */
export type ExpectationStatus = 'testing' | 'due' | 'settled' | 'withdrawn'

/** One invite, as the private stream renders it. */
export type InviteStatus = 'open' | 'declined' | 'pledged'

/** One calibration receipt's lifecycle. */
export type CalibrationStatus = 'open' | 'answered' | 'dismissed'

/** One append request onto the pledger log. `seq`/`time`/`sv` are assigned here. */
export interface PledgerAppendInput<D = JsonValue> {
  readonly type: string
  readonly data: D
  /**
   * Who caused it. **`gear/*`, `mirror/*` and every attribution are `operator`
   * by construction** (§8 持镜人条款): the agent has no tool that can write
   * one, so a shift or a mirror in this log is always something a person
   * signed.
   */
  readonly actor: { readonly kind: 'operator' | 'agent' | 'system'; readonly openId?: string }
}

/** Address of one private-ledger object. Same shape as a graph ref, other store. */
export type PledgerRef = ObjectRef
