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

/**
 * 回流③的目标那一支：状态回写真身 (v4.9「同一条边两个听众」).
 *
 * 一条委派有**两个听众，两种刷新率**：操作者看承诺板的实时信号；而全组看的是云之家
 * 上那份目标文档。板上活着不等于组里知道——设计的原话是「回写只在生与死」，因为把
 * 每一次进度都推回文档，就是把一份共读的文档变成一条日志流。
 *
 * 这一族记的是**我们已经写过哪一笔**：一次写回一条记录，重启不重写。没有它，重启
 * 扫一遍就会把同一条子承诺往文档里再贴一行——而那份文档是全组在读的。
 */
const writebackFamily: GraphFamily = {
  kind: 'goal-writeback',
  events: {
    'goal/written-back': {
      schema: z.object({
        /** `${goalRef}#${commitmentId}#${moment}` —— 每个时刻各记各的。 */
        writebackId: z.string().min(1),
        goalRef: z.string().min(1),
        commitmentId: z.string().min(1),
        /**
         * 生 / 逾期 / 死。
         *
         * `overdue` 是 v3.14r③ 加的**一次标注**——逾期不是终态（勿写脏状态机），它是
         * 这条边活着的时候多出来的一句话。它必须在这个枚举里，否则那条 `written-back`
         * 落不了库，而**幂等就是靠这条记录成立的**：写过的不再写。实测撞到过——同一行
         * 「已逾期」往一份全组在读的文档里贴了两遍。
         */
        moment: z.enum(['born', 'overdue', 'settled']),
        /** 写进去的那句话，原样留底：文档会被人改，我们写过什么不该跟着变。 */
        line: z.string(),
        /**
         * 写成了没有。
         *
         * 失败也要落一条——**不落的话，重启扫一遍会重试，而重试没有上限**。更要紧的
         * 是「组里到底知不知道」这件事得有答案：板上说「已回写」而文档里什么都没有，
         * 是幽灵承诺换了个通道复活。
         */
        status: z.enum(['written', 'failed']),
        detail: z.string().optional(),
      }),
    },
    /**
     * 回写从哪一条日志开始负责 —— 一道水位，只落一次。
     *
     * 没有它，重启补账会把全部历史倒进真实的目标文档；那些文档是同事在读的，
     * 一条三个月前就关掉的承诺今天补一行进去不是修复，是噪音。
     */
    'goal/writeback-began': {
      schema: z.object({
        writebackId: z.string().default('__waterline__'),
        atSeq: z.number().int().min(0),
      }),
    },
  },
  objectIdOf: (_type, data) => field(data, 'writebackId'),
  reduce: mergeReduce,
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
        /**
         * 这个场所是**怎么出生的** (设计 v4.18 场所创设三句，零新族).
         *
         * 此前这一族只回答「合同是什么」，不回答「合同怎么出生」——agent 拿到建群能力
         * 之前那是个无害的空白，之后它就是个危险的空白。三句里的两句落在这个字段上：
         *
         * - **出生血缘携带语境**：从一个目标/一条承诺的语境里建出来的群，`sourceAnchor`
         *   记着那句话，`inheritedGoalRef` 记着它继承的挂接——语境继承的场所版。少了它，
         *   一个专门为某个目标开的群，第二天没有任何地方说得清它为什么存在。
         * - **合同默认最严**：新场所 agent **不在岗、不接单**，须显式开启。这一条的运行态
         *   真相不在这里——在通道的 `allowedGroupIds`（单一事实源，别在图上再存一份
         *   `served` 造第二本账）；这里记的是「它出生时是不是被同时接入了」，那是**签发
         *   卡上那一次勾选**留下的痕迹，回头审计要靠它。
         *
         * `inheritedGoalRef` 的投影遵循既有可见域规则：这个场所看不见那个目标的正文时，
         * 只显示链接、不显示名字。
         */
        birth: z.object({
          sourceAnchor: z.string().min(1),
          inheritedGoalRef: z.string().optional(),
          servedAtBirth: z.boolean().default(false),
        }).optional(),
      }),
    },
    /**
     * **谁把 agent 接进了这个群，什么时候** (v3.15 裁决⑤).
     *
     * 运行态的真相仍然在通道的 `allowedGroupIds`（单一事实源，图上不存第二份
     * `served`）——这一族记的是**那个动作**，不是那个状态。方向是单向的：动作 → 图事件
     * → 物化到通道 config，所以它不是第二本账，是那本账的**流水**。
     *
     * 为什么值得记：接单 = 让 agent 听见这个群里的每一句话，是一次**听众敏感的主权
     * 动作**。而此前它只在一个 JSON 里留下一个布尔——回头问「谁把它接进这个群的、什么
     * 时候」，答案是没有答案。一个改变触达面的决定，不该只剩下一个当前值。
     */
    'contract/served': {
      schema: z.object({
        placeKey: z.string().min(1),
        /** 接入还是移出。两个方向都记——「明确关掉」和「从没提过」是两回事。 */
        served: z.boolean(),
        /** 群名，为了让审计读得懂：placeKey 是个 id，人记不住哪个群是哪个。 */
        groupName: z.string().optional(),
        /**
         * 触发者范围 (决策 #63, v3.23r 精确化).
         *
         * `all` = **对群在岗**：接受全群委派——把自己的账号与授权借给这个群，是身份/听众
         * 敏感的主权动作，切开即向群发一次在岗声明帖；`self` = **仅本人**：只应答自己的
         * 操作者，与他人天然无冲突，不声明、不算在岗。缺席 = 旧记录，按 `all` 读。
         */
        scope: z.enum(['all', 'self', 'standby']).optional(),
      }),
    },
  },
}

/**
 * 在岗 —— **多实例受话唯一律的人签发面** (决策 #63 = 设计 v4.27, 技术方案 §8 B5).
 *
 * 寄生期「同一个 agent」在部署上是 N 个操作者的 N 个实例——名字唯一而实体多。一个群
 * 场所一次受话只能有一个接单者，到达单数**过人的手或过总序，永不过运气**。这一族记的
 * 是过人的手那一半：
 *
 * - `declared` / `withdrawn`：本实例对某群场所的**对群在岗**与退岗。`msgAnchor` 是向群
 *   发出的声明帖——**群即审计面**（v3.15⑤「谁把 agent 接进这个群」由此可审，三方知情
 *   零新机制）。仅本人合同不声明、不算在岗（唯一律的不变量是「一次受话一个接单者」，
 *   不是「一个场所一个实例」）。
 * - `yielded`：让位留痕。「我的 agent 为什么没接」必须可答——静默让位无帖但有账，显式
 *   让位帖锚入 `retractAnchor`。四个 reason 对应四级解析各一。
 *
 * 同侪在岗与同侪 ack 是**从群消息流派生的观测**（署名识别），不落本族——能派生就
 * 不落账；认领胜出也不设事件（`task/opened` 即胜出证据，补 `claim` 字段）。
 */
const presenceFamily: GraphFamily = {
  kind: 'presence',
  events: {
    'presence/declared': {
      schema: z.object({
        placeKey: z.string().min(1),
        scope: z.literal('all').default('all'),
        /** 向群发出的在岗声明帖。发不出去也要记在岗——但那时群里还不知道，面板要说。 */
        msgAnchor: z.string().optional(),
        groupName: z.string().optional(),
        status: z.literal('declared').default('declared'),
      }),
    },
    'presence/withdrawn': {
      schema: z.object({
        placeKey: z.string().min(1),
        msgAnchor: z.string().optional(),
        status: z.literal('withdrawn').default('withdrawn'),
      }),
    },
    'presence/yielded': {
      schema: z.object({
        placeKey: z.string().min(1),
        /** 那一次受话——`yzj:<msgId>`。 */
        triggerAnchor: z.string().min(1),
        /** 让给了谁的实例。观测不到对方身份时可空（仅本人合同下他人的受话没人接）。 */
        toOperatorOpenId: z.string().optional(),
        reason: z.enum(['object-owner', 'speaker-instance', 'presence', 'ack-order']),
        /** 显式让位帖。静默让位没有它。 */
        retractAnchor: z.string().optional(),
      }),
    },
  },
  // 让位是边，不是对象；在岗是对象（一个场所一份）。
  objectIdOf: (type, data) => (type === 'presence/yielded' ? undefined : field(data, 'placeKey')),
  reduce: mergeReduce,
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
  receiptFamily, conflictFamily, truthFamily, writebackFamily,
  envFamily,
  answerFamily, tombstoneFamily,
  authorityFamily, contractFamily, cardFamily,
  presenceFamily,
]
