/**
 * The left column — the unified inbox (§7.2), replacing the host's workspace
 * browser.
 *
 * The host's sidebar answers "which folder is this session in". That is the
 * right question for a coding tool and the wrong one here: the operator's unit
 * of work is a PLACE and the topics living in it, and their scarce resource is
 * attention.
 *
 * **One list.** An earlier version had a triage list AND a place tree, so an
 * active topic appeared twice and a settled one appeared once, somewhere else,
 * looking identical. The design's shape is a single tree grouped by place, with
 * three counters above it that JUMP rather than filter — a chip that filters
 * makes the list a second list again.
 *
 * **节点是行，标签是字 (D13⑤).** Three different things live in this column and
 * each wears its own clothes:
 *
 * - a **place** is a first-class ROW — avatar, name, 「主楼 · N 话题」, aggregate
 *   badge — because it is a resident of the graph with a view of its own that
 *   you can walk into;
 * - a **topic** is an indented SUB-ROW with a subordination line, so that the
 *   attention lease pruning children while the parent stays is legible as the
 *   parent/child relationship it is;
 * - a pure grouping (私聊) is a grey LABEL with a rule, because it is
 *   typography, not a node.
 *
 * **本地 = 工作夹场所.** A working folder is a place that happens to have no IM
 * channel — its contract, tools and memory follow the folder, which is dsh's
 * own semantics. So it gets a place row too, with its sessions as sub-rows, and
 * the orphan 「本地」 label is gone. The column's grammar is now uniform:
 * place row (group / folder) + sub-row (topic / local session) + grouping label.
 *
 * **折叠 is the user's sovereignty over attention; the lease is the system's
 * agent.** They are orthogonal: the lease prunes SETTLED children, collapse
 * hides a whole group that is active but not today's concern. A collapsed
 * group keeps its aggregate badge — attention must not be lost by tidying —
 * and still shows the row of the session you are currently in.
 *
 * **The disclosure column sits at the row's left edge**, vertically aligned
 * down the whole tree (Finder / VS Code / Notion). It was briefly at the tail:
 * wrong, because a right-hand `›` reads as "enter" in iOS grammar, and it
 * crowded the badge's signal zone. One grammar throughout: the disclosure
 * column always collapses, the row body always does the row's own job — a
 * place with a view opens its view, a pure container collapses.
 *
 * The previous version dressed places as labels. Grey text plus a rule is the
 * whole industry's section-divider grammar, so muscle memory read it as "not
 * clickable" — and the topic rows under it looked more first-class than the
 * place above them, drawing the hierarchy upside down. Slack, Discord and Teams
 * all answer this the same way: a channel is a row, a section is a word.
 *
 * **注意力租约** is what keeps it readable: inside a real place a topic holds a
 * row only while it is doing something. When it settles the row is released —
 * the topic is not deleted, it moves to the place's own view, where the archive
 * lives and is still walkable. Size stays O(active work), not O(history). Direct
 * chats keep their rows, because they have no group view to be archived into.
 *
 * It replaces the browsing REGION, not the column: the host keeps its own
 * chrome, its New Session control and the settings seat at the foot. Replacing
 * a whole column would have silently taken away seats that were never ours.
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InboxConversationWire, InboxItemWire, InboxView, SurfaceInject, TopicTone,
} from './rpc.ts'
import { avatarOf } from './stream.ts'
import { currentFrame, setFrame, subscribeFrame } from './store.ts'
import { YzjDirectoryPicker, type DirectoryLevel } from './DirectoryPicker.tsx'
import tokens from './tokens.module.css'
import css from './sidebar.module.css'

/** One host session, as the local list needs it. */
interface HostSession {
  readonly displayTitle?: string
  readonly blank?: boolean
  /** Last activity, for the row's relative clock. */
  readonly updatedAt?: number
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
 * Folds that start closed.
 *
 * Assistant and system feeds are the only ones: 63 of them on this account,
 * none of them somebody asking for you. Everything else starts open, because
 * a conversation list that hides conversations is not a conversation list.
 */
const DEFAULT_SHUT = new Set(['assistants'])

/** dsh's own relative-time buckets, so a row here reads like a row there. */
function timeLabel(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined || !Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  const diff = Math.max(0, now - updatedAt)
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return `${String(Math.floor(diff / MIN))}分钟`
  if (diff < DAY) return `${String(Math.floor(diff / HOUR))}小时`
  if (diff < 30 * DAY) return `${String(Math.floor(diff / DAY))}天`
  if (diff < 365 * DAY) return `${String(Math.floor(diff / (30 * DAY)))}个月`
  return `${String(Math.floor(diff / (365 * DAY)))}年`
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
   * somewhere, so without this there is no way to start one at all: the ＋
   * button lands on a New Session view whose workspace picker went with the
   * column. Taking a seat is not the same as deciding nobody needed it.
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

/**
 * Badge colour per tone. The order of loudness is the order of the design.
 *
 * 冲突此前自成一档（红）；v4.15 的分类学把**冲突确认归进「单答确认」**——人要做的
 * 动作确实就是那一个。颜色因此和确认同档，而「冲突待裁」四个字由家族自己写在徽标上
 * （`demand.badge`），一屏上仍然分得开。少一种颜色，少一份要维护的名册。
 */
const TONE_CLASS: Record<TopicTone, string> = {
  confirm: 'badgeConfirm',
  review: 'badgeReview',
  running: 'badgeRunning',
  waiting: 'badgeWaiting',
  idle: 'badgeIdle',
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
  /** 本地名称过滤 — the substitute for a group-search API that does not exist. */
  const [filter, setFilter] = useState('')
  const frame = useSyncExternalStore(subscribeFrame, currentFrame)
  const hostIds = useSessions(state => state.ids) ?? []
  const hostById = useSessions(state => state.byId) ?? {}
  /**
   * The session on stage.
   *
   * Read from the same snapshot as the list rather than taken as a prop: this
   * slot is root-scoped so the registration never had a `sessionId` to give,
   * and passing nothing meant the active row never highlighted — and, once
   * collapsing arrived, that a collapsed group could hide the very row you
   * were standing in.
   */
  const currentSessionId = useSessions(state => state.current)
  const [inbox, setInbox] = useState<InboxView>(EMPTY)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async (): Promise<void> => {
    setInbox(await inject.inbox() ?? EMPTY)
  }, [inject])

  useEffect(() => {
    let alive = true
    void refresh()
    const timer = setInterval(() => { if (alive) void refresh() }, 5_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  // Relative times only need to be roughly right; a minute is the smallest
  // bucket the labels have, so that is how often they can change.
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { clearInterval(timer) }
  }, [])

  const go = useCallback((sessionId: string): void => {
    setFrame({ kind: 'session' })
    open(sessionId)
  }, [open])

  /** Register a picked directory and land in a session there. */
  const adopt = useCallback(async (path: string): Promise<void> => {
    const created = await workspaces.create?.(path)
    if (created === undefined) throw new Error('这个目录没能登记成工作区')
    setFrame({ kind: 'session' })
    startSession(created.id)
  }, [startSession, workspaces])

  /**
   * 打开本地文件夹 — dsh's own route.
   *
   * In the harness this is a hole (`sidebar.workspaces.directoryFlow`) that a
   * picker package fills; on this deployment the occupant is renderless and
   * does exactly one thing: call the host's `pickDirectory`, which opens the
   * operating system's own folder chooser. We cannot mount that occupant —
   * the hole is declared by the browser entry we shadow, and declaring is
   * claiming — but we can take the same single step, and a dialog of our own
   * in front of it was a step dsh does not make anybody take.
   *
   * The self-built browser survives only as the no-chooser fallback: a host
   * composed with `browse` instead of `native` has no OS dialog to open, and
   * a feature that dies there is worse than one that degrades.
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
        setPickError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setPicking(false) })
  }, [adopt, workspaces])

  /**
   * 演示隐身档 (D10) — declared before the fold helpers that consult it.
   *
   * Zeroing badges and hiding previews left every conversation NAME on the
   * projector, which is exactly what this mode exists to take off the screen.
   */
  const stealth = inbox.stealth === true

  const toggle = (key: string): void => {
    setCollapsed(value => ({ ...value, [key]: !(value[key] ?? DEFAULT_SHUT.has(key)) }))
  }

  /**
   * 隐身档先于一切折叠状态 (D10).
   *
   * Zeroing badges and hiding previews left every conversation NAME on the
   * projector, which is the one thing 隐身 exists to take off the screen. The
   * base folds whole; the operator can still open it deliberately, because a
   * demo档 that cannot be un-hidden is a mode people avoid turning on.
   */
  const shut = (key: string): boolean => (
    collapsed[key] ?? (key === 'sec:yzj' && stealth ? true : DEFAULT_SHUT.has(key))
  )
  const shutBy = (key: string, fallback: boolean): boolean => collapsed[key] ?? fallback

  /**
   * The disclosure mark, drawn rather than typed.
   *
   * `⌄` is a character: its baseline sits wrong, its weight follows whatever
   * font resolved, and it changes shape between platforms. A 1.5px stroked
   * path is the same mark everywhere and at every size.
   */
  const CHEV = (
    <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
      <path
        d="M2 3.5 5 6.5 8 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )

  /**
   * The disclosure column, in its two forms.
   *
   * A row whose OWN job is collapsing (section head, grouping label, working
   * folder) carries the mark as decoration — the row is the control. A row
   * with a job of its own (a place you can walk into) carries a real button,
   * because there the column and the body do two different things.
   */
  const chevMark = (key: string, small = false, closedByDefault = false): ReactNode => (
    <span
      className={`${css.chev} ${small ? css.chevSmall : ''} ${shutBy(key, closedByDefault) ? css.chevClosed : ''}`}
    >
      {CHEV}
    </span>
  )
  const chevButton = (key: string): ReactNode => (
    <button
      type="button"
      className={`${css.chev} ${shut(key) ? css.chevClosed : ''}`}
      aria-label={shut(key) ? '展开' : '折叠'}
      onClick={(event) => {
        event.stopPropagation()
        toggle(key)
      }}
    >
      {CHEV}
    </button>
  )

  /**
   * 顶层大分栏 — the channel axis, projected once at the outermost level.
   *
   * 云之家 is the places that have an IM channel; 本地 is the places that do
   * not. That is a bigger distinction than any grouping inside either one, so
   * it gets a louder typographic register than a grey in-group label — the
   * same move Finder makes with FAVORITES / LOCATIONS.
   */
  const section = (key: string, title: string, hint: string, holds = false): ReactNode => (
    <button
      type="button"
      className={`${css.sec} ${holds ? css.secHolds : ''}`}
      title={holds ? '你正站在这一界里' : '折叠/展开整个分栏'}
      onClick={() => { toggle(key) }}
    >
      {chevMark(key, true)}
      {title}
      <span className={css.secHint}>{hint}</span>
    </button>
  )

  const badge = (tone: TopicTone, label: string): ReactNode => (
    label === '' ? null : (
      <span className={`${css.badge} ${css[TONE_CLASS[tone]] ?? ''}`}>
        {tone === 'running' && <span className={css.pulse} />}
        {label}
      </span>
    )
  )

  /**
   * The item row — the same component for every topic, wherever it sits.
   *
   * `sub` indents it under a place row and draws the subordination line: what
   * the attention lease prunes is exactly these children, so the parent/child
   * relationship has to be visible for the pruning to read as pruning.
   */
  const item = (row: InboxItemWire, sub = false): ReactNode => {
    const avatar = avatarOf(row.title || row.placeName)
    return (
      <button
        type="button"
        key={row.sessionId}
        className={`${css.item} ${sub ? css.itemSub : ''} ${row.sessionId === currentSessionId ? css.itemActive : ''}`}
        onClick={() => { go(row.sessionId) }}
        title={row.preview}
      >
        <span className={css.icon} style={{ background: avatar.color }}>{avatar.text}</span>
        <span className={css.itemText}>
          <span className={css.itemTitle}>{row.title}</span>
          <span className={css.itemPreview}>{row.preview}</span>
        </span>
        {badge(row.tone, row.badge)}
        {/* 一个话题可以同时欠你一个答复、又正在跑。徽标说前者，脉冲说后者。 */}
        {row.live === true && row.tone !== 'running' && <span className={css.livePulse} />}
      </button>
    )
  }

  /**
   * One conversation of the base — 「谁在找我」.
   *
   * Its SHAPE is a function of one fact: does the agent answer here. On duty
   * and with work in it, the row is a 场所行 with its topics under it; the
   * rest are plain conversation rows. That is the whole 升降级 rule (v4.8),
   * derived rather than configured — a column that disagreed with the gate
   * would promise an agent that never answers.
   */
  const conversationRow = (row: InboxConversationWire): ReactNode => {
    const place = inbox.places.find(entry => entry.placeKey === row.placeKey)
    const active = frame.kind === 'place' && frame.placeKey === row.placeKey
    const closed = shut(row.placeKey)
    const openPlace = (): void => {
      setFrame({ kind: 'place', placeKey: row.placeKey, groupName: row.name })
    }
    const avatar = avatarOf(row.name)
    const face = (
      <span className={css.icon} style={{ background: avatar.color }}>
        {row.avatarUrl === undefined || stealth
          ? avatar.text
          : (
            <img
              className={css.photo}
              src={row.avatarUrl}
              alt=""
              onError={(event) => { event.currentTarget.style.display = 'none' }}
            />
          )}
      </span>
    )
    // 自聊 is the approval and private channel; its answerable traffic is
    // already counted in the attention chips above.
    const unread = stealth || row.selfChat ? 0 : row.unread
    const note = row.selfChat ? '审批与私语通道' : stealth ? '' : row.preview

    if (place !== undefined && row.onDuty) {
      const holds = closed && place.topics.some(entry => entry.sessionId === currentSessionId)
      return (
        <div className={css.place} key={row.placeKey}>
          <div
            className={`${css.row} ${css.placeRow} ${active ? css.itemActive : ''} ${holds ? css.holds : ''}`}
            title={holds ? '你正站在这个组里的一个话题上' : undefined}
          >
            {chevButton(row.placeKey)}
            <button
              type="button"
              className={css.rowBody}
              title="打开群视图（主楼 + 内联话题卡）"
              onClick={openPlace}
            >
              {face}
              <span className={css.itemText}>
                <span className={`${css.itemTitle} ${css.placeTitle}`}>{row.name}</span>
                <span className={css.itemPreview}>
                  {/* 自聊是审批与私语通道，即使它接单、即使它长出了话题。 */}
                  {row.selfChat
                    ? `审批与私语通道 · ${String(place.topics.length + place.archived)} 个话题`
                    : `主楼 · ${String(place.topics.length + place.archived)} 个话题`}
                </span>
              </span>
              {badge(place.tone, place.badge)}
              {unread > 0 && <span className={css.unread}>{unread > 99 ? '99+' : unread}</span>}
            </button>
          </div>
          {!closed && place.topics.map(entry => item(entry, true))}
          {!closed && place.archived > 0 && (
            <button type="button" className={css.archived} onClick={openPlace}>
              {place.archived} 个已办完 · 在群视图里
            </button>
          )}
        </div>
      )
    }

    return (
      <button
        type="button"
        key={row.placeKey}
        className={`${css.item} ${active ? css.itemActive : ''}`}
        title={row.onDuty ? row.name : `${row.name}\n（agent 未在此接单）`}
        onClick={openPlace}
      >
        {face}
        <span className={css.itemText}>
          <span className={css.itemTitle}>
            <span>{row.name}</span>
            {/*
              「不在服务范围」必须看得见，不能只活在 hover 里。

              试运行期只有名单内的会话被轮询，名单外的群 agent **根本读不到**
              ——在那里 @ 它，得到的是彻底的沉默，而唯一的解释藏在一个悬停
              提示后面。查不出原因的沉默，和坏掉长得一模一样（这正是本设计
              一路在避免的那种失败）。所以这个状态上屏。
            */}
            {!row.onDuty && row.kind !== 'assistant' && (
              <span className={css.offDuty} title="试运行期不在服务范围：这个会话不会被轮询，在这里 @next 不会有任何反应">
                未接入
              </span>
            )}
          </span>
          <span className={css.itemPreview}>{note}</span>
        </span>
        <span className={css.rightCol}>
          <span className={css.rowTime}>{stealth ? '' : timeLabel(row.lastMsgTime, now)}</span>
          {unread > 0 && <span className={css.unread}>{unread > 99 ? '99+' : unread}</span>}
        </span>
      </button>
    )
  }

  /**
   * One local session row: what it is called, when it last moved, and the
   * three things you can do to it.
   *
   * Only LOCAL sessions get the menu. A topic row is a projection of a graph
   * object: its title comes from the topic's label rather than the session's,
   * so renaming would change nothing visible; a fork of it is bound to no
   * place, so it could not send; and archiving fights the attention lease.
   */
  const sessionRow = (
    entry: { id: string; displayTitle?: string; updatedAt?: number },
    note: string,
  ): ReactNode => {
    const active = entry.id === currentSessionId
    const title = entry.displayTitle ?? '未命名会话'
    const items = [
      { id: 'rename', label: '重命名' },
      ...(sessionActions.fork === undefined ? [] : [{ id: 'fork', label: '分叉对话' }]),
      ...(sessionActions.archive === undefined
        ? []
        : [{ id: 'archive', label: '归档对话', danger: true }]),
    ]
    return (
      <div
        className={`${css.row} ${css.itemSub} ${active ? css.itemActive : ''}`}
        key={entry.id}
      >
        <span className={`${css.icon} ${css.subIcon}`} style={{ background: '#8B93A3' }}>▢</span>
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
                  setRowError(cause instanceof Error ? cause.message : String(cause))
                })
              }}
            />
          )
          : (
            <button
              type="button"
              className={css.rowBody}
              title={title}
              onClick={() => { go(entry.id) }}
            >
              <span className={css.itemText}>
                <span className={css.itemTitle}>{title}</span>
                <span className={css.itemPreview}>{note}</span>
              </span>
            </button>
          )}
        <span className={css.rowTime}>{timeLabel(entry.updatedAt, now)}</span>
        <Menu
          open={menuFor === entry.id}
          anchor={(
            <button
              type="button"
              className={css.more}
              aria-label="会话操作"
              aria-expanded={menuFor === entry.id}
              onClick={(event) => {
                event.stopPropagation()
                setMenuFor(value => (value === entry.id ? undefined : entry.id))
              }}
            >
              ⋯
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
                setRowError(cause instanceof Error ? cause.message : String(cause))
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
        <button
          type="button"
          className={css.confirmYes}
          onClick={() => {
            setArchiving(undefined)
            void sessionActions.archive?.(id).catch((cause: unknown) => {
              setRowError(cause instanceof Error ? cause.message : String(cause))
            })
          }}
        >
          归档
        </button>
        <button
          type="button"
          className={css.confirmNo}
          onClick={() => { setArchiving(undefined) }}
        >
          取消
        </button>
      </div>
    )
  )

  /** A counter that goes somewhere. A chip that filters makes a second list. */
  const chip = (tone: TopicTone, mark: string, label: string, count: number): ReactNode => (
    <button
      type="button"
      className={`${css.chip} ${css[TONE_CLASS[tone]] ?? ''} ${count === 0 ? css.chipZero : ''}`}
      disabled={count === 0}
      title={count === 0 ? `没有${label}的话题` : `跳到第一个${label}的话题`}
      onClick={() => {
        const target = inbox.firstOf[tone]
        if (target !== undefined) go(target)
      }}
    >
      {mark} <span className={css.chipCount}>{count}</span> {label}
    </button>
  )

  // Everything the graph does not know about: sessions started at this desk.
  const topicIds = new Set(inbox.topicSessionIds)
  // An archived session is hidden from every grouping surface the host has.
  const archived = new Set(workspaces.archivedSessionIds ?? [])
  const locals = hostIds
    .filter(id => !topicIds.has(id) && !archived.has(id))
    .map(id => ({ id, ...(hostById[id] ?? {}) }))
    .filter(entry => entry.blank !== true)

  const listed = inbox.conversations ?? []
  /*
    Places with live work but no roster row yet.

    The roster is built BY the poll, so on a cold start — or for a place
    ranked outside the page window, or behind a page the server refused —
    `inbox.conversations` can miss a place that holds a PENDING APPROVAL. The
    task segment must never depend on the message segment: the chips above
    would count it and jump to it while the column claimed it did not exist.
  */
  const known = new Set(listed.map(row => row.placeKey))
  const conversations: InboxConversationWire[] = [
    ...listed,
    ...inbox.places.filter(place => !known.has(place.placeKey)).map(place => ({
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
  const match = filter.trim().toLowerCase()
  const visible = match === ''
    ? conversations
    : conversations.filter(row => row.name.toLowerCase().includes(match))
  /** On duty first (they carry work), then most recent — 在岗场所行之下补轻量会话行. */
  const ofKind = (kind: InboxConversationWire['kind']): InboxConversationWire[] => (
    visible.filter(row => row.kind === kind)
      .sort((left, right) => (
        Number(right.onDuty) - Number(left.onDuty) || right.lastMsgTime - left.lastMsgTime
      ))
  )
  const assistants = ofKind('assistant')
  // Robots and the operator's own approval channel are not somebody asking
  // for them, so neither lands in the one number that says somebody is.
  const unreadTotal = stealth ? 0 : conversations
    .filter(row => row.kind !== 'assistant' && !row.selfChat)
    .reduce((sum, row) => sum + row.unread, 0)

  const kindBlock = (kind: 'group' | 'direct', label: string): ReactNode => {
    const rows = ofKind(kind)
    if (rows.length === 0) return null
    return (
      <div className={css.place}>
        {/* A pure grouping: typography, not a node — so the whole label IS
            the collapse control (纯容器即折叠). */}
        <button
          type="button"
          className={css.groupLabel}
          title="折叠/展开"
          onClick={() => { toggle(`kind:${kind}`) }}
        >
          {chevMark(`kind:${kind}`, true)}{label}
          <span className={css.labelCount}>{rows.length}</span>
          <span className={css.gline} />
        </button>
        {!shut(`kind:${kind}`) && rows.map(conversationRow)}
      </div>
    )
  }

  // A session no directory accounts for still has to be reachable: losing the
  // folder must not lose the conversation.
  const accounted = new Set(workspaces.items.flatMap(workspace => workspace.sessionIds))
  const orphans = locals.filter(entry => !accounted.has(entry.id))

  // 冷启动的出生故事: the roster is built BY the poll, so an instance that has
  // only just started genuinely has nothing here yet — and a column that says
  // nothing about why looks broken rather than young.
  const nothing = conversations.length === 0

  /*
    **窄到画不下一行的时候，收成一条轨，而不是把字挤成一列。**

    宿主在窄宽度下会把左区收到 ~35px（根节点带上它自己的 collapsed 类），而这一列此前
    照旧渲染整份收件箱：于是「承诺板 · 跨执行者」被挤成一列一个字、「收件箱」截成
    「收件」、会话列表被撑到 3908px 高——每一行的每个字各占一行。那不是收起，是压扁。

    判据用**自己的宽度**，不去认宿主那个哈希类名：类名是别人的实现细节，改一次名这条
    路就断了，而且断得无声。ResizeObserver 读自己的盒子，是这个仓库里已有的做法
    （决断条同款）。

    轨上留什么：**只留不需要一行字就能读的东西**——三个计数、一个板入口。会话列表在
    35px 里是读不了的，画出来只是噪音；人要看它，把窗口拉宽就是。
  */
  const [narrow, setNarrow] = useState(false)
  const measure = useCallback((node: HTMLElement | null) => {
    if (node === null) return
    const watch = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
        // 96px：一行「◫ 承诺板」加计数的最小可读宽度，再窄就必然折行。
        setNarrow(width > 0 && width < 96)
      }
    })
    watch.observe(node)
  }, [])

  if (narrow) {
    return (
      <nav
        ref={measure}
        className={`${tokens.tokens} ${css.sidebar} ${css.rail}`}
        aria-label="收件箱"
      >
        <button
          type="button"
          className={css.railNew}
          title="新建会话"
          aria-label="新建会话"
          onClick={() => { startSession() }}
        >
          ＋
        </button>
        {([
          ['confirm', '✋', '待确认', inbox.counts.confirm],
          ['review', '✓', '待验收', inbox.counts.review],
          ['running', '●', '运行中', inbox.counts.running],
        ] as const).map(([tone, mark, label, count]) => (
          <button
            key={tone}
            type="button"
            className={`${css.railChip} ${count === 0 ? css.chipZero : ''}`}
            disabled={count === 0}
            title={count === 0 ? `没有${label}的话题` : `${label} ${String(count)} —— 跳到第一个`}
            aria-label={`${label} ${String(count)}`}
            onClick={() => {
              const target = inbox.firstOf[tone]
              if (target !== undefined) go(target)
            }}
          >
            <span>{mark}</span>
            <span className={css.railCount}>{count}</span>
          </button>
        ))}
        <button
          type="button"
          className={`${css.railBoard} ${frame.kind === 'board' ? css.boardOn : ''}`}
          title="承诺板 · 跨执行者"
          aria-label="承诺板"
          onClick={() => { setFrame({ kind: frame.kind === 'board' ? 'session' : 'board' }) }}
        >
          ◫
        </button>
      </nav>
    )
  }

  return (
    <nav ref={measure} className={`${tokens.tokens} ${css.sidebar}`} aria-label="收件箱">
      {opening && (
        <YzjDirectoryPicker
          {...(workspaces.listDirectory === undefined
            ? {}
            : { listDirectory: workspaces.listDirectory })}
          {...(workspaces.pickDirectory === undefined
            ? {}
            : { pickDirectory: workspaces.pickDirectory })}
          choose={adopt}
          close={() => { setOpening(false) }}
        />
      )}
      <div className={css.head}>
        <h2 className={css.title}>收件箱</h2>
        {/* 「见过的」, not 「全部的」: the roster holds what the poll has seen,
            which grows as conversations become active. Claiming completeness
            would make an absent conversation look like a bug rather than like
            a conversation nobody has touched. */}
        <span className={css.sub}>需要我的在上，见过的会话在下</span>
        <button
          type="button"
          className={css.new}
          title="新建会话"
          onClick={() => { startSession() }}
        >
          ＋
        </button>
      </div>

      <div className={css.chips}>
        {chip('confirm', '✋', '待确认', inbox.counts.confirm)}
        {chip('review', '✓', '待验收', inbox.counts.review)}
        {chip('running', '●', '运行中', inbox.counts.running)}
      </div>

      <button
        type="button"
        className={`${css.board} ${frame.kind === 'board' ? css.boardOn : ''}`}
        title="部门的全部承诺，人和 agent 一屏"
        onClick={() => { setFrame({ kind: frame.kind === 'board' ? 'session' : 'board' }) }}
      >
        <span>◫ 承诺板 · 跨执行者</span>
        {/*
          「该评估了」优先于「在跟」，因为它是一个**时刻**而不是一个存量：
          子承诺全部终态的那一刻是写差距简报的时候，错过它，目标就要靠人
          记得去看——那正是零维护要消掉的东西。逾期仍然压过它，逾期是更响的事。
        */}
        {inbox.commitments.overdue === 0 && (inbox.commitments.toAssess ?? 0) > 0
          ? (
            <span className={css.boardAssess} title="这些目标下面的活都到终态了，可以写差距简报、准备验收">
              {String(inbox.commitments.toAssess)} 该评估
            </span>
          )
          : (
            <span className={inbox.commitments.overdue > 0 ? css.boardOverdue : css.boardCount}>
              {inbox.commitments.overdue > 0
                ? `${String(inbox.commitments.overdue)} 逾期`
                : `${String(inbox.commitments.open)} 在跟`}
            </span>
          )}
      </button>

      <div className={css.tree}>
        {/*
          规则递归: the position mark climbs with the fold. Collapsing a group
          hides the row you are on, so the place row carries the hairline;
          collapsing the whole section hides the place row too, so the section
          head carries it. 位置不丢 has to hold at every level, or it holds at
          none.
        */}
        {section('sec:yzj', '云之家', unreadTotal > 0 ? `${String(unreadTotal)} 条未读` : '群 · 私聊',
          shut('sec:yzj') && currentSessionId !== undefined
          && inbox.topicSessionIds.includes(currentSessionId))}

        {/*
          本地名称过滤 —— the only search this platform has.

          Yunzhijia exposes no group-search API at any level, so finding a
          conversation by name has to happen over what we have already seen.
          That is exactly what the roster is for, and it is why the roster is
          persisted rather than re-fetched.
        */}
        {!shut('sec:yzj') && conversations.length > 12 && (
          <input
            className={css.filter}
            value={filter}
            placeholder="按名字找会话…"
            spellCheck={false}
            onChange={(event) => { setFilter(event.target.value) }}
          />
        )}

        {!shut('sec:yzj') && nothing && (
          <div className={css.calm}>
            还没有读到任何云之家会话。
            <br />
            通道每轮拉取会话列表时会把见到的记下来，<b>攒着的这份就是名录</b>——
            所以刚启动时这里是空的，几轮之后会长出来。
            <br />
            在测试群 <code>{inbox.aliases?.[0] ?? '@agent'}</code> 说句话，那个群还会升级成场所行。
          </div>
        )}

        {!shut('sec:yzj') && kindBlock('group', '群')}
        {!shut('sec:yzj') && kindBlock('direct', '私聊')}
        {/*
          助手号与系统号 (groupType 3/8): 63 of them on this account. They are
          feeds, not conversations — triage refuses those types outright — so
          they get their own fold, start closed, and stay out of the unread
          total. Otherwise the one number meant to say "somebody wants you"
          would be dominated by robots.
        */}
        {!shut('sec:yzj') && assistants.length > 0 && (
          <div className={css.place}>
            <button
              type="button"
              className={css.groupLabel}
              title="折叠/展开"
              onClick={() => { toggle('assistants') }}
            >
              {chevMark('assistants', true, true)}助手与通知
              <span className={css.labelCount}>{assistants.length}</span>
              <span className={css.gline} />
            </button>
            {!shutBy('assistants', true) && assistants.map(conversationRow)}
          </div>
        )}

        {section('sec:local', '本地', '工作文件夹',
          shut('sec:local') && locals.some(entry => entry.id === currentSessionId))}

        {/*
          本地 = 工作夹场所. A working folder is a place with no IM channel — its
          contract, tools and memory follow the folder, which is dsh's own
          structure (workspace > sessions) projected straight through. It has no
          主楼 to walk into, so the row's own job IS collapsing.
        */}
        {!shut('sec:local') && workspaces.items.map((workspace) => {
          const own = locals.filter(entry => workspace.sessionIds.includes(entry.id))
          const closed = shut(workspace.id)
          const holds = closed && own.some(entry => entry.id === currentSessionId)
          return (
            <div className={css.place} key={workspace.id}>
              <button
                type="button"
                className={`${css.row} ${css.placeRow} ${css.folderRow} ${holds ? css.holds : ''}`}
                title={`工作文件夹（本地场所，无主楼）· 点击折叠/展开\n${workspace.path}`}
                onClick={() => { toggle(workspace.id) }}
              >
                {chevMark(workspace.id)}
                <span className={css.icon} style={{ background: '#46536B' }}>⌂</span>
                <span className={css.itemText}>
                  <span className={`${css.itemTitle} ${css.placeTitle}`}>{workspace.title}</span>
                  <span className={css.itemPreview}>{workspace.path} · {own.length} 个会话</span>
                </span>
              </button>
              {!closed
                && own.flatMap(entry => [sessionRow(entry, '本地会话'), archiveAsk(entry.id)])}
              {!closed && (
                <button
                  type="button"
                  className={css.archived}
                  onClick={() => {
                    setFrame({ kind: 'session' })
                    startSession(workspace.id)
                  }}
                >
                  ＋ 在这个文件夹里开一个会话
                </button>
              )}
            </div>
          )
        })}

        {!shut('sec:local') && orphans.length > 0 && (
          <div className={css.place}>
            <button
              type="button"
              className={css.groupLabel}
              title="折叠/展开"
              onClick={() => { toggle('orphans') }}
            >
              {chevMark('orphans', true)}无文件夹<span className={css.gline} />
            </button>
            {!shut('orphans')
              && orphans.flatMap(entry => [sessionRow(entry, '目录已不在'), archiveAsk(entry.id)])}
          </div>
        )}

        {!shut('sec:local') && rowError !== '' && <div className={css.rowError}>{rowError}</div>}

        {!shut('sec:local') && (
          <>
            <button
              type="button"
              className={css.addDir}
              disabled={workspaces.create === undefined || picking}
              title="打开一个本地工作目录 —— 本地会话要在某个文件夹里跑"
              onClick={openDirectory}
            >
              {picking ? '⌛ 系统对话框已弹出…' : '＋ 打开本地文件夹'}
            </button>
            {picking && (
              <div className={css.pickNote}>
                文件夹对话框开在跑 dsh 的那台机器上，不在这个浏览器里。
              </div>
            )}
            {pickError !== '' && (
              <div className={css.pickError}>
                {pickError}
                <button type="button" className={css.pickRetry} onClick={openDirectory}>重新选择</button>
                {workspaces.pickDirectory !== undefined && (
                  <button
                    type="button"
                    className={css.pickRetry}
                    onClick={() => { setPickError(''); setOpening(true) }}
                  >
                    手填路径
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </nav>
  )
}
