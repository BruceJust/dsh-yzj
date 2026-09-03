/**
 * 回执三处出生（§4.2）—— 回流配对表 + 时间轮检验点。出生由比值的分子定义：平安无事不出执。
 * 配对表只配对事实、不向人开口（PTD-31）；幂等 =（裁决边, 事实边）；押过的裁决一份一执，
 * 后到的事实走 `appended`。
 */
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphEvent } from '@yzj-next/graph'
import { calibrationIdFor, calibrationIdemKeyFor, expectationIdemKeyFor } from './families.ts'
import {
  anchoredJson, snapshot, type AnchoredText, type OrgAnchor, type ReceiptType,
} from './types.ts'
import { contextLines, filedVerdicts, goalRefOf, topicOf, type FiledVerdict } from './verdicts.ts'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface PairedFact {
  readonly type: Exclude<ReceiptType, 'pledged'>
  readonly fact: AnchoredText
  readonly factKey: string
}

/**
 * 回流配对表（P1）。每一行：族 × 同意与否 × 组织图事件形状 → 反转 / 印证。
 *
 * | 验收 accept | 反转：同承诺 `commitment/reopened`；转包子边 `commitment/opened{parentCommitmentId}`；
 * |            | 同目标同对话 7 日内新 `commitment/opened`（弱路径）
 * | 验收 reject | 印证：返工后同承诺 `commitment/closed` 且轮次 ≥ 1
 * | 目标提案 确认 | 反转：落库的子承诺 7 日内 `commitment/voided`
 * | 标准写确认 / 目标评估 | 无结构性来源（如实留空——正面证据只能靠押）
 */
export function pairFact(ctx: Context, verdict: FiledVerdict, event: GraphEvent): PairedFact | undefined {
  const data = asRecord(event.data)
  if (data === undefined || event.time < verdict.at) return undefined
  const { kind, id } = verdict.anchor
  const shot = (type: PairedFact['type'], text: string, anchor: OrgAnchor): PairedFact => ({
    type,
    fact: snapshot(text, { ...anchor, graphSeq: event.seq }, event.time),
    factKey: `org:${anchor.kind}:${anchor.id}:${event.type}`,
  })

  if (verdict.family === 'acceptance' && kind === 'commitment') {
    if (verdict.agree) {
      if (event.type === 'commitment/reopened' && asString(data.commitmentId) === id) {
        return shot('reversed', `你验收过的这一条又被打回：${asString(data.cause) ?? '返工'}`, { kind, id })
      }
      if (event.type === 'commitment/opened') {
        const child = asString(data.commitmentId)
        const spunOff = asString(data.parentCommitmentId) === id
        const goal = goalRefOf(ctx, kind, id)
        const topic = topicOf(ctx, kind, id)
        const sameGoal = goal !== undefined && (asString(data.parentGoalRef) === goal || asString(data.goalRef) === goal)
        const pointsBack = topic !== undefined && (asString(data.sourceAnchor) ?? '').includes(topic)
        const soon = event.time - verdict.at <= WEEK_MS
        if (child !== undefined && child !== id && (spunOff || (sameGoal && pointsBack && soon))) {
          return shot('reversed', `验收之后又长出了新一轮：${asString(data.what) ?? child}`, { kind: 'commitment', id: child })
        }
      }
      return undefined
    }
    if (event.type === 'commitment/closed' && asString(data.commitmentId) === id) {
      const round = asRecord(ctx.get('yzjGraph')?.rawObject('commitment', id)?.state)?.round
      if (typeof round === 'number' && round >= 1 && asString(data.cause) !== 'voided') {
        return shot('vindicated', `打回后返工的交付通过了（第 ${String(round)} 轮）`, { kind, id })
      }
    }
    return undefined
  }

  if (verdict.family === 'proposal' && verdict.agree && event.type === 'commitment/voided') {
    const voided = asString(data.commitmentId)
    const born = asRecord(ctx.get('yzjGraph')?.rawObject('commitment', voided ?? '')?.state)
    const source = asString(born?.sourceAnchor) ?? ''
    if (voided !== undefined && source.includes(id) && event.time - verdict.at <= WEEK_MS) {
      return shot('reversed', `你确认的这条活 7 日内被作废：${asString(data.cause) ?? ''}`.trim(), { kind: 'commitment', id: voided })
    }
  }
  return undefined
}

/** 一条新的组织图事件——它是不是某次裁决的「后来」。配最近的那一次裁决。 */
export async function reflowOnGraphEvent(ctx: Context, event: GraphEvent): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return
  let best: { verdict: FiledVerdict; paired: PairedFact } | undefined
  for (const verdict of filedVerdicts(ctx)) {
    const paired = pairFact(ctx, verdict, event)
    if (paired !== undefined && (best === undefined || best.verdict.seq < verdict.seq)) best = { verdict, paired }
  }
  if (best !== undefined) await openReceipt(ctx, { verdict: best.verdict, type: best.paired.type, fact: best.paired.fact, factKey: best.paired.factKey })
}

/** 人工补登那一支：`about` 是显式指认，零推断。 */
export async function reflowOnNotedFact(ctx: Context, event: GraphEvent): Promise<void> {
  if (event.type !== 'fact/noted') return
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return
  const data = asRecord(event.data)
  const factId = asString(data?.factId)
  const text = asString(asRecord(data?.fact)?.text)
  const about = asRecord(data?.about)
  if (factId === undefined || text === undefined || about === undefined) return
  let anchor: OrgAnchor | undefined
  if (asString(about.kind) === 'expectation') {
    const state = asRecord(pledger.object('expectation', asString(about.expectationId) ?? '')?.state)
    const inner = asRecord(asRecord(state?.verdict)?.anchor)
    const kind = asString(inner?.kind)
    const id = asString(inner?.id)
    anchor = kind === undefined || id === undefined ? undefined : { kind, id }
  } else {
    const inner = asRecord(asRecord(about.verdict)?.anchor)
    const kind = asString(inner?.kind)
    const id = asString(inner?.id)
    anchor = kind === undefined || id === undefined ? undefined : { kind, id }
  }
  if (anchor === undefined) return
  const verdict = filedVerdicts(ctx).filter(one => one.anchor.kind === anchor.kind && one.anchor.id === anchor.id).at(-1)
  if (verdict === undefined) return
  await openReceipt(ctx, { verdict, type: 'pledged', fact: snapshot(`你补的：${text}`, undefined, event.time), factKey: `noted:${factId}` })
}

/**
 * 出一张回执，或追加到既有的那一张。
 *
 * 押过的裁决：不管事实是哪一支，都是 `pledged` 型；已有回执时事实走 `appended`。
 * 没押过的：只按配对表出 reversed / vindicated；补登的事实（noted）也出执——人自己说
 * 「这是那次裁决的后来」，那就是分子的证据。
 */
export async function openReceipt(ctx: Context, input: {
  readonly verdict: FiledVerdict
  readonly type: ReceiptType
  readonly fact: AnchoredText
  readonly factKey: string
}): Promise<string | undefined> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return undefined
  const { verdict } = input
  const expectation = pledger.findByIdemKey(expectationIdemKeyFor(verdict.anchor))
  const expectationState = asRecord(expectation?.state)
  const pledged = expectation !== undefined && asString(expectationState?.status) === 'testing'
  const type: ReceiptType = pledged ? 'pledged' : input.type
  const existing = receiptOf(ctx, verdict.anchor)
  if (existing !== undefined) {
    // 一份裁决一张执：后到的事实追加到「后来」栏；同一事实不追加两次。
    const later = Array.isArray(existing.later) ? existing.later : []
    if (later.some(one => asString(asRecord(one)?.at) === input.fact.at && asString(asRecord(one)?.text) === input.fact.text)) return existing.id
    if (input.factKey.startsWith('checkpoint:')) return existing.id
    await pledger.append({ type: 'calibration/appended', data: { calibrationId: existing.id, later: anchoredJson(input.fact) }, actor: { kind: 'system' } })
    return existing.id
  }
  const idemKey = calibrationIdemKeyFor(verdict.anchor, input.factKey)
  if (pledger.findByIdemKey(idemKey) !== undefined) return undefined
  const then: AnchoredText[] = [
    snapshot(`${verdict.agree ? '你签发了' : '你没同意'}「${verdict.verdict.text}」`, verdict.anchor, verdict.at),
    ...(pledged ? [snapshot(`你押的：「${asString(expectationState?.text) ?? ''}」`, undefined, Date.parse(asString(expectationState?.verdict === undefined ? '' : asString(asRecord(expectationState.verdict)?.at)) ?? '') || verdict.at)] : []),
    ...contextLines(ctx, verdict.anchor, verdict.at),
  ]
  const calibrationId = calibrationIdFor(verdict.anchor, input.factKey)
  await pledger.append({
    type: 'calibration/opened',
    data: {
      calibrationId,
      verdict: anchoredJson(verdict.verdict),
      family: verdict.family,
      type,
      then: then.map(anchoredJson),
      later: input.factKey.startsWith('checkpoint:') ? [] : [anchoredJson(input.fact)],
      factKey: input.factKey,
      ...(pledged && expectation !== undefined ? { expectationId: expectation.id } : {}),
      idemKey,
    },
    actor: { kind: 'system' },
  })
  return calibrationId
}

/** 这次裁决已有的回执（一份裁决一张执）。 */
export function receiptOf(ctx: Context, anchor: OrgAnchor): { id: string; later: unknown } | undefined {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return undefined
  for (const object of pledger.query('calibration')) {
    const state = asRecord(object.state)
    const inner = asRecord(asRecord(state?.verdict)?.anchor)
    if (asString(inner?.kind) === anchor.kind && asString(inner?.id) === anchor.id) return { id: object.id, later: state?.later }
  }
  return undefined
}

/** 时间轮：检验点到了、还没有回执 → 开 `pledged` 执，「后来」栏空着等补登。私账零 IM。 */
export async function tickCheckpoints(ctx: Context, now = Date.now()): Promise<readonly string[]> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return []
  const opened: string[] = []
  for (const object of pledger.query('expectation')) {
    const state = asRecord(object.state)
    if (asString(state?.status) !== 'testing') continue
    const ts = asRecord(state?.checkpoint)?.ts
    if (typeof ts !== 'number' || ts > now) continue
    const inner = asRecord(asRecord(state?.verdict)?.anchor)
    const kind = asString(inner?.kind)
    const id = asString(inner?.id)
    if (kind === undefined || id === undefined || receiptOf(ctx, { kind, id }) !== undefined) continue
    const verdict = filedVerdicts(ctx).filter(one => one.anchor.kind === kind && one.anchor.id === id).at(-1)
    if (verdict === undefined) continue
    const calibrationId = await openReceipt(ctx, {
      verdict, type: 'pledged', factKey: `checkpoint:${String(ts)}`,
      fact: snapshot(`检验点到了：${asString(asRecord(state?.checkpoint)?.text) ?? ''}`, undefined, now),
    })
    if (calibrationId !== undefined) opened.push(calibrationId)
  }
  return opened
}

const TICK_MS = 5 * 60_000

/** 私账自带的时间轮。不上 scheduler（ban 名单）。 */
export function startClock(ctx: Context): () => void {
  const timer = setInterval(() => {
    void tickCheckpoints(ctx).catch((error: unknown) => { console.error('[yzj-next-pledger] checkpoint tick failed', error) })
  }, TICK_MS)
  timer.unref?.()
  return () => { clearInterval(timer) }
}
