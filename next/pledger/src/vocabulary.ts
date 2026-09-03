/** 私账词汇——只在 pgraph（分册 §3）：预期 / 补登事实 / 校准回执 / 软合同句 / 裁决归档。无 updated（无改笔通道）、无 settled/reopened（派生）。 */
import { z, type GraphFamily, type GraphEvent, type JsonValue } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

const orgAnchor = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  graphSeq: z.number().int().optional(),
})

/** 唯一携锚形态。这份 schema 里没有裸锚的位置（断言⑤ 静态半）。 */
const anchoredText = z.object({
  text: z.string().min(1),
  at: z.string().min(1),
  anchor: orgAnchor.optional(),
})

const merge = (previous: JsonValue | undefined, event: GraphEvent): JsonValue => ({
  ...(asRecord(previous) ?? {}),
  ...(asRecord(event.data) ?? {}),
})

const idOf = (key: string) => (_type: string, data: JsonValue): string | undefined => (
  asString(asRecord(data)?.[key])
)

/** 押：人的原话直存；锚到最近一条人签发裁决（推断，ack 亮出可纠）。 */
export const expectationFamily: GraphFamily = {
  kind: 'expectation',
  events: {
    'expectation/opened': {
      schema: z.object({
        expectationId: z.string().min(1),
        text: z.string().min(1),
        verdict: anchoredText,
        family: z.string().min(1),
        /** 还没开的那场会 › 未来的 due › 无戳（不参与时间轮）。`text` 已说明来源。 */
        checkpoint: z.object({ text: z.string().min(1), ts: z.number().int().optional() }),
        status: z.literal('testing').default('testing'),
        /** 幂等锚 = verdictRef：同一裁决至多一次；withdrawn 后再 opened 是 no-op。 */
        idemKey: z.string().min(1),
      }),
    },
    'expectation/withdrawn': {
      schema: z.object({
        expectationId: z.string().min(1),
        reason: z.string().default(''),
        status: z.literal('withdrawn').default('withdrawn'),
      }),
    },
  },
  objectIdOf: idOf('expectationId'),
  reduce: merge,
}

/** 图外事实的唯一入口：人一句话补登，系统不猜图外。 */
export const factFamily: GraphFamily = {
  kind: 'fact',
  events: {
    'fact/noted': {
      schema: z.object({
        factId: z.string().min(1),
        fact: anchoredText,
        about: z.object({
          kind: z.enum(['verdict', 'expectation']),
          verdict: anchoredText.optional(),
          expectationId: z.string().optional(),
        }),
      }),
    },
  },
  objectIdOf: idOf('factId'),
}

/** 校准回执：当时 × 后来，两栏全是照片。 */
export const calibrationFamily: GraphFamily = {
  kind: 'calibration',
  events: {
    'calibration/opened': {
      schema: z.object({
        calibrationId: z.string().min(1),
        verdict: anchoredText,
        family: z.string().min(1),
        type: z.enum(['pledged', 'reversed', 'vindicated']),
        then: z.array(anchoredText).default([]),
        later: z.array(anchoredText).default([]),
        /** `org:<锚>` / `noted:<factId>` / `checkpoint:<ts>`。 */
        verdictKey: z.string().optional(),
        factKey: z.string().min(1),
        expectationId: z.string().optional(),
        status: z.literal('open').default('open'),
        /** 幂等锚 =（裁决边, 事实边）。 */
        idemKey: z.string().min(1),
      }),
    },
    'calibration/answered': {
      schema: z.object({
        calibrationId: z.string().min(1),
        attribution: z.enum(['q1', 'q2', 'q3', 'q4']),
        status: z.literal('answered').default('answered'),
      }),
    },
    /** 「这不是那件事的结果」：判例不入账；之后再 answered 即覆盖（更正即追加）。 */
    'calibration/dismissed': {
      schema: z.object({
        calibrationId: z.string().min(1),
        status: z.literal('dismissed').default('dismissed'),
      }),
    },
    /** 私账显示层事实：这条回执首次在屏（归因率分母）。每回执至多一次。 */
    'calibration/seen': {
      schema: z.object({ calibrationId: z.string().min(1), seen: z.literal(true).default(true) }),
    },
    /** 补登事实追加到既有回执的「后来」栏——pledged 型不出第二执。 */
    'calibration/appended': {
      schema: z.object({ calibrationId: z.string().min(1), later: anchoredText }),
    },
  },
  objectIdOf: idOf('calibrationId'),
  reduce: (previous, event) => {
    if (event.type !== 'calibration/appended') return merge(previous, event)
    const base = asRecord(previous) ?? {}
    const later = Array.isArray(base.later) ? base.later : []
    const one = asRecord(event.data)?.later
    return { ...base, later: one === undefined ? later : [...later, one] }
  },
}

/** 换挡 = 软合同私账句——本层唯一产出。回喂事件数 = count(set) + count(cleared)。 */
export const clauseFamily: GraphFamily = {
  kind: 'clause',
  events: {
    'clause/set': {
      schema: z.object({
        clauseId: z.string().min(1),
        key: z.enum(['spread', 'mirror', 'morning', 'lease']),
        family: z.string().optional(),
        text: z.string().min(1),
        /** key='lease' 时：组织侧 lease/granted 的锚（私账私记，组织图零字段）。 */
        leaseRef: z.string().optional(),
        active: z.literal(true).default(true),
      }),
    },
    'clause/cleared': {
      schema: z.object({ clauseId: z.string().min(1), active: z.literal(false).default(false) }),
    },
  },
  objectIdOf: idOf('clauseId'),
  reduce: merge,
}

/** 裁决归档——接缝① 落点：`{ family, agree, dwellMs?, waitMs? }`，两分母只在裁决那一刻拍得下。 */
export const verdictFamily: GraphFamily = {
  kind: 'verdict',
  events: {
    'verdict/filed': {
      schema: z.object({
        verdictKey: z.string().min(1),
        verdict: anchoredText,
        kind: z.string().min(1),
        actionId: z.string().min(1),
        family: z.string().min(1),
        agree: z.boolean(),
        topicKey: z.string().optional(),
        dwellMs: z.number().int().optional(),
        waitMs: z.number().int().optional(),
        idemKey: z.string().min(1),
      }),
    },
  },
  objectIdOf: idOf('verdictKey'),
  reduce: merge,
}

export const PLEDGER_FAMILIES: readonly GraphFamily[] = [
  expectationFamily, factFamily, calibrationFamily, clauseFamily, verdictFamily,
]

/** 三不入的结构性根据：这些族不声明 `pendingStatuses`，且不在组织 store 上。 */
export const PLEDGER_KINDS: readonly string[] = PLEDGER_FAMILIES.map(family => family.kind)
