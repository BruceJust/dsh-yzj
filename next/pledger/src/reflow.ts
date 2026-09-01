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
    ② 血缘新边 —— 同一目标下长出的新活，而且它的出处回指你裁决的那段对话。

    只看目标会太宽（一个目标下每天都有新活）；只看话题会太窄（后续常常另起一段）。
    两条都要，才是「你那次裁决之后，这件事在你决定的那个地方长出了下一步」。
  */
  if (event.type === 'commitment/opened') {
    const sameGoal = asString(data.parentGoalRef) === goal || asString(data.goalRef) === goal
    const source = asString(data.sourceAnchor) ?? ''
    const topic = topicOf(ctx, kind, id)
    const pointsBack = topic !== undefined && source.includes(topic)
    if (sameGoal && pointsBack) {
      const child = asString(data.commitmentId)
      if (child !== undefined) {
        return {
          fact: {
            source: 'org',
            anchor: anchorFor(ctx, 'commitment', child, event.seq),
            why: 'lineage',
          },
          factText: `这次裁决之后，同一目标下长出了新的一步：${asString(data.what) ?? child}`,
        }
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
  lineage: '结构匹配：同一目标下回指本次裁决的血缘新边',
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
  const at = ctx.get('yzjGraph')?.rawObject(verdict.kind, verdict.id)?.updatedAt
  if (at !== undefined) {
    lines.push(`当时那个对象最后一次变动：${new Date(at).toLocaleString('zh-CN', { hour12: false })}`)
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
