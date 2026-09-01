/**
 * 事实回流（环3）—— **事实源三分** (v1.1 §3 / PTD-11).
 *
 * ① **图内结构性事实** —— 结构匹配优先。「结构性判定先于语义判定」是既有纪律：
 *    一条被裁决的活**又被打回**、同一目标上长出**回指你那次裁决的血缘新边**、
 *    同一目标上后来**写了一份差距简报**——这三件事都是图自己说的，不需要谁去读
 *    懂一句话的意思。
 * ② **人工补登（`fact/noted`）** —— 图外事实（线下评审、口头反馈、邮件结果）的
 *    唯一入口。系统不猜图外：「跟踪≠监工」对私账同样适用。
 * ③ **ambient 语义识别** —— **押门，P1 不做**。它在这个文件里没有分支，在
 *    {@link FactRef} 里没有构造函数——断言⑮ 的「语义识别路径不存在」因此是一句
 *    关于代码的话。
 *
 * 幂等锚 =（裁决边, 事实边）：同一事实多次回流不出第二张执；`dismissed` 之后不再
 * 出执（吸收态）；`reopened` 之后可再答 (断言④)。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphEvent } from '@yzj-next/graph'
import { calibrationIdFor, calibrationIdemKeyFor } from './families.ts'
import type { FactRef, OrgAnchor } from './types.ts'
import { anchorFor, goalRefOf, seenVerdicts, topicOf, type SeenVerdict } from './verdicts.ts'

/**
 * 血缘新边还算不算「这次裁决的后来」的时间边界.
 *
 * 一周 = 工作周的量级。验收之后这一周里在同一段对话、同一目标下长出的下一步，多半
 * 真是它的后续；再往后，因果就只剩下「碰巧在同一间屋子里」——而拿那个当证据，就是
 * 在替人制造一次他一眼就知道该按「配对错了」的配对。
 */
const LINEAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** One matched fact: what it is, and the sentence that will sit on the receipt. */
export interface MatchedFact {
  readonly fact: FactRef
  /** 后来那件事，一句话。 */
  readonly factText: string
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

  /*
    ① 被裁决的那一条又被打回。

    最强的一种：它不是「相关的事」，它就是**同一个对象**。所以它排在最前面，也
    是唯一一条不需要目标做中介的规则。
  */
  if (event.type === 'commitment/reopened' && asString(data.commitmentId) === id) {
    return {
      fact: { source: 'org', anchor: anchorFor(ctx, kind, id, event.seq), why: 'reopened' },
      factText: `你验收过的这一条又被打回：${asString(data.cause) ?? '返工'}`,
    }
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
      新登记**都会对着你上一次验收出一张回执，而三周后在同一段对话里登记的活，早已
      不是那次验收的后来了。

    一周是**工作周的量级**，不是一个精确阈值：验收之后这一周里长出的下一步，多半
    真的是它的后续；再往后，因果就只剩下「碰巧在同一间屋子里」。这个数字写在这里
    而不是散在判断里，因为下面那句 `factText` 说的和这里判的必须是同一个数。
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
      return {
        fact: {
          source: 'org',
          anchor: anchorFor(ctx, 'commitment', child, event.seq),
          why: 'lineage',
        },
        factText: spunOff
          ? `这次裁决之后，从这条活里拆出了下一步：${asString(data.what) ?? child}`
          : `这次裁决之后一周内，同一目标下长出了新的一步：${asString(data.what) ?? child}`,
      }
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
      return {
        fact: {
          source: 'org',
          anchor: anchorFor(ctx, 'assessment', assessmentId, event.seq),
          why: 'assessed',
        },
        factText: `同一目标上后来写了一份差距简报：${asString(data.summary) ?? assessmentId}`,
      }
    }
  }
  return undefined
}

/** Human-readable name of each structural rule. Shown on the receipt. */
export const WHY_LABEL: Readonly<Record<'reopened' | 'lineage' | 'assessed', string>> = {
  reopened: '结构匹配：被裁决的对象被打回',
  lineage: '结构匹配：本次裁决之后长出的血缘新边（转包子边，或一周内同目标同对话）',
  assessed: '结构匹配：同一目标上后来的差距简报',
}

/**
 * 「当时」那半边.
 *
 * 有显式预期就用**你自己的原话**；没有就说出隐式预期的措辞——**不立预期，回执照样
 * 会来**：裁决本身即预期。这两种写法的区别必须留在字面上，否则一条隐式的回执会
 * 看起来像是系统替你写了一句赌注。
 */
export function thenTextFor(
  verdict: OrgAnchor,
  expectationText: string | undefined,
): string {
  if (expectationText !== undefined) return `预期「${expectationText}」`
  const what = verdict.label ?? `${verdict.kind}:${verdict.id}`
  return `无显式预期——你的裁决是对「${what}」放行，隐式预期即「它已经够好」。`
}

/**
 * 证据行 —— **只许事实与假设措辞，禁心理判词** (§3 evidence 条款).
 *
 * 这是 prompt 纪律仅存的一处（原话直存律拿走了另外两处），所以它在这里是**代码**
 * 而不是一段说明：证据从图上的结构性事实生成，没有任何一句是关于你当时怎么想的。
 */
export function evidenceFor(
  ctx: Context,
  verdict: OrgAnchor,
  fact: FactRef,
): readonly string[] {
  const lines: string[] = []
  if (fact.source === 'org') lines.push(WHY_LABEL[fact.why])
  else lines.push('人工补登：这条事实由你在私语通道说出，系统没有猜过图外')
  const goal = goalRefOf(ctx, verdict.kind, verdict.id)
  if (goal !== undefined) lines.push(`当时在档：这次裁决挂在目标 ${goal} 下`)
  /*
    **证据行只许写事实，而「当时」必须真的是当时。**

    这里原来有一行「当时那个对象最后一次变动：…」，读的是 `updatedAt`——可那是**读
    这一刻**的值，而事实刚刚才改过它。于是这一行写着「当时」，说的却是「现在」：一句
    自称是证据的话，本身不成立。删掉，换成一条真的关于当时的：你下这个判断时，图上
    这个对象在哪一步。

    这条纪律比这一行重要：证据行是 prompt 纪律仅存的一处（原话直存律拿走了另外两处），
    而它守的是「只许事实与假设措辞，禁心理判词」。一句时态错了的事实，已经不是事实。
  */
  if (verdict.graphSeq !== undefined) {
    lines.push(`当时的裁决落在组织图第 ${String(verdict.graphSeq)} 条边上——一跳可回`)
  }
  return lines
}

/** The private-ledger events one calibration receipt is born from. */
export interface CalibrationBirth {
  readonly calibrationId: string
  readonly type: 'calibration/opened'
  readonly data: Record<string, unknown>
}

/**
 * Build one calibration receipt. Returns `undefined` when its anchor is already
 * taken — the idempotency check itself, kept next to the construction so the
 * two cannot drift.
 */
export function calibrationBirth(input: {
  readonly verdict: OrgAnchor
  readonly fact: FactRef
  readonly factText: string
  readonly family: string
  readonly thenText: string
  readonly evidence: readonly string[]
  readonly expectationId?: string
}): CalibrationBirth {
  const calibrationId = calibrationIdFor(input.verdict, input.fact)
  return {
    calibrationId,
    type: 'calibration/opened',
    data: {
      calibrationId,
      verdictRef: input.verdict,
      factRef: input.fact,
      ...(input.expectationId === undefined ? {} : { expectationId: input.expectationId }),
      evidence: [...input.evidence],
      thenText: input.thenText,
      factText: input.factText,
      family: input.family,
      idemKey: calibrationIdemKeyFor(input.verdict, input.fact),
    },
  }
}

/** Every verdict this ledger might still be waiting on a fact for. */
export function watchedVerdicts(ctx: Context): readonly SeenVerdict[] {
  return seenVerdicts(ctx)
}
