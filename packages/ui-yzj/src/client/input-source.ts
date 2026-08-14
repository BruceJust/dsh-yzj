/**
 * The 云之家 '@' trigger sources (design v1.6 §5.2, journey 5): three menu
 * groups — 同事 (directory search, order 0), 会话 (recent sessions, order 1),
 * 文档 (knowledge-base docs, order 2) — plus the '云之家' carrier source whose
 * codec serves drag-and-drop chips. A pick inserts a reference chip; on send
 * the codec's serialize() emits the fetched context block so the agent
 * receives real substance (excerpts, times, recent messages) — not just a
 * title.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerSource, ReferenceCodec, ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/src/types.ts'
import type { YzjPanelInject } from './rpc.ts'
import type { YzjDragRef } from './panel.tsx'
import { clearRefContextCache, fetchRefContext } from './context.ts'

/** Compact ref string persisted with the chip (lossless JSON payload). */
export function encodeRef(ref: YzjDragRef): string {
  return `yzj:${JSON.stringify({ kind: ref.kind, id: ref.id, title: ref.title, url: ref.url, sub: ref.sub, group: ref.group })}`
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
    if (typeof parsed.group === 'string' && parsed.group !== '') ref.group = parsed.group
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

/** Menu group names for the three candidate sets (journey 5 ordering). */
export const SOURCE_CONTACTS = '云之家 · 同事'
export const SOURCE_GROUPS = '云之家 · 会话'
export const SOURCE_DOCS = '云之家 · 文档'

const KIND_ICON: Record<YzjDragRef['kind'], string> = {
  workspace: '📚', doc: '📄', group: '💬', event: '📅', contact: '👤', message: '✉️',
}

/** Session cache of warm catalog data + pick-time ref metadata. */
interface YzjSourceCache {
  warm: Promise<void> | null
  workspaces: unknown[]
  groups: unknown[]
  docs: unknown[]
  /** Candidate display name → ref. */
  byName: Map<string, YzjDragRef>
  /** Encoded ref string → full ref (survives pick but not reload). */
  byRef: Map<string, YzjDragRef>
}

const caches = new Map<string, YzjSourceCache>()

/** Drop every session cache (used on connection/reset and in tests). */
export function clearYzjSourceCaches(): void {
  caches.clear()
}

function cacheOf(sessionId: string): YzjSourceCache {
  let cache = caches.get(sessionId)
  if (cache === undefined) {
    cache = { warm: null, workspaces: [], groups: [], docs: [], byName: new Map(), byRef: new Map() }
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

/** Warm the catalog once per session: workspaces + recent groups + first-level docs. */
function ensureWarm(cache: YzjSourceCache, inject: YzjPanelInject): Promise<void> {
  if (cache.warm !== null) return cache.warm
  cache.warm = Promise.all([
    inject.fetchWorkspaces().then((result) => {
      if (result.ok) cache.workspaces = asArray(result.value)
    }).catch(() => {}),
    inject.fetchGroups(20).then((result) => {
      if (result.ok) cache.groups = asArray(asRecord(result.value).list)
    }).catch(() => {}),
  ]).then(() => {
    // Docs come from the first three workspaces' first level (bounded warm).
    const roots = cache.workspaces.slice(0, 3)
    return Promise.all(roots.map(workspace =>
      inject.fetchDocs(asString(asRecord(workspace).id)).then((result) => {
        if (result.ok) cache.docs = [...cache.docs, ...asArray(result.value)]
      }).catch(() => {}),
    ))
  }).then(() => {})
  return cache.warm
}

/** Register one candidate (name-unique within the session) and its ref. */
function pushCandidate(
  cache: YzjSourceCache,
  out: InputTriggerCandidate[],
  name: string,
  description: string,
  icon: string,
  ref: YzjDragRef,
): void {
  if (cache.byName.has(name)) return
  cache.byName.set(name, ref)
  cache.byRef.set(encodeRef(ref), ref)
  out.push({ name, description, icon })
}

/** 同事: directory hits; requires a query (scoped to what the user can see). */
function contactCandidates(cache: YzjSourceCache, query: string, inject: YzjPanelInject): Promise<InputTriggerCandidate[]> {
  const q = query.trim()
  if (q === '') return Promise.resolve([])
  return inject.fetchSearch(q).then((result) => {
    const out: InputTriggerCandidate[] = []
    if (result.ok) {
      for (const item of asArray(result.value)) {
        const user = asRecord(item)
        const name = asString(user.name)
        if (name === '') continue
        const sub = [asString(user.department), asString(user.jobTitle)].filter(part => part !== '').join(' · ')
        pushCandidate(cache, out, name, `👤 ${sub === '' ? '联系人' : sub}（仅你有权查看的范围）`, KIND_ICON.contact,
          { kind: 'contact', id: asString(user.oId ?? user.openId), title: name })
      }
    }
    return out
  })
}

/** 会话: recent sessions from the warm snapshot, filtered by query. */
function groupCandidates(cache: YzjSourceCache, query: string): InputTriggerCandidate[] {
  const q = query.trim().toLowerCase()
  const out: InputTriggerCandidate[] = []
  for (const item of cache.groups) {
    const group = asRecord(item)
    const name = asString(group.groupName)
    if (name === '') continue
    if (q !== '' && !name.toLowerCase().includes(q)) continue
    const unread = typeof group.unreadCount === 'number' ? group.unreadCount : 0
    pushCandidate(cache, out, name, `💬 会话${unread > 0 ? ` · 未读 ${unread}` : ''}`, KIND_ICON.group,
      { kind: 'group', id: asString(group.groupId), title: name })
  }
  return out
}

/** 文档: knowledge-base docs from the warm snapshot, filtered by query. */
function docCandidates(cache: YzjSourceCache, query: string): InputTriggerCandidate[] {
  const q = query.trim().toLowerCase()
  const out: InputTriggerCandidate[] = []
  for (const item of cache.docs) {
    const node = asRecord(item)
    const title = asString(node.title)
    if (title === '') continue
    if (q !== '' && !title.toLowerCase().includes(q)) continue
    const suffix = asString(node.fileSuffix)
    const kindText = suffix === 'dbt' ? '多维表格' : '文档'
    const updated = asString(node.updateTime).slice(0, 10)
    pushCandidate(cache, out, title, `📄 ${kindText}${updated === '' ? '' : ` · 更新 ${updated}`}`, KIND_ICON.doc,
      { kind: 'doc', id: asString(node.id), title })
  }
  return out
}

/** Insert payload for one ref. `source` must equal the registered source name. */
function insertFor(source: string, ref: YzjDragRef): ReferenceInsert {
  return {
    source,
    ref: encodeRef(ref),
    label: `☁ ${ref.title}`,
    clipboardText: `【云之家·${KIND_LABEL[ref.kind]}】${ref.title}`,
  }
}

/** Shared codec: serializes any yzj ref into its fetched context block. */
function sharedCodec(inject: YzjPanelInject): ReferenceCodec {
  return {
    clipboardText: (ref) => {
      const parsed = decodeRef(ref)
      return parsed === undefined ? ref : `【云之家·${KIND_LABEL[parsed.kind]}】${parsed.title}`
    },
    serialize: async (ref, signal) => {
      const parsed = decodeRef(ref)
      if (parsed === undefined) return ref
      const context = await fetchRefContext(inject, parsed)
      signal.throwIfAborted()
      return context
    },
  }
}

/** The shared pick handler for every source. */
function sharedOnPick(source: string): InputTriggerSource['onPick'] {
  return ({ candidate, session }) => {
    const ref = cacheOf(session.sessionId).byName.get(candidate.name)
    if (ref === undefined) return undefined
    return { insert: insertFor(source, ref) }
  }
}

/** Build the four '@' sources (three candidate groups + the codec carrier). */
export function createYzjSources(inject: YzjPanelInject): InputTriggerSource[] {
  const codec = sharedCodec(inject)
  const onPick = sharedOnPick
  return [
    {
      trigger: '@',
      name: SOURCE_CONTACTS,
      order: 0,
      candidates: (session, req) => contactCandidates(cacheOf(session.sessionId), req.query, inject),
      onPick: onPick(SOURCE_CONTACTS),
      codec,
    },
    {
      trigger: '@',
      name: SOURCE_GROUPS,
      order: 1,
      warm(session: ClientSessionContext) {
        void ensureWarm(cacheOf(session.sessionId), inject)
      },
      candidates: (session, req) => {
        const cache = cacheOf(session.sessionId)
        if (cache.warm !== null) return cache.warm.then(() => groupCandidates(cache, req.query))
        return Promise.resolve(groupCandidates(cache, req.query))
      },
      onPick: onPick(SOURCE_GROUPS),
      codec,
    },
    {
      trigger: '@',
      name: SOURCE_DOCS,
      order: 2,
      warm(session: ClientSessionContext) {
        void ensureWarm(cacheOf(session.sessionId), inject)
      },
      candidates: (session, req) => {
        const cache = cacheOf(session.sessionId)
        if (cache.warm !== null) return cache.warm.then(() => docCandidates(cache, req.query))
        return Promise.resolve(docCandidates(cache, req.query))
      },
      onPick: onPick(SOURCE_DOCS),
      codec,
    },
    {
      // Carrier source: empty candidate set (the menu hides it), exists so
      // drag-and-drop chips keep a registered codec under SOURCE_NAME.
      trigger: '@',
      name: SOURCE_NAME,
      order: 9,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      codec,
    },
  ]
}

/** Register the three candidate groups plus the codec carrier source. */
export function applyYzjAtSource(ctx: ClientContext, inject: YzjPanelInject): void {
  const service = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (service === undefined) return
  const sources = createYzjSources(inject)
  ctx.effect(() => {
    const disposers = sources.map(source => service.registerSource(source))
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-yzj: @ sources')
  ctx.on('connection/reset', () => { clearRefContextCache(); clearYzjSourceCaches() })
}
