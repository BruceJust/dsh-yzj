/**
 * The 云之家 '@' trigger source. Typing `@` in the composer opens the
 * pipeline menu with knowledge bases, recent sessions, and (with a query)
 * directory hits. A pick inserts a reference chip; on send the codec's
 * serialize() emits the fetched context block so the agent receives real
 * substance (excerpts, times, recent messages) — not just a title.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerSource, ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/src/types.ts'
import type { YzjPanelInject } from './rpc.ts'
import type { YzjDragRef } from './panel.tsx'
import { clearRefContextCache, fetchRefContext } from './context.ts'

/** Compact ref string persisted with the chip (lossless JSON payload). */
export function encodeRef(ref: YzjDragRef): string {
  return `yzj:${JSON.stringify({ kind: ref.kind, id: ref.id, title: ref.title, url: ref.url, sub: ref.sub })}`
}

/** Best-effort decode; unknown shapes return undefined. */
export function decodeRef(raw: string): YzjDragRef | undefined {
  if (!raw.startsWith('yzj:')) return undefined
  try {
    const parsed = JSON.parse(raw.slice(4)) as Partial<YzjDragRef>
    if (typeof parsed.kind !== 'string' || typeof parsed.id !== 'string' || typeof parsed.title !== 'string') return undefined
    const ref: YzjDragRef = {
      kind: parsed.kind as YzjDragRef['kind'],
      id: parsed.id,
      title: parsed.title,
    }
    if (typeof parsed.url === 'string' && parsed.url !== '') ref.url = parsed.url
    if (typeof parsed.sub === 'string' && parsed.sub !== '') ref.sub = parsed.sub
    return ref
  } catch {
    return undefined
  }
}

const KIND_LABEL: Record<YzjDragRef['kind'], string> = {
  workspace: '知识库', doc: '文档', group: '会话', event: '日程', contact: '联系人', message: '消息',
}

/** Registered source name — the serializer routing key for reference chips. */
export const SOURCE_NAME = '云之家'

const KIND_ICON: Record<YzjDragRef['kind'], string> = {
  workspace: '📚', doc: '📄', group: '💬', event: '📅', contact: '👤', message: '✉️',
}

/** Session cache of warm catalog data + pick-time ref metadata. */
interface YzjSourceCache {
  warm: Promise<void> | null
  workspaces: unknown[]
  groups: unknown[]
  /** Candidate display name → ref. */
  byName: Map<string, YzjDragRef>
  /** Encoded ref string → full ref (survives pick but not reload). */
  byRef: Map<string, YzjDragRef>
}

const caches = new Map<string, YzjSourceCache>()

function cacheOf(sessionId: string): YzjSourceCache {
  let cache = caches.get(sessionId)
  if (cache === undefined) {
    cache = { warm: null, workspaces: [], groups: [], byName: new Map(), byRef: new Map() }
    caches.set(sessionId, cache)
  }
  return cache
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Build candidates from the warm snapshot, filtered by query. */
function buildCandidates(cache: YzjSourceCache, query: string, inject: YzjPanelInject): Promise<readonly InputTriggerCandidate[]> {
  const q = query.trim().toLowerCase()
  const out: InputTriggerCandidate[] = []
  const seen = new Set<string>()
  const push = (name: string, description: string, icon: string, ref: YzjDragRef): void => {
    if (q !== '' && !name.toLowerCase().includes(q)) return
    if (seen.has(name)) return
    seen.add(name)
    cache.byName.set(name, ref)
    cache.byRef.set(encodeRef(ref), ref)
    out.push({ name, description, icon })
  }

  for (const item of cache.workspaces) {
    const ws = asRecord(item)
    const name = asString(ws.name)
    if (name === '') continue
    push(name, `📚 知识库 · 文档 ${typeof ws.docCount === 'number' ? ws.docCount : '?'} 篇`,
      KIND_ICON.workspace, { kind: 'workspace', id: asString(ws.id), title: name })
  }
  for (const item of cache.groups) {
    const group = asRecord(item)
    const name = asString(group.groupName)
    if (name === '') continue
    const unread = typeof group.unreadCount === 'number' ? group.unreadCount : 0
    push(name, `💬 会话${unread > 0 ? ` · 未读 ${unread}` : ''}`, KIND_ICON.group,
      { kind: 'group', id: asString(group.groupId), title: name })
  }
  if (q !== '') {
    return inject.fetchSearch(q).then((result) => {
      if (result.ok) {
        for (const item of asArray(result.value)) {
          const user = asRecord(item)
          const name = asString(user.name)
          if (name === '') continue
          const sub = [asString(user.department), asString(user.jobTitle)].filter(part => part !== '').join(' · ')
          push(name, `👤 ${sub === '' ? '联系人' : sub}`, KIND_ICON.contact,
            { kind: 'contact', id: asString(user.oId ?? user.openId), title: name })
        }
      }
      return out
    })
  }
  return Promise.resolve(out)
}

/** Insert payload for one ref. `source` must equal the registered source name. */
function insertFor(ref: YzjDragRef): ReferenceInsert {
  return {
    source: SOURCE_NAME,
    ref: encodeRef(ref),
    label: `☁ ${ref.title}`,
    clipboardText: `【云之家·${KIND_LABEL[ref.kind]}】${ref.title}`,
  }
}

/** Register the '@' source on the session-scoped registrant ctx. */
export function applyYzjAtSource(ctx: ClientContext, inject: YzjPanelInject): void {
  const source: InputTriggerSource = {
    trigger: '@',
    name: '云之家',
    order: 5,
    warm(session: ClientSessionContext) {
      const cache = cacheOf(session.sessionId)
      if (cache.warm !== null) return
      cache.warm = Promise.all([
        inject.fetchWorkspaces().then((result) => {
          if (result.ok) cache.workspaces = asArray(result.value)
        }).catch(() => {}),
        inject.fetchGroups(20).then((result) => {
          if (result.ok) cache.groups = asArray(asRecord(result.value).list)
        }).catch(() => {}),
      ]).then(() => {})
    },
    async candidates(session, req) {
      const cache = cacheOf(session.sessionId)
      if (cache.warm !== null) await cache.warm
      return buildCandidates(cache, req.query, inject)
    },
    onPick({ candidate, session }) {
      const cache = cacheOf(session.sessionId)
      const ref = cache.byName.get(candidate.name)
      if (ref === undefined) return undefined
      return { insert: insertFor(ref) }
    },
    codec: {
      clipboardText: (ref) => {
        const parsed = decodeRef(ref)
        return parsed === undefined ? ref : `【云之家·${KIND_LABEL[parsed.kind]}】${parsed.title}`
      },
      serialize: async (ref, signal) => {
        const parsed = decodeRef(ref)
        if (parsed === undefined) return ref
        // Find the full ref (pick-time meta) or degrade to the decoded stub.
        const full = parsed
        const context = await fetchRefContext(inject, full)
        signal.throwIfAborted()
        return context
      },
    },
  }

  const service = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (service === undefined) return
  ctx.effect(() => service.registerSource(source), 'ui-yzj: @ source')
  ctx.on('connection/reset', clearRefContextCache)
}
