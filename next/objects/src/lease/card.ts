/**
 * 租约确认卡 —— ①单答确认，**强确认**：签发一份租约 = 这一期这类写入不再问你。
 *
 * 发现入口在疲劳现场（私账取景框组头的「不用再问我」是它的传送门）；签发是人的
 * 主权动作；期中可收回；到期自动收回并留审计证据。
 */

import type { CardDefinition } from '@yzj-next/cards'
import type { LeaseState } from './family.ts'

const isDecider = (openId: string | undefined, state: LeaseState): boolean => openId !== undefined && openId === state.decider

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
      label: '不签',
      style: 'neutral',
      keywords: ['不签', '先问着'],
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => state.status === 'proposed',
    },
    {
      id: 'revoke',
      label: '收回',
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
      ? { layer: 'blocking', mode: 'single-confirm', label: `租约：${state.reason}` }
      : undefined
  ),
  renderText: state => ({
    body: [
      `【授权租约】${state.reason}`,
      `范围：${state.scope.toolClass} 一类的写入${state.scope.placeKey === undefined ? '' : `（限 ${state.scope.placeKey}）`}`,
      `期间：${state.periodText}（${when(state.period.from)} – ${when(state.period.to)}）`,
      state.status === 'proposed'
        ? '签发之后这一期内这类写入不再弹确认；期中随时可收回，到期自动收回。'
        : state.status === 'active' ? '生效中。回复「收回」即撤销。' : `状态：${state.status}`,
      `[card#lease:${state.leaseId}]`,
    ].join('\n'),
    replyHints: state.status === 'proposed' ? ['签发', '不签'] : state.status === 'active' ? ['收回 <原因>'] : [],
  }),
  onResolved: state => ({ echoText: `【授权租约 · ${state.status === 'revoked' ? '已收回' : state.status === 'expired' ? '已到期' : '未签发'}】${state.reason}` }),
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
