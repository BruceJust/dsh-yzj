/** 人的动词——押 / 撤回 / 补一句 / 归因 / 配对错了 / 换挡：全由人在既有面上发起，actor 恒为 operator，原话直存，这条路上没有模型（PTD-30）。 */
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import {
  clauseIdFor, expectationIdFor, expectationIdemKeyFor, factIdFor, familyLabel, familySpec,
} from './families.ts'
import {
  anchoredJson, snapshot, CLAUSE_TEXT,
  type AnchoredText, type Attribution, type ClauseKey, type OrgAnchor,
} from './types.ts'
import { checkpointFor, latestVerdictIn, verdictOn } from './verdicts.ts'

/** 私语道那句话是不是私账动词。认不出 = 不是，照常给 agent。 */
export type PrivateSay =
  | { readonly kind: 'pledge'; readonly text: string; readonly anchor?: OrgAnchor }
  | { readonly kind: 'clause'; readonly off: boolean; readonly key?: Exclude<ClauseKey, 'lease'>; readonly raw: string }

export function parsePrivateSay(text: string): PrivateSay | undefined {
  // 引用指名押：「押 [card#task:tsk-…]：…」——句柄就是各处回复用的那一个；不带句柄 = 本会话最近裁决。
  const bet = /^(?:押|\/押)(?:\s*\[card#([a-z-]+):([^\]\s]+)\])?[：:\s]+(.+)$/su.exec(text.trim())
  if (bet !== null) {
    const [, kind, id, body] = bet
    return { kind: 'pledge', text: (body ?? '').trim(), ...(kind === undefined || id === undefined ? {} : { anchor: { kind, id } }) }
  }
  const soft = /^(不再|取消)?\s*(以后|每天早上)(.+)$/su.exec(text.trim())
  if (soft === null) return undefined
  const key = /摆开证据|不预选|先看证据|先看|摆给我看/u.test(text) ? 'spread'
    : /判例|看我的|上次/u.test(text) ? 'mirror'
      : /晨报|每天早上|几条/u.test(text) ? 'morning' : undefined
  return { kind: 'clause', off: soft[1] !== undefined, ...(key === undefined ? {} : { key }), raw: text.trim() }
}

const operatorActor = (ctx: Context): { kind: 'operator'; openId?: string } => {
  const openId = ctx.get('yzjPledger')?.owner
  return { kind: 'operator', ...(openId === undefined ? {} : { openId }) }
}

const when = (at: number): string => new Date(at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

/** 押：默认锚到本会话最近裁决（指名押走句柄）。没有 → 不猜不问；已押 → 先撤回，撤回后不可再押。ack 亮出锚与检验点。 */
export async function pledge(ctx: Context, input: { readonly topicKey: string; readonly text: string; readonly anchor?: OrgAnchor }): Promise<string> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return '私账还没打开——云之家身份还没就绪。'
  if (input.text === '') return '押什么？跟在「押：」后面说一句可证伪的话。'
  const verdict = input.anchor === undefined ? latestVerdictIn(ctx, input.topicKey) : verdictOn(ctx, input.anchor)
  if (verdict === undefined) return input.anchor === undefined ? '还没有可以押的裁决——先做一个裁决，再押。' : '没有这条裁决的记录——只能押你自己签发过的裁决。'
  if (pledger.findByIdemKey(expectationIdemKeyFor(verdict.anchor)) !== undefined) {
    return '这条裁决已经押过了。要改，先撤回——撤回之后，这条就不能再押。'
  }
  const checkpoint = checkpointFor(ctx, verdict.anchor, Date.now())
  await pledger.append({
    type: 'expectation/opened',
    data: {
      expectationId: expectationIdFor(verdict.anchor),
      text: input.text,
      verdict: anchoredJson(verdict.verdict),
      family: verdict.family,
      checkpoint,
      idemKey: expectationIdemKeyFor(verdict.anchor),
    },
    actor: operatorActor(ctx),
  })
  return `押已记：「${input.text}」——押在你 ${when(verdict.at)} 的${familyLabel(verdict.family)}「${verdict.verdict.text}」上`
    + (checkpoint.ts === undefined ? '；没有定时间，有结果时我放回那张卡下面' : `；${checkpoint.text}，结果会回到那张卡下面`)
    + '。押错地方了就说一声。只有你能看到。'
}

/** 撤回：唯一退出动词，留痕不删史。 */
export async function withdraw(ctx: Context, expectationId: string, reason: string): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  if (pledger.object('expectation', expectationId) === undefined) throw new Error('找不到这条押')
  await pledger.append({ type: 'expectation/withdrawn', data: { expectationId, reason }, actor: operatorActor(ctx) })
}

/** 补一句结果：图外事实的唯一入口。 */
export async function noteFact(ctx: Context, input: {
  readonly text: string
  readonly about: { readonly kind: 'verdict'; readonly verdict: AnchoredText } | { readonly kind: 'expectation'; readonly expectationId: string }
}): Promise<string> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  const now = Date.now()
  const aboutKey = input.about.kind === 'verdict'
    ? `${input.about.verdict.anchor?.kind ?? ''}:${input.about.verdict.anchor?.id ?? ''}`
    : input.about.expectationId
  const factId = factIdFor(aboutKey, input.text, now)
  await pledger.append({
    type: 'fact/noted',
    data: {
      factId,
      fact: anchoredJson(snapshot(input.text, undefined, now)),
      about: input.about.kind === 'verdict'
        ? { kind: 'verdict', verdict: anchoredJson(input.about.verdict) }
        : { kind: 'expectation', expectationId: input.about.expectationId },
    },
    actor: operatorActor(ctx),
  })
  return factId
}

/** 归因：可改，更正即追加；dismissed 之后再 answered 即覆盖（纠回）。 */
export async function attribute(ctx: Context, calibrationId: string, cell: Attribution): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  if (pledger.object('calibration', calibrationId) === undefined) throw new Error(`找不到回执 ${calibrationId}`)
  await pledger.append({ type: 'calibration/answered', data: { calibrationId, attribution: cell }, actor: operatorActor(ctx) })
}

/** 「这不是那件事的结果」：判例不入账，可纠回。 */
export async function dismiss(ctx: Context, calibrationId: string): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  if (pledger.object('calibration', calibrationId) === undefined) throw new Error(`找不到回执 ${calibrationId}`)
  await pledger.append({ type: 'calibration/dismissed', data: { calibrationId }, actor: operatorActor(ctx) })
}

/** 首次在屏：每回执至多一次；只由渲染路径写（归因率分母）。 */
export async function markSeen(ctx: Context, calibrationIds: readonly string[]): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return
  for (const calibrationId of calibrationIds) {
    const state = asRecord(pledger.object('calibration', calibrationId)?.state)
    if (state === undefined || state.seen === true) continue
    await pledger.append({ type: 'calibration/seen', data: { calibrationId }, actor: { kind: 'system' } })
  }
}

/** 换挡：写一句软合同私账句。P1 三句只接验收族。 */
export async function setClause(ctx: Context, key: Exclude<ClauseKey, 'lease'>, family?: string): Promise<string> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  const scoped = key === 'morning' ? undefined : (family ?? 'acceptance')
  if (scoped !== undefined && familySpec(scoped)?.clauses !== true) {
    return `「${familyLabel(scoped)}」这类还没接上，先只有验收。`
  }
  await pledger.append({
    type: 'clause/set',
    data: { clauseId: clauseIdFor(key, scoped), key, ...(scoped === undefined ? {} : { family: scoped }), text: CLAUSE_TEXT[key] },
    actor: operatorActor(ctx),
  })
  return `记下了：「${CLAUSE_TEXT[key]}」。这是你定的规矩，我照做；在合同面板能看到、能删。`
}

export async function clearClause(ctx: Context, key: ClauseKey, family?: string): Promise<string> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  const clauseId = clauseIdFor(key, key === 'morning' ? undefined : family ?? 'acceptance')
  const state = asRecord(pledger.object('clause', clauseId)?.state)
  if (state === undefined || state.active !== true) return '这一句本来就没有。'
  await pledger.append({ type: 'clause/cleared', data: { clauseId }, actor: operatorActor(ctx) })
  return `好，删掉了：「${asString(state.text) ?? key}」。`
}

/** 租约出口的私记：组织侧 lease/granted 落地后，私账多一条 `clause{key:'lease'}`（组织图零字段）。 */
export async function recordLeaseClause(ctx: Context, input: { readonly leaseRef: string; readonly family: string; readonly text: string }): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return
  const clauseId = clauseIdFor('lease', input.leaseRef)
  if (pledger.object('clause', clauseId) !== undefined) return
  await pledger.append({
    type: 'clause/set',
    data: { clauseId, key: 'lease', family: input.family, text: input.text, leaseRef: input.leaseRef },
    actor: operatorActor(ctx),
  })
}

/** 生效中的软合同句。 */
export function activeClauses(ctx: Context): readonly { clauseId: string; key: ClauseKey; family?: string; text: string; leaseRef?: string; at: number }[] {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return []
  const out: { clauseId: string; key: ClauseKey; family?: string; text: string; leaseRef?: string; at: number }[] = []
  for (const object of pledger.query('clause')) {
    const state = asRecord(object.state)
    if (state?.active !== true) continue
    const key = asString(state.key) as ClauseKey | undefined
    const text = asString(state.text)
    if (key === undefined || text === undefined) continue
    out.push({
      clauseId: object.id, key, text, at: object.updatedAt,
      ...(asString(state.family) === undefined ? {} : { family: asString(state.family) as string }),
      ...(asString(state.leaseRef) === undefined ? {} : { leaseRef: asString(state.leaseRef) as string }),
    })
  }
  return out
}

export function clauseOn(ctx: Context, key: Exclude<ClauseKey, 'lease'>, family?: string): boolean {
  return activeClauses(ctx).some(one => one.key === key && (key === 'morning' || one.family === (family ?? 'acceptance')))
}
