/**
 * The Yunzhijia workspace panel: a frame overlay with three tabs — 知识库
 * (workspace → doc tree), 日程 (today), 会话 (recent groups → messages with
 * paging). Rendering stays presentational: data arrives through the injected
 * fetch face and the shared store; verbs are the injected face and store
 * actions.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  IconChecklistOutline14,
  IconFolderOpenOutline16,
  IconNewChatOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BakedActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { YzjPanelActions, YzjPanelState, YzjTab } from './stores.ts'
import type { YzjPanelInject } from './rpc.ts'
import {
  effectiveUnread, ensureMyProfile, formatListTime, formatMsgTime, formatSize, getGroupWindow,
  getMessageWindow, markAllRead, markGroupRead, putGroupWindow, putMessageWindow, resolveFileData, resolveSenders,
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

/** Extract a minimal adaptive-card face (image + title + action). */
function cardFace(cardJson: string): { title: string; image: string; actionTitle: string; actionUrl: string } {
  const face = { title: '', image: '', actionTitle: '', actionUrl: '' }
  let parsed: unknown
  try {
    parsed = JSON.parse(cardJson)
  } catch {
    return face
  }
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    if (record.type === 'Image' && typeof record.url === 'string' && face.image === '') face.image = record.url
    if (record.type === 'TextBlock' && typeof record.text === 'string' && record.isSubtle !== true && face.title === '') face.title = record.text
    if (record.type === 'Action.OpenUrl') {
      if (typeof record.title === 'string' && face.actionTitle === '') face.actionTitle = record.title
      if (typeof record.url === 'string' && face.actionUrl === '') face.actionUrl = record.url
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) for (const item of value) walk(item)
      else if (typeof value === 'object' && value !== null) walk(value)
    }
  }
  walk(parsed)
  return face
}

/**
 * One message's body, rendered by msgType: text (bold + emoticon tokens),
 * richText (inline proxy images + text), file (image inline / PDF preview /
 * download chip), other (link card, adaptive card, or system line), withdraw
 * (system line). Images and PDFs open the lightbox.
 */
function MessageBody({ message, onOpenImage, onOpenPdf, inject }: {
  message: Record<string, unknown>
  onOpenImage: (src: string) => void
  onOpenPdf: (src: string) => void
  inject: Pick<YzjPanelInject, 'fetchFileData'>
}) {
  const content = asString(message.content)
  const msgType = asString(message.msgType)
  const param = asRecord(message.param)

  // System rows (撤回 / 入群 / 其他) — centered, tertiary.
  if (msgType === 'other' && asString(param.title) === '' && asRecord(param.interactiveCard).cardJson === undefined) {
    return <span className={css.msgSystem}>{content === '' ? '(系统消息)' : emojiText(content)}</span>
  }
  if (asString(param.sysType) === 'withdrawMsg') {
    return <span className={css.msgSystem}>{content === '' ? '撤回了一条消息' : emojiText(content)}</span>
  }

  // Reply quote above the body.
  const replyMsgId = asString(param.replyMsgId)
  const replySummary = asString(param.replySummary)
  const replyPerson = asString(param.replyPersonName)
  const quote = replyMsgId !== ''
    ? <span className={css.msgQuote} title={replySummary}>{`↳ ${replyPerson === '' ? '' : `${replyPerson}：`}${replySummary}`}</span>
    : null

  // File: image extensions preview inline; PDF previews in the lightbox
  // with a separate 下载 action; everything else downloads on click.
  if (msgType === 'file') {
    const fileId = asString(param.file_id)
    const name = asString(param.name) !== '' ? asString(param.name) : content.replace(/^\[文件\]:/, '')
    const size = formatSize(param.size)
    const ext = asString(param.ext).toLowerCase()
    if (/^(png|jpe?g|gif|webp|bmp)$/.test(ext) && fileId !== '') {
      return (
        <span className={css.msgBody}>
          {quote}
          <ProxyImage fileId={fileId} alt={name} onOpen={onOpenImage} inject={inject} />
        </span>
      )
    }
    const isPdf = ext === 'pdf'
    const icon = isPdf ? '📕'
      : /^(mp4|mov|avi|mkv|webm)$/.test(ext) ? '🎬'
        : /^(xls|xlsx|csv)$/.test(ext) ? '📊'
          : /^(doc|docx|txt|md)$/.test(ext) ? '📄'
            : /^(zip|rar|7z|tar|gz)$/.test(ext) ? '📦'
              : '📎'
    const download = (): void => {
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
    }
    return (
      <span className={css.msgBody}>
        {quote}
        <span className={css.msgFileGroup}>
          <button
            type="button"
            className={css.msgFile}
            title={isPdf ? `预览 ${name}` : `下载 ${name}`}
            disabled={fileId === ''}
            onClick={(event) => {
              event.stopPropagation()
              if (fileId === '') return
              if (!isPdf) {
                download()
                return
              }
              void resolveFileData(fileId, inject).then(dataUrl => {
                if (dataUrl !== undefined) onOpenPdf(dataUrl)
              })
            }}
          >
            <span className={css.msgFileIcon}>{icon}</span>
            <span className={css.msgFileMeta}>
              <span className={css.msgFileName}>{name}</span>
              <span className={css.msgFileSize}>{size === '' ? ext === '' ? '文件' : ext.toUpperCase() : size}</span>
            </span>
          </button>
          {isPdf && fileId !== '' && (
            <button
              type="button"
              className={css.msgFileDownload}
              onClick={(event) => {
                event.stopPropagation()
                download()
              }}
            >
              下载
            </button>
          )}
        </span>
      </span>
    )
  }

  // Link card (survey / light app).
  if (msgType === 'other' && asString(param.title) !== '') {
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
            <span className={css.linkCardDesc}>{emojiText(content)}</span>
            {url !== '' && <span className={css.linkCardAction}>查看详情 →</span>}
          </span>
        </a>
      </span>
    )
  }

  // Adaptive interactive card: first image + title + action, rendered as a
  // mini card (cloudhub:// deep links stay inert).
  if (msgType === 'other') {
    const card = asRecord(param.interactiveCard)
    const cardJson = asString(card.cardJson)
    const face = cardJson === '' ? { title: '', image: '', actionTitle: '', actionUrl: '' } : cardFace(cardJson)
    const title = face.title !== '' ? face.title : content
    const actionUrl = face.actionUrl.startsWith('http') ? face.actionUrl : ''
    if (face.title !== '' || face.image !== '') {
      return (
        <span className={css.msgBody}>
          <a
            className={css.linkCard}
            href={actionUrl === '' ? undefined : actionUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => { event.stopPropagation() }}
          >
            {face.image !== '' && (
              <img className={css.linkCardThumb} src={face.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
            )}
            <span className={css.linkCardBody}>
              <span className={css.linkCardTitle}>{title}</span>
              <span className={css.linkCardDesc}>{emojiText(content)}</span>
              {actionUrl !== '' && <span className={css.linkCardAction}>{face.actionTitle === '' ? '查看详情' : face.actionTitle} →</span>}
            </span>
          </a>
        </span>
      )
    }
    return <span className={css.msgSystem}>{content === '' ? '(系统消息)' : emojiText(content)}</span>
  }

  // richText: interleave text (with bold + emoticons) and inline images.
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
        {quote}
        {spans.map((span, index) => (
          <span key={`t${index}`} className={span.bold ? css.msgBold : undefined}>{emojiText(span.text)}</span>
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

  // Plain text (with emoticon tokens).
  return (
    <span className={css.msgBody}>
      {quote}
      {content === '' ? `(${typeLabelOf(msgType)})` : emojiText(content)}
    </span>
  )
}

const TABS: { key: YzjTab; label: string; icon: () => ReactNode }[] = [
  { key: 'docs', label: '知识库', icon: () => <IconFolderOpenOutline16 /> },
  { key: 'calendar', label: '日程', icon: () => <IconChecklistOutline14 /> },
  { key: 'chat', label: '会话', icon: () => <IconNewChatOutline16 /> },
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

/** Sum the effective (read-aware) unread counts of a recent-session window. */
function unreadTotalOf(value: unknown): number {
  const list = asArray(asRecord(value).list)
  return list.reduce<number>((sum, item) => {
    const group = asRecord(item)
    const server = typeof group.unreadCount === 'number' ? group.unreadCount : 0
    if (server <= 0) return sum
    return sum + effectiveUnread(asString(group.groupId), server)
  }, 0)
}

/** Yunzhijia bracket-emoticon tokens → real emoji (messages use [握手] etc.). */
const EMOJI_MAP: Record<string, string> = {
  微笑: '😊', 呲牙: '😁', 大笑: '😂', 开心: '😄', 愉快: '😀', 调皮: '😜', 机智: '🤓', 得意: '😎',
  害羞: '😳', 难过: '😔', 大哭: '😭', 流泪: '😢', 愤怒: '😡', 惊讶: '😲', 惊恐: '😱', 发呆: '😶',
  睡觉: '😴', 疑问: '🤔', 思考: '🤔', 奋斗: '💪', 加油: '💪', 强: '👊', 弱: '👎', 赞: '👍',
  鼓掌: '👏', 抱拳: '🙏', 握手: '🤝', 胜利: '✌️', 耶: '✌️', OK: '👌', 勾: '✅', 叉: '❌',
  心: '❤️', 爱心: '❤️', 玫瑰: '🌹', 咖啡: '☕', 茶: '🍵', 啤酒: '🍺', 干杯: '🍻', 蛋糕: '🎂',
  庆祝: '🎉', 烟花: '🎆', 红包: '🧧', 礼物: '🎁', 飞机: '✈️', 汽车: '🚗', 太阳: '☀️', 月亮: '🌙',
  星星: '⭐', 闪电: '⚡', 雨: '🌧️', 雪: '❄️', 云: '☁️', 风: '🍃', 西瓜: '🍉', 苹果: '🍎',
  米饭: '🍚', 面: '🍜', 收到: '✅', 求抱抱: '🤗', 比心: '💗', 花朵: '🌸',
}

/** Render message text with [token] emoticons mapped to real emoji. */
function emojiText(text: string): ReactNode[] {
  return text.split(/(\[[^\]\n]{1,10}\])/).map((part, index) => {
    if (part.length > 2 && part.startsWith('[') && part.endsWith(']')) {
      const emoji = EMOJI_MAP[part.slice(1, -1)]
      if (emoji !== undefined) return <span key={index}>{emoji}</span>
    }
    return part
  })
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
  state: YzjPanelState,
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
    const pad = (n: number): string => String(n).padStart(2, '0')
    const start = `${state.calYear}-${pad(state.calMonth)}-01`
    const end = `${state.calYear}-${pad(state.calMonth)}-${pad(new Date(state.calYear, state.calMonth, 0).getDate())}`
    void props.fetchEvents(start, end).then((result) => {
      if (result.ok) {
        props.actions.setCalEvents(asArray(result.value))
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
  }
}

/** The frame-overlay Yunzhijia panel; renders null while closed. */
export function YzjPanel(props: YzjPanelProps) {
  const open = props.useStore(state => state.open)
  const tab = props.useStore(state => state.tab)
  // Persisted tabs may hold the removed 'me'; fall back to the docs tab.
  const activeTab: YzjTab = tab === 'docs' || tab === 'calendar' || tab === 'chat' ? tab : 'docs'
  const anchorActive = props.useStore(state => state.anchorMsgId !== '')
  const state = props.useStore(s => s)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [anchorToast, setAnchorToast] = useState('')
  const [senderNames, setSenderNames] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ src: string; kind: 'image' | 'pdf' } | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [replyTo, setReplyTo] = useState<{ msgId: string; summary: string } | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [myProfile, setMyProfile] = useState<{ openId: string; name: string }>({ openId: '', name: '' })
  const [dropToast, setDropToast] = useState('')
  const [docPreview, setDocPreview] = useState<{ title: string; meta: string; lines: string[] } | null>(null)
  const [eventDetail, setEventDetail] = useState<{ title: string; time: string; person: string; place: string; content: string } | null>(null)
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

  // Opening a group marks it read locally (the CLI has no mark-read): the
  // row's unread clears and the floating-ball total drops to what's real.
  useEffect(() => {
    if (state.groupId === '') return
    const group = state.groups.map(asRecord).find(item => asString(item.groupId) === state.groupId)
    if (group === undefined) return
    const serverUnread = typeof group.unreadCount === 'number' ? group.unreadCount : 0
    if (serverUnread <= 0) return
    markGroupRead(state.groupId, serverUnread)
    props.actions.setGroups(state.groups.map(item =>
      asString(asRecord(item).groupId) === state.groupId ? { ...asRecord(item), unreadCount: 0 } : item))
    props.actions.setUnreadTotal(unreadTotalOf({ list: state.groups }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.groupId])

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
      const x = Math.max(8, Math.min(event.clientX - dragOffset.current.dx, Math.max(8, window.innerWidth - 880)))
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
    loadTab(activeTab, props, state)
    // tab switches and opens are the load triggers; state reads inside the
    // loader come from the snapshot taken at effect time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab])

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
    props.actions.setDocId('')
    setDocPreview(null)
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

  /** Right-pane doc preview: info + first blocks as text. */
  const openDoc = (id: string, title: string): void => {
    props.actions.setDocId(id)
    setDocPreview(null)
    void Promise.all([props.fetchDoc(id), props.fetchDocBlocks(id)]).then(([infoResult, blocksResult]) => {
      const node = asRecord(infoResult.ok ? infoResult.value : {})
      const suffix = asString(node.fileSuffix)
      const meta = [
        suffix === 'dbt' ? '多维表格' : '在线文档',
        asString(node.updateTime).slice(0, 10) === '' ? '' : `更新 ${asString(node.updateTime).slice(0, 10)}`,
        asString(node.creatorName) === '' ? '' : `创建人 ${asString(node.creatorName)}`,
      ].filter(part => part !== '').join(' · ')
      const lines: string[] = []
      if (blocksResult.ok) {
        const walk = (node2: unknown): void => {
          if (typeof node2 !== 'object' || node2 === null) return
          const record = node2 as Record<string, unknown>
          if (typeof record.type === 'string' && typeof record.content === 'string') {
            const text = record.content.trim()
            if (text !== '' && (record.type === 'heading' || record.type === 'paragraph' || record.type === 'code' || record.type === 'text')) {
              lines.push(text)
            }
          }
          for (const value of Object.values(record)) {
            if (Array.isArray(value)) for (const item of value) walk(item)
            else if (typeof value === 'object' && value !== null) walk(value)
          }
        }
        for (const block of asArray(blocksResult.value)) walk(block)
      }
      setDocPreview({ title, meta, lines: lines.slice(0, 200) })
    }).catch(() => setDocPreview({ title, meta: '', lines: [] }))
  }

  /** Move the calendar cursor and fetch the new month. */
  const moveMonth = (delta: number): void => {
    const next = new Date(state.calYear, state.calMonth - 1 + delta, 1)
    const year = next.getFullYear()
    const month = next.getMonth() + 1
    props.actions.setCalCursor(year, month)
    props.actions.setCalDay('')
    props.actions.setCalEventId('')
    setEventDetail(null)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const start = `${year}-${pad(month)}-01`
    const end = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`
    props.actions.setLoading(true)
    props.actions.setError('')
    void props.fetchEvents(start, end).then((result) => {
      if (result.ok) {
        props.actions.setCalEvents(asArray(result.value))
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  /** Select a calendar day; the right pane lists its events. */
  const pickDay = (day: string): void => {
    props.actions.setCalDay(day)
    props.actions.setCalEventId('')
    setEventDetail(null)
  }

  /** Select an event; enrich with the full detail when needed. */
  const pickEvent = (event: Record<string, unknown>): void => {
    const id = asString(event.id)
    props.actions.setCalEventId(id)
    const clock = (ms: unknown): string => {
      if (typeof ms !== 'number') return ''
      const date = new Date(ms)
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
    const start = clock(event.startDate)
    const end = clock(event.endDate)
    const base = {
      title: asString(event.title),
      time: start === '' ? '' : `${start}${end === '' ? '' : ` → ${end}`}`,
      person: asString(event.personName),
      place: asString(event.meetingPlace),
      content: asString(event.content),
    }
    if (base.content !== '') {
      setEventDetail(base)
      return
    }
    void props.fetchEvent(id).then((result) => {
      if (!result.ok) {
        setEventDetail(base)
        return
      }
      const detail = asRecord(result.value)
      const ms = typeof detail.startDate === 'number' ? detail.startDate : typeof event.startDate === 'number' ? event.startDate : 0
      const start2 = clock(ms)
      const endMs = typeof detail.endDate === 'number' ? detail.endDate : typeof event.endDate === 'number' ? event.endDate : 0
      const end2 = clock(endMs)
      setEventDetail({
        title: asString(detail.title) === '' ? base.title : asString(detail.title),
        time: start2 === '' ? base.time : `${start2}${end2 === '' ? '' : ` → ${end2}`}`,
        person: asString(detail.personName) === '' ? base.person : asString(detail.personName),
        place: asString(detail.meetingPlace),
        content: asString(detail.content),
      })
    }).catch(() => setEventDetail(base))
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
          onClick={() => { loadTab(activeTab, props, state) }}
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
            className={activeTab === item.key ? `${css.tab} ${css.tabActive}` : css.tab}
            aria-current={activeTab === item.key ? 'page' : undefined}
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

      {activeTab === 'docs' && (
        <div className={css.body}>
          <div className={css.twoPane}>
            <div className={css.paneLeft}>
              <div className={css.paneList}>
                {state.workspaces.length === 0 && !state.loading && state.error === '' && (
                  <div className={css.empty}><YzjCloudIcon size={28} /><span>暂无知识库</span></div>
                )}
                {state.workspaces.map((item, index) => {
                  const ws = asRecord(item)
                  const count = typeof ws.docCount === 'number' ? ws.docCount : 0
                  const members = typeof ws.memberCount === 'number' ? ws.memberCount : 0
                  const id = asString(ws.id)
                  const name = asString(ws.name)
                  const active = id === state.workspaceId
                  return (
                    <button
                      key={`w${index}`}
                      type="button"
                      className={active ? `${css.item} ${css.itemActive}` : css.item}
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
            </div>
            <div className={css.paneRight}>
              {state.workspaceId === '' ? (
                <div className={css.paneEmpty}><YzjCloudIcon size={28} /><span>选择左侧知识库查看文档</span></div>
              ) : state.docId === '' ? (
                <div className={css.paneList}>
                  <div className={css.paneHead}>
                    <span className={css.paneTitle}>
                      {asString(state.workspaces.map(asRecord).find(ws => asString(ws.id) === state.workspaceId)?.name ?? '知识库')}
                    </span>
                  </div>
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
                        onClick={() => { openDoc(id, title) }}
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
              ) : docPreview === null ? (
                <div className={css.paneEmpty}>加载中…</div>
              ) : (
                <div className={css.paneList}>
                  <div className={css.paneHead}>
                    <button type="button" className={css.back} onClick={() => { props.actions.setDocId('') }}>
                      <IconChevronLeft14 /> 返回文档
                    </button>
                    <span className={css.paneTitle}>{docPreview.title}</span>
                  </div>
                  {docPreview.meta !== '' && <div className={css.docMeta}>{docPreview.meta}</div>}
                  <div className={css.docBody}>
                    {docPreview.lines.length === 0
                      ? '（无文本内容，可拖拽引用或在新标签打开）'
                      : docPreview.lines.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className={css.body}>
          <div className={css.twoPane}>
            <div className={css.paneLeft}>
              <div className={css.calHead}>
                <button type="button" className={css.calNav} aria-label="上个月" onClick={() => moveMonth(-1)}>‹</button>
                <span className={css.calTitle}>{state.calYear}年{state.calMonth}月</span>
                <button type="button" className={css.calNav} aria-label="下个月" onClick={() => moveMonth(1)}>›</button>
              </div>
              <div className={css.calGrid}>
                {['一', '二', '三', '四', '五', '六', '日'].map(day => (
                  <div key={day} className={css.calDow}>{day}</div>
                ))}
                {(() => {
                  const firstDow = (new Date(state.calYear, state.calMonth - 1, 1).getDay() + 6) % 7
                  const daysInMonth = new Date(state.calYear, state.calMonth, 0).getDate()
                  const pad = (n: number): string => String(n).padStart(2, '0')
                  const todayKey = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`
                  const eventsByDay = new Map<string, number>()
                  for (const item of state.calEvents) {
                    const event = asRecord(item)
                    if (typeof event.startDate !== 'number') continue
                    const date = new Date(event.startDate)
                    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
                    eventsByDay.set(key, (eventsByDay.get(key) ?? 0) + 1)
                  }
                  const cells = []
                  for (let i = 0; i < firstDow; i++) cells.push(<div key={`b${i}`} className={css.calBlank} />)
                  for (let day = 1; day <= daysInMonth; day++) {
                    const key = `${state.calYear}-${pad(state.calMonth)}-${pad(day)}`
                    const count = eventsByDay.get(key) ?? 0
                    const classes = [
                      css.calCell,
                      key === todayKey ? css.calCellToday : '',
                      key === state.calDay ? css.calCellSelected : '',
                      count > 0 ? css.calCellHas : '',
                    ].filter(Boolean).join(' ')
                    cells.push(
                      <button
                        key={key}
                        type="button"
                        className={classes}
                        aria-label={key}
                        onClick={() => pickDay(key)}
                      >
                        <span className={css.calDayNum}>{day}</span>
                        {count > 0 && <span className={css.calDot} title={`${count} 个日程`} />}
                      </button>,
                    )
                  }
                  return cells
                })()}
              </div>
            </div>
            <div className={css.paneRight}>
              {state.calDay === '' ? (
                <div className={css.paneEmpty}><IconChecklistOutline14 /><span>选择左侧日期查看日程</span></div>
              ) : (
                <div className={css.paneList}>
                  <div className={css.paneHead}>
                    <span className={css.paneTitle}>{formatListTime(`${state.calDay} 00:00:00`)}</span>
                  </div>
                  {(() => {
                    const pad = (n: number): string => String(n).padStart(2, '0')
                    const dayEvents = state.calEvents.filter((item) => {
                      const event = asRecord(item)
                      if (typeof event.startDate !== 'number') return false
                      const date = new Date(event.startDate)
                      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` === state.calDay
                    })
                    if (dayEvents.length === 0) {
                      return <div className={css.empty}>当天暂无日程</div>
                    }
                    return dayEvents.map((item, index) => {
                      const event = asRecord(item)
                      const clock = (ms: unknown): string => {
                        if (typeof ms !== 'number') return ''
                        const date = new Date(ms)
                        const p = (n: number): string => String(n).padStart(2, '0')
                        return `${p(date.getHours())}:${p(date.getMinutes())}`
                      }
                      const start = clock(event.startDate)
                      const end = clock(event.endDate)
                      const timeText = start === '' ? '' : `${start}${end === '' ? '' : ` → ${end}`}`
                      const title = asString(event.title)
                      const person = asString(event.personName)
                      const place = asString(event.meetingPlace)
                      const id = asString(event.id)
                      const active = id === state.calEventId
                      return (
                        <button
                          key={`e${index}`}
                          type="button"
                          className={active ? `${css.item} ${css.itemActive}` : css.item}
                          onClick={() => pickEvent(event)}
                          draggable
                          onDragStart={(event) => {
                            startDragTransfer(event, {
                              kind: 'event', id, title,
                              sub: [timeText, person].filter(part => part !== '').join(' · '),
                            })
                          }}
                        >
                          <span className={css.eventTime}>{timeText === '' ? '全天' : timeText}</span>
                          <span className={css.itemTitleText}>{title}</span>
                          <span className={css.itemSub}>
                            {[person, place].filter(part => part !== '').join(' · ')}
                          </span>
                        </button>
                      )
                    })
                  })()}
                  {eventDetail !== null && state.calEventId !== '' && (
                    <div className={css.eventDetail}>
                      <div className={css.eventDetailTitle}>{eventDetail.title}</div>
                      {eventDetail.time !== '' && <div className={css.eventDetailRow}>🕐 {eventDetail.time}</div>}
                      {eventDetail.person !== '' && <div className={css.eventDetailRow}>👤 {eventDetail.person}</div>}
                      {eventDetail.place !== '' && <div className={css.eventDetailRow}>📍 {eventDetail.place}</div>}
                      {eventDetail.content !== '' && <div className={css.eventDetailContent}>{eventDetail.content}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'chat' && (
        <div className={css.body}>
          <div className={css.twoPane}>
            <div className={css.paneLeft}>
              <div className={css.readAllRow}>
                <span className={css.readAllHint}>
                  {state.unreadTotal > 0 ? `共 ${state.unreadTotal > 99 ? '99+' : state.unreadTotal} 条未读` : '没有未读消息'}
                </span>
                <button
                  type="button"
                  className={css.readAll}
                  disabled={state.unreadTotal === 0}
                  onClick={() => {
                    markAllRead(state.groups)
                    props.actions.setGroups(state.groups.map(item => ({ ...asRecord(item), unreadCount: 0 })))
                    props.actions.setUnreadTotal(0)
                  }}
                >
                  全部已读
                </button>
              </div>
              <div className={css.paneList}>
              {state.groups.length === 0 && !state.loading && state.error === '' && (
                <div className={css.empty}><IconNewChatOutline16 /><span>暂无最近会话</span></div>
              )}
              {state.groups.map((item, index) => {
                const group = asRecord(item)
                const unread = effectiveUnread(asString(group.groupId), typeof group.unreadCount === 'number' ? group.unreadCount : 0)
                const name = asString(group.groupName)
                const lastTime = formatListTime(group.lastMsgSendTime)
                const preview = messagePreview(asRecord(group.lastMsg))
                const active = asString(group.groupId) === state.groupId
                return (
                  <button
                    key={`g${index}`}
                    type="button"
                    className={active ? `${css.item} ${css.itemActive}` : css.item}
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
            </div>
            <div className={css.paneRight}>
            {state.groupId === '' ? (
                <div className={css.paneEmpty}><IconNewChatOutline16 /><span>选择左侧会话查看消息</span></div>
            ) : (
            <>
              <div className={css.chatHeader}>
                <GroupHead groups={state.groups} groupId={state.groupId} />
              </div>
              {anchorActive && (
                <div className={css.anchorHint} role="status">
                  已定位到锚点消息（来自「查看上下文」）
                </div>
              )}
              <div className={css.list} ref={listRef}>
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
                      {!isSystem && (
                        <SenderAvatar openId={fromOpenId} fallback={sender === '' ? typeLabelOf(msgType) : sender} />
                      )}
                      <span className={css.msgStack}>
                        {!isSystem && (
                          <span className={css.msgMetaLine}>
                            <span className={css.msgSender}>{sender === '' ? typeLabelOf(msgType) : sender}{mine ? '（我）' : ''}</span>
                            <span className={css.msgTime}>{sendTime}</span>
                            {anchored && <span className={css.anchorTag}>锚点</span>}
                          </span>
                        )}
                        <span className={css.msgContent}>
                          <MessageBody
                            message={message}
                            onOpenImage={(src) => setLightbox({ src, kind: 'image' })}
                            onOpenPdf={(src) => setLightbox({ src, kind: 'pdf' })}
                            inject={props}
                          />
                        </span>
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
          {lightbox.kind === 'pdf'
            ? (
                <embed
                  className={css.lightboxPdf}
                  src={lightbox.src}
                  type="application/pdf"
                  onClick={(event) => event.stopPropagation()}
                />
              )
            : (
                <img className={css.lightboxImg} src={lightbox.src} alt="" onClick={(event) => event.stopPropagation()} />
              )}
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
