/**
 * `@yzj-next/objects` — the graph's object families.
 *
 * One npm package, several cordis plugins (TD-6'): the P1 families' events are
 * one coupled household, and the package is split only when a family grows up
 * or when the first genuinely external family — the verdict card in P1.5 —
 * arrives to prove the registration surface is really pluggable.
 * @module @yzj-next/objects
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as objApproval from './approval/index.ts'
import * as objCommitment from './commitment/index.ts'
import * as objEvent from './event/index.ts'
import * as objGoal from './goal/index.ts'
import * as objMinutes from './minutes/index.ts'
import * as objTask from './task/index.ts'
import { applyGraphTools } from './graph-tools.ts'
import { applyMemoryTools } from './memory/tools.ts'

export * as objApproval from './approval/index.ts'
export * as objCommitment from './commitment/index.ts'
export * as objEvent from './event/index.ts'
export * as objGoal from './goal/index.ts'
export * as objMinutes from './minutes/index.ts'
export * as objTask from './task/index.ts'
export { approvalCard } from './approval/card.ts'
export {
  approvalFamily, approvalIdFor, digestArgs, isTerminal, retryIdemKeyFor,
  type ApprovalState, type ApprovalStatus,
} from './approval/family.ts'
export { ApprovalAnswerer, YZJ_TEXT_SURFACE } from './approval/answerer.ts'
export type { PendingAsk, YzjAsks } from './approval/asks.ts'
export type { TurnBinding, YzjTurns } from './turns.ts'
export type { LeaseQuery, YzjLeases } from './leases.ts'
export {
  waitingCard, waitingFamily, waitingIdFor, waitingIdemKeyFor,
  type WaitingCloseCause, type WaitingState, type WaitingStatus,
} from './task/waiting.ts'
export { commitmentCard } from './commitment/card.ts'
export {
  commitmentFamily, commitmentIdFor, commitmentIdemKeyFor, earnsCommitment,
  isSettled, ownsCommitment, processFamily,
  type CommitmentExecutor, type CommitmentState, type CommitmentStatus,
} from './commitment/family.ts'
export { applyCommitmentTools } from './commitment/tools.ts'
export { assessmentCard } from './goal/assessment-card.ts'
export { createProposalCard } from './goal/proposal-card.ts'
export {
  armedGoalOf, assessmentFamily, assessmentIdFor, goalCommitmentIdFor, goalContextFamily,
  itemsFrom, proposalFamily, proposalIdFor, proposalSettled,
  type AssessmentLine, type AssessmentState, type GoalContextState,
  type ProposalDecision, type ProposalItem, type ProposalKind, type ProposalState,
} from './goal/family.ts'
export {
  goalEvidence, visibleGoals,
  type GoalArtifact, type GoalChild, type GoalEvidence,
} from './goal/evidence.ts'
export { applyGoalTools } from './goal/tools.ts'
export { eventFamily, type EventState } from './event/family.ts'
export {
  eventHub, materialsFor, readinessLine,
  type EventHub, type EventPrep, type Readiness,
} from './event/hub.ts'
export { applyEventTools } from './event/tools.ts'
export {
  proposalItemFor, readMinutes, trustOf,
  type ExecutorTrust, type MinutesDecision, type MinutesRead, type MinutesTask,
} from './minutes/bridge.ts'
export {
  ingestMinutes, pullAndIngest, type IngestOutcome, type YzjMinutesSource,
} from './minutes/ingest.ts'
export { applyCommitmentNotify } from './goal/notify.ts'
export { applyGoalWriteback, lineFor, writebackIdFor } from './goal/writeback.ts'
export { failureOf } from './bridge-error.ts'
export { applyGraphTools, describeObject } from './graph-tools.ts'
export { applyMemoryTools, memoriesFor, memoryIdFor } from './memory/tools.ts'
export { processSummary, type ProcessSummaryInput } from './summary.ts'
export { taskCard, taskFamily, type TaskArtifact, type TaskState, type TaskStatus } from './task/task.ts'
export {
  applyConflictTools, conflictCard, conflictStateOf, type ConflictState,
} from './task/conflict.ts'

export const name = 'yzj-next-objects'
/**
 * The package's own dependencies, declared at the package level.
 *
 * Their absence is what let the package-level tools ship broken: with no
 * declaration here, the loader hands `apply` a context that injects nothing,
 * and every `ctx.inject([...])` scope inside it starts from empty rather than
 * from what the package already needs.
 */
export const inject = ['yzjGraph', 'yzjCards', 'tools']

export interface Config {
  approval?: objApproval.Config
}

export const Config: z<Config> = z.object({
  approval: objApproval.Config,
})

/** Mount every P1 object family. */
export function apply(ctx: Context, config: Config): void {
  /**
   * `graph_query` belongs to no single family — it is the read window onto all
   * of them — so it mounts with the package rather than inside one plugin.
   * Memory is here for the same reason: it is what is left of all of them once
   * a task is over.
   *
   * **`yzjGraph` must be in the inject list, not just `tools`.** The scoped
   * context is what the tool bodies close over, and reading a service it did
   * not inject throws inside `execute` — so the tool registers fine, the model
   * calls it, and the failure appears as the model narrating a workaround
   * ("图记忆这次没写上，先落在 CONVENTIONS.md") instead of as a boot error.
   * Both tools were shipping broken exactly that way.
   */
  ctx.inject(['tools', 'yzjGraph'], (scoped) => {
    scoped.effect(() => applyGraphTools(scoped))
    scoped.effect(() => applyMemoryTools(scoped))
  })
  ctx.plugin(objApproval, config.approval ?? {})
  ctx.plugin(objTask)
  ctx.plugin(objCommitment)
  // After `objCommitment`: the goal plugin writes commitment events and listens
  // for them, so the family it depends on must already be defined.
  ctx.plugin(objGoal)
  // 事件枢纽读承诺的状态推材料就绪度，所以也排在承诺之后。
  ctx.plugin(objEvent)
  // 纪要双桥写 proposal 事件，所以排在定义了那一族的 objGoal 之后。
  ctx.plugin(objMinutes)
}
