/**
 * 事实回流（环3）—— **事实源三分** (v1.1 §3 / PTD-11) × **立此存照律** (v2.0 §3.1).
 *
 * ① **图内结构性事实** —— 结构匹配优先。「结构性判定先于语义判定」是既有纪律：
 *    一条被裁决的活**又被打回**、你那次裁决**之后长出的血缘新边**、同一目标上后来
 *    **写了一份差距简报**——这三件事都是图自己说的，不需要谁去读懂一句话的意思。
 * ② **人工补登（`fact/noted`）** —— 图外事实（线下评审、口头反馈、邮件结果）的
 *    唯一入口。系统不猜图外：「跟踪≠监工」对私账同样适用。
 * ③ **ambient 语义识别** —— **押门，P1 不做**。它在这个文件里没有分支，在
 *    {@link FactSource} 里没有构造函数——断言⑮ 的「语义识别路径不存在」因此是一句
 *    关于代码的话。
 *
 * **v2.0 的形状变化**：匹配的产物不再是「一个锚」，是**一张照片**
 * （{@link AnchoredText}）——写入的那一刻就把人可读的那句话定格下来。于是拷走目录
 * 之后、组织侧墓碑之后，回执正文一个字都不会少（断言⑯ 集成半）。
 *
 * 幂等锚 =（裁决边, 事实边）：同一事实多次回流不出第二张执；`dismissed` 之后不再
 * 出执（吸收态）；`reopened` 之后可再答 (断言④)。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphEvent } from '@yzj-next/graph'
import { calibrationIdFor, calibrationIdemKeyFor } from './families.ts'
import {
  anchoredJson, snapshot,
  type AnchoredText, type FactSource, type OrgAnchor, type StructuralWhy,
} from './types.ts'
import { goalRefOf, labelOf, seenVerdicts, topicOf, type SeenVerdict } from './verdicts.ts'

/**
 * 血缘新边还算不算「这次裁决的后来」的时间边界.
 *
 * 一周 = 工作周的量级。验收之后这一周里在同一段对话、同一目标下长出的下一步，多半
 * 真是它的后续；再往后，因果就只剩下「碰巧在同一间屋子里」——而拿那个当证据，就是
 * 在替人制造一次他一眼就知道该按「配对错了」的配对。
 */
const LINEAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** One matched fact: 它的照片、它走的哪一支、以及照片里那句话。 */
export interface MatchedFact {
  /** 后来那件事 —— **照片**：文本必填，锚可空（v2.0 立此存照律）。 */
  readonly fact: AnchoredText
  readonly source: FactSource
}

/**
 * 结构匹配 —— does this freshly appended organization event close that verdict?
 *
 * Reads only the event and the graph. It never reads the private ledger, and
 * it never asks a model: a rule that has to be *interpreted* is a rule that
 * fires differently on two similar days, and this one decides whether you get
 * asked to grade your own judgement.
 */
export function structuralFactFor(
  ctx: Context,
  verdict: SeenVerdict,
  event: GraphEvent,
): MatchedFact | undefined {
  const data = asRecord(event.data)
  if (data === undefined) return undefined
  const { kind, id } = verdict.anchor
  const shot = (text: string, anchor: OrgAnchor, why: StructuralWhy): MatchedFact => ({
    // 照片就在这里拍下：文本此刻定格，之后组织侧怎么变都不影响这张执。
    fact: snapshot(text, { ...anchor, graphSeq: event.seq }, event.time),
    source: { kind: 'org', why },
  })

  /*
    ① 被裁决的那一条又被打回。

    最强的一种：它不是「相关的事」，它就是**同一个对象**。所以它排在最前面，也
    是唯一一条不需要目标做中介的规则。

    **P1 明标：这一条是休眠的。** 整个代码库里没有任何生产者 append
    `commitment/reopened`——打回走的是 `commitment/rework`，而那发生在验收**之前**。
    规则本身对，等「反悔/重开」那个动词落座它就活；写在这里而不是删掉，是因为
    词汇表里有这一型，删了下次有人加生产者时又要重新想一遍。
  */
  if (event.type === 'commitment/reopened' && asString(data.commitmentId) === id) {
    return shot(
      `你验收过的这一条又被打回：${asString(data.cause) ?? '返工'}`,
      { kind, id }, 'reopened',
    )
  }

  const goal = goalRefOf(ctx, kind, id)
  if (goal === undefined) return undefined

  /*
    ② 血缘新边 —— 你那次裁决**之后长出来的下一步**。

    两条路，强弱分明：

    - **强**：新边是被裁决那一条的转包子边（`parentCommitmentId`）。这是图上明写的
      因果，不需要任何近似。
    - **弱**：同一目标 + 同一段对话 + **一周之内**。前两条是设计的原文（「同 goalRef
      且 sourceAnchor 回指」），第三条是自审时补的——没有它，一个忙碌的目标里**每一条
      新登记**都会对着你上一次验收出一张回执。
  */
  if (event.type === 'commitment/opened') {
    const child = asString(data.commitmentId)
    const spunOff = asString(data.parentCommitmentId) === id
    const sameGoal = asString(data.parentGoalRef) === goal || asString(data.goalRef) === goal
    const source = asString(data.sourceAnchor) ?? ''
    const topic = topicOf(ctx, kind, id)
    const pointsBack = topic !== undefined && source.includes(topic)
    const soonAfter = event.time - verdict.at <= LINEAGE_WINDOW_MS
    if (child !== undefined && (spunOff || (sameGoal && pointsBack && soonAfter))) {
      const what = asString(data.what) ?? child
      return shot(
        spunOff
          ? `这次裁决之后，从这条活里拆出了下一步：${what}`
          : `这次裁决之后一周内，同一目标下长出了新的一步：${what}`,
        { kind: 'commitment', id: child }, 'lineage',
      )
    }
  }

  /*
    ③ 同一目标上后来写的差距简报。

    简报是**对着标准逐条判**的那份东西——它是这个目标上最接近「后来到底怎么样」
    的一条结构性事实，而且它本身也是人裁的，不是系统的意见。
  */
  if (event.type === 'assessment/reported' && asString(data.goalRef) === goal) {
    const assessmentId = asString(data.assessmentId)
    if (assessmentId !== undefined && !(kind === 'assessment' && id === assessmentId)) {
      return shot(
        `同一目标上后来写了一份差距简报：${asString(data.summary) ?? assessmentId}`,
        { kind: 'assessment', id: assessmentId }, 'assessed',
      )
    }
  }
  return undefined
}

/** Human-readable name of each structural rule. Shown on the receipt. */
export const WHY_LABEL: Readonly<Record<StructuralWhy, string>> = {
  reopened: '结构匹配：被裁决的对象被打回',
  lineage: '结构匹配：本次裁决之后长出的血缘新边（转包子边，或一周内同目标同对话）',
  assessed: '结构匹配：同一目标上后来的差距简报',
}

/**
 * 「当时」栏 —— **两输入联合类型，第三种在类型上不可构造** (v2.0 / #62-C7 / PTD-22).
 *
 * 有显式预期 → **直出人的原话**。
 * 无显式预期 → **只陈列裁决事实本身**，不代人推演其含义。
 *
 * 上一版这里写的是「隐式预期即『它已经够好』」——那是 agent 替你写好了你当时在想
 * 什么，和预填出处律、归因候选措辞是同一族违规。**不措辞化**靠的不是 prompt 里
 * 写「不要推演」，靠的是**第三种输入构造不出来**：这个联合类型是封闭的，没有一支
 * 通向模型。
 */
export type WhenInput =
  | { readonly expectationText: string }
  | { readonly verdictSnapshot: AnchoredText }

export function renderWhen(input: WhenInput): string {
  if ('expectationText' in input) return `预期「${input.expectationText}」`
  const { text, at } = input.verdictSnapshot
  const when = new Date(at).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  // 模板拼装的纯函数：陈列事实，不解释它。
  return `你在 ${when} 裁决了「${text}」`
}

/**
 * 证据行 —— **只许事实与假设措辞，禁心理判词** (§3 evidence 条款).
 *
 * v2.0：每一条都是**照片**。写入时定格，所以断了组织图也读得出来；锚留在照片里，
 * 只用来一跳回与活性探测。
 */
export function evidenceFor(
  ctx: Context,
  verdict: OrgAnchor,
  source: FactSource,
  at: number,
): readonly AnchoredText[] {
  const lines: AnchoredText[] = []
  lines.push(snapshot(
    source.kind === 'org'
      ? WHY_LABEL[source.why]
      : '人工补登：这条事实由你在私语通道说出，系统没有猜过图外',
    undefined, at,
  ))
  const goal = goalRefOf(ctx, verdict.kind, verdict.id)
  if (goal !== undefined) {
    lines.push(snapshot(`当时在档：这次裁决挂在目标 ${goal} 下`, { kind: 'goal', id: goal }, at))
  }
  if (verdict.graphSeq !== undefined) {
    lines.push(snapshot(
      `当时的裁决落在组织图第 ${String(verdict.graphSeq)} 条边上——一跳可回`,
      verdict, at,
    ))
  }
  return lines
}

/** The private-ledger events one calibration receipt is born from. */
export interface CalibrationBirth {
  readonly calibrationId: string
  readonly type: 'calibration/opened'
  readonly data: Record<string, unknown>
}

/** Build one calibration receipt. 全部三段都是照片。 */
export function calibrationBirth(input: {
  readonly verdict: AnchoredText
  readonly verdictAnchor: OrgAnchor
  readonly fact: AnchoredText
  readonly source: FactSource
  readonly family: string
  readonly evidence: readonly AnchoredText[]
  readonly expectationId?: string
}): CalibrationBirth {
  const calibrationId = calibrationIdFor(input.verdictAnchor, input.fact, input.source)
  return {
    calibrationId,
    type: 'calibration/opened',
    data: {
      calibrationId,
      verdict: anchoredJson(input.verdict),
      fact: anchoredJson(input.fact),
      factSource: input.source,
      ...(input.expectationId === undefined ? {} : { expectationId: input.expectationId }),
      evidence: input.evidence.map(anchoredJson),
      // 由 `openCalibration` 用 `renderWhen` 覆写——这里先占位，schema 才收得下。
      thenText: '',
      family: input.family,
      idemKey: calibrationIdemKeyFor(input.verdictAnchor, input.fact, input.source),
    },
  }
}

/** 裁决当时的那句话 —— 组织侧是唯一知道标题的人，所以这里向它要一次，然后定格。 */
export function verdictSnapshot(ctx: Context, verdict: SeenVerdict): AnchoredText {
  const label = verdict.titleText
    ?? labelOf(ctx, verdict.anchor.kind, verdict.anchor.id)
    ?? `${verdict.anchor.kind}:${verdict.anchor.id}`
  return snapshot(label, verdict.anchor, verdict.at)
}

/** Every verdict this ledger might still be waiting on a fact for. */
export function watchedVerdicts(ctx: Context): readonly SeenVerdict[] {
  return seenVerdicts(ctx)
}
