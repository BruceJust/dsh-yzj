/**
 * The process summary — a transparency artifact, projected free from the graph.
 *
 * Nothing here is stored: the summary is the read-out of edges that were
 * already recorded for other reasons (what was produced, what was approved,
 * what is still waited on). That is the point — a summary that needed its own
 * bookkeeping would drift from the work, and a summary that costs nothing gets
 * posted every time instead of only when somebody remembers to.
 *
 * It goes to the task's own place, because its audience is the group that
 * delegated the work, not the operator who already watched it happen.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  asRecord, asString, type GraphViewer, type JsonValue,
} from '@yzj-next/graph'

export interface ProcessSummaryInput {
  readonly topicKey: string
  readonly viewer: GraphViewer
  /**
   * Only what happened from this moment on (epoch ms) — the span of the task
   * being delivered. A DM or self-chat is one long-lived topic; summarizing
   * the whole topic made every delivery claim the documents, approvals and
   * waits of every earlier task (实测 2026-10-21：一句「我有几个知识库」交回来，
   * 摘要里写着三次「写入文档内容」和一条「顺延承诺期限 → 已放行」).
   * Omit for the topic-wide pull view (`/status`).
   */
  readonly since?: number
  /** Cap on artifact lines; the rest are counted. */
  readonly maxArtifacts?: number
}

interface ArtifactLine {
  readonly action: string
  readonly title?: string
  readonly uri: string
  times: number
}

function artifactOf(data: Record<string, JsonValue> | undefined): ArtifactLine | undefined {
  const artifact = asRecord(data?.artifact)
  const uri = asString(artifact?.uri)
  if (uri === undefined) return undefined
  const title = asString(artifact?.title)
  return { action: asString(data?.action) ?? '产出', ...(title === undefined ? {} : { title }), uri, times: 1 }
}

/** 同一份东西写了三遍是一行「×3」，不是三行；没有标题就不把链接写两遍。 */
function renderArtifact(line: ArtifactLine): string {
  const times = line.times > 1 ? ` ×${String(line.times)}` : ''
  return line.title === undefined
    ? `· ${line.action}${times}：${line.uri}`
    : `· ${line.action}${times}：${line.title}\n  ${line.uri}`
}

/**
 * Render the summary for one topic, or undefined when nothing happened worth
 * summarizing (a pure question produced no edges, and a summary of nothing is
 * noise).
 */
export function processSummary(ctx: Context, input: ProcessSummaryInput): string | undefined {
  const maxArtifacts = input.maxArtifacts ?? 8
  const since = input.since ?? Number.NEGATIVE_INFINITY

  const produced: ArtifactLine[] = []
  for (const event of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    if (event.time < since) continue
    const data = asRecord(event.data)
    if (asString(data?.topicKey) !== input.topicKey) continue
    const line = artifactOf(data)
    if (line === undefined) continue
    const same = produced.find(seen => seen.action === line.action && seen.uri === line.uri)
    if (same === undefined) produced.push(line)
    else same.times += 1
  }

  const decisions: string[] = []
  for (const event of ctx.yzjGraph.rawEvents(['approval/decided', 'approval/expired'])) {
    if (event.time < since) continue
    const data = asRecord(event.data)
    const approvalId = asString(data?.approvalId)
    if (approvalId === undefined) continue
    const approval = ctx.yzjGraph.rawObject('approval', approvalId)
    const state = asRecord(approval?.state)
    if (asString(state?.topicKey) !== input.topicKey) continue
    const status = asString(state?.status) ?? '?'
    const reason = asString(state?.reason) ?? asString(state?.toolName) ?? ''
    decisions.push(`${reason} → ${status === 'approved' ? '已放行' : status === 'rejected' ? '已拒绝' : '已超时'}`)
  }

  const waits = ctx.yzjGraph.query(input.viewer, { kind: 'waiting', status: ['open', 'escalated'] })
    .filter(object => asString(asRecord(object.state)?.topicKey) === input.topicKey)
    .filter(object => object.createdAt >= since)
    .map(object => asString(asRecord(object.state)?.what) ?? '未命名')

  if (produced.length === 0 && decisions.length === 0 && waits.length === 0) return undefined

  const artifactLines = produced.slice(0, maxArtifacts).map(renderArtifact)
  const overflow = produced.length - artifactLines.length

  return [
    '【过程摘要】',
    ...(artifactLines.length === 0 ? [] : ['产出：', ...artifactLines]),
    ...(overflow > 0 ? [`  （另有 ${String(overflow)} 项产出）`] : []),
    ...(decisions.length === 0 ? [] : ['确认记录：', ...decisions.map(line => `· ${line}`)]),
    ...(waits.length === 0 ? [] : ['仍在等待：', ...waits.map(line => `· ${line}`)]),
  ].join('\n')
}
