/**
 * 账的内核（技术方案-下一代ERP账本 §2.1 / §4 / §13.1–§13.2 / §13.6）：行哈希、日志起点、
 * 成链校验、四种行、审计。
 *
 * 一条日志的价值是**当证据用**——拿去对质一个更愿意忘掉的人，读的人当时不在场。所以
 * 「它被改过」必须是一件能被发现的事：每一行 v2 存着上一行 v2 的 hash，改动任何一行，
 * 它和它之后的每一行都对不上。
 *
 * 这里只有确定性代码。给定同一份日志，`verifyChain` 永远给出同一个答案；服务的
 * `integrity()` 与离线的审计脚本用的是**同一个**校验函数——两个校验器迟早会给出两个
 * 答案，而那时没有人能说清该信哪个。
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { asNumber, asRecord, asString, canonicalJson } from './json.ts'
import type { GraphEvent, GraphFamily, GraphIntegrity, JsonValue } from './types.ts'

/** 日志起点的类型。只有内核自己写它（`YzjGraph.append` 拒收外来的）。 */
export const GENESIS_TYPE = 'ledger/genesis'

/** genesis 的 `prev`。 */
export const GENESIS_PREV = '0'.repeat(64)

/** 守门人放行一次写的三行（族在 tools，配对规则在这里：审计与孤儿扫描读的是同一条）。 */
export const ACTION_RELEASED = 'action/released'
export const ACTION_SETTLED = 'action/settled'
export const ACTION_OUTCOME_UNKNOWN = 'action/outcome-unknown'

/** 一行的 hash：对写进文件的那个对象（不含 `hash` 自己）取规范 JSON 的 sha256。 */
export function eventHash(event: Omit<GraphEvent, 'hash'>): string {
  const { v, sv, seq, time, type, data, actor, prev } = event
  return createHash('sha256')
    .update(canonicalJson({ v, sv, seq, time, type, data, actor, prev }))
    .digest('hex')
}

/**
 * 日志起点（§13.1-5/6）。分区里第一行 v2 之前写下，登记它接手的那一段 v1 历史：到哪个
 * seq 为止、当时整个文件的字节摘要。v1 段从没成过链，起点之前的那段只能这样被「封存」。
 */
export const ledgerFamily: GraphFamily = {
  kind: 'ledger',
  events: {
    [GENESIS_TYPE]: {
      schema: z.object({
        v1Through: z.number().int().min(0),
        v1Digest: z.string().regex(/^[0-9a-f]{64}$/u),
      }),
    },
  },
}

/** 校验结果，外加续写需要的链尾。 */
export interface ChainState extends Omit<GraphIntegrity, 'orphanActions'> {
  /** 最后一行 v2 **存着的** hash，不论断没断：新行接在它上面，断点因此永久可见。 */
  readonly lastHash?: string
}

/**
 * 从起点逐行校验（§13.1-8）。`events` 须已按 seq 升序（`parseLog` 的输出）。
 *
 * - v1 段不校验，但起点**之后**的任何非 v2 行都是断链：否则在起点后插一行伪造的 v1，
 *   它会被折叠成事实，链却不报。「之后」按起点登记的 `v1Through` 算，所以连 seq 空洞
 *   里插进去的那一行也逃不掉。
 * - 起点必须是第一行 v2，且只有一个。
 * - **带着 hash 的行就是链上的行，不论它的 `v` 写的是几**：把 v2 改回 v1 是想逃开校验，
 *   它照样断在那一行；它存着的 hash 照样是链尾——否则整条链被改回 v1 之后，下一次追加会
 *   重新写一个起点，把篡改过的历史当成干净的 v1 封存起来，系统亲手替篡改者洗白。
 * - seq 不连续不算断链：写盘失败会消耗掉一个 seq。
 *
 * **绝不向外抛错**：分区打开要等它，抛出去整个实例就写不了了。出错就当作断在那一行。
 */
export function verifyChain(events: readonly GraphEvent[]): ChainState {
  let lastHash: string | undefined
  let genesisSeq: number | undefined
  let verifiedThrough = 0
  let at = 0
  const result = (breakAt?: number): ChainState => ({
    ...(genesisSeq === undefined ? {} : { genesisSeq }),
    verifiedThrough,
    ...(breakAt === undefined ? {} : { breakAt }),
    ...(lastHash === undefined ? {} : { lastHash }),
  })
  const chained = (event: GraphEvent): boolean => event.v === 2 || event.hash !== undefined
  try {
    for (const event of events) if (chained(event)) lastHash = event.hash
    const first = events.find(chained)
    if (first === undefined) {
      const forged = events.find(event => event.type === GENESIS_TYPE)
      return forged === undefined ? result() : result(forged.seq)
    }
    at = first.seq
    if (first.type === GENESIS_TYPE) genesisSeq = first.seq
    const boundary = (genesisSeq === undefined ? undefined : asNumber(asRecord(first.data)?.v1Through)) ?? first.seq
    let expected = GENESIS_PREV
    for (const event of events) {
      at = event.seq
      if (!chained(event)) {
        // 起点只会是 v2：一行 v1 的起点只可能是改出来的。
        if (event.seq > boundary || event.type === GENESIS_TYPE) return result(event.seq)
        continue
      }
      if (event.v !== 2 || (event === first) !== (event.type === GENESIS_TYPE)) return result(event.seq)
      const hash = eventHash(event)
      if (event.prev !== expected || event.hash !== hash) return result(event.seq)
      expected = hash
      verifiedThrough = event.seq
    }
    return result()
  } catch {
    return result(Math.max(at, 1))
  }
}

/**
 * 起点封存的那一段 v1 还是不是原样：用文件的原始字节重算起点之前那一段的 sha256，和起点
 * 登记的 `v1Digest` 对。不核的话，那个封印只是摆设——改动 E0 之前的任何一行都没人知道。
 *
 * 加载时不核（§13.1-8：v1 段不校验），审计时核：它要的是字节，那是文件的事。起点那一行
 * 前面可能多一个换行（文件尾停在半行上时，追加先补一个），两种前缀都认。
 * @returns 没有起点时为 undefined。
 */
export function v1SealHolds(raw: Uint8Array, events: readonly GraphEvent[]): boolean | undefined {
  const genesis = events.find(event => event.type === GENESIS_TYPE && event.v === 2)
  const digest = asString(asRecord(genesis?.data)?.v1Digest)
  if (genesis?.hash === undefined || digest === undefined) return undefined
  const bytes = Buffer.from(raw)
  const at = bytes.indexOf(`"hash":"${genesis.hash}"`)
  if (at < 0) return false
  const lineStart = bytes.lastIndexOf('\n', at) + 1
  const sha = (end: number): string => createHash('sha256').update(bytes.subarray(0, end)).digest('hex')
  return sha(lineStart) === digest || (lineStart > 0 && sha(lineStart - 1) === digest)
}

/** 一次调用的键。callId 只在单个会话内唯一，所以键是 (sessionId, callId) 这一对（§13.3）。 */
export function actionKey(data: JsonValue): string | undefined {
  const record = asRecord(data)
  const sessionId = asString(record?.sessionId)
  const callId = asString(record?.callId)
  return sessionId === undefined || callId === undefined ? undefined : `${sessionId}\0${callId}`
}

/**
 * 放行了、却既没有 `settled` 也没有 `outcome-unknown` 的 `action/released`（§13.4）。
 * 墓碑不豁免：更正改的是一句说法，改不了一次已经放出去的写。
 */
export function orphanReleases(events: readonly GraphEvent[]): readonly GraphEvent[] {
  const closed = new Set<string>()
  for (const event of events) {
    if (event.type !== ACTION_SETTLED && event.type !== ACTION_OUTCOME_UNKNOWN) continue
    const key = actionKey(event.data)
    if (key !== undefined) closed.add(key)
  }
  return events.filter(event => event.type === ACTION_RELEASED && !closed.has(actionKey(event.data) ?? ''))
}

/** 四种行（§2.1）。 */
export type Atom = 'said' | 'did' | 'seen' | 'ruled'

/**
 * 一行是哪一种，靠推导，不存（§13.2）——按本册自己的规矩，能重算的不存。
 *
 * `seen` 在 E0 不会出现：现有的外部观测（`event/observed`）actor 都是 agent。认不出的
 * actor 归 `did`：那是「必须追得到授权」的一类，把它误标成 `said` 等于替没签字的人签字。
 */
export function atomOf(event: GraphEvent): Atom {
  switch (event.actor.kind) {
    case 'person':
    case 'operator':
      return 'said'
    case 'system':
      return 'ruled'
    default:
      return 'did'
  }
}

/** 链的完整性加孤儿计数：服务的 `integrity()` 与离线审计对同一份文件给出同一个答案。 */
export function integrityOf(events: readonly GraphEvent[]): GraphIntegrity {
  const { lastHash: _tail, ...chain } = verifyChain(events)
  return { ...chain, orphanActions: orphanReleases(events).length }
}

/** 审计报告（§13.6）。只读，不进模型工具面，不进 UI。 */
export interface LedgerAudit {
  readonly byAtom: Record<Atom, number>
  readonly byType: Record<string, number>
  /** I5「said 行必带 openId」——E0 先量后禁。 */
  readonly saidWithoutOpenId: number
  readonly orphanActions: number
  /** 工具体已经跑完、调用却被取消的写：效果可能已经发生，要人看。 */
  readonly abortedAfterBody: number
  readonly chain: GraphIntegrity
}

export function auditLedger(events: readonly GraphEvent[]): LedgerAudit {
  const byAtom: Record<Atom, number> = { said: 0, did: 0, seen: 0, ruled: 0 }
  const byType: Record<string, number> = {}
  let saidWithoutOpenId = 0
  let abortedAfterBody = 0
  for (const event of events) {
    const atom = atomOf(event)
    byAtom[atom] += 1
    byType[event.type] = (byType[event.type] ?? 0) + 1
    if (atom === 'said' && asString(event.actor.openId) === undefined) saidWithoutOpenId += 1
    if (event.type === ACTION_SETTLED && asRecord(event.data)?.outcome === 'aborted-after-body') {
      abortedAfterBody += 1
    }
  }
  const chain = integrityOf(events)
  return { byAtom, byType, saidWithoutOpenId, orphanActions: chain.orphanActions, abortedAfterBody, chain }
}
