/**
 * The kernel's own event vocabulary — the "三类边 + 三语义字段" the design
 * froze in v4.4 (§5.5) and the technical plan pinned in §4. Object families
 * (approval / waiting / task / commitment) merge their own families on top;
 * everything here is either an edge no single object owns, or a cross-cutting
 * semantic field.
 *
 * The classification is load-bearing, not decorative: BIRTH edges record what
 * came into being, RETURN edges record what came back (§1.8 回程律 — a return
 * edge unrecorded at its moment is lost exactly like a birth edge), and the
 * ENVIRONMENT snapshot slices by moment rather than by object (§1.9-5).
 */

import { z } from 'zod'
import type { GraphEvent, GraphFamily, JsonValue } from './types.ts'

/**
 * A reference to something whose real body lives outside the graph. `placeKey`
 * is mandatory (TD-15): crossing detection cannot exist without knowing which
 * place an artifact came from.
 */
export const artifactRef = z.object({
  uri: z.string().min(1),
  placeKey: z.string().min(1),
  kind: z.string().optional(),
  title: z.string().optional(),
  version: z.string().optional(),
})

const objectRef = z.object({ kind: z.string().min(1), id: z.string().min(1) })

/** Shallow-merge fold used by families that keep a plain record state. */
function mergeReduce(previous: JsonValue | undefined, event: GraphEvent): JsonValue {
  const base = typeof previous === 'object' && previous !== null && !Array.isArray(previous)
    ? previous
    : {}
  const next = typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data)
    ? event.data
    : {}
  return { ...base, ...next }
}

/** Read one string field out of an event payload. */
function field(data: JsonValue, name: string): string | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const value = (data as Record<string, JsonValue>)[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

// ---------------------------------------------------------------------------
// Birth edges (六) — objects and relations coming into being.
// ---------------------------------------------------------------------------

/** 出生⑤ 会话边界. Also the object family behind `topicHandle()`. */
const topicFamily: GraphFamily = {
  kind: 'topic',
  events: {
    'topic/registered': {
      schema: z.object({
        topicKey: z.string().min(1),
        placeKey: z.string().min(1),
        conversationKind: z.enum(['group', 'direct']),
        generation: z.number().int().min(1),
        label: z.string(),
        // The anchor the boundary is FOUND by, kept because a projection has
        // to be able to walk back from a session to the conversation it is a
        // window onto. Without it "one topic, one window" is a claim the data
        // cannot support: the view could render the trajectory but never the
        // messages beside it.
        topicRootId: z.string().optional(),
        groupId: z.string().optional(),
        groupName: z.string().optional(),
      }),
    },
    'topic/generation-advanced': {
      schema: z.object({ topicKey: z.string().min(1), generation: z.number().int().min(1) }),
    },
    'topic/relabeled': {
      schema: z.object({ topicKey: z.string().min(1), label: z.string() }),
    },
  },
  objectIdOf: (_type, data) => field(data, 'topicKey'),
  reduce: mergeReduce,
}

/** 出生① 血缘. Pure edges: the artifact's real body lives in Yunzhijia. */
const lineageFamily: GraphFamily = {
  kind: 'lineage',
  events: {
    'lineage/produced': {
      schema: z.object({
        topicKey: z.string().min(1),
        artifact: artifactRef,
        action: z.string().min(1),
        toolName: z.string().optional(),
        taskId: z.string().optional(),
      }),
    },
    'lineage/derived': {
      schema: z.object({
        from: artifactRef,
        to: artifactRef,
        via: z.string().optional(),
      }),
    },
  },
}

/** 出生② 越境审计. P1's producer is `/handoff` (WP7/WP8). */
const crossingFamily: GraphFamily = {
  kind: 'crossing',
  events: {
    'crossing/recorded': {
      schema: z.object({
        fromPlaceKey: z.string().min(1),
        toPlaceKey: z.string().min(1),
        issuedBy: z.string().min(1),
        summary: z.string(),
        artifacts: z.array(artifactRef).default([]),
        topicKey: z.string().optional(),
      }),
    },
  },
}

/**
 * 出生③ 蒸馏来源. No producer before P3; `sourceAnchors` is locked into the
 * schema now precisely because a distillation whose source was not recorded
 * at write time can never be traced back afterwards.
 */
const memoryFamily: GraphFamily = {
  kind: 'memory',
  events: {
    'memory/distilled': {
      schema: z.object({
        memoryId: z.string().min(1),
        axis: z.enum(['place', 'entity', 'org']),
        sourceAnchors: z.array(z.string().min(1)).min(1),
        summary: z.string(),
        /** The place/entity/org this holds for — the axis's coordinate. */
        scope: z.string().optional(),
        /**
         * The listener set the lesson was learned in front of. Without it a
         * place viewer sees nothing (F20 fails closed) — which is the correct
         * default, and the reason a place-axis memory must always carry one:
         * a convention learned in one group must not be quotable in another.
         */
        audience: z.array(z.string()).optional(),
        status: z.literal('live').default('live'),
      }),
    },
    /**
     * Memory has to be able to DIE. A store that only grows is one a person
     * stops trusting the first time it repeats something that stopped being
     * true — and correction here is an append like everywhere else, so the
     * distillation and the reason it was dropped both stay on the record.
     */
    'memory/forgotten': {
      schema: z.object({
        memoryId: z.string().min(1),
        reason: z.string().optional(),
        status: z.literal('forgotten').default('forgotten'),
      }),
    },
  },
  objectIdOf: (_type, data) => field(data, 'memoryId'),
  reduce: mergeReduce,
}

// ---------------------------------------------------------------------------
// Return edges (五) — §1.8. Same rank as birth edges: unrecorded is lost.
// ---------------------------------------------------------------------------

/**
 * 回流① 回执登记. `proposedChange` applies IMMEDIATELY as a state event and
 * the acknowledgement carries an undo entry (v2.5): correction-by-append, no
 * suspended "proposed" limbo.
 */
const receiptFamily: GraphFamily = {
  kind: 'receipt',
  events: {
    'receipt/recorded': {
      schema: z.object({
        objectRef,
        kind: z.enum(['human-reply', 'external', 'approval-credential']),
        anchor: z.string().min(1),
        text: z.string().optional(),
        proposedChange: z.record(z.string(), z.unknown()).optional(),
      }),
    },
  },
}

/**
 * 回流④ 冲突对撞 (A1's estranged twin). Flagged by the agent inside the turn
 * that consumes the queued steering — the P1 degraded form of design-level
 * "system detects it"; misses fall back to old-world behaviour (H18).
 */
const conflictFamily: GraphFamily = {
  kind: 'conflict',
  events: {
    'conflict/flagged': {
      schema: z.object({
        conflictId: z.string().min(1),
        topicKey: z.string().min(1),
        inflightAnchor: z.string().min(1),
        incomingAnchor: z.string().min(1),
        note: z.string(),
        status: z.literal('flagged').default('flagged'),
        /**
         * 这次暂停发生在谁面前。
         *
         * 冲突卡是**明确投到工作发生的那个场所**的（「冲突要被造成它的人看见」），
         * 可这个字段此前不存在——于是对象自己说「我没被说进任何场所」，而群里明明
         * 躺着那张卡。两句话对不上的后果不抽象：群视图问「这个话题欠着什么」时，
         * 隔离函数如实答「什么都没有」，一件已经把活停在半路的事在群里没有任何徽标。
         */
        audience: z.array(z.string()).optional(),
      }),
    },
    'conflict/resolved': {
      schema: z.object({
        conflictId: z.string().min(1),
        resolution: z.enum(['continue', 'cancel']),
        by: z.string().min(1),
        status: z.literal('resolved').default('resolved'),
      }),
    },
  },
  pendingStatuses: ['flagged'],
  objectIdOf: (_type, data) => field(data, 'conflictId'),
  reduce: mergeReduce,
}

/**
 * 回流⑤ 真身之变 (§1.9-4). Recorded at the consumption-time check: a broken
 * link becomes visible, is never silently re-pointed, and is refilled by hand
 * through `/link`. Before webhooks exist this IS the P1 form.
 */
const truthFamily: GraphFamily = {
  kind: 'truth',
  events: {
    'truth/changed': {
      schema: z.object({
        ref: artifactRef,
        kind: z.enum(['missing', 'changed', 'stale']),
        observedAt: z.number().int(),
        detail: z.string(),
      }),
    },
  },
}

// ---------------------------------------------------------------------------
// Environment snapshot (第三类边) — §1.9-5, sliced by MOMENT not by object.
// ---------------------------------------------------------------------------

/**
 * "What authority/judgement was this turn standing on." Written lazily at the
 * turn's first Yunzhijia resource consumption, at most once per turn (§4
 * v2.5 write point), which covers IM-triggered and desktop-originated turns
 * alike. In P1 the live payload is `contractVersion` + `fedReferenceIds`;
 * the lease and memory slots are reserved and empty.
 */
const envFamily: GraphFamily = {
  kind: 'env',
  events: {
    'env/snapshot': {
      schema: z.object({
        sessionAnchor: z.string().min(1),
        contractVersion: z.number().int().min(0),
        activeLeaseIds: z.array(z.string()).default([]),
        injectedMemoryIds: z.array(z.string()).default([]),
        fedReferenceIds: z.array(z.string()).default([]),
      }),
    },
  },
}

// ---------------------------------------------------------------------------
// Semantic fields (三) — §1.9 data laws 2 / 3 / 7.
// ---------------------------------------------------------------------------

/**
 * 应答序 (先答先赢律). EVERY `act()` appends one, win or lose: the state
 * machine decides which answer takes effect, and the losing or duplicate
 * answer is still evidence that somebody answered.
 */
const answerFamily: GraphFamily = {
  kind: 'answer',
  events: {
    'answer/recorded': {
      schema: z.object({
        cardRef: objectRef,
        actionId: z.string().min(1),
        actor: z.string().min(1),
        via: z.string().min(1),
        outcome: z.enum(['applied', 'superseded', 'duplicate', 'unauthorized']),
        detail: z.string().optional(),
      }),
    },
  },
}

/**
 * 墓碑 (更正即追加律). The materializer folds the target event away; history
 * is never rewritten. Compliance erasure = the projection is masked while the
 * real body is retained (the sole exception being a never-remember place).
 */
const tombstoneFamily: GraphFamily = {
  kind: 'tombstone',
  events: {
    'tombstone/appended': {
      schema: z.object({
        targetSeq: z.number().int().min(1),
        reason: z.string(),
        by: z.string().min(1),
      }),
    },
  },
}

// ---------------------------------------------------------------------------
// Runtime families the kernel owns.
// ---------------------------------------------------------------------------

/**
 * Turn-level authority revocation. It lives here — not in the DSH Session log
 * — because the host's cold-read whitelist rejects unknown event types (F4),
 * and it is read live on every guarded call rather than from a turn snapshot
 * (§5.3 "撤销类硬项穿透快照").
 */
const authorityFamily: GraphFamily = {
  kind: 'authority',
  events: {
    'authority/revoked': {
      schema: z.object({ messageId: z.string().min(1), reason: z.string() }),
    },
  },
}

/** Place contract updates. P1 writes none; the read path is live from day one. */
const contractFamily: GraphFamily = {
  kind: 'contract',
  events: {
    'contract/updated': {
      schema: z.object({
        placeKey: z.string().min(1),
        version: z.number().int().min(1),
        oaRequiredCategories: z.array(z.string()).default([]),
        memoryPolicy: z.enum(['normal', 'facts-only', 'never']),
        processSummary: z.boolean(),
      }),
    },
  },
}

/**
 * Where a card has been rendered. EVERY message fragment is registered, so an
 * answer anchored to any one of them resolves (§3.1); the terminal echo is
 * posted back to every registered text surface.
 */
const cardFamily: GraphFamily = {
  kind: 'card',
  events: {
    'card/projected': {
      schema: z.object({
        cardRef: objectRef,
        surface: z.string().min(1),
        msgAnchors: z.array(z.string().min(1)).default([]),
        placeKey: z.string().optional(),
      }),
    },
  },
}

/** Every family the kernel itself contributes. */
export const KERNEL_FAMILIES: readonly GraphFamily[] = [
  topicFamily, lineageFamily, crossingFamily, memoryFamily,
  receiptFamily, conflictFamily, truthFamily,
  envFamily,
  answerFamily, tombstoneFamily,
  authorityFamily, contractFamily, cardFamily,
]
