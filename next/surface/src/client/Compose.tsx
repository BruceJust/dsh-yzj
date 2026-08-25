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
import type { InboxConversationWire, PersonWire, SurfaceInject } from './rpc.ts'
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

/**
 * @成员补全 —— 「执行者选择」在 UI 里的真身 (v3.10 4h④，D13① 余项).
 *
 * 翻案：「通讯录不能按名字搜」是一次能力误判——`contact user search --keyword` 一直
 * 都在。真正的缺口是**群成员列表没有 API**（平台三墙之一），所以这里搜的是**全组织**，
 * 答不出「这个人在不在这个群」。
 *
 * 那一问**不假装校验**：面板上如实写着这一行，而「他在不在这个群」由选场所的人自己
 * 知道。§1.6 的老话——场所与人选是社交决策，机器代做的那一刻就错了；这里能做的是把
 * 「打字找人」这件损耗性摩擦归零，不是替谁判断该不该 @ 他。
 */
export interface MentionPickerProps {
  inject: SurfaceInject
  /** 把 `@名字 ` 放到光标处；正文归 composer own。 */
  insert(text: string): void
}

export function MentionPicker(props: MentionPickerProps): ReactNode {
  const { inject, insert } = props
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [people, setPeople] = useState<PersonWire[]>([])
  /** 三值：搜到了 / 一个也没有 / 读不了。看不了不等于没有。 */
  const [state, setState] = useState<'idle' | 'looking' | 'empty' | 'broken'>('idle')
  const [why, setWhy] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)
  /** 只有最新那一次搜索可以画——慢回包会把新结果盖回旧的。 */
  const ticket = useRef(0)

  useEffect(() => {
    if (!open) return undefined
    const away = (event: MouseEvent): void => {
      if (boxRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => { document.removeEventListener('mousedown', away) }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const word = keyword.trim()
    if (word === '') {
      setPeople([])
      setState('idle')
      return undefined
    }
    setState('looking')
    // 每敲一个字打一次通讯录 = 一次没人要的洪水。等手停下来再问。
    const timer = setTimeout(() => {
      ticket.current += 1
      const mine = ticket.current
      void inject.people(word).then((found) => {
        if (mine !== ticket.current) return
        setPeople(found.people)
        if (found.error !== undefined) { setWhy(found.error); setState('broken'); return }
        setState(found.people.length === 0 ? 'empty' : 'idle')
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [inject, keyword, open])

  return (
    <div className={css.wrap} ref={boxRef}>
      <button
        type="button"
        className={css.iconBtn}
        title="@ 一位同事（按名字搜通讯录）"
        aria-label="@成员"
        onClick={() => { setOpen(value => !value) }}
      >
        @
      </button>
      {open && (
        <div className={`${css.pop} ${css.mentionPop}`}>
          <input
            className={css.mentionInput}
            value={keyword}
            autoFocus
            placeholder="名字…"
            onChange={(event) => { setKeyword(event.target.value) }}
          />
          {state === 'looking' && <div className={css.mentionNote}>在通讯录里找…</div>}
          {state === 'empty' && <div className={css.mentionNote}>通讯录里没有叫这个名字的人。</div>}
          {/* 读不了 ≠ 没有：把一次故障说成「查无此人」，人会照着这个假答案往下做。 */}
          {state === 'broken' && <div className={css.mentionNote}>通讯录读不了（{why}）——这不等于没有这个人。</div>}
          {people.map(person => (
            <button
              type="button"
              key={person.openId}
              className={css.mentionRow}
              onClick={() => {
                insert(`@${person.name} `)
                setOpen(false)
                setKeyword('')
              }}
            >
              <span className={css.mentionName}>{person.name}</span>
              <span className={css.mentionMeta}>
                {[person.department, person.jobTitle].filter(part => part !== undefined).join(' · ')}
              </span>
            </button>
          ))}
          {/*
            如实说这一行。

            搜的是全组织，而群成员列表平台没有 API——「他在不在这个群」我们答不了。
            不说的话，人会以为这份名单已经按当前会话筛过了，而它没有。
          */}
          <div className={css.mentionFoot}>搜的是全公司通讯录 · 在不在这个群，只有你知道</div>
        </div>
      )}
    </div>
  )
}
