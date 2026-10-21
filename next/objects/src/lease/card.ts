/**
 * 租约确认卡 —— ①单答确认，**强确认**：签发一份租约 = 这一期这类写入不再问你。
 *
 * 发现入口在疲劳现场（私账取景框组头的「不用再问我」是它的传送门）；签发是人的
 * 主权动作；期中可收回；到期自动收回并留审计证据。
 */

import type { CardDefinition } from '@yzj-next/cards'
import type { LeaseState } from './family.ts'

const isDecider = (openId: string | undefined, state: LeaseState): boolean => openId !== undefined && openId === state.decider

/** 卡上说「文档」不说 `doc`：这张卡会原样投进云之家。 */
const CLASS_LABEL: Readonly<Record<string, string>> = { doc: '文档', sheet: '表格', calendar: '日程', im: '群消息', file: '文件', drive: '网盘' }

const when = (at: number): string => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour12: false })

export const leaseCard: CardDefinition<LeaseState> = {
  type: 'lease',
  updateStrategy: 'append-echo',
  actions: [
    {
      id: 'grant',
      label: '签发',
      style: 'primary',
      keywords: ['签发', '同意租约', '不用再问'],
      // 租约签发本身是人签发的裁决终态；如实广播，判据留给听的人。
      verdict: 'lease-grant',
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'proposed',
    },
    {
      id: 'decline',
      label: '先不签',
      style: 'neutral',
      keywords: ['不签', '先问着'],
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'proposed',
    },
    {
      id: 'revoke',
      label: '收回',
      secondary: true,
      style: 'danger',
      keywords: ['收回', '撤销租约'],
      needsInput: true,
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'active',
    },
  ],
  isResolved: state => state.status !== 'proposed' && state.status !== 'active',
  demand: state => (
    state.status === 'proposed'
      // 签一条规矩是签发，不是确认：动词跟着它在屏上要你做的那件事走。
      ? { layer: 'blocking', mode: 'single-confirm', label: `规矩：${state.reason}`, verb: '签' }
      : undefined
  ),
  renderText: state => ({
    body: [
      `【规矩 · 等你签】${state.reason}`,
      `范围：往${CLASS_LABEL[state.scope.toolClass] ?? state.scope.toolClass}里新加东西${state.scope.placeKey === undefined ? '（不限群）' : '（只在这一个群）'}`,
      `期间：${state.periodText}（${when(state.period.from)} – ${when(state.period.to)}）`,
      state.status === 'proposed'
        ? '签了之后，这段时间里这类新加不再每次问你；随时可收回，到期自动失效。改已有的、删除、建群照旧每次都问。'
        : state.status === 'active' ? '生效中。回复「收回」即撤销。' : `状态：${state.status}`,
      `[card#lease:${state.leaseId}]`,
    ].join('\n'),
    replyHints: state.status === 'proposed' ? ['签发', '不签'] : state.status === 'active' ? ['收回 <原因>'] : [],
  }),
  onResolved: state => ({ echoText: `【规矩 · ${state.status === 'revoked' ? '已收回' : state.status === 'expired' ? '已到期' : '没签'}】${state.reason}` }),
  apply: (state, action, actor, input) => {
    if (action.id === 'grant') {
      return {
        events: [{
          type: 'lease/granted',
          data: { leaseId: state.leaseId, grantedBy: actor.openId ?? state.decider, scope: { ...state.scope }, periodText: state.periodText, family: state.family },
          actor,
        }],
      }
    }
    if (action.id === 'decline') return { events: [{ type: 'lease/declined', data: { leaseId: state.leaseId }, actor }] }
    return {
      events: [{
        type: 'lease/revoked',
        data: { leaseId: state.leaseId, revokedBy: actor.openId ?? state.decider, ...(input === undefined ? {} : { reason: input }) },
        actor,
      }],
    }
  },
}
