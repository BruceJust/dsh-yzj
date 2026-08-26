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
  /** 义务线：去掉 transferred 之后的那一份。计数与评估读它，见 `goalEvidence` 的注释。 */
  readonly obligationLine: readonly GoalChild[]
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
  /*
    移交要说出来，而且要和作废分得开（决策 #59）。

    差距简报是拿去对账的东西：一条被转手的活在这里显示成「没有进展」，读简报的人会以为
    它停着——而它正在另一条边上跑。两条边都挂在同一个目标下，所以简报里本来就看得到
    接手的那一条。
  */
  if (status === 'transferred') return '已移交'
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

  /*
    义务线：链尾的现行边代表这条义务，transferred 边是它的责任史。见返回值上的注释。
  */
  const line = children.filter(child => child.status !== 'transferred')

  // 第二跳：the artifacts those topics produced. A goal has no artifacts of its
  // own — it has the work under it, and the work leaves things behind.
  //
  // **遍历的是 `children` 而不是 `line`**（v3.19r② 工件归集例外）：移交封存的是责任史，
  // 不是产出。少了这一句，旧执行者做到一半留下的东西会随着一次移交从目标上消失。
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
    /**
     * **义务线** —— 一条义务经 N 次移交是一条义务，不是 N 条承诺 (v3.19r②).
     *
     * 计数与评估都读这一份，而不是 `children`：transferred 边是**责任史封存卷宗**，
     * 它的义务并没有结束，正在链尾那条现行边上活着。把它算进「已了」，目标每被移交一
     * 次就凭空多一格完成度，差距简报把同一件事列两遍——而这两处恰恰是拿去对账的。
     *
     * `children` 保留全量：**留档要看得见**（板上那一行说得出「已移交 → 王五」），
     * 产出归集也要遍历它——张锐做了一半的东西不因为移交就蒸发（吸收态封存的是责任史，
     * 不是产出）。可见与计数是两件事。
     */
    obligationLine: line,
    artifacts,
    counts: {
      open: line.filter(child => child.status === 'open' && !child.overdue).length,
      overdue: line.filter(child => child.overdue).length,
      settled: line.filter(child => child.status !== 'open').length,
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
