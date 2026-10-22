/**
 * The confirmation card — the one card type P1 ships, and the design's most
 * validated object (DM fallback approval was the high point of five of the six
 * scenarios).
 *
 * `renderText` has to be self-sufficient prose: the operator reading it in
 * Yunzhijia may have no client of ours at all, so the message carries the
 * whole question and the exact words that answer it. It carries a HANDLE, not
 * a state — the live state is always read back from the graph.
 */

import type { CardDefinition } from '@yzj-next/cards'
import type { JsonValue } from '@yzj-next/graph'
import { isTerminal, type ApprovalState } from './family.ts'

/** Free text after a keyword ("取消 价格没定") becomes the rejection note. */
const RETRY_HINT = '回复「重试」可重新发起（此前步骤可能已部分执行，请核对后再作）'

function formatDeadline(deadline: number): string {
  return new Date(deadline).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** One argument line, clipped so a large payload cannot eat the whole message. */
function argLine(key: string, value: JsonValue): string {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value)
  const text = rendered.replace(/\s+/gu, ' ').trim()
  return `· ${key}：${text.length > 200 ? `${text.slice(0, 200)}…` : text}`
}

function argLines(args: JsonValue): string[] {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return args === null ? [] : [argLine('参数', args)]
  }
  return Object.entries(args).map(([key, value]) => argLine(key, value))
}

function statusLabel(status: ApprovalState['status']): string {
  switch (status) {
    case 'approved': return '已放行'
    case 'rejected': return '已拒绝'
    case 'expired': return '已超时自动拒绝'
    case 'interrupted': return '因重启中断'
    case 'superseded': return '已重新发起'
    default: return '等待确认'
  }
}

/**
 * 这一次确认是哪一件 —— 「云之家操作确认：」是守门那一层给 reason 加的抬头。
 *
 * 横条上徽标已经说了「确认」，再说一遍就把一行十来个字吃掉三分之一；卡头、终态回声写着
 * 「【云之家确认】」，过程摘要列在「确认记录」底下——每一处都已经说过了。此前只有横条
 * 剥掉了它，于是过期回声读作「【云之家确认·已超时自动拒绝】云之家操作确认：新建知识库
 * 文档」（实测 2026-10-22）。
 */
export function approvalWhat(reason: string): string {
  return reason.replace(/^云之家操作确认[：:]\s*/u, '') || reason
}

const isDecider = (openId: string | undefined, state: ApprovalState): boolean => (
  openId !== undefined && openId === state.decider
)

/**
 * 按下去的是什么——「确认写入」「先不发」，不只一个「确认」(界面重设计 律二).
 *
 * 桌面按钮和云之家里的「回 1 确认写入 · 2 先不写」读的都是这里；桌面那一份
 * （`surface/src/client/words.ts`，浏览器包引不到这个包）有测试钉着和它一致。
 */
export function approvalVerbs(toolName: string): { readonly yes: string; readonly no: string; readonly act: string } {
  if (toolName === '/handoff') return { yes: '确认移交', no: '先不移交', act: '移交' }
  if (/_send$|_reply$|_post$/u.test(toolName)) return { yes: '确认发出', no: '先不发', act: '发' }
  if (/_delete$|_remove$/u.test(toolName)) return { yes: '确认删除', no: '先不删', act: '删' }
  return { yes: '确认写入', no: '先不写', act: '写' }
}

export const approvalCard: CardDefinition<ApprovalState> = {
  type: 'approval',

  // Ordinary Yunzhijia messages cannot be edited, so a decided card is
  // announced by a NEW message carrying the same handle. `edit-in-place`
  // becomes available for this same card once the native message-card channel
  // lands — the strategy is a property of the card, not of the transport.
  updateStrategy: 'append-echo',

  actions: [
    {
      id: 'approve',
      label: '确认',
      labelFor: state => approvalVerbs(state.toolName).yes,
      style: 'primary',
      keywords: ['确认', '同意', '批准', '放行', 'ok', 'y', 'yes'],
      /*
        **如实声明，判据留给听的人** —— 这是「种类而不是布尔」买到的东西。

        写确认确实是一次人签发的裁决终态，所以这里照实说。它高频低信息、不该触发
        任何下游打扰，可那是**下游的判据**（私账侧谱表的信息量否决位），不是这个
        家族该替谁做的判断。上一版这里什么都不写，等于把下游的判据藏在了组织侧的
        一处沉默里——沉默是最难被 review 看见的耦合。
      */
      verdict: 'write-confirm',
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'pending',
    },
    {
      id: 'reject',
      label: '取消',
      labelFor: state => approvalVerbs(state.toolName).no,
      style: 'danger',
      keywords: ['取消', '拒绝', '不要', 'no', 'n'],
      needsInput: true,
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'pending',
    },
    {
      id: 'retry',
      label: '重试',
      keywords: ['重试', '重新发起', 'retry'],
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      // One retry, and only from the interrupted state. A second press lands
      // on the terminal `superseded` card and folds into a duplicate answer,
      // so double-tapping cannot double-execute.
      available: state => state.status === 'interrupted' && state.retried !== true,
    },
  ],

  isResolved: state => isTerminal(state.status),

  /**
   * ①单答确认——一个问题一个答案，答之前那一步真的动不了。
   *
   * 字面里**不重复动词**：徽标已经写了「待确认」，chip 上再写一遍「确认：」，等于
   * 在一条只有十来个字的横条上花掉三个字说一句已经说过的话。徽标说是哪一种，
   * 字面说是哪一件。
   */
  demand: state => (
    state.status === 'pending'
      ? { layer: 'blocking', mode: 'single-confirm', label: approvalWhat(state.reason) }
      : state.status === 'interrupted'
        ? { layer: 'blocking', mode: 'single-confirm', label: approvalWhat(state.reason), badge: '待重试', verb: '重试' }
        : undefined
  ),

  renderText: (state) => {
    // 抬头已经说了是「云之家确认」，守门那一层加在 reason 前面的同一句不再说第二遍。
    const head = `【云之家确认】${approvalWhat(state.reason)}`
    const body = [
      head,
      // 「每次都问」是判据；「不可撤销」只是其中一种理由（另一种是改变触达面）。
      `工具：${state.toolName}${state.level === 'strong' ? '（强风险，每次都问）' : ''}`,
      ...(argLines(state.args).length === 0 ? [] : ['参数：', ...argLines(state.args)]),
    ]
    if (state.status === 'interrupted') {
      return {
        // 中断不给这道题续命：重试也只在原来的期限之内（过了就自动过期）。
        body: [...body, '', `状态：${statusLabel(state.status)}`, `${RETRY_HINT}；${formatDeadline(state.deadline)} 前有效。`].join('\n'),
        replyHints: ['重试'],
      }
    }
    return {
      body: [
        ...body,
        '',
        `回复「确认」放行，回复「取消 <原因>」拒绝；${formatDeadline(state.deadline)} 前未回复将自动拒绝。`,
        `[card#approval:${state.approvalId}]`,
      ].join('\n'),
      replyHints: ['确认', '取消'],
    }
  },

  /**
   * The terminal echo. Yunzhijia text cannot be edited (F1), so a decided card
   * whose "please confirm" line is still sitting in the chat has to be
   * answered by a new message — otherwise the call to action dangles forever.
   */
  onResolved: state => ({
    echoText: [
      `【云之家确认·${statusLabel(state.status)}】${approvalWhat(state.reason)}`,
      ...(state.note === undefined || state.note === '' ? [] : [`理由：${state.note}`]),
      `[card#approval:${state.approvalId}]`,
    ].join('\n'),
  }),

  apply: (state, action, actor, input) => {
    if (action.id === 'retry') {
      return {
        events: [{
          type: 'approval/superseded',
          data: {
            approvalId: state.approvalId,
            // The anchor a retry runner uses to re-issue the original work.
            retryTaskAnchor: `${state.approvalId}:${state.argsDigest}`,
          },
          actor,
        }],
      }
    }
    const note = input === undefined ? undefined : input.trim()
    return {
      events: [{
        type: 'approval/decided',
        data: {
          approvalId: state.approvalId,
          status: action.id === 'approve' ? 'approved' : 'rejected',
          decidedBy: actor.openId ?? actor.kind,
          ...(note === undefined || note === '' ? {} : { note }),
        },
        actor,
      }],
    }
  },
}
