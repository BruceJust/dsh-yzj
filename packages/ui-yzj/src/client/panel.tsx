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
import {
  ensureMyProfile, formatListTime, formatMsgTime, formatSize, getGroupWindow,
  getMessageWindow, putGroupWindow, putMessageWindow, resolveFileData, resolveSenders,
  senderNameOf, senderPhotoOf,
} from './im-cache.ts'
import { emitYzjDropRequest } from './drop-bus.ts'
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

/** Human-readable label for a raw msgType. */
function typeLabelOf(msgType: string): string {
  if (msgType === 'richText') return '图文'
  if (msgType === 'file') return '文件'
  if (msgType === 'other') return '系统'
  return '消息'
}

/** One-line preview of a message for the group list / drag payload. */
function messagePreview(message: Record<string, unknown>): string {
  const content = asString(message.content)
  const msgType = asString(message.msgType)
  const param = asRecord(message.param)
  if (msgType === 'file') {
    const name = asString(param.name)
    return name === '' ? '[文件]' : `[文件] ${name}`
  }
  if (msgType === 'other' && asString(param.title) !== '') {
    return `[链接] ${asString(param.title)}`
  }
  if (msgType === 'richText') {
    const plain = content.replace(/\[图片\]/g, '[图片]').trim()
    return plain === '' ? '[图文]' : plain
  }
  return content.replace(/\s+/g, ' ').slice(0, 60)
}

/** Drag-chip title for a message (file names and media get real labels). */
function dragTitleOf(message: Record<string, unknown>): string {
  const msgType = asString(message.msgType)
  const param = asRecord(message.param)
  if (msgType === 'file') {
    const name = asString(param.name)
    return name === '' ? '文件消息' : name
  }
  if (msgType === 'richText') return '图文消息'
  const content = asString(message.content)
  return content === '' ? '(消息)' : content
}

/** Group avatar: headerUrl image with first-letter fallback. */
function GroupAvatar({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (url === '' || failed) return <span className={css.groupGlyph}>{name.slice(0, 1)}</span>
  return (
    <img
      className={css.avatar}
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/** Chat header inside a group: the group's avatar + name. */
function GroupHead({ groups, groupId }: { groups: unknown[]; groupId: string }) {
  const group = groups.map(asRecord).find(item => asString(item.groupId) === groupId)
  const name = group === undefined ? '群聊' : asString(group.groupName)
  const avatar = group === undefined ? '' : asString(group.headerUrl)
  return (
    <div className={css.groupHead}>
      <GroupAvatar url={avatar} name={name} />
      <span className={css.groupHeadName}>{name}</span>
    </div>
  )
}

/** Sender avatar in a message row: photo with a glyph fallback. */
function SenderAvatar({ openId, fallback }: { openId: string; fallback: string }) {
  const [failed, setFailed] = useState(false)
  const photo = senderPhotoOf(openId)
  if (photo === '' || failed) return <span className={css.msgAvatarFallback}>{fallback.slice(0, 1)}</span>
  return (
    <img
      className={css.msgAvatar}
      src={photo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * One richText/image/file payload rendered through the file-data proxy
 * (docrest URLs require the authenticated CLI; the panel has no session
 * cookie). Shows a loading placeholder, then the image; failures degrade to
 * a small chip.
 */
function ProxyImage({ fileId, alt, onOpen, inject }: {
  fileId: string
  alt: string
  onOpen: (src: string) => void
  inject: Pick<YzjPanelInject, 'fetchFileData'>
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    void resolveFileData(fileId, inject).then(dataUrl => {
      if (!alive) return
      if (dataUrl === undefined) setFailed(true)
      else setSrc(dataUrl)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])
  if (failed) return <span className={css.msgImageFail}>图片加载失败</span>
  if (src === null) return <span className={css.msgImageSkeleton}>加载中…</span>
  return (
    <img
      className={css.msgImage}
      src={src}
      alt={alt}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(src)
      }}
    />
  )
}

/**
 * One message's body, rendered by msgType: text (with bold segments),
 * richText (inline proxy images + text), file (download chip), other (link
 * card or system line), withdraw (system line). Images open a lightbox.
 */
function MessageBody({ message, onOpenImage, inject }: {
  message: Record<string, unknown>
  onOpenImage: (src: string) => void
  inject: Pick<YzjPanelInject, 'fetchFileData'>
}) {
  const content = asString(message.content)
  const msgType = asString(message.msgType)
  const param = asRecord(message.param)

  // System rows (撤回 / 入群 / 其他) — centered, tertiary.
  if (msgType === 'other' && asString(param.title) === '') {
    return <span className={css.msgSystem}>{content === '' ? '(系统消息)' : content}</span>
  }
  if (asString(param.sysType) === 'withdrawMsg') {
    return <span className={css.msgSystem}>{content === '' ? '撤回了一条消息' : content}</span>
  }

  // Reply quote above the body.
  const replyMsgId = asString(param.replyMsgId)
  const replySummary = asString(param.replySummary)
  const replyPerson = asString(param.replyPersonName)

  // File chip: name + size, downloads through the proxy.
  if (msgType === 'file') {
    const fileId = asString(param.file_id)
    const name = asString(param.name) !== '' ? asString(param.name) : content.replace(/^\[文件\]:/, '')
    const size = formatSize(param.size)
    const ext = asString(param.ext).toLowerCase()
    const icon = /^(png|jpe?g|gif|webp|bmp)$/.test(ext) ? '🖼️'
      : /^(mp4|mov|avi|mkv|webm)$/.test(ext) ? '🎬'
        : /^pdf$/.test(ext) ? '📕'
          : /^(xls|xlsx|csv)$/.test(ext) ? '📊'
            : /^(doc|docx|txt|md)$/.test(ext) ? '📄'
              : /^(zip|rar|7z|tar|gz)$/.test(ext) ? '📦'
                : '📎'
    return (
      <span className={css.msgBody}>
        {replyMsgId !== '' && <span className={css.msgQuote} title={replySummary}>{`↳ ${replyPerson === '' ? '' : `${replyPerson}：`}${replySummary}`}</span>}
        <button
          type="button"
          className={css.msgFile}
          title={fileId === '' ? name : `下载 ${name}`}
          disabled={fileId === ''}
          onClick={(event) => {
            event.stopPropagation()
            if (fileId === '') return
            void resolveFileData(fileId, inject).then(dataUrl => {
              if (dataUrl === undefined) return
              const link = document.createElement('a')
              link.href = dataUrl
              link.download = name
              document.body.appendChild(link)
              link.click()
              link.remove()
            })
          }}
        >
          <span className={css.msgFileIcon}>{icon}</span>
          <span className={css.msgFileMeta}>
            <span className={css.msgFileName}>{name}</span>
            <span className={css.msgFileSize}>{size === '' ? ext === '' ? '文件' : ext.toUpperCase() : size}</span>
          </span>
        </button>
      </span>
    )
  }

  // Link card (interactive card / survey / light app).
  if (msgType === 'other') {
    const title = asString(param.title)
    const thumb = asString(param.thumbUrl)
    const url = asString(param.webpageUrl)
    return (
      <span className={css.msgBody}>
        <a
          className={css.linkCard}
          href={url === '' ? undefined : url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => { event.stopPropagation() }}
        >
          {thumb !== '' && (
            <img className={css.linkCardThumb} src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
          )}
          <span className={css.linkCardBody}>
            <span className={css.linkCardTitle}>{title}</span>
            <span className={css.linkCardDesc}>{content}</span>
            {url !== '' && <span className={css.linkCardAction}>查看详情 →</span>}
          </span>
        </a>
      </span>
    )
  }

  // richText: interleave text (with bold) and inline proxy images.
  if (msgType === 'richText') {
    const desc = asArray(param.desc)
    const images: { start: number; fileId: string }[] = []
    const bolds: { start: number; length: number }[] = []
    for (const raw of desc) {
      const seg = asRecord(raw)
      const segType = asString(seg.type)
      if (segType === 'image') {
        const fileId = asString(seg.data)
        if (fileId === '') continue
        images.push({ start: typeof seg.start === 'number' ? seg.start : -1, fileId })
      } else if (segType === 'bold' && typeof seg.start === 'number' && typeof seg.length === 'number') {
        bolds.push({ start: seg.start, length: seg.length })
      }
    }
    const sorted = [...images].sort((a, b) => a.start - b.start)
    const spans: { text: string; bold: boolean }[] = []
    const imgSpans: { fileId: string }[] = []
    let cursor = 0
    const inBold = (from: number, to: number): boolean =>
      bolds.some(range => from < range.start + range.length && to > range.start)
    for (const image of sorted) {
      const chunk = content.slice(cursor, image.start).replace(/\[图片\]/g, '')
      if (chunk !== '') spans.push({ text: chunk, bold: inBold(cursor, image.start) })
      imgSpans.push({ fileId: image.fileId })
      cursor = image.start + 4
    }
    const tail = content.slice(cursor).replace(/\[图片\]/g, '')
    if (tail !== '') spans.push({ text: tail, bold: inBold(cursor, content.length) })
    return (
      <span className={css.msgBody}>
        {replyMsgId !== '' && <span className={css.msgQuote} title={replySummary}>{`↳ ${replyPerson === '' ? '' : `${replyPerson}：`}${replySummary}`}</span>}
        {spans.map((span, index) => (
          <span key={`t${index}`} className={span.bold ? css.msgBold : undefined}>{span.text}</span>
        ))}
        {imgSpans.map((image, index) => (
          <ProxyImage
            key={`i${index}`}
            fileId={image.fileId}
            alt=""
            onOpen={onOpenImage}
            inject={inject}
          />
        ))}
      </span>
    )
  }

  // Plain text.
  return (
    <span className={css.msgBody}>
      {replyMsgId !== '' && <span className={css.msgQuote} title={replySummary}>{`↳ ${replyPerson === '' ? '' : `${replyPerson}：`}${replySummary}`}</span>}
      {content === '' ? `(${typeLabelOf(msgType)})` : content}
    </span>
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

/** Shortcut order for the floating ball's hover quick-dock. */
const DOCK_ITEMS: { key: YzjTab; label: string; icon: () => ReactNode }[] = [
  { key: 'chat', label: '会话', icon: () => <IconNewChatOutline16 /> },
  { key: 'calendar', label: '日程', icon: () => <IconChecklistOutline14 /> },
  { key: 'docs', label: '知识库', icon: () => <IconFolderOpenOutline16 /> },
  { key: 'me', label: '我的', icon: () => <IconUserOutline16 /> },
]

/** Common emojis for the composer picker (real-IM habit). */
const EMOJI_LIST = ['😀', '😄', '😂', '🤣', '😊', '😍', '🤔', '😎', '😭', '😅', '😉', '🙏', '👍', '👏', '💪', '🔥', '❤️', '🎉', '✅', '❌', '⚠️', '📌', '💡', '🚀']

/** The floating ball (prototype): bottom-right round button with the unread
 *  badge; hidden while the panel is open. Hovering expands a quick-dock with
 *  one shortcut per panel tab (会话 carries the unread count). Registered in
 *  shell.overlay. */
export interface YzjFloatBallProps {
  useStore: <R>(selector: (state: YzjPanelState) => R) => R
  actions: BakedActions<YzjPanelState, YzjPanelActions>
  /** Fresh recent-session window for the unread badge poll. */
  fetchGroups: (limit?: number, page?: number) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>
}

export function YzjFloatBall(props: YzjFloatBallProps) {
  const open = props.useStore(state => state.open)
  const unreadTotal = props.useStore(state => state.unreadTotal)
  const [hover, setHover] = useState(false)

  // The unread poll used to live on the sidebar button; the ball is now the
  // only entry, so it owns the poll. ~60s cadence; an increase raises the
  // badge and fires one browser notification (design §5.3 layer 3).
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
    const interval = window.setInterval(poll, 60_000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (open) return null
  const openTab = (tab: YzjTab): void => {
    props.actions.setTab(tab)
    props.actions.setOpen(true)
  }
  return (
    <div className={css.floatWrap} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div
        className={hover ? `${css.floatDock} ${css.floatDockOpen}` : css.floatDock}
        role="group"
        aria-label="云之家快捷入口"
      >
        {DOCK_ITEMS.map(item => (
          <button
            key={item.key}
            type="button"
            className={css.floatDockItem}
            title={`${item.label}${item.key === 'chat' && unreadTotal > 0 ? ` · ${unreadTotal} 条未读` : ''}`}
            aria-label={item.label}
            onClick={() => openTab(item.key)}
          >
            {item.icon()}
            <span className={css.floatDockLabel}>{item.label}</span>
            {item.key === 'chat' && unreadTotal > 0 && (
              <span className={css.floatDockBadge}>{unreadTotal > 99 ? '99+' : unreadTotal}</span>
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={css.floatBall}
        aria-label="云之家悬浮窗"
        title={unreadTotal > 0 ? `云之家 · ${unreadTotal} 条未读` : '云之家'}
        onClick={() => {
          requestNotificationPermission()
          props.actions.setOpen(true)
        }}
      >
        <YzjCloudIcon size={22} />
        {unreadTotal > 0 && (
          <span className={css.floatBallBadge} title={`${unreadTotal} 条未读`}>
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>
    </div>
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
    // Group list is cached ~30s so switching tabs is instant.
    const cached = getGroupWindow()
    if (cached !== undefined) {
      props.actions.setGroups(cached.groups)
      props.actions.setGroupsPage(1)
      props.actions.setGroupsMore(cached.more)
      props.actions.setLoading(false)
      return
    }
    // CLI caps --limit at 20; the node half clamps, so ask for the max.
    void props.fetchGroups(20, 1).then((result) => {
      if (result.ok) {
        const groups = asArray(asRecord(result.value).list)
        putGroupWindow(groups, asRecord(result.value).more === true)
        props.actions.setGroups(groups)
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
  const [senderNames, setSenderNames] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [replyTo, setReplyTo] = useState<{ msgId: string; summary: string } | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [myProfile, setMyProfile] = useState<{ openId: string; name: string }>({ openId: '', name: '' })
  const [dropToast, setDropToast] = useState('')
  const dropToastTimer = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const draftRef = useRef<HTMLTextAreaElement | null>(null)

  // The login user, so "my" messages bubble right with the brand color.
  useEffect(() => {
    void ensureMyProfile(props).then(profile => {
      setMyProfile({ openId: profile.openId, name: profile.name })
      if (profile.openId !== '' && profile.name !== '') {
        setSenderNames(prev => ({ ...prev, [profile.openId]: profile.name }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset the auto-growing textarea after a send clears the draft.
  useEffect(() => {
    if (draft === '' && draftRef.current !== null) draftRef.current.style.height = 'auto'
  }, [draft])

  // Transient confirmation that a panel drop reached the composer.
  const showDropToast = (title: string): void => {
    setDropToast(`已插入「${title.length > 14 ? `${title.slice(0, 14)}…` : title}」到输入框`)
    if (dropToastTimer.current !== null) window.clearTimeout(dropToastTimer.current)
    dropToastTimer.current = window.setTimeout(() => setDropToast(''), 2600)
  }

  // Panel-wide drop target: a yzj drag dropped ANYWHERE on the panel mints
  // a reference chip in the composer (via the drop bus) — no need to aim at
  // the thin band outside.
  const onPanelDragOver = (event: React.DragEvent): void => {
    if (event.dataTransfer.types.includes(YZJ_DRAG_MIME)) event.preventDefault()
  }
  const onPanelDrop = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes(YZJ_DRAG_MIME)) return
    const raw = event.dataTransfer.getData(YZJ_DRAG_MIME)
    if (raw === '') return
    let ref: YzjDragRef | undefined
    try {
      const parsed = JSON.parse(raw) as YzjDragRef
      if (typeof parsed.kind === 'string' && typeof parsed.title === 'string') ref = parsed
    } catch {
      ref = undefined
    }
    if (ref === undefined) return
    event.preventDefault()
    emitYzjDropRequest(ref)
    showDropToast(ref.title)
  }

  // Keep the newest messages in view: bottom on group open and after sends,
  // unless an anchor jump is active.
  useEffect(() => {
    if (state.groupId === '' || state.anchorMsgId !== '') return
    const list = listRef.current
    if (list === null) return
    list.scrollTop = list.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.groupId, state.messages])

  // Resolve sender display names for the loaded message window (cached).
  // The React state mirrors the module cache so newly resolved names
  // re-render; already-cached names are seeded immediately.
  useEffect(() => {
    const openIds = state.messages.map(message => asString(asRecord(message).fromOpenId))
    if (openIds.length === 0) return
    const seeded: Record<string, string> = {}
    for (const openId of openIds) {
      const name = senderNameOf(openId)
      if (name !== '') seeded[openId] = name
    }
    if (Object.keys(seeded).length > 0) setSenderNames(prev => ({ ...prev, ...seeded }))
    void resolveSenders(openIds, props).then(names => {
      if (Object.keys(names).length > 0) setSenderNames(prev => ({ ...prev, ...names }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.messages])

  // Esc closes the image lightbox.
  useEffect(() => {
    if (lightbox === null) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

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
    props.actions.setAnchorMsgId('')
    setDraft('')
    // Rendered window is cached ~60s: revisiting a group is instant.
    const cached = getMessageWindow(id)
    if (cached !== undefined) {
      props.actions.setMessages(cached.messages)
      props.actions.setMessagesMore(cached.more)
      // The CLI returns messages OLDEST-first; the oldest id is the next
      // anchor for paging further back.
      props.actions.setMessagesAnchor(
        cached.messages.length > 0 ? asString(asRecord(cached.messages[0]).msgId) : '',
      )
      props.actions.setLoading(false)
      return
    }
    props.actions.setLoading(true)
    props.actions.setError('')
    void props.fetchMessages(id, 20).then((result) => {
      if (result.ok) {
        // The CLI already returns oldest-first, which is exactly the chat
        // reading order — do NOT reverse.
        const messages = asArray(asRecord(result.value).list)
        putMessageWindow(id, messages, asRecord(result.value).more === true)
        props.actions.setMessages(messages)
        props.actions.setMessagesMore(asRecord(result.value).more === true)
        props.actions.setMessagesAnchor(messages.length > 0 ? asString(asRecord(messages[0]).msgId) : '')
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
        // type 'old' returns messages OLDER than the anchor, oldest-first —
        // prepend as-is so the top of the list stays the oldest message.
        const older = asArray(asRecord(result.value).list)
        props.actions.prependMessages(older)
        putMessageWindow(state.groupId, [...older, ...state.messages], asRecord(result.value).more === true)
        props.actions.setMessagesMore(asRecord(result.value).more === true)
        if (older.length > 0) {
          props.actions.setMessagesAnchor(asString(asRecord(older[0]).msgId))
        }
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  /** Core send: calls the bridge, appends the local message, clears state. */
  const doSend = async (opts: {
    content?: string
    msgType?: 'text' | 'richText' | 'file'
    fileId?: string
    images?: string[]
    replyMsgId?: string
    fileName?: string
    fileSize?: number
  }): Promise<void> => {
    if (state.groupId === '') return
    const groupId = state.groupId
    const result = await props.sendMessage(groupId, opts.content, {
      ...(opts.msgType === undefined ? {} : { msgType: opts.msgType }),
      ...(opts.fileId === undefined ? {} : { fileId: opts.fileId }),
      ...(opts.images === undefined ? {} : { images: opts.images }),
      ...(opts.replyMsgId === undefined ? {} : { replyMsgId: opts.replyMsgId }),
    })
    if (!result.ok) {
      props.actions.setError(result.error.message)
      return
    }
    const profile = await ensureMyProfile(props)
    const payload = asRecord(result.value)
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const sendTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.000`
    const msgType = opts.msgType ?? 'text'
    const sent: Record<string, unknown> = {
      msgId: asString(payload.msgId ?? payload.id) === '' ? `local-${now.getTime()}` : asString(payload.msgId ?? payload.id),
      content: opts.content ?? '',
      msgType,
      sendTime,
      fromOpenId: profile.openId,
      param: {
        ...(opts.replyMsgId === undefined ? {} : { replyMsgId: opts.replyMsgId }),
        ...(opts.replyMsgId !== undefined && opts.content !== undefined ? { replySummary: opts.content.slice(0, 80) } : {}),
        ...(msgType === 'file'
          ? { file_id: opts.fileId ?? '', name: opts.fileName ?? '', size: opts.fileSize ?? 0, ext: (opts.fileName ?? '').split('.').pop() ?? '' }
          : {}),
        ...(msgType === 'richText' && opts.images !== undefined && opts.images.length > 0
          ? {
              desc: opts.images.map((fileId) => ({
                type: 'image',
                data: fileId,
                start: (opts.content ?? '').indexOf('[图片]'),
                length: 4,
              })),
            }
          : {}),
      },
    }
    if (profile.openId !== '' && profile.name !== '') {
      setSenderNames(prev => ({ ...prev, [profile.openId]: profile.name }))
    }
    const next = [...state.messages, sent]
    props.actions.setMessages(next)
    putMessageWindow(groupId, next, state.messagesMore)
    setDraft('')
    setReplyTo(null)
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }

  /** Plain-text send (Enter / 发送 button). */
  const submitMessage = (): void => {
    const content = draft.trim()
    if (content === '' || sending || uploading || state.groupId === '') return
    setSending(true)
    const replyMsgId = replyTo?.msgId
    void doSend(replyMsgId === undefined ? { content } : { content, replyMsgId })
      .finally(() => setSending(false))
  }

  /** Upload a picked file, then send it as an image (richText) or file. */
  const handlePickFile = (kind: 'image' | 'file', file: File | undefined): void => {
    if (file === undefined) return
    if (file.size > 24 * 1024 * 1024) {
      props.actions.setError('文件超过 24MB，请压缩后重试')
      return
    }
    const reader = new FileReader()
    reader.onload = (): void => {
      const base64 = typeof reader.result === 'string' ? reader.result.split(',')[1] ?? '' : ''
      if (base64 === '') return
      setUploading(true)
      void props.uploadFile(file.name, base64, file.size).then(async (result) => {
        if (!result.ok) {
          props.actions.setError(result.error.message)
          return
        }
        const payload = asRecord(result.value)
        const fileId = asString(payload.fileId ?? payload.file_id ?? payload.id)
        if (fileId === '') {
          props.actions.setError('上传失败：未返回文件 ID')
          return
        }
        if (kind === 'image') {
          const text = draft.trim()
          const content = text === '' ? '[图片]' : `${text}\n[图片]`
          const replyMsgId = replyTo?.msgId
          await doSend(replyMsgId === undefined
            ? { content, msgType: 'richText', images: [fileId] }
            : { content, msgType: 'richText', images: [fileId], replyMsgId })
        } else {
          await doSend({ msgType: 'file', fileId, fileName: file.name, fileSize: file.size })
        }
      }).finally(() => setUploading(false))
    }
    reader.readAsDataURL(file)
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
    <div
      ref={panelRef}
      className={css.panel}
      role="dialog"
      aria-label="云之家"
      style={dockStyle}
      onDragOver={onPanelDragOver}
      onDrop={onPanelDrop}
    >
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
                const name = asString(group.groupName)
                const lastTime = formatListTime(group.lastMsgSendTime)
                const preview = messagePreview(asRecord(group.lastMsg))
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
                        sub: preview.replace(/\s+/g, ' ').slice(0, 40),
                      })
                    }}
                  >
                    <span className={css.itemTitle}>
                      <GroupAvatar url={asString(group.headerUrl)} name={name} />
                      <span className={css.itemTitleText}>{name}</span>
                      {lastTime !== '' && <span className={css.itemTime}>{lastTime}</span>}
                      {unread > 0 && <span className={css.badge}>{unread > 99 ? '99+' : unread}</span>}
                    </span>
                    <span className={css.itemSub}>{preview}</span>
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
            <>
              <div className={css.list} ref={listRef}>
                <button type="button" className={css.back} onClick={() => {
                  props.actions.setGroupId('')
                  props.actions.setAnchorMsgId('')
                  setDraft('')
                  setReplyTo(null)
                }}>
                  <IconChevronLeft14 /> 返回会话
                </button>
                <GroupHead groups={state.groups} groupId={state.groupId} />
              {state.messages.length === 0 && !state.loading && state.error === '' && <div className={css.empty}>暂无消息</div>}
              {state.messagesMore && (
                <button type="button" className={css.more} onClick={loadOlderMessages} disabled={state.loading}>
                  {state.loading ? '加载中…' : '加载更早消息'}
                </button>
              )}
              {state.messages.map((item, index) => {
                const message = asRecord(item)
                const msgType = asString(message.msgType)
                const sendTime = formatMsgTime(message.sendTime)
                const msgId = asString(message.msgId)
                const fromOpenId = asString(message.fromOpenId)
                const mine = myProfile.openId !== '' && fromOpenId === myProfile.openId
                const sender = fromOpenId === '' ? '' : senderNames[fromOpenId] ?? ''
                const anchored = msgId !== '' && msgId === state.anchorMsgId
                // Date divider: a new day between consecutive messages.
                const dayKey = String(message.sendTime).slice(0, 10)
                const prevDay = index > 0 ? String(asRecord(state.messages[index - 1]).sendTime).slice(0, 10) : ''
                const dayLabel = dayKey === '' ? '' : formatListTime(`${dayKey} 00:00:00`)
                const isSystem = msgType === 'other' || asString(asRecord(message.param).sysType) === 'withdrawMsg'
                return (
                  <div key={`m${index}`}>
                    {dayKey !== '' && dayKey !== prevDay && (
                      <div className={css.dayDivider}>{dayLabel}</div>
                    )}
                    <div
                      ref={anchored ? anchorRef : undefined}
                      className={[
                        css.msgRow,
                        mine ? css.msgRowMine : '',
                        isSystem ? css.msgRowSystem : '',
                        anchored ? css.itemAnchored : '',
                      ].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={(event) => {
                        startDragTransfer(event, {
                          kind: 'message', id: msgId,
                          title: dragTitleOf(message),
                          sub: sendTime,
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
                      {!mine && !isSystem && (
                        <SenderAvatar openId={fromOpenId} fallback={sender === '' ? typeLabelOf(msgType) : sender} />
                      )}
                      <span className={mine ? `${css.msgStack} ${css.msgStackMine}` : css.msgStack}>
                        {!mine && !isSystem && (
                          <span className={css.msgSender}>{sender === '' ? typeLabelOf(msgType) : sender}</span>
                        )}
                        <span className={mine ? `${css.bubble} ${css.bubbleMine}` : css.bubble}>
                          <MessageBody message={message} onOpenImage={(src) => setLightbox(src)} inject={props} />
                        </span>
                        <span className={mine ? `${css.msgTime} ${css.msgTimeMine}` : css.msgTime}>{sendTime}</span>
                        {!isSystem && (
                          <button
                            type="button"
                            className={css.msgReply}
                            title="回复此消息"
                            aria-label="回复"
                            onClick={() => {
                              setReplyTo({ msgId, summary: dragTitleOf(message) })
                              draftRef.current?.focus()
                            }}
                          >
                            回复
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
              {anchorToast !== '' && (
                <div className={css.panelToast} role="status">{anchorToast}</div>
              )}
              </div>
              <div className={css.composer}>
                {replyTo !== null && (
                  <div className={css.replyBar}>
                    <span className={css.replyText}>回复：{replyTo.summary.length > 40 ? `${replyTo.summary.slice(0, 40)}…` : replyTo.summary}</span>
                    <button
                      type="button"
                      className={css.replyCancel}
                      aria-label="取消回复"
                      onClick={() => setReplyTo(null)}
                    >
                      ✕
                    </button>
                  </div>
                )}
                {emojiOpen && (
                  <div className={css.emojiPanel} role="group" aria-label="表情">
                    {EMOJI_LIST.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        className={css.emojiCell}
                        onClick={() => {
                          setDraft(draft + emoji)
                          draftRef.current?.focus()
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                <div className={css.composerRow}>
                  <textarea
                    ref={draftRef}
                    className={css.composerInput}
                    value={draft}
                    rows={1}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      const el = event.target
                      el.style.height = 'auto'
                      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.shiftKey) {
                        event.preventDefault()
                        submitMessage()
                      }
                    }}
                    placeholder="输入消息，回车发送…"
                    aria-label="输入消息"
                    disabled={sending || uploading}
                  />
                  <button
                    type="button"
                    className={css.composerSend}
                    onClick={submitMessage}
                    disabled={sending || uploading || draft.trim() === ''}
                  >
                    {sending || uploading ? '发送中…' : '发送'}
                  </button>
                </div>
                <div className={css.composerToolbar}>
                  <button
                    type="button"
                    className={css.toolButton}
                    title="发送图片"
                    aria-label="发送图片"
                    disabled={sending || uploading}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    🖼️
                  </button>
                  <button
                    type="button"
                    className={css.toolButton}
                    title="发送文件"
                    aria-label="发送文件"
                    disabled={sending || uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📎
                  </button>
                  <button
                    type="button"
                    className={css.toolButton}
                    title="表情"
                    aria-label="表情"
                    disabled={sending || uploading}
                    onClick={() => setEmojiOpen(open => !open)}
                  >
                    😊
                  </button>
                  {uploading && <span className={css.toolStatus}>上传中…</span>}
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      handlePickFile('image', event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    onChange={(event) => {
                      handlePickFile('file', event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </div>
              </div>
            </>
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
      {dropToast !== '' && (
        <div className={css.dropToast} role="status">{dropToast}</div>
      )}
      {lightbox !== null && (
        <div
          className={css.lightbox}
          role="presentation"
          onClick={() => setLightbox(null)}
        >
          <img className={css.lightboxImg} src={lightbox} alt="" onClick={(event) => event.stopPropagation()} />
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
