/** 私条 —— 一个组合点四种条（押 / 回执 / 先看 / 上次），裁决卡下、私语道内、仅操作者桌面（接缝⑤）。 */
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import { familyLabel, FAMILIES } from './families.ts'
import { clauseOn } from './pledge.ts'
import { pledgeRows, receiptRows, type PledgeRow, type ReceiptRow } from './judg.ts'
import type { AnchoredText } from './types.ts'

export type Strip =
  | { readonly kind: 'pledge'; readonly row: PledgeRow }
  | { readonly kind: 'receipt'; readonly row: ReceiptRow }
  | { readonly kind: 'spread'; readonly requirements: readonly AnchoredText[]; readonly delivery: readonly AnchoredText[] }
  | { readonly kind: 'mirror'; readonly family: string; readonly cases: readonly ReceiptRow[] }

const CARD_FAMILY: Readonly<Record<string, string>> = { commitment: 'acceptance', task: 'acceptance', approval: 'write-confirm', proposal: 'proposal', assessment: 'assessment' }

export function familyOfCard(kind: string): string | undefined {
  const family = CARD_FAMILY[kind]
  return family !== undefined && FAMILIES.some(spec => spec.family === family) ? family : undefined
}

/** 这张裁决卡下面的私条们。 */
export function stripsFor(ctx: Context, cardKind: string, id: string, resolved: boolean, now = Date.now()): readonly Strip[] {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return []
  const out: Strip[] = []
  const family = familyOfCard(cardKind)
  const mine = (anchor: AnchoredText | undefined): boolean => anchor?.anchor?.kind === cardKind && anchor.anchor.id === id
  for (const row of pledgeRows(ctx, now)) if (mine(row.verdict) && row.status !== 'withdrawn') out.push({ kind: 'pledge', row })
  for (const row of receiptRows(ctx)) if (mine(row.verdict)) out.push({ kind: 'receipt', row })
  if (family === 'acceptance' && !resolved) {
    if (clauseOn(ctx, 'spread', family)) out.push({ kind: 'spread', ...spreadOf(ctx, cardKind, id, now) })
    if (clauseOn(ctx, 'mirror', family)) {
      const cases = receiptRows(ctx).filter(row => row.family === family && row.attribution !== undefined && !row.dismissed).slice(0, 2)
      if (cases.length > 0) out.push({ kind: 'mirror', family: familyLabel(family), cases })
    }
  }
  return out
}

/** 「先看」= 要求 × 交付。要求：目标成功标准；没目标就是对方原话 + 委派原话。交付：主张 + 轮次 + 工件。任务卡（task）走同一张脸：原话 × 这条话题里产出的工件。 */
function spreadOf(ctx: Context, cardKind: string, id: string, now: number): { requirements: AnchoredText[]; delivery: AnchoredText[] } {
  const graph = ctx.get('yzjGraph')
  const state = asRecord(graph?.rawObject(cardKind === 'task' ? 'task' : 'commitment', id)?.state)
  const at = new Date(now).toISOString()
  const requirements: AnchoredText[] = []
  const goalRef = cardKind === 'task' ? undefined : asString(state?.parentGoalRef)
  if (goalRef !== undefined && graph !== undefined) {
    for (const event of graph.rawEvents(['commitment/opened'])) {
      const data = asRecord(event.data)
      if (asString(data?.goalRef) !== goalRef) continue
      const criteria = asString(asRecord(graph.rawObject('commitment', asString(data?.commitmentId) ?? '')?.state)?.criteria)
      if (criteria !== undefined) {
        criteria.split('\n').map(line => line.trim()).filter(line => line !== '').forEach((line, index) => {
          requirements.push({ text: `目标要求 ${String(index + 1)}：${line}`, at, anchor: { kind: 'goal', id: goalRef } })
        })
      }
      break
    }
  }
  if (requirements.length === 0) requirements.push({ text: `${cardKind === 'task' ? '对方原话' : '委派原话'}：${asString(state?.what) ?? ''}`, at })
  const delivery: AnchoredText[] = []
  const claim = asRecord(state?.delivery)
  if (asString(claim?.claim) !== undefined) delivery.push({ text: `交付主张：${asString(claim?.claim) ?? ''}`, at })
  if (typeof state?.round === 'number' && state.round > 0) delivery.push({ text: `返工第 ${String(state.round)} 轮`, at })
  if (graph !== undefined) {
    const topic = asString(state?.topicKey) ?? asString(asRecord(state?.executor)?.topicKey)
    for (const event of graph.rawEvents(['lineage/produced'])) {
      const data = asRecord(event.data)
      if (asString(data?.topicKey) !== topic) continue
      const artifact = asRecord(data?.artifact)
      delivery.push({ text: `交付物：${asString(artifact?.title) ?? asString(artifact?.uri) ?? ''}`, at })
    }
  }
  if (delivery.length === 0) delivery.push({ text: '（还没有交付物）', at })
  return { requirements, delivery }
}
