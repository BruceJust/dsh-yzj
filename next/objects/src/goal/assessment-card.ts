/**
 * 差距简报卡 — 验收权 ≠ 验收材料 (v4.10).
 *
 * The acceptance of a goal has been a human act since the first ruling and
 * stays one. What was missing was the MATERIAL: somebody had to reconstruct,
 * by hand, what had actually been delivered against what had been promised.
 * That reconstruction is derived data — child commitments' terminal states,
 * artifacts produced under them, the criteria the goal was signed with — so an
 * agent can assemble it and a person can decide on it.
 *
 * **代差点**: an OKR tool's check-in is a self-reported number. This report's
 * every line points at an object in the graph — that is the dividend of having
 * an execution graph at all, and it is why the evidence column is not optional.
 *
 * The card never closes a goal by itself. 「验收」 is the operator's press, and
 * 「继续」 is a real answer rather than a dismissal: it says the goal is still
 * live and this reading of it has been seen.
 */

import type { CardDefinition } from '@yzj-next/cards'
import type { GraphAppendInput } from '@yzj-next/graph'
import { goalCommitmentIdFor, type AssessmentLine, type AssessmentState } from './family.ts'

/** 递给谁就是谁验收；没记 decider 的老卡退回旧行为，卡不能变成没人能答。 */
function isDecider(openId: string | undefined, state: AssessmentState): boolean {
  if (openId === undefined) return false
  return state.decider === undefined || state.decider === openId
}

const VERDICT: Record<AssessmentLine['verdict'], string> = {
  met: '✓ 已达成',
  partial: '◐ 部分',
  missing: '✗ 缺失',
}

export const assessmentCard: CardDefinition<AssessmentState> = {
  type: 'assessment',
  updateStrategy: 'append-echo',

  actions: [
    {
      id: 'accept',
      label: '验收',
      style: 'primary',
      keywords: ['验收', '通过', '收了'],
      // 人工验收 is the whole point of the family; an agent actor has no
      // openId here and therefore no way in. And it is ONE person's act: the
      // report is assembled for whoever asked, from evidence spanning places
      // others cannot see, so 「有 openId」 was never the right bar.
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'open',
    },
    {
      id: 'continue',
      label: '继续',
      style: 'neutral',
      keywords: ['继续', '还没完', '再跑'],
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'open',
    },
  ],

  isResolved: state => state.status !== 'open',

  /**
   * ⑤多出口评估——出口不止一个，所以它不是一张确认卡。
   *
   * 验收／差距变委派／继续／作废，四条路都是对这份材料的正当答复。把它画成
   * 「确认吗」会逼人在两个错误答案之间选一个。
   */
  demand: state => (
    state.status === 'open'
      ? {
        layer: 'blocking',
        mode: 'multi-exit-assessment',
        // 和验收卡共用「待验收」这个徽标，所以字面得自报家门——否则两件不同的事在
        // 条上长得一模一样。
        label: `差距简报 · ${state.goalName ?? state.goalRef}`,
      }
      : undefined
  ),

  renderText: state => ({
    body: [
      `【差距简报】${state.goalName ?? state.goalRef}`,
      state.summary,
      ...state.lines.map((line, index) => (
        `${String(index + 1)}. ${VERDICT[line.verdict]} ${line.criterion}`
        + (line.evidence === '' ? '' : `\n　 依据：${line.evidence}`)
      )),
      '这是材料，不是判决——验收是你的动作。',
      `[card#assessment:${state.assessmentId}]`,
    ].join('\n'),
    replyHints: state.status === 'open' ? ['验收', '继续'] : [],
  }),

  onResolved: state => ({
    echoText: state.status === 'accepted'
      ? `【目标·已验收】${state.goalName ?? state.goalRef}`
      : `【差距简报·继续】${state.goalName ?? state.goalRef}——目标仍在进行。`,
  }),

  apply: (state, action, actor) => {
    const events: GraphAppendInput[] = [{
      type: 'assessment/closed',
      data: {
        assessmentId: state.assessmentId,
        status: action.id === 'accept' ? 'accepted' : 'continued',
        ...(actor.openId === undefined ? {} : { decidedBy: actor.openId }),
      },
      actor,
    }]
    if (action.id === 'accept') {
      /*
        终态：人工验收 — and this press IS it.

        The goal's own commitment closes with cause `accepted`, which is the
        same terminal the conversation path uses. 聚合是信号不是状态: the child
        counts never did this, and never will.
      */
      events.push({
        type: 'commitment/closed',
        data: { commitmentId: goalCommitmentIdFor(state.goalRef), cause: 'accepted' },
        actor,
      })
    }
    return { events }
  },
}
