/**
 * 交付推断 —— 行为回执 (v3.12 = v4.20 回执面第二门；P1 仅操作者本人).
 *
 * 执行者只甩工件不说话：操作者自己把一个文件丢进某个会话，watcher 在**他自己名下未终态
 * 的承诺**里找像的（合法查询，§1.6 不破），找到了递一张提议卡「这像是『X』的交付——挂为
 * 交付回执？」投给他本人。**先问而非默认生效**：行为回执要替执行者说一句他没说过的话，
 * 代发言是社交行为不可默认代做。保守推断、亮出可纠、宁空勿错。
 *
 * 幂等锚 = (工件消息锚)：同一个文件只问一次；驳回即该配对入吸收态；同一文件像多条承诺
 * 时合并一卡供选，不连发。
 */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'

export interface FileSighting {
  readonly placeKey: string
  readonly groupId?: string
  readonly msgId: string
  readonly fromOpenId: string
  readonly fileId: string
  readonly name: string
  readonly ext?: string
  readonly time: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 通道的观测：操作者本人在某场所甩了一个文件（非图片）。识别归这里，分诊定序不动。 */
    'yzj-channel/file-seen'(payload: FileSighting): void
  }
}

export interface DeliveryCandidate {
  readonly commitmentId: string
  readonly what: string
}

const CJK = /[一-鿿]{2,}/gu
const LATIN = /[a-z0-9][a-z0-9_-]{2,}/giu
/** 太泛的词不算证据：光凭「报表」两个字配不上一条承诺。 */
const STOP = new Set(['报表', '文档', '文件', '资料', '材料', '一下', '一份', '这个', '那个', '我们', '你们', '他们', 'final', 'draft', 'copy', 'new', 'doc', 'docx', 'xlsx', 'pdf'])

function stem(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/u, '').toLowerCase()
}

/**
 * 像不像：承诺原话里的一段（≥3 个汉字，或 ≥4 位字母数字）原样出现在文件名里。
 * 只认原样子串，不做语义——语义比对的错误方向是「像了不该像的」，而这一门宁空勿错。
 */
export function looksLikeDelivery(fileName: string, what: string): boolean {
  const file = stem(fileName)
  if (file === '') return false
  for (const run of what.match(CJK) ?? []) {
    for (let width = run.length; width >= 3; width -= 1) {
      for (let start = 0; start + width <= run.length; start += 1) {
        const piece = run.slice(start, start + width)
        if (!STOP.has(piece) && file.includes(piece)) return true
      }
    }
  }
  for (const word of what.match(LATIN) ?? []) {
    const piece = word.toLowerCase()
    if (piece.length >= 4 && !STOP.has(piece) && file.includes(piece)) return true
  }
  return false
}

/** 操作者本人名下、还没交付主张的承诺里，像这个文件的那几条。 */
export function candidatesFor(ctx: Context, sighting: FileSighting): readonly DeliveryCandidate[] {
  const out: DeliveryCandidate[] = []
  // 旧的在前：卡上的编号要稳定，人「确认 2」指的得是同一条。
  const open = [...ctx.yzjGraph.query({ kind: 'operator', openId: sighting.fromOpenId }, { kind: 'commitment', status: ['open'] })]
    .sort((left, right) => left.createdSeq - right.createdSeq)
  for (const object of open) {
    const state = asRecord(object.state)
    const executor = asRecord(state?.executor)
    if (asString(executor?.kind) !== 'human' || asString(executor?.openId) !== sighting.fromOpenId) continue
    if (asRecord(state?.delivery) !== undefined) continue
    const what = asString(state?.what) ?? ''
    if (looksLikeDelivery(sighting.name, what)) out.push({ commitmentId: object.id, what })
  }
  return out
}

export function deliveryProposalIdFor(msgId: string): string {
  return `prp-dlv-${createHash('sha256').update(msgId).digest('hex').slice(0, 20)}`
}

/**
 * 看到一个文件：像的话递卡（一次），不像就什么都不做。返回递出的提案 id。
 */
export async function inferDelivery(ctx: Context, sighting: FileSighting): Promise<string | undefined> {
  const proposalId = deliveryProposalIdFor(sighting.msgId)
  if (ctx.yzjGraph.rawObject('proposal', proposalId) !== undefined) return undefined
  const candidates = candidatesFor(ctx, sighting)
  if (candidates.length === 0) return undefined
  await ctx.yzjGraph.append({
    type: 'proposal/opened',
    data: {
      proposalId,
      kind: 'delivery',
      title: candidates.length === 1
        ? `这像是「${candidates[0]?.what ?? ''}」的交付——挂为交付回执？`
        : `「${sighting.name}」像是下面哪一条的交付？`,
      items: candidates.map(candidate => ({ what: candidate.what, commitmentId: candidate.commitmentId, evidence: sighting.name })),
      artifact: { msgId: sighting.msgId, fileId: sighting.fileId, name: sighting.name, placeKey: sighting.placeKey },
      sourceAnchor: `yzj:${sighting.msgId}`,
      placeKey: sighting.placeKey,
      decider: sighting.fromOpenId,
    },
    actor: { kind: 'system' },
  })
  const channel = ctx.get('yzjCardChannel')
  if (channel !== undefined) {
    await channel.deliverToOperator({ kind: 'proposal', id: proposalId }).catch((error: unknown) => {
      console.error('[yzj-next-delivery] failed to deliver the inference card', error)
    })
  }
  return proposalId
}

/** 接上通道的观测源；没有通道（测试、离线）时静默。 */
export function applyDeliveryInference(ctx: Context): () => void {
  const off = ctx.on('yzj-channel/file-seen', (payload) => {
    void inferDelivery(ctx, payload).catch((error: unknown) => {
      console.error('[yzj-next-delivery] inference failed', error)
    })
  })
  /*
    确认之后以执行者名义**回流登记场所**（回程律）：登记的听众看到出生，也该看到交付。
    代发一句「已交付」——确认即签发代发，同拆解代发授权模型。
  */
  const offEcho = ctx.on('yzj-graph/appended', (event) => {
    if (event.type !== 'proposal/item-decided') return
    const data = asRecord(event.data)
    if (asString(data?.decision) !== 'confirmed') return
    const proposal = asRecord(ctx.yzjGraph.rawObject('proposal', asString(data?.proposalId) ?? '')?.state)
    if (asString(proposal?.kind) !== 'delivery') return
    const index = typeof data?.index === 'number' ? data.index : -1
    const items = Array.isArray(proposal?.items) ? proposal.items : []
    const item = asRecord(items[index])
    const commitment = asRecord(ctx.yzjGraph.rawObject('commitment', asString(item?.commitmentId) ?? '')?.state)
    const place = asString(commitment?.notifyPlaceKey) ?? (Array.isArray(commitment?.audience) ? asString(commitment.audience[0]) : undefined)
    const topics = ctx.get('yzjTopics')
    const artifact = asRecord(proposal?.artifact)
    if (place === undefined || topics === undefined || commitment === undefined) return
    void topics.sendInPlace(place, `已交付：${asString(commitment.what) ?? ''}（${asString(artifact?.name) ?? '工件'}）`).catch((error: unknown) => {
      console.error('[yzj-next-delivery] failed to announce the delivery', error)
    })
  })
  return () => { off(); offEcho() }
}
