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
  /** Cap on artifact lines; the rest are counted. */
  readonly maxArtifacts?: number
}

interface ArtifactLine {
  readonly action: string
  readonly title: string
  readonly uri: string
}

function artifactOf(data: Record<string, JsonValue> | undefined): ArtifactLine | undefined {
  const artifact = asRecord(data?.artifact)
  const uri = asString(artifact?.uri)
  if (uri === undefined) return undefined
  return {
    action: asString(data?.action) ?? '产出',
    title: asString(artifact?.title) ?? uri,
    uri,
  }
}

/**
 * Render the summary for one topic, or undefined when nothing happened worth
 * summarizing (a pure question produced no edges, and a summary of nothing is
 * noise).
 */
export function processSummary(ctx: Context, input: ProcessSummaryInput): string | undefined {
  const maxArtifacts = input.maxArtifacts ?? 8

  const produced: ArtifactLine[] = []
  for (const event of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    const data = asRecord(event.data)
    if (asString(data?.topicKey) !== input.topicKey) continue
    const line = artifactOf(data)
    if (line !== undefined) produced.push(line)
  }

  const decisions: string[] = []
  for (const event of ctx.yzjGraph.rawEvents(['approval/decided', 'approval/expired'])) {
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
    .map(object => asString(asRecord(object.state)?.what) ?? '未命名')

  if (produced.length === 0 && decisions.length === 0 && waits.length === 0) return undefined

  const artifactLines = produced.slice(0, maxArtifacts)
    .map(line => `· ${line.action}：${line.title}\n  ${line.uri}`)
  const overflow = produced.length - artifactLines.length

  return [
    '【过程摘要】',
    ...(artifactLines.length === 0 ? [] : ['产出：', ...artifactLines]),
    ...(overflow > 0 ? [`  （另有 ${String(overflow)} 项产出）`] : []),
    ...(decisions.length === 0 ? [] : ['确认记录：', ...decisions.map(line => `· ${line}`)]),
    ...(waits.length === 0 ? [] : ['仍在等待：', ...waits.map(line => `· ${line}`)]),
  ].join('\n')
}
