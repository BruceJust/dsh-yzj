/**
 * IM-side caching + rendering helpers for the panel chat tab:
 * - message-window cache per group (TTL 60s) and group-list cache (TTL 30s)
 * - sender-name resolution (fetchContact per openId, session cache) so group
 *   chat rows show real names instead of raw openIds
 * - time/size formatters and yunzhijia media URL builders
 */
import type { YzjPanelInject } from './rpc.ts'

export interface MessageWindow {
  /** Oldest-first, as rendered by the chat list. */
  messages: unknown[]
  more: boolean
  fetchedAt: number
}

const MESSAGE_TTL = 60_000
const GROUP_TTL = 30_000

const messageCache = new Map<string, MessageWindow>()
let groupCache: { groups: unknown[]; more: boolean; fetchedAt: number } | null = null

/** Fresh cached message window for a group, or undefined when stale/missing. */
export function getMessageWindow(groupId: string): MessageWindow | undefined {
  const hit = messageCache.get(groupId)
  if (hit === undefined) return undefined
  if (Date.now() - hit.fetchedAt > MESSAGE_TTL) {
    messageCache.delete(groupId)
    return undefined
  }
  return hit
}

/** Store (or refresh) a group's rendered message window. */
export function putMessageWindow(groupId: string, messages: unknown[], more: boolean): void {
  messageCache.set(groupId, { messages, more, fetchedAt: Date.now() })
}

/** Fresh cached first group page, or undefined when stale/missing. */
export function getGroupWindow(): { groups: unknown[]; more: boolean } | undefined {
  if (groupCache === null) return undefined
  if (Date.now() - groupCache.fetchedAt > GROUP_TTL) return undefined
  return { groups: groupCache.groups, more: groupCache.more }
}

/** Store (or refresh) the first group page. */
export function putGroupWindow(groups: unknown[], more: boolean): void {
  groupCache = { groups, more, fetchedAt: Date.now() }
}

/* ── Local read state: the CLI has no mark-read, so opening a group marks
     it read CLIENT-side. We remember the server unread at mark time; later
     polls show only the delta (new messages), never the historical pile. ── */

const readState = new Map<string, number>()

/** Record that a group was opened; its server unread at that moment. */
export function markGroupRead(groupId: string, serverUnread: number): void {
  readState.set(groupId, serverUnread)
}

/** Effective unread for a group: 0 for marked-read groups plus new arrivals. */
export function effectiveUnread(groupId: string, serverUnread: number): number {
  if (groupId === '' || serverUnread <= 0) return serverUnread
  const marked = readState.get(groupId)
  if (marked === undefined) return serverUnread
  return Math.max(0, serverUnread - marked)
}

/** Session sender cache (openId → display name + avatar). */
interface SenderInfo {
  name: string
  photoUrl: string
}
const senderNames = new Map<string, SenderInfo>()
const senderInflight = new Map<string, Promise<SenderInfo>>()

/** The login user's profile, resolved once (for outbound message attribution). */
let myProfile: { openId: string; name: string; photoUrl: string } | null = null

/** Resolve the login user's openId + name (cached for the session). */
export async function ensureMyProfile(
  inject: Pick<YzjPanelInject, 'fetchWhoami'>,
): Promise<{ openId: string; name: string; photoUrl: string }> {
  if (myProfile !== null) return myProfile
  const result = await inject.fetchWhoami()
  if (!result.ok) return { openId: '', name: '', photoUrl: '' }
  const list = Array.isArray(result.value) ? result.value : []
  const user = (list[0] ?? {}) as Record<string, unknown>
  myProfile = {
    openId: typeof user.openId === 'string' ? user.openId : typeof user.oId === 'string' ? user.oId : '',
    name: typeof user.name === 'string' ? user.name : '',
    photoUrl: typeof user.photoUrl === 'string' ? user.photoUrl : '',
  }
  return myProfile
}

/** Cached display name for a sender, or '' when not yet resolved. */
export function senderNameOf(openId: string): string {
  return senderNames.get(openId)?.name ?? ''
}

/** Cached avatar URL for a sender, or '' when unknown. */
export function senderPhotoOf(openId: string): string {
  return senderNames.get(openId)?.photoUrl ?? ''
}

/** Resolve every unknown sender in a window; returns the newly found names. */
export async function resolveSenders(
  openIds: string[],
  inject: Pick<YzjPanelInject, 'fetchContact'>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const unknown = [...new Set(openIds)].filter(id => id !== '' && !senderNames.has(id))
  if (unknown.length === 0) return out
  await Promise.all(unknown.map(async (openId) => {
    let pending = senderInflight.get(openId)
    if (pending === undefined) {
      pending = inject.fetchContact(openId).then((result) => {
        const info: SenderInfo = { name: '', photoUrl: '' }
        if (result.ok) {
          const list = Array.isArray(result.value) ? result.value : []
          const user = (list[0] ?? {}) as Record<string, unknown>
          info.name = typeof user.name === 'string' ? user.name : ''
          info.photoUrl = typeof user.photoUrl === 'string' ? user.photoUrl : ''
          if (info.name !== '' || info.photoUrl !== '') senderNames.set(openId, info)
        }
        return info
      }).catch(() => ({ name: '', photoUrl: '' }))
      senderInflight.set(openId, pending)
    }
    const info = await pending
    if (info.name !== '') out[openId] = info.name
  }))
  return out
}

/** "2026-08-14 23:03:34.640" → "23:03" today, else "08-14 23:03". */
export function formatMsgTime(text: unknown): string {
  const value = String(text ?? '')
  if (value.length < 16) return value
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (value.startsWith(todayKey)) return value.slice(11, 16)
  return `${value.slice(5, 7)}-${value.slice(8, 10)} ${value.slice(11, 16)}`
}

/** Group-list time: 今天 HH:mm / 昨天 / MM-DD / YYYY-MM-DD. */
export function formatListTime(text: unknown): string {
  const value = String(text ?? '')
  if (value.length < 10) return ''
  const day = value.slice(0, 10)
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (day === todayKey) return value.length >= 16 ? value.slice(11, 16) : '今天'
  const yesterday = new Date(now.getTime() - 86_400_000)
  const yesterdayKey = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`
  if (day === yesterdayKey) return '昨天'
  const year = String(now.getFullYear())
  return day.startsWith(year) ? day.slice(5) : day
}

/** 5896737 → "5.6 MB"; unknown → ''. */
export function formatSize(bytes: unknown): string {
  const size = typeof bytes === 'number' ? bytes : Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** Download URL for a yzj file message (param.file_id). */
export function fileDownloadUrl(fileId: string): string {
  return `https://www.yunzhijia.com/docrest/doc/user/downloadfile?fileId=${encodeURIComponent(fileId)}`
}

/** Image URL for a yzj image file id (richText desc image segments). */
export function imageUrlOf(fileId: string): string {
  return `https://www.yunzhijia.com/docrest/doc/user/image?fileId=${encodeURIComponent(fileId)}`
}

/* ── file-data proxy cache (docrest URLs need the CLI's auth) ────────── */

const fileDataCache = new Map<string, string>()
const fileDataInflight = new Map<string, Promise<string | undefined>>()

/**
 * Resolve a fileId's data URL through the /yzj file-data proxy. Results are
 * cached in-session (bounded) so revisits and repeated images are instant.
 */
export async function resolveFileData(
  fileId: string,
  inject: Pick<YzjPanelInject, 'fetchFileData'>,
): Promise<string | undefined> {
  const cached = fileDataCache.get(fileId)
  if (cached !== undefined) return cached
  let pending = fileDataInflight.get(fileId)
  if (pending === undefined) {
    pending = inject.fetchFileData(fileId).then((result) => {
      if (!result.ok) return undefined
      const value = (result.value ?? {}) as { dataUrl?: unknown }
      const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : ''
      if (dataUrl !== '') {
        fileDataCache.set(fileId, dataUrl)
        // Bounded: drop oldest entries beyond 32.
        for (const key of fileDataCache.keys()) {
          if (fileDataCache.size <= 32) break
          fileDataCache.delete(key)
        }
      }
      return dataUrl === '' ? undefined : dataUrl
    }).catch(() => undefined)
    fileDataInflight.set(fileId, pending)
  }
  return pending
}
