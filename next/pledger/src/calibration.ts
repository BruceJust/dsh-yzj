/**
 * 校准回执卡 —— **当时裁决 × 后来事实**, the middle of the ring.
 *
 * 原料图已天然生产：组织侧本来就记着你什么时候裁的、后来发生了什么。回执不生产
 * 新事实，它只是把两条已经在图上的边**摆在同一行里**，然后让你自己下那一格。
 *
 * Four disciplines live in this file:
 *
 * - **归因由人下，agent 不代下.** The four cells are actions; nothing computes
 *   one. 候选注只给**证据与假设**（「差距条目②当时已在档」），不给心理判词
 *   （「没当回事」= 替人写好的归因，违规）。
 * - **第五出口「配对错了」.** 宁空勿错的私账版：事实与裁决无关时，判例不入账。
 *   它是吸收态，同一幂等锚不再出执——但**可以纠回**，因为更正即追加。
 * - **未答不成欠账.** 不老化、不可催、不进任何聚合——这本账的债主是你自己。
 *   That is why this definition declares no `demand` (the private card type
 *   cannot declare one) and why nothing in this file has a deadline.
 * - **一跳可回.** 正文里的锚一跳回组织侧对象；断链时判例文字仍在——判例是你的史，
 *   锚失效不蒸发内容（真身之变律的私账形态）。
 */

import type { CardAction, CardTransition } from '@yzj-next/cards'
import type { GraphActor } from '@yzj-next/graph'
import type { PledgerCardDefinition } from './bus.ts'
import {
  ATTRIBUTION_LABEL,
  type Attribution, type FactRef, type OrgAnchor,
} from './types.ts'

/** Materialized calibration state. */
export interface CalibrationState {
  readonly calibrationId: string
  readonly status: 'open' | 'answered' | 'dismissed'
  readonly verdictRef: OrgAnchor
  readonly factRef: FactRef
  readonly expectationId?: string
  readonly evidence: readonly string[]
  /** 当时那句话：预期原文，或隐式预期的措辞。 */
  readonly thenText: string
  /** 后来那件事：事实的一句话。 */
  readonly factText: string
  readonly family: string
  readonly attribution?: Attribution
}

/**
 * 四格各自的**候选注** —— 证据与假设，绝不心理判词.
 *
 * 每一句都在说「这一格意味着什么」，没有一句在说「你当时怎么想的」。这条界线是
 * v4.25r 显示层收紧的原文：格子是判例的标签，不是分数的原料。
 */
export const ATTRIBUTION_NOTE: Readonly<Record<Attribution, string>> = {
  q1: '判例入账，姿势可复用',
  q2: '结果对了，但过程不可复用——下次同样的做法未必再对',
  q3: '当时可得的信息足以看出来，而没有看出来',
  q4: '当时不可知；同样的判断再来一次仍然会这么下',
}

const isOperator = (actor: GraphActor): boolean => actor.kind === 'operator'

const cell = (id: Attribution, keywords: readonly string[]): CardAction<CalibrationState> => ({
  id,
  label: ATTRIBUTION_LABEL[id],
  keywords: [...keywords],
  allowedActors: isOperator,
  available: state => state.status === 'open',
})

export const calibrationCard: PledgerCardDefinition<CalibrationState> = {
  type: 'calibration',

  actions: [
    cell('q1', ['对了因判断', 'q1', '①']),
    cell('q2', ['对了因运气', 'q2', '②']),
    cell('q3', ['错了因判断', 'q3', '③']),
    cell('q4', ['错了因世界', 'q4', '④']),
    {
      id: 'dismiss',
      label: '配对错了',
      style: 'neutral',
      keywords: ['配对错了', '无关', '不是这件事'],
      allowedActors: isOperator,
      available: state => state.status === 'open',
    },
    {
      /**
       * 纠回 —— dismissed 的出口.
       *
       * 「配对错了」是吸收态，不是终态：**更正即追加，不改史**。一个没有回头路的
       * 第五出口，会让人在不确定的时候不敢用它——而不敢用的出口等于没有出口。
       */
      id: 'reopen',
      label: '纠回',
      keywords: ['纠回', '重新打开'],
      allowedActors: isOperator,
      available: state => state.status === 'dismissed',
    },
  ],

  /**
   * 已归因即完结；**已驳回不算完结**.
   *
   * dismissed 留着「纠回」这个动作，所以它对动作总线仍然是活的。它不会因此出现在
   * 任何聚合里——私账对象结构上就不在那些查询的定义域内（三不入靠存储分离）。
   */
  isResolved: state => state.status === 'answered',

  renderText: (state) => {
    const anchor = state.factRef.source === 'org'
      ? `锚：${state.factRef.anchor.kind}:${state.factRef.anchor.id}`
      : '锚：你补登的事实'
    return {
      body: [
        '【校准回执】当时裁决 × 后来事实',
        `当时：${state.thenText}`,
        `事实：${state.factText}`,
        ...(state.evidence.length === 0 ? [] : ['证据：', ...state.evidence.map(line => `· ${line}`)]),
        anchor,
        '',
        state.status === 'dismissed'
          ? '已标注「配对错了」：这条事实与该裁决无关，判例未入账。回复「纠回」可以撤回这个标注。'
          : '归因由你下，我不代下：回复 ①对了因判断 / ②对了因运气 / ③错了因判断 / ④错了因世界，'
            + '或「配对错了」。',
        `[calib#calibration:${state.calibrationId}]`,
      ].join('\n'),
      replyHints: state.status === 'dismissed'
        ? ['纠回']
        : ['①', '②', '③', '④', '配对错了'],
    }
  },

  onResolved: state => ({
    echoText: [
      `【校准回执 · 已对表】${state.attribution === undefined ? '' : ATTRIBUTION_LABEL[state.attribution]}`,
      '已入对表（金库可查）· 归因可纠（更正即追加，不改史）。',
    ].join('\n'),
  }),

  apply: (state, action: CardAction<CalibrationState>, actor): CardTransition => {
    if (action.id === 'dismiss') {
      return {
        events: [{
          type: 'calibration/dismissed',
          data: { calibrationId: state.calibrationId },
          actor,
        }],
      }
    }
    if (action.id === 'reopen') {
      return {
        events: [{
          type: 'calibration/reopened',
          data: { calibrationId: state.calibrationId },
          actor,
        }],
      }
    }
    /*
      对表归档 —— 检验中 → 已对表的迁移时刻.

      预期的终局由**回执的归因**触发，不由时间触发：一个过了检验点却没人对表的预期
      仍然在等你，而它等的是一个判断，不是一个时钟。
    */
    return {
      events: [
        {
          type: 'calibration/answered',
          data: { calibrationId: state.calibrationId, attribution: action.id },
          actor,
        },
        ...(state.expectationId === undefined ? [] : [{
          type: 'expectation/settled',
          data: { expectationId: state.expectationId, calibrationRef: state.calibrationId },
          actor,
        }]),
      ],
    }
  },
}

/**
 * 判例 —— 就是 `calibration/answered` 那条留痕本身 (§3 末).
 *
 * 没有「判例」这种事件、没有「判例」这张表。模式派生自这些留痕，而它们派生自
 * 你的裁决与后来的事实——一路上没有任何一步是系统的意见。
 */
export interface Case {
  readonly calibrationId: string
  readonly attribution: Attribution
  readonly at: number
  readonly family: string
  readonly thenText: string
  readonly factText: string
  readonly verdictRef: OrgAnchor
}
