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
 *
 * **2（v2.1）**：立此存照律的读时升级（`compat.ts`）住在折叠里，所以它对已经落盘
 * 的快照**够不到**——不bump 的话，跑了一阵子的部署会一直读着旧形状折出来的状态，
 * 而新代码在那些状态上只找得到「（这一段没有留下快照）」。这条实例上验到过：线上
 * 那本账的三条判例正是这么读的，直到这个数字变成 2。
 */
export const PLEDGER_FOLD_VERSION = 2

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
 * **它永远不单独出现** —— 见 {@link AnchoredText}。锚只有三个合法用途：一跳回、
 * 活性探测、幂等键。取内容一律非法。
 */
export interface OrgAnchor {
  /** Organization-graph object kind, e.g. `commitment` / `assessment`. */
  readonly kind: string
  readonly id: string
  /** The organization-graph sequence this anchor was taken at, when known. */
  readonly graphSeq?: number
}

/**
 * 立此存照律的唯一携锚形态 (v2.0 / #62-A / PTD-16).
 *
 * **私账存的是照片，不是链接。**
 *
 * 上一版把 `OrgAnchor` 当字段直接存，正文靠锚回组织图解析。看起来省事，可它让
 * 两条宪法同时变成假话：§2 说「拷走目录即取走全账」——拷走之后锚解析不了，判例
 * 就是一串 id；§6 说「锚失效不蒸发内容」——组织侧一墓碑，判例当场空壳。
 *
 * 修法不是「记得也存一份摘要」，是**让只存锚写不出来**：pgraph 的任何 schema
 * 位置都不得出现独立的 `OrgAnchor` 字段（断言⑯ 静态扫描），于是实现者**想偷懒
 * 都没有那个位置**。这是本设计第三次用「通道不存在」取代「运行时校验」——前两次
 * 是无 `updated` 事件（PTD-6）与工具 schema 无 text 参数（PTD-12）。
 *
 * 三句成文：
 * ① 私账存的是照片，不是链接；
 * ② 锚的三个合法用途 = **一跳回 / 活性探测 / 幂等键**；
 * ③ **取内容一律非法** —— 正文渲染函数的入参类型里根本没有组织图 service。
 */
export interface AnchoredText {
  /** 当时的人可读摘要（组织侧内容的照片）——**必填**，写入时刻定格。 */
  readonly text: string
  /** 快照时刻（ISO）——「当时」的时间坐标。 */
  readonly at: string
  /** 可空的导航/活性探测/幂等键；**渲染正文时永不解析它**。 */
  readonly anchor?: OrgAnchor
}

/** Render one organization anchor as its flat key. */
export function anchorKey(anchor: OrgAnchor): string {
  return `${anchor.kind}:${anchor.id}`
}

/**
 * 把一张照片写成纯 JSON —— 落账前的最后一步.
 *
 * `exactOptionalPropertyTypes` 下，`anchor?: OrgAnchor` 这样的可选字段不是
 * `JsonValue`（它的类型里含 `undefined`）。逐字段展开而不是 `as never` 强转：
 * 强转会连「锚里多了一个不该存的字段」也一起放过去，而这条路上正好有一个不该存的
 * 东西——组织侧的**内容**。展开写死了只有三个键，多一个都进不来。
 */
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

/** 给一段组织侧文本拍照。`at` 由调用方传时钟，便于用例定格。 */
export function snapshot(
  text: string, anchor?: OrgAnchor, at: number = Date.now(),
): AnchoredText {
  return {
    text,
    at: new Date(at).toISOString(),
    ...(anchor === undefined ? {} : { anchor }),
  }
}

/**
 * 锚此刻还在不在 —— **返回状态，不返回内容** (§1 组织图只读三用途之②).
 *
 * `unknown` 不是「可能死了」，是**我们此刻答不出这个问题**（组织图不可达：取走后的
 * 目录、并存期切实例）。认识论诚实同款：答不出就不显形，绝不拿「可能」去吓人。
 */
export type PremiseState = 'live' | 'changed' | 'unknown'

/**
 * 事实源三分 (v1.1 §3) —— where a fact that closes a loop may come from.
 *
 * ① `org` 图内结构性事实 —— 结构匹配优先，「结构性判定先于语义判定」既有纪律；
 * ② `noted` 人工补登 —— 图外事实的唯一入口（「跟踪≠监工」对私账适用）；
 * ③ ambient 语义识别 —— **押门，P1 不做**：它没有构造函数，所以断言⑮ 的「路径
 *    不存在」是一句关于类型的话，不是一句关于纪律的话。
 *
 * **v2.0：这里只剩「哪一支」，事实本身住在 {@link AnchoredText} 里** —— 锚在
 * `fact.anchor`，正文在 `fact.text`。这条类型上不再有独立的 `OrgAnchor` 字段。
 */
export type FactSource =
  | { readonly kind: 'org'; readonly why: StructuralWhy }
  | { readonly kind: 'noted'; readonly factId: string }

/** Which structural rule matched. Shown on the receipt, so the pairing is auditable. */
export type StructuralWhy =
  /** The very thing you accepted came back. */
  | 'reopened'
  /** New work was born under the same goal, pointing back at where you decided. */
  | 'lineage'
  /** A gap report was written on the same goal afterwards. */
  | 'assessed'

/** 事实边的幂等键 —— 校准回执幂等锚的后半截。 */
export function factKey(fact: AnchoredText, source: FactSource): string {
  if (source.kind === 'noted') return `noted:${source.factId}`
  return fact.anchor === undefined ? 'org:?' : `org:${anchorKey(fact.anchor)}`
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

/**
 * 换挡/开镜是在**哪儿**签的 —— 入口不垄断律的留痕面 (v2.0 补 `'receipt'`).
 *
 * `'receipt'` 是就地合环那一个：人刚在回执上下完归因，判断刚出炉、动机最热，合环
 * 动词就近长在那一行上。**金库是汇总处，不是唯一入口**——#61 的条款对它自己生效。
 */
export type GearEntry = 'tail' | 'vault' | 'receipt'

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

/** 分册 §7 分布镜签名里的名字，同一个东西。两处叫法不同会让人以为是两样。 */
export type RollingWindow = PatternWindow

/** The default window every vault projection uses. 90 days, stated once. */
export const DEFAULT_PATTERN_WINDOW: PatternWindow = { days: 90 }

/**
 * 静默沉降的两个参数 (§4.5 / §9——**入 dogfood 观测项**).
 *
 * 沉得太快 = 藏事，沉得太慢 = 堆积。所以它们是**参数**不是常数：换挡台的软合同
 * 区可调，而这里只给 P1 的起点。
 */
export const SETTLE_DAYS = 14
/** 同类未答私账卡到这个数就在私语流折叠成一行——**归并条是门不是徽标**。 */
export const FOLD_THRESHOLD = 2

/** 私账卡在私语流里的三态：展开 / 折进归并条 / 已沉降（金库未对表区）。 */
export type SettleZone = 'live' | 'folded' | 'settled'

/**
 * 私账能力 → 它的入口们 —— **入口不垄断律的执法机关** (v2.0 / PTD-21).
 *
 * #61 写着「凡只能在金库获得的能力即违规」，可那一直只是一句文字。给自己立的法
 * 要有自己的执法机关：这张表被断言⑳ 校验，任一能力的入口 < 2 就 CI 红。
 */
export interface CapabilityEntries {
  readonly capability: string
  /** 前缀是它长在哪儿：`vault:` / `receipt:` / `tail:` / `selfdm:`。 */
  readonly entries: readonly string[]
  /**
   * **这一项此刻只能在金库获得** —— 一处明标的缺口，不是一个通过的检查.
   *
   * #61 的原话是「凡只能在金库获得的能力即违规」。P1 有一项还没做到：**撤回预期**
   * 的两个入口都在金库里。它真正的第二个家是检验点到期时自聊里的那一问（「结果
   * 怎么样了？」——那一刻最自然的两个答案就是补登事实与撤回），而自聊在 P1 **只出
   * 不进**（§9 押 P5 移动形态）。在那条运输落成之前，给它画一个入口就是幽灵信号。
   *
   * 所以这里选择**说出来并冻住**：断言⑳ 校验带这个标记的集合**恰好**是已知的那
   * 一个——新长出来的金库独占能力会当场变红。一处认下的欠账不会扩散；一处不写下来
   * 的欠账，半年后就成了「本来就这样」。
   */
  readonly vaultOnly?: true
}

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
