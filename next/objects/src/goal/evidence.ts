/**
 * 目标三看的数据面：状态 / 产出 / 过程 (v4.9).
 *
 * All three are QUERIES. 目标是取景框不是第二存储 — a goal that copied its
 * children's state into itself would need somebody to keep the copy true, and
 * "somebody keeps it true" is the maintenance cost that killed OKR tools. So
 * nothing here is stored:
 *
 * - **状态** — counts of child commitments. 聚合是信号不是状态: they inform, they
 *   never close the parent.
 * - **产出** — a two-hop derived join (goal → commitments → the artifacts their
 *   topics produced). Not a new edge; the edges were already there.
 * - **过程** — a one-line SUMMARY plus the session to jump to. 一跳可达、绝不
 *   搬运: the trajectory stays where it lives, and the goal view never grows a
 *   second timeline of it.
 *
 * Shared by the board and by the assessment tool on purpose: 验收材料 and the
 * board's signal must be the same reading of the same facts, or the operator is
 * deciding on numbers the screen disagrees with.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphViewer } from '@yzj-next/graph'
import { goalCommitmentIdFor } from './family.ts'

/** One artifact produced under a goal, with the commitment it came through. */
export interface GoalArtifact {
  readonly uri: string
  readonly title: string
  readonly action: string
  readonly time: number
  /** The child commitment whose topic produced it — the second hop. */
  readonly viaCommitmentId?: string
  /**
   * 哪一件活留下的 (4h⑤)。
   *
   * 有它 = 精确归属；没有 = 只知道产在哪个话题里，而一个话题可以同时服务好几个
   * 目标——那时这条工件对每个目标都只是「可能是我的」。
   */
  readonly viaTaskId?: string
  /** 归属是兜底来的：只知道话题，不知道是哪件活。 */
  readonly shared?: boolean
}

/** One child commitment as the evidence bundle sees it. */
export interface GoalChild {
  readonly id: string
  readonly what: string
  readonly who: string
  readonly status: string
  readonly due?: string
  readonly overdue: boolean
  readonly topicKey?: string
  /** 过程摘要 — the last thing that happened, one line, never the log. */
  readonly progress?: string
  readonly notified?: 'sent' | 'failed'
}

export interface GoalEvidence {
  readonly goalRef: string
  readonly goalName?: string
  readonly owner?: string
  readonly status: string
  /** The success criteria the goal was SIGNED with (v4.10 磨点在可验收). */
  readonly criteria?: string
  readonly children: readonly GoalChild[]
  readonly artifacts: readonly GoalArtifact[]
  readonly counts: {
    readonly open: number
    readonly overdue: number
    readonly settled: number
  }
}

/** A due string that is a real date in the past. Vague dues never count. */
function overdueAt(due: string | undefined, now: number): boolean {
  if (due === undefined) return false
  const parsed = Date.parse(due)
  return Number.isFinite(parsed) && parsed < now
}

/**
 * The progress line for one child.
 *
 * Deliberately the LAST fact rather than a digest of everything: a summary that
 * tries to say what happened over a week is a second timeline in disguise, and
 * §7.4's ruling is that the process is one hop away, never carried here.
 */
function progressOf(state: Record<string, unknown> | undefined): string | undefined {
  const receipt = typeof state?.lastReceipt === 'string' ? state.lastReceipt : undefined
  if (receipt !== undefined && receipt !== '') return receipt
  const status = typeof state?.status === 'string' ? state.status : 'open'
  if (status === 'closed') return '已完成'
  if (status === 'voided') return '已作废'
  return undefined
}

/**
 * Everything the graph can honestly say about one goal.
 *
 * `viewer` is passed in rather than assumed: the board reads as the operator,
 * and a turn bound to a group reads as that place. A function that picked its
 * own viewer would be a way to read across places and then speak the result
 * out loud (§3.3).
 */
export function goalEvidence(
  ctx: Context,
  viewer: GraphViewer,
  goalRef: string,
  now = Date.now(),
): GoalEvidence {
  /*
    结构可见，措辞不可见 (§3.3).

    `rawObject` bypasses `audienceAllows`, and reading the goal that way handed
    a group-bound turn the NAME, the OWNER and the SUCCESS CRITERIA of a goal
    declared privately on the desktop — which the agent then reads aloud in
    that group. The children were viewer-scoped all along; the goal itself was
    the hole, and it was the part carrying the words.

    But refusing outright would be wrong too: whoever asked already holds the
    URI, and the work hanging off it in THIS place is legitimately theirs to
    see. So the two reads are split by what they carry — existence and status
    are structure (they reveal nothing the caller did not already have), while
    every human-authored string comes only from the scoped read.
  */
  const goalId = goalCommitmentIdFor(goalRef)
  const structure = asRecord(ctx.yzjGraph.rawObject('commitment', goalId)?.state)
  const goal = asRecord(ctx.yzjGraph.object(viewer, 'commitment', goalId)?.state)
  const children: GoalChild[] = []
  const topics = new Map<string, string>()
  for (const object of ctx.yzjGraph.query(viewer, { kind: 'commitment' })) {
    const state = asRecord(object.state)
    if (asString(state?.parentGoalRef) !== goalRef) continue
    const executor = asRecord(state?.executor)
    const due = asString(state?.due)
    const status = asString(state?.status) ?? 'open'
    const topicKey = asString(state?.topicKey) ?? asString(executor?.topicKey)
    if (topicKey !== undefined) topics.set(topicKey, object.id)
    const notified = asString(state?.notified)
    children.push({
      id: object.id,
      what: asString(state?.what) ?? '',
      who: asString(executor?.kind) === 'human'
        ? asString(executor?.name) ?? asString(executor?.openId) ?? '某人'
        : 'agent',
      status,
      overdue: status === 'open' && overdueAt(due, now),
      ...(due === undefined ? {} : { due }),
      ...(topicKey === undefined ? {} : { topicKey }),
      ...(progressOf(state) === undefined ? {} : { progress: progressOf(state) as string }),
      ...(notified === 'sent' || notified === 'failed' ? { notified } : {}),
    })
  }

  // 第二跳：the artifacts those topics produced. A goal has no artifacts of its
  // own — it has the work under it, and the work leaves things behind.
  const artifacts: GoalArtifact[] = []
  const seen = new Set<string>()
  for (const event of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    const data = asRecord(event.data)
    const topicKey = asString(data?.topicKey)
    if (topicKey === undefined || !topics.has(topicKey)) continue
    const artifact = asRecord(data?.artifact)
    const uri = asString(artifact?.uri)
    if (uri === undefined || seen.has(uri)) continue
    seen.add(uri)
    const taskId = asString(data?.taskId)
    artifacts.push({
      uri,
      title: asString(artifact?.title) ?? uri,
      action: asString(data?.action) ?? '产出',
      time: event.time,
      ...(topics.get(topicKey) === undefined
        ? {}
        : { viaCommitmentId: topics.get(topicKey) as string }),
      // 说得出是哪件活留下的就是精确归属；说不出就标出来，别让兜底冒充精确。
      ...(taskId === undefined ? { shared: true } : { viaTaskId: taskId }),
    })
  }
  artifacts.sort((left, right) => right.time - left.time)

  const criteria = asString(goal?.criteria)
  const owner = asString(asRecord(goal?.executor)?.name)
    ?? asString(asRecord(goal?.executor)?.openId)
  return {
    goalRef,
    ...(asString(goal?.what) === undefined ? {} : { goalName: asString(goal?.what) as string }),
    ...(owner === undefined ? {} : { owner }),
    status: asString(structure?.status) ?? 'unknown',
    ...(criteria === undefined ? {} : { criteria }),
    children,
    artifacts,
    counts: {
      open: children.filter(child => child.status === 'open' && !child.overdue).length,
      overdue: children.filter(child => child.overdue).length,
      settled: children.filter(child => child.status !== 'open').length,
    },
  }
}

/** Every goal the viewer can see, newest declaration first. */
export function visibleGoals(
  ctx: Context,
  viewer: GraphViewer,
): readonly { readonly goalRef: string; readonly what: string; readonly status: string }[] {
  const out: { goalRef: string; what: string; status: string }[] = []
  for (const object of ctx.yzjGraph.query(viewer, { kind: 'commitment' })) {
    const state = asRecord(object.state)
    const goalRef = asString(state?.goalRef)
    if (goalRef === undefined) continue
    out.push({
      goalRef,
      what: asString(state?.what) ?? goalRef,
      status: asString(state?.status) ?? 'open',
    })
  }
  return out
}
