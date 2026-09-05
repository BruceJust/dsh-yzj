/**
 * 镜像行 —— 同侪实例登记的承诺，在本实例图上的**滞后镜像** (决策 #63 §7.4, 段 4q P1.5).
 *
 * 公域承诺的真身 = 登记者实例的图。本实例只从群消息流里带句柄的登记 ack / 终态回声
 * **物化**一行镜像：`origin` 记着它是谁的图上的真身；幂等锚 = (operatorOpenId, handle)。
 * 镜像永不本地改写、永不回写；状态只随后续回声往前走（允许滞后，禁止错序）；修理动词
 * 按主权自然不渲染——镜像行的动作 = 文本传送门（去群里对那个实例说）。
 */
import { createHash } from 'node:crypto'
import type { YzjGraph } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

export type MirrorStatus = 'open' | 'closed' | 'voided' | 'merged' | 'transferred' | 'rework'

/** 一条同侪出站里读出来的承诺样子。`commitmentId` 缺席 = 只有终态回声、没有句柄，要按回复锚找。 */
export interface MirrorSighting {
  readonly commitmentId?: string
  readonly status: MirrorStatus
  readonly what: string
  readonly executor?: string
  readonly due?: string
  readonly cause?: string
  /** 打回回声带的轮次；镜像只往前走，轮次不倒退。 */
  readonly round?: number
}

const HEAD = /【承诺·(进行中|已完成|已作废|已合并|已移交|打回)】(.+)/u
const HANDLE = /\[card#commitment:([^\]\s]+)\]/u
const EXECUTOR = /^执行者：(.+?)(?:\s·\s期限\s(.+))?$/u
const STATUS: Record<string, MirrorStatus> = { 进行中: 'open', 已完成: 'closed', 已作废: 'voided', 已合并: 'merged', 已移交: 'transferred', 打回: 'rework' }
const ROUND = /\s*·\s*第\s*(\d+)\s*轮\s*$/u

/** 只认承诺卡的投影形状（`【承诺·状态】…` 头 + 可选句柄）。别的实例出站一律不是镜像源。 */
export function readMirror(content: string): MirrorSighting | undefined {
  const lines = content.split('\n').map(line => line.trim())
  const headLine = lines.find(line => HEAD.test(line))
  if (headLine === undefined) return undefined
  const head = HEAD.exec(headLine)
  const status = STATUS[head?.[1] ?? '']
  if (head === null || status === undefined) return undefined
  let what = (head[2] ?? '').trim()
  let cause: string | undefined
  const roundMatch = ROUND.exec(what)
  const round = roundMatch?.[1] === undefined ? undefined : Number(roundMatch[1])
  if (roundMatch !== null) what = what.slice(0, roundMatch.index).trim()
  const tail = /^(.*)（([^（）]*)）$/u.exec(what)
  if (tail !== null && status !== 'open') { what = (tail[1] ?? '').trim(); cause = (tail[2] ?? '').trim() }
  const handle = HANDLE.exec(content)?.[1]
  const executorLine = lines.map(line => EXECUTOR.exec(line)).find(match => match !== null)
  return {
    ...(handle === undefined ? {} : { commitmentId: handle }),
    status,
    what,
    ...(executorLine?.[1] === undefined ? {} : { executor: executorLine[1].trim() }),
    ...(executorLine?.[2] === undefined ? {} : { due: executorLine[2].trim() }),
    ...(cause === undefined ? {} : { cause }),
    ...(round === undefined ? {} : { round }),
  }
}

export function mirrorIdemKey(operatorOpenId: string, handle: string): string {
  return `mirror:${operatorOpenId}:${handle}`
}

/** 本地 id 永不与本机登记撞名：镜像是另一本真身的影子，不是同一条边。 */
export function mirrorIdFor(operatorOpenId: string, handle: string): string {
  return `mir-${createHash('sha256').update(mirrorIdemKey(operatorOpenId, handle)).digest('hex').slice(0, 24)}`
}

export interface MirrorSource {
  /** 那个实例的操作者（消息的 fromOpenId）。 */
  readonly operatorOpenId: string
  readonly msgId: string
  readonly placeKey: string
  readonly time: number
  /** 这条消息回复的是哪条——终态回声不带句柄，靠它找到镜像。 */
  readonly replyMsgId?: string
}

/** 把一次目击落到图上。返回做了什么（测试与日志用）。 */
export async function applyMirror(
  graph: YzjGraph, sighting: MirrorSighting, source: MirrorSource,
): Promise<'opened' | 'advanced' | 'ignored'> {
  const viewer = { kind: 'operator' as const, openId: '' }
  const handle = sighting.commitmentId === undefined ? undefined : `[card#commitment:${sighting.commitmentId}]`
  const existing = handle === undefined
    ? graph.query(viewer, { kind: 'commitment' }).find((object) => {
      const origin = asRecord(asRecord(object.state)?.origin)
      return asString(origin?.operatorOpenId) === source.operatorOpenId && asString(origin?.msgAnchor) === source.replyMsgId
    })
    : graph.findByIdemKey(mirrorIdemKey(source.operatorOpenId, handle))
  if (existing === undefined) {
    // 没句柄找不到锚，或第一次见到的就是终态：不物化一行死的镜像。
    if (handle === undefined || sighting.commitmentId === undefined || sighting.status !== 'open') return 'ignored'
    const executor = sighting.executor === undefined || sighting.executor === 'agent'
      ? { kind: 'agent' as const, topicKey: `mirror:${source.operatorOpenId}` }
      : { kind: 'human' as const, openId: `unresolved:${sighting.executor}`, name: sighting.executor }
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: mirrorIdFor(source.operatorOpenId, handle),
        what: sighting.what,
        executor,
        sourceAnchor: `yzj:${source.msgId}`,
        ...(sighting.due === undefined ? {} : { due: sighting.due }),
        delegatedBy: source.operatorOpenId,
        audience: [source.placeKey],
        origin: { kind: 'foreign', operatorOpenId: source.operatorOpenId, handle, msgAnchor: source.msgId },
        idemKey: mirrorIdemKey(source.operatorOpenId, handle),
      },
      actor: { kind: 'system' },
    })
    return 'opened'
  }
  if (sighting.status === 'open') return 'ignored'
  // 只往前走：已经终态的镜像不再被更晚（或更早、乱序到达）的回声改写。
  if (asString(asRecord(existing.state)?.status) !== 'open') return 'ignored'
  const commitmentId = existing.id
  if (sighting.status === 'rework') {
    // 打回：轮次只升不降——同一轮的回声再来一次不重复记。
    const current = asRecord(existing.state)?.round
    const round = sighting.round ?? 1
    if (typeof current === 'number' && current >= round) return 'ignored'
    const reason = `镜像：真身被打回${sighting.cause === undefined || sighting.cause === '' ? '' : `（${sighting.cause}）`}`
    await graph.append({ type: 'commitment/rework', data: { commitmentId, reason, round }, actor: { kind: 'system' } })
    return 'advanced'
  }
  if (sighting.status === 'closed') {
    await graph.append({ type: 'commitment/closed', data: { commitmentId, cause: 'done' }, actor: { kind: 'system' } })
  } else {
    const label = sighting.status === 'voided' ? '已作废' : sighting.status === 'merged' ? '已合并' : '已移交'
    const cause = `镜像：真身${label}${sighting.cause === undefined || sighting.cause === '' ? '' : `（${sighting.cause}）`}`
    await graph.append({ type: 'commitment/voided', data: { commitmentId, cause }, actor: { kind: 'system' } })
  }
  return 'advanced'
}
