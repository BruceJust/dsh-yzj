/**
 * The commitment card.
 *
 * A commitment owed by a PERSON is the case that matters here: the agent is an
 * observer, so the only way the graph learns anything after registration is
 * through this card's verbs and through receipts. Give it no answer path and
 * the commitment board fills with zombies — which is exactly why `void` is a
 * first-class action next to `done`.
 */

import type { CardDefinition } from '@yzj-next/cards'
import { isSettled, type CommitmentState } from './family.ts'

/**
 * 谁能验收这份交付 —— **委派者 ∪ 操作者**（§5.2）。
 *
 * 验收自己委派的活是主权本义。委派者由 reduce 从出生事件的 actor 盖上；老数据里
 * 没有这一格时**放行**——一条谁都验收不了的活，是比放宽一点更坏的结果（板上那条
 * 又变回断头路）。宁可宽，不可锁死。
 */
function mayAccept(openId: string | undefined, state: CommitmentState): boolean {
  if (openId === undefined) return false
  return state.delegatedBy === undefined || state.delegatedBy === openId
}

/**
 * 主张交付的这个人，同时也是要验收的那个人吗。
 *
 * 是的话，**主张即验收**——再请他按一次「验收」，是同一个主权时刻收两次费（和提案
 * 裁决确认后不再弹第二张确认卡同一条道理）。「我欠我自己的活做完了」需要两次点击，
 * 是审批疲劳的教科书样本。
 */
export function claimIsAcceptance(openId: string | undefined, state: CommitmentState): boolean {
  return mayAccept(openId, state) && state.executor.kind === 'human'
    && state.executor.openId === openId
}

function executorLabel(state: CommitmentState): string {
  return state.executor.kind === 'agent'
    ? 'agent'
    : state.executor.name ?? state.executor.openId
}

function statusLabel(status: CommitmentState['status']): string {
  switch (status) {
    case 'closed': return '已完成'
    case 'voided': return '已作废'
    case 'merged': return '已合并'
    default: return '进行中'
  }
}

export const commitmentCard: CardDefinition<CommitmentState> = {
  type: 'commitment',
  updateStrategy: 'append-echo',

  actions: [
    {
      id: 'done',
      label: '完成',
      style: 'primary',
      keywords: ['完成', '做完了', '已完成', 'done'],
      // Whoever is in the audience may report it done — the executor usually
      // is not the operator, and making the operator relay that is exactly the
      // pumping the design forbids.
      allowedActors: actor => actor.openId !== undefined,
      // 已经主张过交付的，这颗按钮就退场——该按的是「验收」或「打回」。
      available: state => state.status === 'open' && state.delivery === undefined,
    },
    {
      /*
        验收 —— 双动词之一 (v4.21 第一档⑥「验收断链接通」)。

        只在交付被主张之后出现：没有交付可验的时候摆一颗「验收」，是请人去验收一份
        不存在的产出（此前修过的僵尸问题）。
      */
      id: 'accept',
      label: '验收',
      style: 'primary',
      keywords: ['验收', '收下了', '可以', 'accept'],
      allowedActors: (actor, state) => mayAccept(actor.openId, state),
      available: state => state.status === 'open' && state.delivery !== undefined,
    },
    {
      /*
        打回 —— 拒收 → 返工 → 再验收，**在同一条上循环**，轮次可见。

        它不是作废：承诺没死，死的是这一版交付主张。作废是「这件事不做了」，打回是
        「这件事还没做好」——两者混成一个按钮，等于让一次质量判断顺手杀掉一条承诺。
      */
      id: 'reject',
      label: '打回',
      style: 'danger',
      keywords: ['打回', '拒收', '不行', '返工'],
      needsInput: true,
      allowedActors: (actor, state) => mayAccept(actor.openId, state),
      available: state => state.status === 'open' && state.delivery !== undefined,
    },
    {
      id: 'void',
      label: '作废',
      style: 'danger',
      keywords: ['作废', '不做了', '取消这条'],
      needsInput: true,
      allowedActors: actor => actor.openId !== undefined,
      available: state => state.status === 'open',
    },
  ],

  isResolved: state => isSettled(state.status),

  /**
   * 第三层：**信号 + 就近动词**，不进决断面 (v4.15 三层定律)。
   *
   * 一条没做完的承诺不是一个「等你答」的问题——它是一件还没发生的事。逾期、
   * 没信号、真身被改过都是**信号**，动词（完成／作废／催／顺延）就近长在承诺板
   * 那一行上。
   *
   * 把它塞进决断条，条会立刻长成一份待办清单：每一条没做完的活都要人去按一下
   * 「我知道了」。那正是「宁默认勿阻塞」拦的东西，也是零维护死掉的样子。
   */
  demand: (state) => {
    if (state.status !== 'open') return undefined
    /*
      交付被主张了 —— 这一刻它**才**是一个「等你答」的东西 (v4.21 第一档⑥)。

      此前一条人执行的承诺在任何状态下都只是信号，于是「他交了、等我认」这个真正需要
      人的时刻，在决断面上根本不存在。这就是断头路：登记有呼吸，交付无验收落座。

      返工轮次**不写进徽标**（和验收卡同一条纪律）：徽标是一格固定词汇，塞进「待验收 ·
      第 2 版」就把一个变长的事实挤进了一个不变长的槽。轮次的位置在卡正文上。
    */
    if (state.delivery !== undefined) {
      return {
        layer: 'blocking',
        mode: 'two-verb-acceptance',
        label: state.delivery.claim === '' ? state.what : state.delivery.claim,
      }
    }
    return { layer: 'signal', mode: 'open-question', label: `进行中：${state.what}` }
  },

  renderText: state => ({
    body: [
      `【承诺·${statusLabel(state.status)}】${state.what}`,
      `执行者：${executorLabel(state)}${state.due === undefined ? '' : ` · 期限 ${state.due}`}`,
      // Detaching writes an EMPTY string rather than deleting the key (the
      // fold is a merge), so `undefined` is not the only absent value — and
      // this is the projection that gets posted into a real group.
      ...(state.parentGoalRef === undefined || state.parentGoalRef === ''
        ? []
        : [`承 ${state.parentGoalRef}${state.attachedVia === 'inferred' ? '（推断，可回复「改挂 <目标>」纠正）' : ''}`]),
      ...(state.lastReceipt === undefined ? [] : [`最近回执：${state.lastReceipt}`]),
      // 交付主张 + 返工轮次上卡（轮次不进徽标，位置在这儿）。
      ...(state.delivery === undefined
        ? []
        : [
          `交付：${state.delivery.claim}${state.delivery.anchor === undefined ? '' : ` — ${state.delivery.anchor}`}`,
          ...((state.delivery.round ?? 0) > 0 ? [`已返工 ${String(state.delivery.round)} 轮`] : []),
        ]),
      `[card#commitment:${state.commitmentId}]`,
    ].join('\n'),
    replyHints: state.status !== 'open'
      ? []
      : state.delivery !== undefined
        ? ['验收', '打回 <原因>', '作废 <原因>']
        : ['完成', '作废 <原因>'],
  }),

  onResolved: state => ({
    echoText: `【承诺·${statusLabel(state.status)}】${state.what}${state.cause === undefined ? '' : `（${state.cause}）`}`,
  }),

  apply: (state, action, actor, input) => {
    if (action.id === 'void') {
      return {
        events: [{
          type: 'commitment/voided',
          data: {
            commitmentId: state.commitmentId,
            cause: input === undefined || input.trim() === '' ? '未说明' : input.trim(),
          },
          actor,
        }],
      }
    }
    if (action.id === 'accept') {
      return {
        events: [{
          type: 'commitment/closed',
          data: { commitmentId: state.commitmentId, cause: 'accepted' },
          actor,
        }],
      }
    }
    if (action.id === 'reject') {
      return {
        events: [{
          type: 'commitment/rework',
          data: {
            commitmentId: state.commitmentId,
            reason: input === undefined || input.trim() === '' ? '未说明' : input.trim(),
            // 轮次从承诺上数，不从那份即将被删掉的交付主张里数。
            round: (state.round ?? 0) + 1,
          },
          actor,
        }],
      }
    }
    /*
      「完成」= **主张交付**，不是终态 (v4.21 第一档⑥)。

      「他说做完了」和「我认了这份交付」是两个人的两次判断，此前被压成同一件事：
      执行者按一下，系统直接判终态，而委派的人从来没有被问过。

      **除非主张的人就是要验收的那个人**——那时再请他按一次「验收」，是同一个主权
      时刻收两次费。「我欠我自己的活做完了」要点两下，是审批疲劳的教科书样本。
    */
    if (claimIsAcceptance(actor.openId, state)) {
      return {
        events: [{
          type: 'commitment/closed',
          data: { commitmentId: state.commitmentId, cause: 'done' },
          actor,
        }],
      }
    }
    return {
      events: [{
        type: 'commitment/delivered',
        data: {
          commitmentId: state.commitmentId,
          delivery: {
            claim: input === undefined || input.trim() === '' ? '（说了完成，没有细节）' : input.trim(),
            at: Date.now(),
            // 重交时把承诺上的轮次抄进这一版交付，卡上才写得出「已返工 N 轮」。
            ...(state.round === undefined ? {} : { round: state.round }),
          },
        },
        actor,
      }],
    }
  },
}
