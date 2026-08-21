/**
 * 传送门的唯一一屏：选一个会话。
 *
 * 单独一个文件，因为**板和目标页都要用它**——它长在其中一个消费者体内的话，
 * 另一个要么去 import 一个组件的私处，要么自己抄一份；而抄的那一份迟早在
 * 「该不该问场所」这件事上和原件分道扬镳。
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { SurfaceInject, TreeWire } from './rpc.ts'
import css from './board.module.css'

/** What a portal is about to carry, while the operator picks the room. */
export interface Portal {
  /** 带过去的是目标还是一场会——两者落地后的后果不同，见 `Errand.subject`。 */
  readonly subject: 'goal' | 'event'
  readonly goalRef: string
  readonly goalName: string
  readonly voice: 'place' | 'private'
  readonly seed?: string
  readonly title: string
  readonly note: string
}

/**
 * 传送门的唯一一屏：选一个会话。
 *
 * Everything else a delegation needs — who, what, by when — is said in the
 * conversation, in the operator's own words. This asks only the one thing that
 * cannot be derived and must not be guessed: WHERE. 场所是委派话语的一等参数，
 * 人选不推导 (§1.6).
 *
 * The list is conversations, not groups, because a commitment breathes in a
 * window: the registration card lands there, the receipt is read there, and the
 * board's 「打开」 hops back to it. A place with no conversation yet is shown
 * with the reason rather than hidden — an empty list that does not say why is
 * indistinguishable from a broken one.
 */
export function RoomPicker(props: {
  portal: Portal
  inject: SurfaceInject
  close(): void
  go(sessionId: string): void
}): ReactNode {
  const { portal, inject, close, go } = props
  const [tree, setTree] = useState<TreeWire | undefined>(undefined)
  const [filter, setFilter] = useState('')

  useEffect(() => { void inject.tree().then(setTree) }, [inject])

  const places = (tree?.places ?? []).map(entry => ({
    placeKey: entry.place.placeKey,
    groupName: entry.place.groupName,
    topics: entry.topics.filter(topic => (
      filter.trim() === ''
      || topic.label.includes(filter.trim())
      || entry.place.groupName.includes(filter.trim())
    )),
  })).filter(entry => entry.topics.length > 0)

  return (
    <div className={css.mask} onClick={close}>
      <div
        className={css.sheet}
        role="dialog"
        aria-label={portal.title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.sheetHead}>
          <span className={css.sheetTitle}>{portal.title}</span>
          <button type="button" className={css.sheetClose} onClick={close} aria-label="关闭">×</button>
        </div>
        <div className={css.sheetNote}>
          {/* 一场会不是一个目标。标签跟着东西走，不跟着组件走。 */}
          {portal.subject === 'event' ? '这场会' : '目标'}：<b>{portal.goalName}</b>
          <br />
          {portal.note}
        </div>
        <input
          className={css.input}
          value={filter}
          autoFocus
          placeholder="过滤群或话题…"
          onChange={(event) => { setFilter(event.target.value) }}
        />
        <div className={css.rooms}>
          {tree === undefined
            ? <div className={css.goalEmpty}>正在读会话…</div>
            : places.length === 0
              ? (
                <div className={css.goalEmpty}>
                  没有可跳进去的话题。
                  {' '}
                  承诺是在<b>话题</b>里呼吸的——先在群里 @ 一句让话题长出来，再回来委派。
                </div>
              )
              : places.map(entry => (
                <div className={css.roomGroup} key={entry.placeKey}>
                  <div className={css.roomPlace}>{entry.groupName}</div>
                  {entry.topics.map(topic => (
                    <button
                      type="button"
                      className={css.room}
                      key={topic.sessionId}
                      onClick={() => { go(topic.sessionId) }}
                    >
                      {topic.label}
                    </button>
                  ))}
                </div>
              ))}
        </div>
        <div className={css.sheetFoot}>
          <span className={css.sheetHint}>
            {portal.subject === 'event'
              ? '跳过去之后 composer 会带着这场会的提示——句子由你说，发出去才算数；这一步不给话题装载任何语境。'
              : '跳过去之后 composer 会带着目标 chip——句子由你说，发出去才算数。'}
          </span>
        </div>
      </div>
    </div>
  )
}

