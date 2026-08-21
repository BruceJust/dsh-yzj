/**
 * 传送门的唯一一屏：选一个会话。
 *
 * 单独一个文件，因为**板和目标页都要用它**——它长在其中一个消费者体内的话，
 * 另一个要么去 import 一个组件的私处，要么自己抄一份；而抄的那一份迟早在
 * 「该不该问场所」这件事上和原件分道扬镳。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PersonWire, SurfaceInject, TreeWire } from './rpc.ts'
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
  /*
    没有合适的场所时，可以**当场造一个** (设计 v4.18「新建专项群」格).

    这一格是这样长出来的：选场所这一屏此前默认「合适的听众集合已经存在」，而一个刚
    定下来的目标最常见的情形恰恰是**还没有它自己的群**。缺了这一格，人要跳出去、在
    云之家建群、回来、刷新、再选——四步搬运，而其中三步是纯损耗。

    但它不能做成「顺手就建」：建群是**创造一个新的听众集合**，从此这批人听得见这里的
    每一句话。所以它是一张要填的表、要按的签发键，而不是列表里一个一点就有的选项。
  */
  const [minting, setMinting] = useState(false)

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
          {/*
            尾项，不是首项。

            一屏之内「造一个新的」永远排在「用现成的」后面：默认该是复用一个已经存在的
            听众集合，新建是那个默认不成立时才走的路。
          */}
          {tree !== undefined && !minting && (
            <button
              type="button"
              className={css.roomNew}
              onClick={() => { setMinting(true) }}
            >
              ＋ 新建专项群 —— 没有合适的场所时
            </button>
          )}
        </div>
        {minting && (
          <NewPlace
            portal={portal}
            inject={inject}
            cancel={() => { setMinting(false) }}
          />
        )}
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


/**
 * 新建一个专项群 —— 一次主权时刻，同时裁三件事 (设计 v4.18).
 *
 * 建群 = **创造一个新的听众集合**。从此这批人听得见这里说的每一句话，而这件事没有
 * 撤销键：群可以解散，谁在那段时间里听见了什么收不回来。所以它长成一张要填的表、
 * 一枚要按的签发键，而不是列表里一个一点就有的选项——**摩擦刀的用法**：平台让建群
 * 变容易了，而建群的难度本来在保护听众集合，所以设计的动向是把新能力放进门里。
 *
 * 三件事一次裁完，因为它们是同一个决定的三个面：
 *
 * - **谁听得见**（群名 + 成员）；
 * - **agent 在不在岗**（「接入」勾选）——合同默认最严是**系统的**默认，不是不许人在
 *   签发的同一刻一并开启；专项群默认勾上，因为它存在的理由就是让 agent 在这儿干活；
 * - **它从哪句话里长出来**（出生血缘，表上不出现——它由发起这次传送门的语境自动携带）。
 *
 * 不勾「接入」也可以，但**代发之前要警示**：agent 听不见这个群，登记卡发过去没有人
 * 接收回执。出生要有呼吸，而呼吸包括**回执可达**——一条落了库却没人应答得了的承诺，
 * 正是幽灵承诺换了个形状。
 *
 * **建完不自动跳进去**，这是一处如实的缺口而不是设计取舍：新群里一条消息都没有，
 * 因而没有话题可跳；能说话的地方是它的主楼，而主楼要按 `placeKey` 导航——那条路由
 * 此刻只到宿主手里（`setFrame`），传送门够不着。所以这里如实说「它会出现在会话
 * 列表里」，而不是跳去一个应用还不认识的场所然后显示一片空白。
 */
function NewPlace(props: {
  portal: Portal
  inject: SurfaceInject
  cancel(): void
}): ReactNode {
  const { portal, inject, cancel } = props
  const [name, setName] = useState(portal.subject === 'goal' ? portal.goalName : '')
  const [keyword, setKeyword] = useState('')
  const [found, setFound] = useState<PersonWire[]>([])
  const [picked, setPicked] = useState<PersonWire[]>([])
  const [serve, setServe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ served: boolean } | undefined>(undefined)
  const [error, setError] = useState('')
  /*
    搜人是**单调的**：后发先至的那一次回包不许覆盖更新的一次。

    输入框的每一次改动都开一次搜索，而网络不保证顺序——不记票号的话，一次慢的旧查询
    回来会把新查询的结果盖掉，看起来就是「搜出来的人和我打的字对不上」。
  */
  const ticket = useRef(0)
  useEffect(() => {
    const query = keyword.trim()
    if (query === '') { setFound([]); return undefined }
    const mine = ticket.current + 1
    ticket.current = mine
    const timer = setTimeout(() => {
      void inject.people(query).then((people) => {
        if (ticket.current === mine) setFound(people)
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [keyword, inject])

  const toggle = (person: PersonWire): void => {
    setPicked(current => (current.some(one => one.openId === person.openId)
      ? current.filter(one => one.openId !== person.openId)
      : [...current, person]))
  }

  if (result !== undefined) {
    return (
      <div className={css.newPlace}>
        <div className={css.newPlaceHead}>群建好了：<b>{name.trim()}</b></div>
        <div className={css.newPlaceNote}>
          {result.served
            ? 'agent 已经接入这个群，登记卡的回执有人接收。'
            /*
              这一句是这一格存在的一半理由。

              不接入就建群，登记消息发过去没有任何东西在听——承诺落了库、群里也看得见
              那句话，可**回执没有接收方**。板上会一直显示「在跟」，而它永远等不到动静。
              说清楚，并给出那条仍然走得通的路（自己盯、自己回来记）。
            */
            : '⚠️ agent **没有**接入这个群：登记卡发过去也不会有人接收回执，板上那条承诺会一直等不到动静。'
              + '要么到「场所合同」里把接单打开，要么这次自己亲发、自己回来把回执记上。'}
          <br />
          它会在下一次轮询之后出现在左边的会话列表里；委派那句话到那儿去说——句子由你说，发出去才算数。
        </div>
        <div className={css.newPlaceActions}>
          <button type="button" className={css.newPlacePrimary} onClick={cancel}>知道了</button>
        </div>
      </div>
    )
  }

  return (
    <div className={css.newPlace}>
      <div className={css.newPlaceHead}>新建专项群 —— 这会创造一个新的听众集合</div>
      <input
        className={css.input}
        value={name}
        placeholder="群名称"
        onChange={(event) => { setName(event.target.value) }}
      />
      <input
        className={css.input}
        value={keyword}
        placeholder="按名字找人加进来（2-10 人，不含你自己）…"
        onChange={(event) => { setKeyword(event.target.value) }}
      />
      {picked.length > 0 && (
        <div className={css.newPlacePicked}>
          {picked.map(person => (
            <button
              type="button"
              className={css.newPlaceChip}
              key={person.openId}
              onClick={() => { toggle(person) }}
            >
              {person.name} ×
            </button>
          ))}
        </div>
      )}
      {found.length > 0 && (
        <div className={css.newPlaceFound}>
          {found.map(person => (
            <button
              type="button"
              className={css.room}
              key={person.openId}
              onClick={() => { toggle(person) }}
            >
              {person.name}
              {person.department === undefined ? '' : ` · ${person.department}`}
              {picked.some(one => one.openId === person.openId) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      {/*
        搜的是**全组织**，不是这个群——群成员列表平台没有 API（三墙之一）。
        如实说，不假装校验过。
      */}
      <div className={css.newPlaceHint}>搜的是全公司通讯录 · 谁该进这个群，只有你知道</div>
      <label className={css.newPlaceServe}>
        <input
          type="checkbox"
          checked={serve}
          onChange={(event) => { setServe(event.target.checked) }}
        />
        接入 agent（不勾的话，发到这个群的登记卡不会有人接收回执）
      </label>
      {error !== '' && <div className={css.newPlaceError}>{error}</div>}
      <div className={css.newPlaceActions}>
        <button type="button" className={css.newPlaceGhost} onClick={cancel} disabled={busy}>取消</button>
        <button
          type="button"
          className={css.newPlacePrimary}
          disabled={busy || name.trim() === '' || picked.length < 2 || picked.length > 10}
          onClick={() => {
            setBusy(true)
            setError('')
            void inject.createPlace({
              name: name.trim(),
              members: picked.map(person => person.openId),
              serve,
              // 出生血缘：这次传送门是从哪个目标/哪场会发起的，群就从那儿长出来。
              sourceAnchor: `portal:${portal.subject}:${portal.goalRef}`,
              ...(portal.subject === 'goal' ? { goalRef: portal.goalRef } : {}),
            }).then((outcome) => {
              setBusy(false)
              if (outcome.error !== undefined) { setError(outcome.error); return }
              setResult({ served: outcome.served === true })
            })
          }}
        >
          {busy ? '正在建…' : `签发并建群（${String(picked.length)} 人）`}
        </button>
      </div>
      <div className={css.newPlaceHint}>
        按下就是签发——建群是创造一个新的听众集合，比在现成的群里挑一个更需要你点头。
      </div>
    </div>
  )
}
