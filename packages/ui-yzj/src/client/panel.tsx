/**
 * The Yunzhijia workspace panel: a frame overlay with four tabs — 知识库
 * (workspace → doc tree), 日程 (today), 会话 (recent groups → messages with
 * paging), and 我的 (whoami + directory search). Rendering stays
 * presentational: data arrives through the injected fetch face and the shared
 * store; verbs are the injected face and store actions.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  IconChecklistOutline14,
  IconFolderOpenOutline16,
  IconNewChatOutline16,
  IconUserOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BakedActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { YzjPanelActions, YzjPanelState, YzjTab } from './stores.ts'
import type { YzjPanelInject } from './rpc.ts'
import css from './panel.module.css'

/** The props shares the panel reads. */
export interface YzjPanelProps extends YzjPanelInject {
  useStore: <R>(selector: (state: YzjPanelState) => R) => R
  actions: BakedActions<YzjPanelState, YzjPanelActions>
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** One draggable reference payload shared by drag sources and the drop dock. */
export interface YzjDragRef {
  kind: 'workspace' | 'doc' | 'group' | 'event' | 'contact' | 'message'
  id: string
  title: string
  url?: string
  sub?: string
  /** Owning session id for message refs (required for re-fetching the body). */
  group?: string
}

/** MIME type carrying the structured drag payload. */
export const YZJ_DRAG_MIME = 'application/x-dsh-yzj-ref'

/** Human-readable citation text for a drag ref (what lands in the draft). */
export function yzjRefText(ref: YzjDragRef): string {
  const kindLabel: Record<YzjDragRef['kind'], string> = {
    workspace: '知识库', doc: '文档', group: '会话', event: '日程', contact: '联系人', message: '消息',
  }
  const head = `【云之家·${kindLabel[ref.kind]}】${ref.title}`
  const sub = ref.sub === undefined || ref.sub === '' ? '' : `（${ref.sub}）`
  const url = ref.url === undefined || ref.url === '' ? '' : `\n${ref.url}`
  return `${head}${sub}${url}`
}

/** Wire one draggable item's data transfer. */
function startDragTransfer(event: React.DragEvent, ref: YzjDragRef): void {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(YZJ_DRAG_MIME, JSON.stringify(ref))
  event.dataTransfer.setData('text/plain', yzjRefText(ref))
}

/** Outline cloud mark for the Yunzhijia brand, DSH icon-line style. */
export function YzjCloudIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.5 18.5h9a4.25 4.25 0 0 0 .65-8.45A6 6 0 0 0 5.6 11.3a3.9 3.9 0 0 0 1.9 7.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 14.6l2.4 2.3 3.4-3.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const TABS: { key: YzjTab; label: string; icon: () => ReactNode }[] = [
  { key: 'docs', label: '知识库', icon: () => <IconFolderOpenOutline16 /> },
  { key: 'calendar', label: '日程', icon: () => <IconChecklistOutline14 /> },
  { key: 'chat', label: '会话', icon: () => <IconNewChatOutline16 /> },
  { key: 'me', label: '我的', icon: () => <IconUserOutline16 /> },
]

/** The sidebar-foot toggle; label and open state ride the store shares. */
export interface YzjPanelButtonProps {
  useStore: <R>(selector: (state: YzjPanelState) => R) => R
  actions: BakedActions<YzjPanelState, YzjPanelActions>
  /** Sidebar column state: wide renders the labeled row, rail the icon. */
  wide: boolean
  /** Fresh recent-session window for the unread badge poll. */
  fetchGroups: (limit?: number, page?: number) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>
}

/** Sum the unread counts of a recent-session window. */
function unreadTotalOf(value: unknown): number {
  const list = asArray(asRecord(value).list)
  return list.reduce<number>((sum, item) => {
    const count = asRecord(item).unreadCount
    return sum + (typeof count === 'number' && count > 0 ? count : 0)
  }, 0)
}

/**
 * Fire one browser system notification for new unread messages (design v1.6
 * §5.3 layer 3). dsh ships no Notification wrapper — this plugin owns it.
 */
function notifyUnread(total: number, focusPanel: () => void): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const notice = new Notification('云之家', { body: `${total} 条未读消息` })
    notice.onclick = () => {
      window.focus()
      focusPanel()
    }
  } catch {
    // Some environments (sandboxed iframes) throw on construction.
  }
}

/** Ask for notification permission on first toggle (design §5.3 layer 3). */
function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default' && typeof Notification.requestPermission === 'function') {
    void Notification.requestPermission()
  }
}

/** The sidebar-foot Yunzhijia toggle (labeled row or rail icon). */
export function YzjPanelButton(props: YzjPanelButtonProps) {  const open = props.useStore(state => state.open)
  const unreadTotal = props.useStore(state => state.unreadTotal)
  // Poll cadence follows the design: ~30s while the panel is open, ~5min
  // while collapsed. New unread counts raise the badge and fire a browser
  // notification once per increase.
  useEffect(() => {
    let last = unreadTotal
    const poll = (): void => {
      void props.fetchGroups(20).then((result) => {
        if (!result.ok) return
        const total = unreadTotalOf(result.value)
        props.actions.setUnreadTotal(total)
        if (total > last && total > 0) notifyUnread(total, () => props.actions.setOpen(true))
        last = total
      })
    }
    poll()
    const interval = window.setInterval(poll, open ? 30_000 : 300_000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const button = (
    <button
      type="button"
      className={open ? `${css.toggle} ${css.toggleActive}` : css.toggle}
      aria-expanded={open}
      onClick={() => {
        requestNotificationPermission()
        props.actions.setOpen(!open)
      }}
      aria-label="云之家"
    >
      <YzjCloudIcon size={props.wide ? 16 : 18} />
      {props.wide && <span className={css.toggleLabel}>云之家</span>}
      {unreadTotal > 0 && (
        <span className={css.unreadBadge} title={`${unreadTotal} 条未读`}>
          {unreadTotal > 99 ? '99+' : unreadTotal}
        </span>
      )}
    </button>
  )
  if (props.wide) return button
  return (
    <Tooltip label="云之家" delayMs={500} side="right">
      {button}
    </Tooltip>
  )
}

/** The floating ball (prototype): bottom-right round button with the unread
 *  badge; hidden while the panel is open. Registered in shell.overlay. */
export interface YzjFloatBallProps {
  useStore: <R>(selector: (state: YzjPanelState) => R) => R
  actions: BakedActions<YzjPanelState, YzjPanelActions>
}

export function YzjFloatBall(props: YzjFloatBallProps) {
  const open = props.useStore(state => state.open)
  const unreadTotal = props.useStore(state => state.unreadTotal)
  if (open) return null
  return (
    <button
      type="button"
      className={css.floatBall}
      aria-label="云之家悬浮窗"
      title="云之家"
      onClick={() => { props.actions.setOpen(true) }}
    >
      <YzjCloudIcon size={22} />
      {unreadTotal > 0 && (
        <span className={css.floatBallBadge} title={`${unreadTotal} 条未读`}>
          {unreadTotal > 99 ? '99+' : unreadTotal}
        </span>
      )}
    </button>
  )
}

/** Load one tab's data into the store through the fetch face. */
function loadTab(
  tab: YzjTab,
  props: YzjPanelProps,
): void {
  const fail = (error: unknown): void => {
    props.actions.setError(typeof error === 'string' ? error : '加载失败')
    props.actions.setLoading(false)
  }
  props.actions.setLoading(true)
  props.actions.setError('')
  if (tab === 'docs') {
    void props.fetchWorkspaces().then((result) => {
      if (result.ok) {
        props.actions.setWorkspaces(asArray(result.value))
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  } else if (tab === 'calendar') {
    const today = new Date().toISOString().slice(0, 10)
    void props.fetchEvents(today, today).then((result) => {
      if (result.ok) {
        props.actions.setEvents(asArray(result.value))
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  } else if (tab === 'chat') {
    // CLI caps --limit at 20; the node half clamps, so ask for the max.
    void props.fetchGroups(20, 1).then((result) => {
      if (result.ok) {
        props.actions.setGroups(asArray(asRecord(result.value).list))
        props.actions.setGroupsPage(1)
        props.actions.setGroupsMore(asRecord(result.value).more === true)
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  } else {
    void props.fetchWhoami().then((result) => {
      if (result.ok) {
        const users = asArray(result.value)
        props.actions.setMe(users[0] ?? {})
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  }
}

/** The frame-overlay Yunzhijia panel; renders null while closed. */
export function YzjPanel(props: YzjPanelProps) {
  const open = props.useStore(state => state.open)
  const tab = props.useStore(state => state.tab)
  const [keyword, setKeyword] = useState('')
  const state = props.useStore(s => s)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [anchorToast, setAnchorToast] = useState('')

  // Scroll the jump anchor into view once its group's messages land.
  useEffect(() => {
    if (state.anchorMsgId === '' || anchorRef.current === null) return
    anchorRef.current.scrollIntoView({ block: 'center' })
    setAnchorToast(`已定位到锚点消息（${state.anchorMsgId.slice(0, 12)}…）`)
    const timer = window.setTimeout(() => setAnchorToast(''), 3200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.messages, state.anchorMsgId])

  useEffect(() => {
    if (!open) return
    const move = (event: PointerEvent): void => {
      if (dragOffset.current === null) return
      const x = Math.max(8, Math.min(event.clientX - dragOffset.current.dx, window.innerWidth - 220))
      const y = Math.max(8, Math.min(event.clientY - dragOffset.current.dy, window.innerHeight - 60))
      props.actions.setPanelPosition(x, y)
    }
    const up = (): void => { dragOffset.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    loadTab(tab, props)
    // tab switches and opens are the load triggers; state reads inside the
    // loader come from the snapshot taken at effect time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  if (!open) return null

  const startDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    dragOffset.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    event.preventDefault()
  }

  const dockStyle = state.panelX >= 0 && state.panelY >= 0
    ? { left: state.panelX, top: state.panelY, margin: 0 }
    : undefined

  const openWorkspace = (id: string): void => {
    props.actions.setWorkspaceId(id)
    props.actions.setLoading(true)
    props.actions.setError('')
    void props.fetchDocs(id).then((result) => {
      if (result.ok) {
        props.actions.setDocs(asArray(result.value))
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  const openGroup = (id: string): void => {
    props.actions.setGroupId(id)
    props.actions.setLoading(true)
    props.actions.setError('')
    void props.fetchMessages(id, 20).then((result) => {
      if (result.ok) {
        // Store oldest-first so the chat reads top-down; the CLI returns
        // newest-first.
        const messages = asArray(asRecord(result.value).list)
        props.actions.setMessages([...messages].reverse())
        props.actions.setMessagesMore(asRecord(result.value).more === true)
        props.actions.setMessagesAnchor(messages.length > 0 ? asString(asRecord(messages[messages.length - 1]).msgId) : '')
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  const loadMoreGroups = (): void => {
    if (state.loading) return
    props.actions.setLoading(true)
    void props.fetchGroups(20, state.groupsPage + 1).then((result) => {
      if (result.ok) {
        props.actions.appendGroups(asArray(asRecord(result.value).list))
        props.actions.setGroupsPage(state.groupsPage + 1)
        props.actions.setGroupsMore(asRecord(result.value).more === true)
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  const loadOlderMessages = (): void => {
    if (state.loading || state.messagesAnchor === '') return
    props.actions.setLoading(true)
    void props.fetchMessages(state.groupId, 20, { type: 'old', msgId: state.messagesAnchor }).then((result) => {
      if (result.ok) {
        const older = asArray(asRecord(result.value).list)
        // The CLI returns newest-first; prepend after reversing to keep the
        // store oldest-first.
        props.actions.prependMessages([...older].reverse())
        props.actions.setMessagesMore(asRecord(result.value).more === true)
        if (older.length > 0) {
          props.actions.setMessagesAnchor(asString(asRecord(older[older.length - 1]).msgId))
        }
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  const runSearch = (): void => {
    if (keyword.trim() === '') return
    props.actions.setLoading(true)
    void props.fetchSearch(keyword.trim()).then((result) => {
      if (result.ok) {
        props.actions.setSearchResults(asArray(result.value))
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  return (
    <div ref={panelRef} className={css.panel} role="dialog" aria-label="云之家" style={dockStyle}>
      <header className={css.header} onPointerDown={startDrag}>
        <span className={css.brand}><YzjCloudIcon size={18} /></span>
        <span className={css.title}>云之家</span>
        <span className={css.headerSpacer} />
        <button
          type="button"
          className={css.iconButton}
          onClick={() => { loadTab(tab, props) }}
          disabled={state.loading}
          aria-label="刷新"
          title="刷新"
          onPointerDown={(event) => { event.stopPropagation() }}
        >
          <IconRefresh14 />
        </button>
        <button
          type="button"
          className={css.iconButton}
          onClick={() => { props.actions.setOpen(false) }}
          aria-label="关闭"
          title="关闭"
          onPointerDown={(event) => { event.stopPropagation() }}
        >
          <IconClose14 />
        </button>
      </header>
      <nav className={css.tabs} aria-label="云之家功能" onPointerDown={(event) => { event.stopPropagation() }}>
        {TABS.map(item => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? `${css.tab} ${css.tabActive}` : css.tab}
            aria-current={tab === item.key ? 'page' : undefined}
            onClick={() => { props.actions.setTab(item.key) }}
          >
            {item.icon()}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {state.error !== '' && (
        <div className={css.error} role="alert">
          <span className={css.errorText}>{state.error}</span>
          <button
            type="button"
            className={css.errorDismiss}
            onClick={() => { props.actions.setError('') }}
            aria-label="忽略错误"
          >
            <IconClose14 />
          </button>
        </div>
      )}
      {state.loading && <div className={css.loading}>加载中…</div>}

      {tab === 'docs' && (
        <div className={css.body}>
          {state.workspaceId === '' ? (
            <div className={css.list}>
              {state.workspaces.length === 0 && !state.loading && state.error === '' && (
                <div className={css.empty}><YzjCloudIcon size={28} /><span>暂无知识库</span></div>
              )}
              {state.workspaces.map((item, index) => {
                const ws = asRecord(item)
                const count = typeof ws.docCount === 'number' ? ws.docCount : 0
                const members = typeof ws.memberCount === 'number' ? ws.memberCount : 0
                const id = asString(ws.id)
                const name = asString(ws.name)
                return (
                  <button
                    key={`w${index}`}
                    type="button"
                    className={css.item}
                    onClick={() => { openWorkspace(id) }}
                    draggable
                    onDragStart={(event) => {
                      startDragTransfer(event, { kind: 'workspace', id, title: name, sub: `文档 ${count} · 成员 ${members}` })
                    }}
                  >
                    <span className={css.itemTitle}>
                      <IconFolderOpenOutline16 />
                      <span className={css.itemTitleText}>{name}</span>
                    </span>
                    <span className={css.itemSub}>文档 {count} · 成员 {members}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className={css.list}>
              <button type="button" className={css.back} onClick={() => { props.actions.setWorkspaceId('') }}>
                <IconChevronLeft14 /> 返回知识库
              </button>
              {state.docs.length === 0 && !state.loading && state.error === '' && <div className={css.empty}>暂无文档</div>}
              {state.docs.map((item, index) => {
                const node = asRecord(item)
                const suffix = asString(node.fileSuffix)
                const title = asString(node.title)
                const id = asString(node.id)
                const url = asString(node.openWebUrl)
                return (
                  <button
                    key={`d${index}`}
                    type="button"
                    className={css.item}
                    onClick={() => { window.open(url, '_blank', 'noreferrer') }}
                    draggable
                    onDragStart={(event) => {
                      startDragTransfer(event, {
                        kind: 'doc', id, title, url,
                        sub: `${suffix === 'dbt' ? '多维表格' : '在线文档'} · ${asString(node.updateTime).slice(0, 10)}`,
                      })
                    }}
                  >
                    <span className={css.itemTitle}>
                      <span className={css.docGlyph}>{suffix === 'dbt' ? '表' : '文'}</span>
                      <span className={css.itemTitleText}>{title}</span>
                    </span>
                    <span className={css.itemSub}>{suffix === 'dbt' ? '多维表格' : '在线文档'} · {asString(node.updateTime).slice(0, 10)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'calendar' && (
        <div className={css.body}>
          <div className={css.list}>
            {state.events.length === 0 && !state.loading && state.error === '' && (
              <div className={css.empty}><IconChecklistOutline14 /><span>今日暂无日程</span></div>
            )}
            {state.events.map((item, index) => {
              const event = asRecord(item)
              const clock = (ms: unknown): string => {
                if (typeof ms !== 'number') return ''
                const date = new Date(ms)
                const pad = (n: number): string => String(n).padStart(2, '0')
                return `${pad(date.getHours())}:${pad(date.getMinutes())}`
              }
              const start = clock(event.startDate)
              const end = clock(event.endDate)
              const timeText = start === '' ? '' : `${start}${end === '' ? '' : ` → ${end}`}`
              const title = asString(event.title)
              const person = asString(event.personName)
              return (
                <div
                  key={`e${index}`}
                  className={css.item}
                  draggable
                  onDragStart={(event) => {
                    startDragTransfer(event, {
                      kind: 'event', id: asString(asRecord(item).id), title,
                      sub: [timeText, person].filter(part => part !== '').join(' · '),
                    })
                  }}
                >
                  <span className={css.itemTitle}><span className={css.itemTitleText}>{title}</span></span>
                  <span className={css.itemSub}>
                    {timeText}
                    {person === '' ? '' : ` · ${person}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <div className={css.body}>
          {state.groupId === '' ? (
            <div className={css.list}>
              {state.groups.length === 0 && !state.loading && state.error === '' && (
                <div className={css.empty}><IconNewChatOutline16 /><span>暂无最近会话</span></div>
              )}
              {state.groups.map((item, index) => {
                const group = asRecord(item)
                const unread = typeof group.unreadCount === 'number' ? group.unreadCount : 0
                const last = asString(asRecord(group.lastMsg).content)
                const name = asString(group.groupName)
                return (
                  <button
                    key={`g${index}`}
                    type="button"
                    className={css.item}
                    onClick={() => { openGroup(asString(group.groupId)) }}
                    draggable
                    onDragStart={(event) => {
                      startDragTransfer(event, {
                        kind: 'group', id: asString(group.groupId), title: name,
                        sub: last.replace(/\s+/g, ' ').slice(0, 40),
                      })
                    }}
                  >
                    <span className={css.itemTitle}>
                      <span className={css.groupGlyph}>{name.slice(0, 1)}</span>
                      <span className={css.itemTitleText}>{name}</span>
                      {unread > 0 && <span className={css.badge}>{unread > 99 ? '99+' : unread}</span>}
                    </span>
                    <span className={css.itemSub}>{last.replace(/\s+/g, ' ').slice(0, 40)}</span>
                  </button>
                )
              })}
              {state.groupsMore && (
                <button type="button" className={css.more} onClick={loadMoreGroups} disabled={state.loading}>
                  {state.loading ? '加载中…' : '加载更多会话'}
                </button>
              )}
            </div>
          ) : (
            <div className={css.list}>
              <button type="button" className={css.back} onClick={() => { props.actions.setGroupId('') }}>
                <IconChevronLeft14 /> 返回会话
              </button>
              {state.messages.length === 0 && !state.loading && state.error === '' && <div className={css.empty}>暂无消息</div>}
              {state.messagesMore && (
                <button type="button" className={css.more} onClick={loadOlderMessages} disabled={state.loading}>
                  {state.loading ? '加载中…' : '加载更早消息'}
                </button>
              )}
              {state.messages.map((item, index) => {
                const message = asRecord(item)
                const content = asString(message.content)
                const msgType = asString(message.msgType)
                const sendTime = asString(message.sendTime)
                const msgId = asString(message.msgId)
                const anchored = msgId !== '' && msgId === state.anchorMsgId
                return (
                  <div
                    key={`m${index}`}
                    ref={anchored ? anchorRef : undefined}
                    className={anchored ? `${css.item} ${css.msgItem} ${css.itemAnchored}` : `${css.item} ${css.msgItem}`}
                    draggable
                    onDragStart={(event) => {
                      startDragTransfer(event, {
                        kind: 'message', id: msgId,
                        title: content === '' ? `(${msgType === '' ? '消息' : msgType})` : content,
                        sub: sendTime.slice(5, 16),
                        group: state.groupId,
                      })
                    }}
                  >
                    <span className={css.grip} aria-hidden="true">
                      <svg viewBox="0 0 10 16" fill="currentColor" width="10" height="16">
                        <circle cx="3" cy="3" r="1.4" /><circle cx="7" cy="3" r="1.4" />
                        <circle cx="3" cy="8" r="1.4" /><circle cx="7" cy="8" r="1.4" />
                        <circle cx="3" cy="13" r="1.4" /><circle cx="7" cy="13" r="1.4" />
                      </svg>
                    </span>
                    <span className={css.msgMeta}>
                      <span className={css.msgTime}>{sendTime.slice(5, 16)}</span>
                      <span className={css.msgKind}>{msgType === '' ? '消息' : msgType}</span>
                    </span>
                    <span className={css.msgBody}>{content === '' ? `(${msgType === '' ? '消息' : msgType})` : content}</span>
                  </div>
                )
              })}
              {anchorToast !== '' && (
                <div className={css.panelToast} role="status">{anchorToast}</div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'me' && (
        <div className={css.body}>
          <div className={css.searchRow}>
            <input
              className={css.searchInput}
              value={keyword}
              onChange={(event) => { setKeyword(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }}
              placeholder="搜索同事…"
            />
            <button type="button" className={css.headerButton} onClick={runSearch}>搜索</button>
          </div>
          {(() => {
            const me = asRecord(state.me)
            if (Object.keys(me).length === 0) return null
            const photo = asString(me.photoUrl)
            return (
              <div className={css.meCard}>
                {photo !== ''
                  ? <img className={css.meAvatar} src={photo} alt="" />
                  : <span className={css.meAvatarFallback}>{asString(me.name).slice(0, 1)}</span>}
                <div className={css.meInfo}>
                  <div className={css.meName}>{asString(me.name)}</div>
                  <div className={css.meSub}>
                    {[asString(me.department), asString(me.jobTitle), asString(me.jobNo) === '' ? '' : `工号 ${asString(me.jobNo)}`].filter(part => part !== '').join(' · ')}
                  </div>
                </div>
              </div>
            )
          })()}
          <div className={css.list}>
            {state.searchResults.map((item, index) => {
              const user = asRecord(item)
              const openId = asString(user.oId ?? user.openId)
              const name = asString(user.name)
              return (
                <div
                  key={`s${index}`}
                  className={css.item}
                  draggable
                  onDragStart={(event) => {
                    startDragTransfer(event, {
                      kind: 'contact', id: openId, title: name,
                      sub: [asString(user.department), asString(user.jobTitle)].filter(part => part !== '').join(' · '),
                    })
                  }}
                >
                  <span className={css.itemTitle}>
                    <span className={css.userGlyph}>{name.slice(0, 1)}</span>
                    <span className={css.itemTitleText}>{name}</span>
                  </span>
                  <span className={css.itemSub}>{[asString(user.department), asString(user.jobTitle)].filter(part => part !== '').join(' · ')}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function IconRefresh14() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 3v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconClose14() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconChevronLeft14() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
