/**
 * Public contracts of the conversation-graph kernel. The kernel is the sole
 * home of product-level facts (technical plan §4 / TD-1): DSH Session logs
 * keep turn-level facts under the host's own whitelisted vocabulary, and this
 * log keeps everything the product owns. Nothing here knows Yunzhijia exists —
 * the kernel receives anchors and events, never a transport.
 */

/** Envelope version of one graph log line. Bumped only for envelope changes. */
export const GRAPH_ENVELOPE_VERSION = 1

/** Lossless JSON, the only shape a graph event may carry. */
export type JsonValue =
  | string | number | boolean | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Who caused one event. `openId` is the Yunzhijia-side person when there is one. */
export interface GraphActor {
  readonly kind: 'operator' | 'agent' | 'system' | 'person'
  readonly openId?: string
}

/**
 * One append-only log line. `sv` is the EVENT FAMILY schema version, not the
 * envelope version (TD-15): the log outlives every plugin build, so schema
 * tightening binds writes only and the read path decodes leniently.
 */
export interface GraphEvent<D = JsonValue> {
  readonly v: typeof GRAPH_ENVELOPE_VERSION
  readonly sv: number
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: D
  readonly actor: GraphActor
}

/**
 * Who is asking. Bound by the orchestrator from the turn's message source and
 * NEVER a model-facing tool parameter (§4.1 / TD-7'): a model that could pass
 * `operator` would read cross-place facts and speak them into a group.
 */
export type GraphViewer =
  | { readonly kind: 'operator'; readonly openId: string }
  | { readonly kind: 'place'; readonly placeKey: string }

/** Address of one materialized object. */
export interface ObjectRef {
  readonly kind: string
  readonly id: string
}

/** Render one ref as its flat map key. */
export function refKey(ref: ObjectRef): string {
  return `${ref.kind}:${ref.id}`
}

/**
 * One materialized object: the fold of its own events, plus the two
 * cross-cutting semantic fields the kernel owns (§4 "三语义字段").
 */
export interface GraphObject<S = JsonValue> {
  readonly kind: string
  readonly id: string
  readonly state: S
  /**
   * The listener set this object inherits from the utterance that registered
   * it (v4.4). Place keys or openIds, NEVER expanded into members — equality
   * matching keeps the kernel free of any organization-directory dependency.
   */
  readonly audience?: readonly string[]
  /** Idempotency anchor; same anchor collapses onto the same object. */
  readonly idemKey?: string
  readonly createdSeq: number
  readonly updatedSeq: number
  /** When the object came into being. What a timeline sorts a card by. */
  readonly createdAt: number
  readonly updatedAt: number
}

/** Declaration of one event type inside a family. */
export interface GraphEventSpec {
  /** Family schema version stamped onto writes of this type. Defaults to 1. */
  readonly sv?: number
  /** Validator applied to `data` on write. Reads never re-validate. */
  readonly schema: { parse(value: unknown): unknown }
}

/**
 * One object family's registration on the graph surface — the first of the
 * four registration points an object family implements (§2). A family with no
 * `objectIdOf` contributes pure edges (lineage, crossing, …) that are queried
 * as events rather than folded into objects.
 */
export interface GraphFamily<S = JsonValue> {
  /** Object kind these events address, e.g. `approval`. */
  readonly kind: string
  /** Event type → declaration. Type names are globally unique across families. */
  readonly events: Readonly<Record<string, GraphEventSpec>>
  /** Statuses that mean "this object is still waiting for an answer". */
  readonly pendingStatuses?: readonly string[]
  /** Object addressed by one event, or undefined when the event is a pure edge. */
  objectIdOf?(type: string, data: JsonValue): string | undefined
  /**
   * Fold one event onto the previous state. Returning `undefined` drops the
   * object (never used in P1 — the tombstone rule replaces deletion).
   * Defaults to a shallow merge of `data` onto the previous state.
   */
  reduce?(previous: S | undefined, event: GraphEvent): S | undefined
}

/** Object query. Every field narrows; omitted fields do not filter. */
export interface GraphQuery {
  readonly kind?: string | readonly string[]
  readonly ids?: readonly string[]
  /** Matches `state.status` when the family keeps one. */
  readonly status?: readonly string[]
  /** Only objects updated at or after this epoch millisecond. */
  readonly since?: number
  /** Newest-first cap. */
  readonly limit?: number
}

/** Event (edge) query, for lineage/crossing/audit reads. */
export interface GraphEventQuery {
  readonly types?: readonly string[]
  readonly since?: number
  readonly limit?: number
}

/**
 * Read-domain filter (§4). Every query and every derived export passes through
 * the hook chain, so a place contract that declares "never remember" can
 * collapse its own reachable domain. In P1 the single org-default contract
 * makes this a pass-through — but the hook must sit on the read path from day
 * one, because a bypass added later is a bypass that already leaked.
 */
export interface GraphReadHook {
  objects?(objects: readonly GraphObject[], viewer: GraphViewer): readonly GraphObject[]
  events?(events: readonly GraphEvent[], viewer: GraphViewer): readonly GraphEvent[]
}

/** Place contract, read at every guard decision (§5.3). P1 is a single org default. */
export interface PlaceContract {
  readonly placeKey: string
  /** Monotonic version recorded into `env/snapshot` so authority is auditable. */
  readonly version: number
  /**
   * Action categories that must travel the organization's own approval rail.
   * A hit is denied outright — a local card must never manufacture the
   * appearance of organizational permission (TD-5). Empty in P1.
   */
  readonly oaRequiredCategories: readonly string[]
  /** Memory policy (C5). Hard contract item: `never` is revocation-class. */
  readonly memoryPolicy: 'normal' | 'facts-only' | 'never'
  /** Whether non-trivial tasks post a transparency summary to the place (A4). */
  readonly processSummary: boolean
}

/** The org-wide default every place inherits until a contract is written. */
export const ORG_DEFAULT_CONTRACT: Omit<PlaceContract, 'placeKey'> = {
  version: 0,
  oaRequiredCategories: [],
  memoryPolicy: 'normal',
  processSummary: true,
}

/** Topic handle: the durable identity of one conversation boundary (A0). */
export interface TopicHandle {
  readonly topicKey: string
  readonly placeKey: string
  readonly generation: number
  readonly label: string
  /** The message the boundary is anchored on; `direct` for a private chat. */
  readonly topicRootId?: string
  readonly groupId?: string
  readonly groupName?: string
}

/**
 * One append request. `seq`/`time`/`sv` are kernel-assigned.
 *
 * `audience` and `idemKey` are NOT envelope fields: a family that needs them
 * declares them on its own opening event's schema and the kernel reads them
 * from `data` (§4). The idempotency anchor is always computed by the
 * orchestrator or the family state machine — never passed in by the model
 * (§4 "幂等锚计算铁律" / F21), because model-side dedup keys are unreliable.
 */
export interface GraphAppendInput<D = JsonValue> {
  readonly type: string
  readonly data: D
  readonly actor: GraphActor
}
