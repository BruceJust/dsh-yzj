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
      available: state => state.status === 'open',
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
  demand: state => (
    state.status === 'open'
      ? { layer: 'signal', mode: 'open-question', label: `进行中：${state.what}` }
      : undefined
  ),

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
      `[card#commitment:${state.commitmentId}]`,
    ].join('\n'),
    replyHints: state.status === 'open' ? ['完成', '作废 <原因>'] : [],
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
    return {
      events: [{
        type: 'commitment/closed',
        data: { commitmentId: state.commitmentId, cause: 'done' },
        actor,
      }],
    }
  },
}
