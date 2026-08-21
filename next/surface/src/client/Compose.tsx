/**
 * The small parts a real IM composer has and an agent console forgets.
 *
 * 委派是对话的特例，不是对话的全部 (D13①). A surface that can delegate but
 * cannot paste an emoji, copy a line, or pass a message to somebody else is
 * not the complete writing half of an IM idiom — it is the agent half wearing
 * the room's clothes. These three are the cheapest of that set and the ones
 * people reach for constantly.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { InboxConversationWire, SurfaceInject } from './rpc.ts'
import { avatarOf } from './stream.ts'
import css from './compose.module.css'

/** dsh's relative-time buckets, so a row here reads like a row in the sidebar. */
function ago(time: number, now: number): string {
  if (!Number.isFinite(time) || time <= 0) return ''
  const diff = Math.max(0, now - time)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))}分钟`
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))}小时`
  return `${String(Math.floor(diff / 86_400_000))}天`
}

const KIND_LABEL: Record<string, string> = { group: '群', direct: '私聊', assistant: '助手' }

/**
 * A small, opinionated set rather than a full unicode browser.
 *
 * Every one of these is something people actually type at work. A 1800-glyph
 * grid is a search problem nobody came here to solve, and the platform's own
 * sticker set is not reachable — reaction stickers have no CLI API at all, and
 * the design books them as an infrastructure ask rather than pretending.
 */
const EMOJI = [
  '👍', '🙏', '😄', '😅', '🤝', '💪', '👀', '🎉',
  '✅', '❌', '⚠️', '❓', '🔥', '⏰', '📌', '📄',
  '😂', '😊', '🥲', '😮', '🤔', '😭', '🫡', '🙌',
]

export interface EmojiButtonProps {
  /** Insert at the caret; the composer owns the text. */
  insert(text: string): void
}

export function EmojiButton(props: EmojiButtonProps): ReactNode {
  const { insert } = props
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Click-away, because a picker that only closes by re-pressing its own
  // button is a picker people leave open by accident.
  useEffect(() => {
    if (!open) return undefined
    const away = (event: MouseEvent): void => {
      if (boxRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => { document.removeEventListener('mousedown', away) }
  }, [open])

  return (
    <div className={css.wrap} ref={boxRef}>
      <button
        type="button"
        className={css.iconBtn}
        title="表情"
        aria-label="表情"
        onClick={() => { setOpen(value => !value) }}
      >
        ☺
      </button>
      {open && (
        <div className={css.pop}>
          {EMOJI.map(glyph => (
            <button
              type="button"
              key={glyph}
              className={css.emoji}
              onClick={() => {
                insert(glyph)
                setOpen(false)
              }}
            >
              {glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Copy one message's text. The clipboard is the oldest verb in every chat app. */
export function CopyButton(props: { text: string; className?: string | undefined }): ReactNode {
  const { text, className } = props
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return undefined
    const timer = setTimeout(() => { setDone(false) }, 1_400)
    return () => { clearTimeout(timer) }
  }, [done])
  return (
    <button
      type="button"
      className={className ?? css.verb}
      title="复制这条"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => { setDone(true) })
      }}
    >
      {done ? '已复制' : '⧉ 复制'}
    </button>
  )
}

export interface ForwardPickerProps {
  /** The message being passed on. */
  text: string
  inject: SurfaceInject
  close(): void
  /** Report the outcome; the caller owns its own toast. */
  done(message: string): void
}

/**
 * 转发 — pass one message to another conversation.
 *
 * It goes through the SAME send path as anything else typed here, so the same
 * rules hold: a forwarded message that happens to contain the trigger word,
 * sent into a place where the agent is not on duty, is refused rather than
 * posted. Forwarding is not a back door, and it does not get its own semantics.
 */
export function ForwardPicker(props: ForwardPickerProps): ReactNode {
  const { text, inject, close, done } = props
  const [rows, setRows] = useState<readonly InboxConversationWire[]>([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState('')
  const [now] = useState(() => Date.now())

  useEffect(() => {
    void inject.inbox().then((view) => { setRows(view?.conversations ?? []) })
  }, [inject])

  const send = useCallback((row: InboxConversationWire): void => {
    setBusy(row.placeKey)
    void inject.sendInPlace(row.placeKey, text).then((result) => {
      setBusy('')
      if (result.refused === 'not-on-duty') {
        done(`没发出去：这条里带着触发词，而 agent 不在「${row.name}」接单。`)
        return
      }
      done(result.error ?? `已转发到「${row.name}」`)
      close()
    })
  }, [close, done, inject, text])

  const match = filter.trim().toLowerCase()
  const shown = (match === '' ? rows : rows.filter(row => row.name.toLowerCase().includes(match)))
    .slice(0, 60)

  return (
    <div className={css.mask} onClick={close}>
      <div
        className={css.panel}
        role="dialog"
        aria-label="转发到"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.head}>
          <span className={css.headTitle}>转发到</span>
          <span className={css.headSub}>按最近活动排</span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭">×</button>
        </div>
        <div className={css.quote}>{text}</div>
        <input
          className={css.search}
          value={filter}
          placeholder="按名字找会话…"
          autoFocus
          spellCheck={false}
          onChange={(event) => { setFilter(event.target.value) }}
        />
        <div className={css.list}>
          {shown.length === 0 && (
            <div className={css.calm}>
              没有匹配的会话。
              <br />
              这里能找到的是通道见过的会话——名录攒到哪儿，就能找到哪儿。
            </div>
          )}
          {shown.map((row) => {
            const face = avatarOf(row.name)
            return (
              <button
                type="button"
                key={row.placeKey}
                className={css.row}
                disabled={busy !== ''}
                onClick={() => { send(row) }}
              >
                <span className={css.rowFace} style={{ background: face.color }}>
                  {row.avatarUrl === undefined
                    ? face.text
                    : <img className={css.rowPhoto} src={row.avatarUrl} alt="" />}
                </span>
                <span className={css.rowText}>
                  <span className={css.rowName}>{row.name}</span>
                  <span className={css.rowSub}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                    {row.preview === '' ? '' : ` · ${row.preview.slice(0, 24)}`}
                  </span>
                </span>
                <span className={css.rowRight}>
                  <span className={css.rowNote}>{ago(row.lastMsgTime, now)}</span>
                  {!row.onDuty && <span className={css.rowOff}>未接单</span>}
                  {busy === row.placeKey && <span className={css.rowNote}>发送中…</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
