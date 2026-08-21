/**
 * In-memory materialization: family registry, the tombstone-aware fold, and
 * the viewer-scoped read path.
 *
 * Two decisions worth naming. First, the fold is TOMBSTONE-AWARE rather than
 * strictly incremental: a tombstone may target an event already folded (even
 * one inside the snapshot), so the store recomputes from the retained event
 * list whenever one arrives. That is rare and bounded, and it is the only way
 * "correction is an append, history is never rewritten" stays true on the read
 * side too. Second, unknown event types are retained but not folded — a log
 * written by a newer build must survive a downgrade without losing lines.
 */

import {
  ORG_DEFAULT_CONTRACT, refKey,
  type GraphEvent, type GraphEventQuery, type GraphFamily, type GraphObject,
  type GraphQuery, type GraphReadHook, type GraphViewer, type JsonValue,
  type PlaceContract, type TopicHandle,
} from './types.ts'

interface ObjectRecord {
  kind: string
  id: string
  state: JsonValue
  audience?: readonly string[]
  idemKey?: string
  createdSeq: number
  updatedSeq: number
  createdAt: number
  updatedAt: number
}

/** Audience/idempotency carried alongside an event while it is being folded. */
export interface EventAnnotations {
  readonly audience?: readonly string[]
  readonly idemKey?: string
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function statusOf(state: JsonValue): string | undefined {
  if (!isRecord(state)) return undefined
  const status = state.status
  return typeof status === 'string' ? status : undefined
}

export class GraphStore {
  private readonly families = new Map<string, GraphFamily>()
  /** Event type → owning family. */
  private readonly types = new Map<string, GraphFamily>()
  private readonly readHooks = new Set<GraphReadHook>()
  private events: GraphEvent[] = []
  private objects = new Map<string, ObjectRecord>()
  private tombstoned = new Set<number>()
  /** idemKey → refKey, so a second creation through another path collapses. */
  private readonly idemIndex = new Map<string, string>()
  private foldedThrough = 0

  register(family: GraphFamily): () => void {
    if (this.families.has(family.kind)) {
      throw new Error(`graph family "${family.kind}" is already registered`)
    }
    for (const type of Object.keys(family.events)) {
      const owner = this.types.get(type)
      if (owner !== undefined) {
        throw new Error(`graph event type "${type}" is already owned by family "${owner.kind}"`)
      }
    }
    this.families.set(family.kind, family)
    for (const type of Object.keys(family.events)) this.types.set(type, family)
    // A family registered after events already landed (plugin load order, HMR)
    // must see its own history: refold rather than start blind.
    if (this.events.length > 0) this.refold()
    return () => {
      this.families.delete(family.kind)
      for (const type of Object.keys(family.events)) {
        if (this.types.get(type) === family) this.types.delete(type)
      }
    }
  }

  familyForType(type: string): GraphFamily | undefined {
    return this.types.get(type)
  }

  onRead(hook: GraphReadHook): () => void {
    this.readHooks.add(hook)
    return () => { this.readHooks.delete(hook) }
  }

  /** Seed from a load: retained events plus an optional pre-folded prefix. */
  hydrate(
    events: GraphEvent[],
    snapshot?: { upToSeq: number; objects: Record<string, GraphObject> },
  ): void {
    this.events = events
    const tombstonesBeforeSnapshot = snapshot !== undefined && events.some(event => (
      event.type === 'tombstone/appended'
      && event.seq > snapshot.upToSeq
      && targetSeqOf(event) !== undefined
      && (targetSeqOf(event) ?? 0) <= snapshot.upToSeq
    ))
    if (snapshot === undefined || tombstonesBeforeSnapshot) {
      this.refold()
      return
    }
    this.objects = new Map(Object.entries(snapshot.objects).map(([key, object]) => [key, {
      kind: object.kind,
      id: object.id,
      state: object.state,
      ...(object.audience === undefined ? {} : { audience: object.audience }),
      ...(object.idemKey === undefined ? {} : { idemKey: object.idemKey }),
      createdSeq: object.createdSeq,
      updatedSeq: object.updatedSeq,
      // Snapshots written before this field existed carry no birth time; the
      // last update is the closest honest answer, and it is never zero.
      createdAt: object.createdAt ?? object.updatedAt,
      updatedAt: object.updatedAt,
    }]))
    this.tombstoned = new Set()
    this.idemIndex.clear()
    for (const [key, object] of this.objects) {
      if (object.idemKey !== undefined) this.idemIndex.set(object.idemKey, key)
    }
    this.foldedThrough = snapshot.upToSeq
    for (const event of this.events) {
      if (event.seq > snapshot.upToSeq) this.fold(event)
    }
  }

  /** Fold one freshly appended event (already pushed onto the event list). */
  apply(event: GraphEvent): void {
    this.events.push(event)
    if (event.type === 'tombstone/appended') {
      this.refold()
      return
    }
    this.fold(event)
  }

  private refold(): void {
    this.objects = new Map()
    this.tombstoned = new Set()
    this.idemIndex.clear()
    this.foldedThrough = 0
    for (const event of this.events) {
      if (event.type !== 'tombstone/appended') continue
      const target = targetSeqOf(event)
      if (target !== undefined) this.tombstoned.add(target)
    }
    for (const event of this.events) this.fold(event)
  }

  private fold(event: GraphEvent): void {
    this.foldedThrough = Math.max(this.foldedThrough, event.seq)
    if (this.tombstoned.has(event.seq)) return
    if (event.type === 'tombstone/appended') {
      const target = targetSeqOf(event)
      if (target !== undefined) this.tombstoned.add(target)
      return
    }
    const family = this.types.get(event.type)
    // Unknown type: retained on the log, deliberately not folded.
    if (family === undefined) return
    const id = family.objectIdOf?.(event.type, event.data)
    if (id === undefined) return
    const key = refKey({ kind: family.kind, id })
    const previous = this.objects.get(key)
    const annotations = annotationsOf(event)
    const reduce = family.reduce ?? defaultReduce
    const state = reduce(previous?.state, event)
    if (state === undefined) {
      this.objects.delete(key)
      return
    }
    const record: ObjectRecord = {
      kind: family.kind,
      id,
      state,
      createdSeq: previous?.createdSeq ?? event.seq,
      updatedSeq: event.seq,
      createdAt: previous?.createdAt ?? event.time,
      updatedAt: event.time,
    }
    const audience = previous?.audience ?? annotations.audience
    if (audience !== undefined) record.audience = audience
    const idemKey = previous?.idemKey ?? annotations.idemKey
    if (idemKey !== undefined) {
      record.idemKey = idemKey
      this.idemIndex.set(idemKey, key)
    }
    this.objects.set(key, record)
  }

  /** The object already created under this idempotency anchor, when one exists. */
  findByIdemKey(idemKey: string): GraphObject | undefined {
    const key = this.idemIndex.get(idemKey)
    if (key === undefined) return undefined
    const record = this.objects.get(key)
    return record === undefined ? undefined : freeze(record)
  }

  get lastSeq(): number {
    return this.events.at(-1)?.seq ?? 0
  }

  get foldedSeq(): number {
    return this.foldedThrough
  }

  /** Every folded object, unfiltered — for snapshot writing only. */
  snapshotObjects(): Record<string, GraphObject> {
    const out: Record<string, GraphObject> = {}
    for (const [key, record] of this.objects) out[key] = freeze(record)
    return out
  }

  /** One object by ref, viewer-filtered. */
  object(viewer: GraphViewer, kind: string, id: string): GraphObject | undefined {
    const record = this.objects.get(refKey({ kind, id }))
    if (record === undefined) return undefined
    return this.filterObjects([freeze(record)], viewer)[0]
  }

  /** Raw read for state machines: no viewer filter, no read hooks. */
  rawObject(kind: string, id: string): GraphObject | undefined {
    const record = this.objects.get(refKey({ kind, id }))
    return record === undefined ? undefined : freeze(record)
  }

  query(viewer: GraphViewer, query: GraphQuery): readonly GraphObject[] {
    const kinds = query.kind === undefined
      ? undefined
      : new Set(typeof query.kind === 'string' ? [query.kind] : query.kind)
    const ids = query.ids === undefined ? undefined : new Set(query.ids)
    const statuses = query.status === undefined ? undefined : new Set(query.status)
    const matched: GraphObject[] = []
    for (const record of this.objects.values()) {
      if (kinds !== undefined && !kinds.has(record.kind)) continue
      if (ids !== undefined && !ids.has(record.id)) continue
      if (query.since !== undefined && record.updatedAt < query.since) continue
      if (statuses !== undefined) {
        const status = statusOf(record.state)
        if (status === undefined || !statuses.has(status)) continue
      }
      matched.push(freeze(record))
    }
    matched.sort((left, right) => right.updatedSeq - left.updatedSeq)
    const filtered = this.filterObjects(matched, viewer)
    return query.limit === undefined ? filtered : filtered.slice(0, query.limit)
  }

  /** Objects still waiting for an answer, per their family's declared statuses. */
  pendingAnswerables(viewer: GraphViewer): readonly GraphObject[] {
    const matched: GraphObject[] = []
    for (const record of this.objects.values()) {
      const pending = this.families.get(record.kind)?.pendingStatuses
      if (pending === undefined || pending.length === 0) continue
      const status = statusOf(record.state)
      if (status === undefined || !pending.includes(status)) continue
      matched.push(freeze(record))
    }
    matched.sort((left, right) => left.createdSeq - right.createdSeq)
    return this.filterObjects(matched, viewer)
  }

  eventsMatching(viewer: GraphViewer, query: GraphEventQuery): readonly GraphEvent[] {
    const types = query.types === undefined ? undefined : new Set(query.types)
    const matched = this.events.filter(event => (
      !this.tombstoned.has(event.seq)
      && (types === undefined || types.has(event.type))
      && (query.since === undefined || event.time >= query.since)
    ))
    const filtered = this.filterEvents(matched, viewer)
    return query.limit === undefined ? filtered : filtered.slice(-query.limit)
  }

  /** Raw event scan for kernel derivations (contracts, revocations, projections). */
  rawEvents(types: readonly string[]): readonly GraphEvent[] {
    const wanted = new Set(types)
    return this.events.filter(event => wanted.has(event.type) && !this.tombstoned.has(event.seq))
  }

  topicHandle(topicKey: string): TopicHandle | undefined {
    const record = this.objects.get(refKey({ kind: 'topic', id: topicKey }))
    if (record === undefined || !isRecord(record.state)) return undefined
    const state = record.state
    const placeKey = typeof state.placeKey === 'string' ? state.placeKey : undefined
    if (placeKey === undefined) return undefined
    const text = (key: string): Record<string, string> => {
      const value = state[key]
      return typeof value === 'string' && value !== '' ? { [key]: value } : {}
    }
    return {
      topicKey,
      placeKey,
      generation: typeof state.generation === 'number' ? state.generation : 1,
      label: typeof state.label === 'string' ? state.label : '',
      ...text('topicRootId'),
      ...text('groupId'),
      ...text('groupName'),
    }
  }

  contractFor(placeKey: string): PlaceContract {
    let contract: PlaceContract = { placeKey, ...ORG_DEFAULT_CONTRACT }
    for (const event of this.rawEvents(['contract/updated'])) {
      const data = event.data
      if (!isRecord(data) || data.placeKey !== placeKey) continue
      contract = {
        placeKey,
        version: typeof data.version === 'number' ? data.version : contract.version,
        oaRequiredCategories: Array.isArray(data.oaRequiredCategories)
          ? data.oaRequiredCategories.filter((value): value is string => typeof value === 'string')
          : contract.oaRequiredCategories,
        memoryPolicy: data.memoryPolicy === 'never' || data.memoryPolicy === 'facts-only'
          ? data.memoryPolicy
          : 'normal',
        processSummary: typeof data.processSummary === 'boolean'
          ? data.processSummary
          : contract.processSummary,
      }
    }
    return contract
  }

  isRevoked(messageId: string): boolean {
    return this.rawEvents(['authority/revoked']).some(event => (
      isRecord(event.data) && event.data.messageId === messageId
    ))
  }

  private filterObjects(objects: readonly GraphObject[], viewer: GraphViewer): readonly GraphObject[] {
    let visible = objects.filter(object => audienceAllows(object.audience, viewer))
    for (const hook of this.readHooks) {
      if (hook.objects !== undefined) visible = [...hook.objects(visible, viewer)]
    }
    return visible
  }

  private filterEvents(events: readonly GraphEvent[], viewer: GraphViewer): readonly GraphEvent[] {
    let visible = [...events]
    for (const hook of this.readHooks) {
      if (hook.events !== undefined) visible = [...hook.events(visible, viewer)]
    }
    return visible
  }
}

/**
 * audience × viewer bridge (§4, v2.5 F20). A place viewer sees only what was
 * spoken into that place; the operator sees their whole partition. An object
 * with NO declared audience was never spoken into a place, so a place viewer
 * does not see it — the conservative direction, since the failure mode on the
 * other side is speaking a private fact into a group.
 */
function audienceAllows(audience: readonly string[] | undefined, viewer: GraphViewer): boolean {
  if (viewer.kind === 'operator') return true
  if (audience === undefined) return false
  return audience.includes(viewer.placeKey)
}

function defaultReduce(previous: JsonValue | undefined, event: GraphEvent): JsonValue {
  const base = isRecord(previous) ? previous : {}
  const next = isRecord(event.data) ? event.data : {}
  return { ...base, ...next }
}

/**
 * `audience` and `idemKey` are FIELDS on the object's own opening event, not a
 * separate envelope (§4 "幂等锚 idemKey 是字段不是事件"). The kernel reads them
 * generically so every family gets the same collapse and visibility semantics
 * without the kernel knowing any family's shape.
 */
function annotationsOf(event: GraphEvent): EventAnnotations {
  const data = event.data
  if (!isRecord(data)) return {}
  const audience = Array.isArray(data.audience)
    ? data.audience.filter((value): value is string => typeof value === 'string')
    : undefined
  const idemKey = typeof data.idemKey === 'string' ? data.idemKey : undefined
  return {
    ...(audience === undefined ? {} : { audience }),
    ...(idemKey === undefined ? {} : { idemKey }),
  }
}

function targetSeqOf(event: GraphEvent): number | undefined {
  const data = event.data
  if (!isRecord(data)) return undefined
  return typeof data.targetSeq === 'number' ? data.targetSeq : undefined
}

function freeze(record: ObjectRecord): GraphObject {
  return {
    kind: record.kind,
    id: record.id,
    state: record.state,
    ...(record.audience === undefined ? {} : { audience: record.audience }),
    ...(record.idemKey === undefined ? {} : { idemKey: record.idemKey }),
    createdSeq: record.createdSeq,
    updatedSeq: record.updatedSeq,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
