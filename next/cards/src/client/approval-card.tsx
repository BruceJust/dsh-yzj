/**
 * The desktop confirmation card: one card object, rendered live in the
 * conversation flow.
 *
 * Its state comes from the graph over RPC rather than from the tool events,
 * because a pending call has no result yet and a rejected one never gets one
 * (TD-4'). Answering goes back through the same action bus the Yunzhijia text
 * reply uses, which is what makes "answer on either surface, effect once"
 * true rather than aspirational — including the loud receipt when this
 * surface loses the race.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { CardInject, CardWire } from './rpc.ts'
import css from './card.module.css'

const STATUS_LABEL: Record<string, string> = {
  pending: '等待确认',
  approved: '已放行',
  rejected: '已拒绝',
  expired: '已超时自动拒绝',
  interrupted: '因重启中断',
  superseded: '已重新发起',
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function argEntries(state: Record<string, unknown>): [string, string][] {
  const args = state.args
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return []
  return Object.entries(args as Record<string, unknown>).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
    const flat = text.replace(/\s+/gu, ' ').trim()
    return [key, flat.length > 240 ? `${flat.slice(0, 240)}…` : flat]
  })
}

function deadlineLabel(state: Record<string, unknown>): string {
  const deadline = state.deadline
  if (typeof deadline !== 'number') return ''
  return new Date(deadline).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/**
 * `ToolCallViewProps` already carries `sessionId` (the seat is declared
 * `scope: 'session'`, so the framework resolves it); `inject` is the face the
 * slot registration supplies.
 */
export interface ApprovalCardProps extends ToolCallViewProps {
  inject: CardInject
}

export function YzjApprovalCard(props: ApprovalCardProps): ReactNode {
  const { callId, toolName, sessionId, inject } = props
  const [card, setCard] = useState<CardWire | undefined>(undefined)
  const [receipt, setReceipt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<CardWire | undefined> => {
    const next = await inject.fetchForCall(sessionId, callId)
    setCard(next)
    return next
  }, [inject, sessionId, callId])

  useEffect(() => {
    let alive = true
    void refresh()
    // A pending card is answerable from Yunzhijia too, so this surface polls
    // for the state it may not have caused.
    const timer = setInterval(() => {
      if (!alive) return
      void refresh()
    }, 2_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  // Not a gated call (or the graph has no card for it): render nothing and let
  // the ordinary tool row speak for itself.
  if (card === undefined) return null

  const state = card.state
  const status = asString(state.status)
  const strong = asString(state.level) === 'strong'
  const args = argEntries(state)
  const deadline = deadlineLabel(state)

  const act = (actionId: string, needsInput: boolean): void => {
    setBusy(true)
    void inject.act(card.kind, card.id, actionId, needsInput && note !== '' ? note : undefined)
      .then((result) => {
        if (result !== undefined) {
          setReceipt(result.receipt)
          if (result.card !== undefined) setCard(result.card)
        }
        return refresh()
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className={`${css.card} ${strong ? css.strong : ''}`}>
      <div className={css.head}>
        <span className={`${css.badge} ${strong ? css.badgeStrong : ''} ${card.resolved ? css.badgeDone : ''}`}>
          {STATUS_LABEL[status] ?? status}
        </span>
        <span>{asString(state.reason) || '云之家操作确认'}</span>
      </div>

      <div className={css.tool}>{toolName}{strong ? ' · 强风险，不可撤销' : ''}</div>

      {args.length > 0 && (
        <div className={css.args}>
          {args.map(([key, value]) => (
            <div className={css.arg} key={key}>
              <span className={css.argKey}>{key}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      )}

      {!card.resolved && (
        <div className={css.actions}>
          {card.actions.filter(action => action.available).map(action => (
            <button
              type="button"
              key={action.id}
              className={`${css.button} ${action.style === 'primary' ? css.primary : ''} ${action.style === 'danger' ? css.danger : ''}`}
              disabled={busy}
              onClick={() => { act(action.id, action.needsInput) }}
            >
              {action.label}
            </button>
          ))}
          {card.actions.some(action => action.available && action.needsInput) && (
            <input
              className={css.input}
              value={note}
              placeholder="拒绝理由（可选）"
              disabled={busy}
              onChange={(event) => { setNote(event.target.value) }}
            />
          )}
        </div>
      )}

      <div className={css.foot}>
        {receipt !== ''
          ? receipt
          : card.resolved
            ? `${STATUS_LABEL[status] ?? status}${asString(state.note) === '' ? '' : `：${asString(state.note)}`}`
            : `也可在云之家自聊回复「确认 / 取消」${deadline === '' ? '' : `；${deadline} 前未回复将自动拒绝`}`}
      </div>
    </div>
  )
}
