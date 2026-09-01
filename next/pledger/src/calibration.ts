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
  type AnchoredText, type Attribution, type FactSource,
} from './types.ts'

/** Materialized calibration state. */
export interface CalibrationState {
  readonly calibrationId: string
  readonly status: 'open' | 'answered' | 'dismissed'
  /** **当时** —— 裁决快照。正文渲染只读它。 */
  readonly verdict: AnchoredText
  /** **后来** —— 事实快照。同上。 */
  readonly fact: AnchoredText
  readonly factSource: FactSource
  readonly expectationId?: string
  readonly evidence: readonly AnchoredText[]
  /**
   * 「当时」那一栏的成文 —— 由 `renderWhen` 在出生时算好并定格.
   *
   * 它是**纯函数的产物**（两输入联合类型，第三种不可构造），存下来是因为渲染面
   * 不该每次重算一遍人话；重算本身没害处，可一旦有人把它改成「渲染时问一次模型」，
   * 这一栏就从陈列变成了推演。存成字面，那条路就没有入口。
   */
  readonly thenText: string
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

  /**
   * 自聊 DM 的文本投影 —— 同 `invite.ts`：**P1 只出不进**，所以这里报信不提问。
   *
   * 归因四格在桌面上按。让 DM 也能答要的是通道分诊认得出私账 ref，而那条路
   * 押 P5（§9 移动投影）；在它到来之前写「回复①」，是把一个做不到的动作摆在
   * 人面前——而这张卡本来就是关于诚实的。
   */
  renderText: (state) => {
    /*
      **正文三段全部渲染照片** (立此存照律 / 断言⑯).

      这个函数的入参里只有 `state`——没有组织图 service，没有 ctx。想在这里回图
      解析一个锚，**连句柄都没有**。于是「拷走目录之后回执还读得出来」不是一句
      承诺，是这个签名的推论。
    */
    const anchor = state.fact.anchor
    const anchorLine = anchor === undefined
      ? '锚：你补登的事实（图外，本来就没有锚）'
      : `锚：${anchor.kind}:${anchor.id}`
    return {
      body: [
        '【校准回执】当时裁决 × 后来事实',
        `当时：${state.thenText}`,
        `事实：${state.fact.text}`,
        ...(state.evidence.length === 0
          ? []
          : ['证据：', ...state.evidence.map(line => `· ${line.text}`)]),
        anchorLine,
        '',
        state.status === 'dismissed'
          ? '已标注「配对错了」：这条事实与该裁决无关，判例未入账。纠回在桌面工作台上。'
          : '归因由你下，我不代下——四格（对了因判断 / 对了因运气 / 错了因判断 / 错了因世界）'
            + '与「配对错了」都在桌面工作台的私语面上按。',
        '未答不成欠账：不老化、不可催，这本账的债主是你自己。',
        `[calib#calibration:${state.calibrationId}]`,
      ].join('\n'),
      replyHints: [],
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
  /** 后来那件事的**照片**——断了组织图也读得出来。 */
  readonly fact: AnchoredText
  /** 当时那次裁决的**照片**。同上。 */
  readonly verdict: AnchoredText
}
