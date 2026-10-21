/**
 * 左栏 —— **去哪？** (界面重设计 §4.2，替换宿主的工作区浏览器).
 *
 * 宿主的左栏回答「这个会话在哪个文件夹里」，那是编程工具的问题。这里的人每天打开它，
 * 要的是另一件事：**今天有哪几件事非我不可**。所以这一栏从上到下是五段，按注意力排：
 *
 * 1. **要你** —— 阻塞层逐条：动词在前、事情在后，第二行写**谁在等、等了多久**，按
 *    被你卡住的代价排好（律二）。此前是三枚计数 chip：它们只回答「有几件」，点下去
 *    跳到第一件，于是「今天要我拍板什么」要点三次才知道。一条「要你」就是一个被你卡住
 *    的人，所以默认生效可纠的、信号层的都不进——那正是「这不是帮我干活，是给我找事」
 *    的解药。
 * 2. **运行中** —— 只说「在跑」，健康与否看最后一次动静：六分钟没进展就变琥珀色。
 *    它不进「要你」（不是要你拍板），但它可能卡住了，人得看得见（剧本 1「空转二十分
 *    钟毫不知情」）。
 * 3. **承诺** —— 账本的入口，一个数：逾期压过该评估，该评估压过在跟。
 * 4. **云之家** —— 只列**接入了的**地方，和它们底下**有事的**话题（注意力租约）；没
 *    接入的群收成一行。工作台不复刻 IM 客户端：没接入的群里没有图，也就没有这里帮得
 *    上的事；要找它们，展开那一行或用 ⌘K。
 * 5. **本地** —— 工作文件夹与它们的会话（重命名 / 分叉 / 归档 三个动词照旧在）。
 *
 * **静为常态，色为例外**（律三）：一行最多一个信号——琥珀实心点是「要你」，转圈是「在
 * 跑」，琥珀转圈是「可能卡住了」。「没有」不画。未读数只给接入了的地方。
 *
 * `N` 是这一栏的键盘入口（律八）：跨群跳到下一件要你的，落在卡上。
 *
 * 它替换的是浏览**区域**，不是整栏：宿主的 logo、新会话、设置座位都还在原处。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CardRefWire, InboxConversationWire, InboxItemWire, InboxView, NeedWire, SurfaceInject, TopicTone,
} from './rpc.ts'
import { avatarOf } from './stream.ts'
import {
  answeringNow, currentFrame, landOn, publishNeeds, setFrame, setNeedJumper, subscribeAnswering, subscribeFrame,
} from './store.ts'
import { commandKey, openPalette, startOfToday } from './keys.ts'
import { usePoll } from './poll.ts'
import { YzjDirectoryPicker, type DirectoryLevel } from './DirectoryPicker.tsx'
import { Icon } from './icons.tsx'
import { AGENT, plainError, span, waitLine } from './words.ts'
import { Skeleton, UnreadLine } from './Unread.tsx'
import { STALL_MS } from './StreamView.tsx'
import tokens from './tokens.module.css'
import css from './sidebar.module.css'

/** One host session, as the local list needs it. */
interface HostSession {
  readonly displayTitle?: string
  readonly blank?: boolean
  /** Last activity: the row's relative clock, and the 「运行中」 health check. */
  readonly updatedAt?: number
  /** 宿主说这个会话此刻有一回合在跑。本地会话没有任务对象，「运行中」只能从这里知道。 */
  readonly running?: boolean
}

/**
 * The three verbs a session row owns.
 *
 * `fork` and `archive` are optional because they are services, not facts: a
 * deployment that composes neither should show no menu entry rather than one
 * that fails when pressed.
 */
export interface SessionActions {
  rename(sessionId: string, title: string): Promise<void>
  fork?(sessionId: string): Promise<void>
  archive?(sessionId: string): Promise<void>
}

/**
 * One local working directory.
 *
 * `sessionIds` rather than a `workspaceId` on each session: the host records
 * membership on the WORKSPACE (its `sessionIds` is the accounting record, in
 * manually owned order), and the session summary carries no folder at all.
 */
export interface LocalWorkspace {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export interface SidebarProps {
  inject: SurfaceInject
  /**
   * The host's own session list. Sessions started at this desk are not topics
   * in any place, so nothing in the graph knows about them — and replacing the
   * workspace browser must not make them unreachable.
   */
  useSessions<T>(selector: (state: {
    ids?: readonly string[]
    byId?: Record<string, HostSession>
    /** The session on stage. Rides the same snapshot as the list. */
    current?: string
  }) => T): T
  /** Navigate to a session. */
  open(sessionId: string): void
  /** Start a fresh session, in a named working directory when one is given. */
  startSession(workspaceId?: string): void
  /** 重命名 / 分叉 / 归档, wired where the host's own browser wires them. */
  sessionActions: SessionActions
  /**
   * Local working directories, and the way to add one.
   *
   * Replacing `sidebar.workspaces` took the host's workspace list — which was
   * also the ONLY entry to open a directory. A local session has to run
   * somewhere, so without this there is no way to start one at all.
   */
  workspaces: {
    readonly items: readonly LocalWorkspace[]
    /** Sessions the host has archived: hidden from every grouping surface. */
    readonly archivedSessionIds?: readonly string[]
    /** The host's `browse` capability, when it composed one. */
    listDirectory?(path?: string): Promise<DirectoryLevel | undefined>
    /** The host's `native` capability, when it composed one. */
    pickDirectory?(): Promise<string | null>
    create?(path: string): Promise<{ id: string } | undefined>
  }
}

const EMPTY: InboxView = {
  counts: { confirm: 0, review: 0, running: 0 },
  firstOf: {},
  places: [],
  topicSessionIds: [],
  commitments: { open: 0, overdue: 0, toAssess: 0 },
}

/** 「要你」最多摊开几条。再多是审批疲劳的信号，不是排版问题——卡上会提议一条规矩。 */
const NEED_ROWS = 5


/** 两个卡地址是不是同一张卡。 */
export const sameRef = (left: CardRefWire | undefined, right: CardRefWire | undefined): boolean => (
  left !== undefined && right !== undefined && left.kind === right.kind && left.id === right.id
)

/** 一行话题此刻的那一个信号（律三：一行一个）。 */
function signalOf(tone: TopicTone, live: boolean): 'need' | 'run' | undefined {
  if (tone === 'confirm' || tone === 'review') return 'need'
  if (tone === 'running' || live) return 'run'
  return undefined
}

/** 私聊行、自聊行的那张脸。 */
function Face(props: { name: string; photo?: string; hidePhoto?: boolean }): ReactNode {
  const { name, photo, hidePhoto = false } = props
  const avatar = avatarOf(name)
  return (
    <span className={css.face} style={{ background: avatar.color }}>
      {photo === undefined || hidePhoto
        ? avatar.text
        : (
          <img
            className={css.photo}
            src={photo}
            alt=""
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        )}
    </span>
  )
}

/** 一行右侧的那一个信号。 */
function Signal(props: { kind: 'need' | 'run' | 'stall' | undefined }): ReactNode {
  if (props.kind === undefined) return null
  if (props.kind === 'need') return <span className={css.needDot} aria-label="要你" />
  return (
    <span
      className={`${css.spin} ${props.kind === 'stall' ? css.spinStall : ''}`}
      aria-label={props.kind === 'stall' ? '可能卡住了' : '在跑'}
    />
  )
}

export function YzjSidebar(props: SidebarProps): ReactNode {
  const { inject, open, sessionActions, startSession, useSessions, workspaces } = props
  /** The fallback dialog, opened only where the host composed no chooser. */
  const [opening, setOpening] = useState(false)
  /** True while the host's own directory chooser is up on the host display. */
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState('')
  /** Which session row's menu is open, which row is being renamed, and its draft. */
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined)
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [rename, setRename] = useState('')
  /** The row asking 「归档？」. Archiving has no way back on this surface. */
  const [archiving, setArchiving] = useState<string | undefined>(undefined)
  const [rowError, setRowError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  /** 没接入的那一堆里按名字找 —— 平台没有群搜索 API，只能在见过的里面找。 */
  const [filter, setFilter] = useState('')
  const [moreNeeds, setMoreNeeds] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const frame = useSyncExternalStore(subscribeFrame, currentFrame)
  /** 正在撤回窗里的回答：卡还没真的落账，可它已经不该再「要你」了（律七）。 */
  const answering = useSyncExternalStore(subscribeAnswering, answeringNow)
  const hostIds = useSessions(state => state.ids) ?? []
  const hostById = useSessions(state => state.byId) ?? {}
  /**
   * The session on stage, read from the same snapshot as the list: this slot
   * is root-scoped, so the registration never had a `sessionId` to give.
   */
  const currentSessionId = useSessions(state => state.current)
  const [inbox, setInbox] = useState<InboxView>(EMPTY)
  /**
   * 读到过一次没有；上一次读成了没有。读不到 ≠ 都处理完了：一次断线落成「✓ 都处理完了」，
   * 是这一栏能说的最危险的一句假话。
   */
  const [loaded, setLoaded] = useState(false)
  const [unread, setUnread] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await inject.inbox()
    setUnread(next === undefined)
    if (next === undefined) return
    setLoaded(true)
    setInbox(next)
    // 中栏「下一件」读的是同一份——两处各取一次，就会各说各的下一件。
    publishNeeds(next.needs ?? [])
  }, [inject])

  usePoll(refresh)

  // 「等了多久」「多久没进展」只需要分钟级的准；半分钟走一次就够。
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { clearInterval(timer) }
  }, [])

  /**
   * 带着卡来的，落在卡上；不带的，落在话题末尾。
   *
   * 每一次跳转都**重写**落点，包括不带卡的那种：上一次点「验收」还没落地就改去了
   * 别处，那份落点不能留到下次碰巧打开那个话题时才兑现。
   */
  const go = useCallback((sessionId: string, cardRef?: CardRefWire): void => {
    landOn(cardRef === undefined ? undefined : { sessionId, ...cardRef })
    setFrame({ kind: 'session' })
    open(sessionId)
  }, [open])

  const stealth = inbox.stealth === true
  const needs = (inbox.needs ?? []).filter(need => !answering.some(ref => sameRef(ref, need.ref)))

  /** 今天没问你就办了几件——只在「要你」清零时露出来，所以也只在那时去数。 */
  const [autoToday, setAutoToday] = useState(0)
  const cleared = loaded && needs.length === 0
  // 读不回来就留着上次的数：清零态少一行不是错误，可也不该因为一次断线把数归零。
  const countAuto = useCallback(async (): Promise<void> => {
    const rows = await inject.autoHandled?.(startOfToday())
    if (rows !== undefined) setAutoToday(rows.length)
  }, [inject])
  usePoll(countAuto, { active: cleared, slow: true })

  /*
    `N` —— 下一件要你的 (律八).

    跨群跳，不用回左栏找。「下一件」是按代价排好的第一件；如果人正站在它上面（刚跳过
    来、还没答），就是第二件——连按 N 是在一件件往下走，不是原地踏步。
  */
  const lastJump = useRef<NeedWire | undefined>(undefined)
  /** 刚跳去的那一件——人站在它所在的会话里时，这一行亮着（落点本身是一次性的）。 */
  const [jumped, setJumped] = useState<CardRefWire | undefined>(undefined)
  const jumpTo = useCallback((need: NeedWire): void => {
    lastJump.current = need
    setJumped(need.ref)
    go(need.sessionId, need.ref)
  }, [go])
  // 把这只手借给中栏的「下一件」：连着处理时不必回左栏找。
  useEffect(() => {
    setNeedJumper(jumpTo)
    return () => { setNeedJumper(undefined) }
  }, [jumpTo])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'n' && event.key !== 'N') return
      if (!commandKey(event)) return
      if (needs.length === 0) return
      const here = lastJump.current
      const at = here === undefined || here.sessionId !== currentSessionId
        ? -1
        : needs.findIndex(need => sameRef(need.ref, here.ref))
      const next = at < 0 ? needs[0] : needs[(at + 1) % needs.length]
      if (next === undefined) return
      event.preventDefault()
      jumpTo(next)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [needs, currentSessionId, jumpTo])

  /** Register a picked directory and land in a session there. */
  const adopt = useCallback(async (path: string): Promise<void> => {
    const created = await workspaces.create?.(path)
    if (created === undefined) throw new Error('这个目录没能登记成工作区')
    setFrame({ kind: 'session' })
    startSession(created.id)
  }, [startSession, workspaces])

  /**
   * 打开本地文件夹 — dsh's own route: the host's `pickDirectory` opens the
   * operating system's own folder chooser. The self-built browser survives
   * only as the no-chooser fallback.
   */
  const openDirectory = useCallback((): void => {
    setPickError('')
    if (workspaces.pickDirectory === undefined) {
      setOpening(true)
      return
    }
    setPicking(true)
    void workspaces.pickDirectory()
      .then(async (path) => { if (path !== null) await adopt(path) })
      .catch((cause: unknown) => {
        setPickError(plainError(cause instanceof Error ? cause.message : String(cause)).text)
      })
      .finally(() => { setPicking(false) })
  }, [adopt, workspaces])

  /** 隐身档先于一切折叠状态 (D10)：云之家那一段整段先收起来，人可以有意展开。 */
  const shut = (key: string, fallback = false): boolean => (
    collapsed[key] ?? (key === 'sec:yzj' && stealth ? true : fallback)
  )
  const toggle = (key: string, fallback = false): void => {
    setCollapsed(value => ({ ...value, [key]: !(value[key] ?? (key === 'sec:yzj' && stealth ? true : fallback)) }))
  }

  /** 段头：小号字；可折叠的段整行就是开关。 */
  const head = (key: string | undefined, title: string, tail?: ReactNode): ReactNode => (
    key === undefined
      ? <div className={css.head}><span className={css.headTitle}>{title}</span>{tail}</div>
      : (
        <button
          type="button"
          className={`${css.head} ${css.headButton}`}
          aria-expanded={!shut(key)}
          onClick={() => { toggle(key) }}
        >
          <span className={css.headTitle}>{title}</span>
          <Icon name="chevD" size={12} className={`${css.headChev} ${shut(key) ? css.headChevShut : ''}`} />
          {tail}
        </button>
      )
  )

  /* ——— 1 · 要你 ——— */

  const needRow = (need: NeedWire): ReactNode => {
    const active = frame.kind === 'session' && need.sessionId === currentSessionId && sameRef(jumped, need.ref)
    const overdue = need.due?.ts !== undefined && need.due.ts < now
    return (
      <button
        type="button"
        key={`${need.ref.kind}:${need.ref.id}`}
        className={`${css.need} ${active ? css.rowActive : ''}`}
        title={stealth ? undefined : `${need.label}\n${need.placeName === undefined ? need.where : `${need.placeName} · ${need.where}`}`}
        onClick={() => { jumpTo(need) }}
      >
        <span className={css.needDot} />
        <span className={css.needText}>
          <span className={css.needLine}>
            <b className={css.needVerb}>{need.verb}</b>
            {!stealth && <span className={css.needLabel}>{need.label}</span>}
          </span>
          {!stealth && (
            <span className={css.needMeta}>
              {waitLine(need.waiting, need.since, now)}
              {need.due !== undefined && (
                // 一行一个颜色（律五）：点已经是琥珀，过了期只把字换成「原定」，不再上红。
                <span className={overdue ? css.past : undefined}>
                  {' · '}
                  {overdue ? '原定' : '原话'}「{need.due.text}」
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    )
  }

  const needSection = (
    <section className={css.section} aria-label="要你">
      {head(undefined, '要你', (
        <span className={css.headTail}>
          {needs.length > 0 && <kbd className={css.kbd} title="按 N 跳到下一件">N</kbd>}
          <span className={needs.length > 0 ? css.needCount : css.zeroCount}>{needs.length}</span>
        </span>
      ))}
      {!loaded
        ? unread ? <UnreadLine had={false} /> : <Skeleton rows={2} />
        : needs.length === 0
        ? (
          <>
            <div className={css.clear}>
              <Icon name="check" size={14} className={css.clearMark} />
              <span>都处理完了</span>
            </div>
            {/* 清零不是空白（律九）：今天没问你就办了的那几件，凭的是你签的规矩。 */}
            {autoToday > 0 && !stealth && (
              <button type="button" className={css.auto} onClick={() => { openPalette('auto') }}>
                今天{AGENT}按你的规矩自己办了 {autoToday} 件
                <Icon name="chevR" size={12} />
              </button>
            )}
          </>
        )
        : (
          <>
            {(moreNeeds ? needs : needs.slice(0, NEED_ROWS)).map(needRow)}
            {needs.length > NEED_ROWS && (
              <button type="button" className={css.more} onClick={() => { setMoreNeeds(value => !value) }}>
                {moreNeeds ? '收起' : `还有 ${String(needs.length - NEED_ROWS)} 条`}
                <Icon name={moreNeeds ? 'chevD' : 'chevR'} size={12} />
              </button>
            )}
          </>
        )}
    </section>
  )

  /* ——— 2 · 运行中 ——— */

  /*
    运行中 = 图上在跑的活 ∪ 宿主说正在跑一回合的**本地**会话。本地会话没有任务对象，
    图上不知道它在跑——此前在桌上开的长活一跑起来就从左栏消失，只能回本地那一节去找。
  */
  const topicSessions = new Set(inbox.topicSessionIds)
  const running = [
    ...(inbox.running ?? []),
    ...hostIds
      .filter(id => hostById[id]?.running === true && !topicSessions.has(id) && !(inbox.running ?? []).some(run => run.sessionId === id))
      .map(id => ({ sessionId: id, title: hostById[id]?.displayTitle ?? '本地会话', placeName: '本地', since: hostById[id]?.updatedAt ?? now, local: true })),
  ]
  const runningSection = running.length === 0 ? null : (
    <section className={css.section} aria-label="运行中">
      {head(undefined, '运行中', <span className={css.headTail}><span className={css.zeroCount}>{running.length}</span></span>)}
      {running.map((run) => {
        const last = Math.max(run.since, hostById[run.sessionId]?.updatedAt ?? 0)
        const stalled = now - last > STALL_MS
        return (
          <button
            type="button"
            key={`${run.sessionId}:${String(run.since)}`}
            className={`${css.row} ${css.tall} ${run.sessionId === currentSessionId ? css.rowActive : ''}`}
            onClick={() => { go(run.sessionId) }}
          >
            <span className={css.lead}><Signal kind={stalled ? 'stall' : 'run'} /></span>
            <span className={css.text}>
              <span className={css.title}>{stealth ? '一件活' : run.title}</span>
              <span className={`${css.meta} ${stalled ? css.metaNeed : ''}`}>
                {stalled
                  ? `${span(now - last)}没进展`
                  // 本地会话只知道最后一次动静，不知道从几点开始跑——不报一个假的时长。
                  : `${stealth ? '' : `${run.placeName} · `}在跑${'local' in run ? '' : ` ${span(now - run.since)}`}`}
              </span>
            </span>
          </button>
        )
      })}
    </section>
  )

  /* ——— 3 · 承诺 ——— */

  const commitments = inbox.commitments
  const boardOn = frame.kind === 'board' || frame.kind === 'goal' || frame.kind === 'judg'
  const ledgerRow = (
    <button
      type="button"
      className={`${css.row} ${css.ledger} ${boardOn ? css.rowActive : ''}`}
      onClick={() => { setFrame({ kind: frame.kind === 'board' ? 'session' : 'board' }) }}
    >
      <span className={css.lead}><Icon name="list" /></span>
      <span className={css.title}>承诺</span>
      {commitments.overdue > 0
        ? <span className={css.tailLate}>{commitments.overdue} 逾期</span>
        : (commitments.toAssess ?? 0) > 0
          ? <span className={css.tailNeed}>{commitments.toAssess} 该评估</span>
          : commitments.open > 0 ? <span className={css.tail}>{commitments.open}</span> : null}
    </button>
  )

  /* ——— 4 · 云之家 ——— */

  const topicRow = (row: InboxItemWire): ReactNode => (
    <button
      type="button"
      key={row.sessionId}
      className={`${css.row} ${css.sub} ${row.sessionId === currentSessionId && frame.kind === 'session' ? css.rowActive : ''}`}
      title={stealth ? undefined : row.preview}
      onClick={() => { go(row.sessionId, row.cardRef) }}
    >
      <span className={css.subLine} />
      <span className={css.title}>{stealth ? '一个话题' : row.title}</span>
      <Signal kind={signalOf(row.tone, row.live === true)} />
    </button>
  )

  const listed = inbox.conversations ?? []
  /*
    Places with live work but no roster row yet: the roster is built BY the
    poll, so on a cold start a place holding a PENDING APPROVAL can be missing
    from it. The task segment must never depend on the message segment.
  */
  const known = new Set(listed.map(row => row.placeKey))
  const conversations: InboxConversationWire[] = [
    ...listed,
    ...inbox.places.filter(place => place.placeKey !== 'local' && !known.has(place.placeKey)).map(place => ({
      placeKey: place.placeKey,
      name: place.groupName,
      kind: place.conversationKind,
      lastMsgTime: Date.now(),
      preview: '',
      unread: 0,
      onDuty: true,
      selfChat: false,
    })),
  ]
  const byRecent = (left: InboxConversationWire, right: InboxConversationWire): number => (
    right.lastMsgTime - left.lastMsgTime
  )
  const served = conversations.filter(row => row.onDuty && row.kind !== 'assistant').sort(byRecent)
  const unserved = conversations.filter(row => !row.onDuty || row.kind === 'assistant').sort(byRecent)

  const lead = (row: InboxConversationWire): ReactNode => (
    row.kind === 'group'
      ? <span className={css.glyph}><Icon name="hash" size={14} /></span>
      : <Face name={row.name} {...(row.avatarUrl === undefined ? {} : { photo: row.avatarUrl })} hidePhoto={stealth} />
  )

  const placeRow = (row: InboxConversationWire): ReactNode => {
    const place = inbox.places.find(entry => entry.placeKey === row.placeKey)
    const active = frame.kind === 'place' && frame.placeKey === row.placeKey
    const topics = place?.topics ?? []
    // 自聊行的未读不算「有人找你」：它的可应答流量已在「要你」里，私账消息读即清。
    const unread = stealth || row.selfChat ? 0 : row.unread
    const signal = place === undefined ? undefined : signalOf(place.tone, topics.some(topic => topic.live === true))
    return (
      <div key={row.placeKey} className={css.place}>
        <button
          type="button"
          className={`${css.row} ${active ? css.rowActive : ''}`}
          title={stealth ? undefined : row.name}
          onClick={() => { setFrame({ kind: 'place', placeKey: row.placeKey, groupName: row.name }) }}
        >
          <span className={css.lead}>{lead(row)}</span>
          {/* 自聊是审批与私语通道：它的名字就是你自己，说它是什么比说它叫什么有用。 */}
          <span className={css.title}>{stealth ? '一个会话' : row.selfChat ? '我 · 审批通道' : row.name}</span>
          {signal !== undefined
            ? <Signal kind={signal} />
            : unread > 0 && <span className={css.unread}>{unread > 99 ? '99+' : unread}</span>}
        </button>
        {topics.map(topicRow)}
      </div>
    )
  }

  /** 没接入的一行：只剩名字——它们是 IM 的事，不是这里的事。 */
  const plainRow = (row: InboxConversationWire): ReactNode => (
    <button
      type="button"
      key={row.placeKey}
      className={`${css.row} ${frame.kind === 'place' && frame.placeKey === row.placeKey ? css.rowActive : ''}`}
      title={row.kind === 'assistant' ? row.name : `${row.name}\n云小助没在这里接单：在这里说话它听不见`}
      onClick={() => { setFrame({ kind: 'place', placeKey: row.placeKey, groupName: row.name }) }}
    >
      <span className={css.lead}>{lead(row)}</span>
      <span className={css.titleDim}>{stealth ? '一个会话' : row.name}</span>
    </button>
  )

  const match = filter.trim().toLowerCase()
  const unservedShown = match === '' ? unserved : unserved.filter(row => row.name.toLowerCase().includes(match))
  const unservedGroups = unserved.filter(row => row.kind === 'group').length
  const unservedOthers = unserved.length - unservedGroups
  const unservedLabel = [
    unservedGroups > 0 ? `${String(unservedGroups)} 个群` : '',
    unservedOthers > 0 ? `${String(unservedOthers)} 个会话` : '',
  ].filter(part => part !== '').join('和')

  const yzjSection = (
    <section className={css.section} aria-label="云之家">
      {head('sec:yzj', '云之家')}
      {!shut('sec:yzj') && (
        <>
          {conversations.length === 0 && (
            <div className={css.calm}>
              还没读到云之家的会话，过一会儿就有了。
            </div>
          )}
          {served.map(placeRow)}
          {unserved.length > 0 && (
            <button
              type="button"
              className={css.row}
              aria-expanded={!shut('unserved', true)}
              onClick={() => { toggle('unserved', true) }}
            >
              <span className={css.lead}><span className={css.glyph}><Icon name="hash" size={14} /></span></span>
              <span className={css.titleDim}>{unservedLabel}未接入</span>
              <Icon name={shut('unserved', true) ? 'chevR' : 'chevD'} size={12} className={css.foldChev} />
            </button>
          )}
          {!shut('unserved', true) && (
            <div className={css.unserved}>
              {unserved.length > 12 && (
                <input
                  className={css.filter}
                  value={filter}
                  placeholder="按名字找…"
                  spellCheck={false}
                  onChange={(event) => { setFilter(event.target.value) }}
                />
              )}
              {unservedShown.map(plainRow)}
            </div>
          )}
        </>
      )}
    </section>
  )

  /* ——— 5 · 本地 ——— */

  const topicIds = new Set(inbox.topicSessionIds)
  const archived = new Set(workspaces.archivedSessionIds ?? [])
  const locals = hostIds
    .filter(id => !topicIds.has(id) && !archived.has(id))
    .map(id => ({ id, ...(hostById[id] ?? {}) }))
    .filter(entry => entry.blank !== true)
  const accounted = new Set(workspaces.items.flatMap(workspace => workspace.sessionIds))
  const orphans = locals.filter(entry => !accounted.has(entry.id))

  /**
   * One local session row: what it is called, when it last moved, and the
   * three things you can do to it. Only LOCAL sessions get the menu: a topic
   * row is a projection of a graph object, not a session you own.
   */
  const sessionRow = (entry: { id: string; displayTitle?: string; updatedAt?: number }): ReactNode => {
    const active = entry.id === currentSessionId && frame.kind === 'session'
    const title = entry.displayTitle ?? '未命名会话'
    const items = [
      { id: 'rename', label: '重命名' },
      ...(sessionActions.fork === undefined ? [] : [{ id: 'fork', label: '分叉对话' }]),
      ...(sessionActions.archive === undefined ? [] : [{ id: 'archive', label: '归档对话', danger: true }]),
    ]
    return (
      <div className={`${css.row} ${css.sub} ${active ? css.rowActive : ''}`} key={entry.id}>
        <span className={css.subLine} />
        {renaming === entry.id
          ? (
            <input
              className={css.renameInput}
              value={rename}
              autoFocus
              spellCheck={false}
              onChange={(event) => { setRename(event.target.value) }}
              onBlur={() => { setRenaming(undefined) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenaming(undefined)
                if (event.key !== 'Enter') return
                const next = rename.trim()
                setRenaming(undefined)
                if (next === '' || next === title) return
                void sessionActions.rename(entry.id, next).catch((cause: unknown) => {
                  setRowError(plainError(cause instanceof Error ? cause.message : String(cause)).text)
                })
              }}
            />
          )
          : (
            <button type="button" className={css.rowBody} title={title} onClick={() => { go(entry.id) }}>
              <span className={css.title}>{title}</span>
            </button>
          )}
        <span className={css.time}>{entry.updatedAt === undefined ? '' : relative(entry.updatedAt, now)}</span>
        <Menu
          open={menuFor === entry.id}
          anchor={(
            <button
              type="button"
              className={css.rowMore}
              aria-label="会话操作"
              aria-expanded={menuFor === entry.id}
              onClick={(event) => {
                event.stopPropagation()
                setMenuFor(value => (value === entry.id ? undefined : entry.id))
              }}
            >
              <Icon name="more" size={14} />
            </button>
          )}
          items={items}
          portal
          compact
          align="end"
          onClose={() => { setMenuFor(undefined) }}
          onSelect={(id) => {
            setMenuFor(undefined)
            setRowError('')
            if (id === 'rename') {
              setRename(title)
              setRenaming(entry.id)
              return
            }
            if (id === 'fork') {
              void sessionActions.fork?.(entry.id).catch((cause: unknown) => {
                setRowError(plainError(cause instanceof Error ? cause.message : String(cause)).text)
              })
              return
            }
            // Archiving hides the session from every surface this app has and
            // there is no way back through the UI, so it asks first.
            if (id === 'archive') setArchiving(entry.id)
          }}
        />
      </div>
    )
  }

  /** The confirm strip, rendered under the row it belongs to. */
  const archiveAsk = (id: string): ReactNode => (
    archiving !== id ? null : (
      <div className={css.confirm} key={`${id}:ask`}>
        归档后这里就找不到它了（日志还在盘上）。
        <span className={css.confirmActs}>
          <button
            type="button"
            className={css.confirmYes}
            onClick={() => {
              setArchiving(undefined)
              void sessionActions.archive?.(id).catch((cause: unknown) => {
                setRowError(plainError(cause instanceof Error ? cause.message : String(cause)).text)
              })
            }}
          >
            归档
          </button>
          <button type="button" className={css.confirmNo} onClick={() => { setArchiving(undefined) }}>取消</button>
        </span>
      </div>
    )
  )

  const localSection = (
    <section className={css.section} aria-label="本地">
      {head('sec:local', '本地')}
      {!shut('sec:local') && (
        <>
          {workspaces.items.map((workspace) => {
            const own = locals.filter(entry => workspace.sessionIds.includes(entry.id))
            const closed = shut(workspace.id)
            return (
              <div className={css.place} key={workspace.id}>
                <div className={css.row} title={workspace.path}>
                  <button
                    type="button"
                    className={css.rowBody}
                    aria-expanded={!closed}
                    onClick={() => { toggle(workspace.id) }}
                  >
                    <span className={css.lead}><span className={css.glyph}><Icon name="folder" size={14} /></span></span>
                    <span className={css.title}>{workspace.title}</span>
                  </button>
                  <button
                    type="button"
                    className={css.rowMore}
                    title="在这个文件夹里开一个会话"
                    aria-label="在这个文件夹里开一个会话"
                    onClick={() => {
                      setFrame({ kind: 'session' })
                      startSession(workspace.id)
                    }}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                </div>
                {!closed && own.flatMap(entry => [sessionRow(entry), archiveAsk(entry.id)])}
              </div>
            )
          })}
          {orphans.length > 0 && (
            <div className={css.place}>
              <button type="button" className={css.row} onClick={() => { toggle('orphans') }}>
                <span className={css.lead}><span className={css.glyph}><Icon name="folder" size={14} /></span></span>
                <span className={css.titleDim}>目录已不在</span>
              </button>
              {!shut('orphans') && orphans.flatMap(entry => [sessionRow(entry), archiveAsk(entry.id)])}
            </div>
          )}
          {rowError !== '' && <div className={css.rowError}>{rowError}</div>}
          <button
            type="button"
            className={css.row}
            disabled={workspaces.create === undefined || picking}
            onClick={openDirectory}
          >
            <span className={css.lead}><Icon name="plus" size={14} /></span>
            <span className={css.titleDim}>{picking ? '系统的文件夹对话框开着…' : '打开本地文件夹'}</span>
          </button>
          {picking && (
            <div className={css.calm}>文件夹对话框开在跑 dsh 的那台机器上，不在这个浏览器里。</div>
          )}
          {pickError !== '' && (
            <div className={css.rowError}>
              {pickError}
              <button type="button" className={css.inlineBtn} onClick={openDirectory}>重新选择</button>
              {workspaces.pickDirectory !== undefined && (
                <button type="button" className={css.inlineBtn} onClick={() => { setPickError(''); setOpening(true) }}>
                  手填路径
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )

  /*
    **窄到画不下一行的时候，收成一条轨。** 宿主在窄宽度下会把左区收到约 35px；判据用
    自己的宽度（不认宿主的哈希类名）。轨上只留不需要字就能读的：要你的数、承诺入口。
  */
  const [narrow, setNarrow] = useState(false)
  const measure = useCallback((node: HTMLElement | null) => {
    if (node === null) return
    const watch = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
        setNarrow(width > 0 && width < 120)
      }
    })
    watch.observe(node)
  }, [])

  if (narrow) {
    const first = needs[0]
    return (
      <nav ref={measure} className={`${tokens.tokens} ${css.sidebar} ${css.rail}`} aria-label="工作台">
        <button
          type="button"
          className={css.railBtn}
          disabled={first === undefined}
          title={first === undefined ? '没有要你的事' : `要你 ${String(needs.length)} —— 去第一件`}
          aria-label={`要你 ${String(needs.length)}`}
          onClick={() => { if (first !== undefined) go(first.sessionId, first.ref) }}
        >
          {needs.length > 0 ? <span className={css.needCount}>{needs.length}</span> : <Icon name="check" />}
        </button>
        <button
          type="button"
          className={`${css.railBtn} ${boardOn ? css.rowActive : ''}`}
          title="承诺"
          aria-label="承诺"
          onClick={() => { setFrame({ kind: frame.kind === 'board' ? 'session' : 'board' }) }}
        >
          <Icon name="list" />
        </button>
      </nav>
    )
  }

  return (
    <nav ref={measure} className={`${tokens.tokens} ${css.sidebar}`} aria-label="工作台">
      {opening && (
        <YzjDirectoryPicker
          {...(workspaces.listDirectory === undefined ? {} : { listDirectory: workspaces.listDirectory })}
          {...(workspaces.pickDirectory === undefined ? {} : { pickDirectory: workspaces.pickDirectory })}
          choose={adopt}
          close={() => { setOpening(false) }}
        />
      )}
      <div className={css.section}>
        <button type="button" className={`${css.row} ${css.jump}`} onClick={() => { openPalette('search') }}>
          <span className={css.lead}><Icon name="search" /></span>
          <span className={css.titleDim}>跳到…</span>
          <kbd className={css.kbd}>⌘K</kbd>
        </button>
      </div>
      {loaded && unread && <UnreadLine had />}
      {needSection}
      {runningSection}
      <div className={css.section}>{ledgerRow}</div>
      {yzjSection}
      {localSection}
    </nav>
  )
}

/** 行尾的相对时间：分钟、小时、天。 */
function relative(at: number, now: number): string {
  const diff = Math.max(0, now - at)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))} 分钟`
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))} 小时`
  return `${String(Math.floor(diff / 86_400_000))} 天`
}
