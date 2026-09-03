/** 裁决的读法 —— 组织图只读三用途：活性探测（回状态不回内容）/ 锚 / 写入那一刻拍照。 */
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphObject } from '@yzj-next/graph'
import { familyOfKind, verdictKeyFor } from './families.ts'
import { anchoredOf, snapshot, type AnchoredText, type OrgAnchor, type PremiseState } from './types.ts'

/** 一次归档过的裁决——私账看见的样子（来自 `verdict/filed`）。 */
export interface FiledVerdict {
  readonly verdictKey: string
  readonly anchor: OrgAnchor
  readonly verdict: AnchoredText
  readonly kind: string
  readonly actionId: string
  readonly family: string
  readonly agree: boolean
  readonly topicKey?: string
  readonly at: number
  readonly seq: number
  readonly dwellMs?: number
  readonly waitMs?: number
}

/** 接缝① 的 payload（组织侧通用广播，它不知道有谁在听）。 */
export interface VerdictSettled {
  readonly cardRef: { kind: string; id: string }
  readonly actionId: string
  readonly kind?: string
  readonly at?: number
  readonly titleText?: string
  readonly openedAt?: number
  readonly decidedAt?: number
  readonly dwellMs?: number
  readonly actor?: { kind: string; openId?: string }
}

/** 组织对象此刻叫什么——**只在写入那一刻拍照用**。 */
export function labelOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.what) ?? asString(state?.summary) ?? asString(state?.reason)
}

export function topicOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.topicKey) ?? asString(asRecord(state?.executor)?.topicKey)
}

export function goalRefOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.parentGoalRef) ?? asString(state?.goalRef)
}

const DEAD_STATUSES = new Set(['voided', 'transferred', 'merged', 'expired', 'superseded'])

/** 活性探测：三值。组织图不可达 = `unknown`，不显形。目标没有自己的族，按 goalRef 找。 */
export function isAlive(ctx: Context, anchor: OrgAnchor): PremiseState {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined) return 'unknown'
  const object = anchor.kind === 'goal' ? goalObjectOf(ctx, anchor.id) : graph.rawObject(anchor.kind, anchor.id)
  if (object === undefined) return 'changed'
  const status = asString(asRecord(object.state)?.status)
  return status !== undefined && DEAD_STATUSES.has(status) ? 'changed' : 'live'
}

function goalObjectOf(ctx: Context, goalRef: string): GraphObject | undefined {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined) return undefined
  for (const event of graph.rawEvents(['commitment/opened', 'commitment/amended'])) {
    const data = asRecord(event.data)
    if (asString(data?.goalRef) !== goalRef) continue
    const id = asString(data?.commitmentId)
    const object = id === undefined ? undefined : graph.rawObject('commitment', id)
    if (asString(asRecord(object?.state)?.goalRef) === goalRef) return object
  }
  return undefined
}

/**
 * 接缝① 的落点：把一次人签发的裁决归档到私账（族、同意与否、两个分母）。
 * 不在族表里的种类（作废/移交…）不入账；同侪签发的裁决不入账（多操作者 §7）。
 */
export async function fileVerdict(ctx: Context, payload: VerdictSettled): Promise<string | undefined> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return undefined
  const kind = payload.kind
  const spec = kind === undefined ? undefined : familyOfKind(kind)
  if (kind === undefined || spec === undefined) return undefined
  if (payload.actor?.openId !== undefined && payload.actor.openId !== pledger.owner) return undefined
  const anchor: OrgAnchor = { kind: payload.cardRef.kind, id: payload.cardRef.id }
  const verdictKey = verdictKeyFor(anchor, payload.actionId)
  if (pledger.findByIdemKey(`verdict:${verdictKey}`) !== undefined) return verdictKey
  const at = payload.decidedAt ?? payload.at ?? Date.now()
  const title = payload.titleText ?? labelOf(ctx, anchor.kind, anchor.id) ?? `${anchor.kind}:${anchor.id}`
  const topicKey = topicOf(ctx, anchor.kind, anchor.id)
  const waitMs = payload.openedAt === undefined ? undefined : Math.max(0, at - payload.openedAt)
  const agreeOf = spec.kinds[kind]
  await pledger.append({
    type: 'verdict/filed',
    data: {
      verdictKey,
      verdict: { text: title, at: new Date(at).toISOString(), anchor: { kind: anchor.kind, id: anchor.id } },
      kind,
      actionId: payload.actionId,
      family: spec.family,
      agree: agreeOf === undefined ? true : agreeOf(payload.actionId),
      ...(topicKey === undefined ? {} : { topicKey }),
      ...(payload.dwellMs === undefined ? {} : { dwellMs: Math.round(payload.dwellMs) }),
      ...(waitMs === undefined ? {} : { waitMs: Math.round(waitMs) }),
      idemKey: `verdict:${verdictKey}`,
    },
    actor: { kind: 'system' },
  })
  return verdictKey
}

/** 全部归档裁决，旧→新。 */
export function filedVerdicts(ctx: Context): readonly FiledVerdict[] {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return []
  const out: FiledVerdict[] = []
  for (const object of pledger.query('verdict')) {
    const state = asRecord(object.state)
    const verdict = anchoredOf(state?.verdict)
    const key = asString(state?.verdictKey)
    const kind = asString(state?.kind)
    const actionId = asString(state?.actionId)
    const family = asString(state?.family)
    if (verdict.anchor === undefined || key === undefined || kind === undefined || actionId === undefined || family === undefined) continue
    out.push({
      verdictKey: key,
      anchor: verdict.anchor,
      verdict,
      kind,
      actionId,
      family,
      agree: state?.agree === true,
      ...(asString(state?.topicKey) === undefined ? {} : { topicKey: asString(state?.topicKey) as string }),
      at: Date.parse(verdict.at) || object.createdAt,
      seq: object.createdSeq,
      ...(typeof state?.dwellMs === 'number' ? { dwellMs: state.dwellMs } : {}),
      ...(typeof state?.waitMs === 'number' ? { waitMs: state.waitMs } : {}),
    })
  }
  return out.sort((left, right) => left.seq - right.seq)
}

/** 这个话题里最近一条人签发的裁决——押的锚。 */
export function latestVerdictIn(ctx: Context, topicKey: string): FiledVerdict | undefined {
  return filedVerdicts(ctx).filter(one => one.topicKey === topicKey).at(-1)
}

/** 检验点取值序：还没开的那场会 › 未来的 due › 无戳。 */
export function checkpointFor(ctx: Context, anchor: OrgAnchor, now: number): { text: string; ts?: number } {
  const graph = ctx.get('yzjGraph')
  if (graph !== undefined && anchor.kind === 'commitment') {
    let best: { text: string; ts: number } | undefined
    for (const object of graph.query({ kind: 'operator', openId: '' }, { kind: 'event' })) {
      const state = asRecord(object.state)
      const prepares = state?.prepares
      const startAt = state?.startAt
      if (!Array.isArray(prepares) || !prepares.includes(anchor.id) || typeof startAt !== 'number' || startAt <= now) continue
      if (best !== undefined && best.ts <= startAt) continue
      const when = new Date(startAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      best = { ts: startAt, text: `${when}「${asString(state?.title) ?? '那场会'}」之后` }
    }
    if (best !== undefined) return best
  }
  const due = asString(asRecord(graph?.rawObject(anchor.kind, anchor.id)?.state)?.due)
  const dueTs = due === undefined ? Number.NaN : Date.parse(due)
  if (due !== undefined && Number.isFinite(dueTs) && dueTs > now) return { text: `${due} 之后`, ts: dueTs }
  return { text: '没有定时间' }
}

/** 当时在档的证据行：挂在哪个目标下——一张照片，写入时定格。 */
export function contextLines(ctx: Context, anchor: OrgAnchor, at: number): AnchoredText[] {
  const goal = goalRefOf(ctx, anchor.kind, anchor.id)
  return goal === undefined ? [] : [snapshot(`当时在档：这次裁决挂在目标 ${goal} 下`, { kind: 'goal', id: goal }, at)]
}
