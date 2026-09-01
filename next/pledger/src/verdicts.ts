/**
 * 裁决的读法 —— read-only, off the organization graph, one direction only.
 *
 * The private ledger needs to know two things about the other ledger: **which
 * verdicts you have handed down**, and **what has happened since**. Both are
 * already on the graph — 原料图已天然生产 — so nothing is written to the
 * organization side to make this work. That single-direction reading IS the
 * mechanism behind「组织图永不引用私账」: the arrow only has one head.
 *
 * Which answers count as verdicts is declared by the CARD FAMILY, not decided
 * here (家族即接口). The organization side emits a generic `verdict-settled`
 * and does not know a private ledger exists (接缝① / PTD-15); this module
 * reads the same declaration when it needs the history rather than the live
 * moment — after a restart, or for a verdict handed down before the ledger was
 * switched on.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asNumber, asObjectRef, asRecord, asString } from '@yzj-next/graph'
import { familyOfCardKind } from './families.ts'
import type { OrgAnchor } from './types.ts'

/** One verdict the operator has handed down, as the private ledger sees it. */
export interface SeenVerdict {
  readonly anchor: OrgAnchor
  readonly actionId: string
  readonly family: string
  readonly at: number
  readonly seq: number
}

/** Whether one organization card action is declared a verdict by its family. */
export function isVerdictAction(ctx: Context, kind: string, actionId: string): boolean {
  const definition = ctx.get('yzjCards')?.definitionOf(kind)
  if (definition === undefined) return false
  return definition.actions.some(action => action.id === actionId && action.verdict === true)
}

/**
 * What one organization object was called, snapshotted at read time.
 *
 * Read through `rawObject` rather than a viewer query on purpose: this is a
 * state machine resolving an anchor it already holds, not a viewer looking at
 * somebody's data. The organization bus makes the same distinction for the
 * same reason.
 */
export function labelOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.what) ?? asString(state?.summary) ?? asString(state?.reason)
}

/** Resolve one organization ref into an anchor, with whatever label it has now. */
export function anchorFor(ctx: Context, kind: string, id: string, graphSeq?: number): OrgAnchor {
  const label = labelOf(ctx, kind, id)
  return {
    kind,
    id,
    ...(graphSeq === undefined ? {} : { graphSeq }),
    ...(label === undefined ? {} : { label }),
  }
}

/**
 * Every verdict on the organization graph, oldest first.
 *
 * Derived from `answer/recorded` — the organization bus's own trace of「有人
 * 答了」— intersected with the families' `verdict` declaration. Nothing is
 * stored on the private side to mirror it: a second copy of the verdict list
 * would be a second thing that can disagree with the graph.
 */
export function seenVerdicts(ctx: Context): readonly SeenVerdict[] {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined) return []
  const out: SeenVerdict[] = []
  for (const event of graph.rawEvents(['answer/recorded'])) {
    const data = asRecord(event.data)
    if (data === undefined || data.outcome !== 'applied') continue
    const ref = asObjectRef(data.cardRef)
    const actionId = asString(data.actionId)
    if (ref === undefined || actionId === undefined) continue
    if (!isVerdictAction(ctx, ref.kind, actionId)) continue
    const family = familyOfCardKind(ref.kind)
    if (family === undefined) continue
    out.push({
      anchor: anchorFor(ctx, ref.kind, ref.id, event.seq),
      actionId,
      family: family.family,
      at: event.time,
      seq: event.seq,
    })
  }
  return out
}

/**
 * The goal one verdicted object serves, when it serves one.
 *
 * Both structural fact rules below hang off it: 「同 goalRef 的血缘新边」 and
 * 「同一目标上后来的差距简报」. Read from whichever field the family keeps —
 * a goal's own commitment names it `goalRef`, a child names it
 * `parentGoalRef`, an assessment names it `goalRef`.
 */
export function goalRefOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.parentGoalRef) ?? asString(state?.goalRef)
}

/** The conversation one verdicted object lived in, for the lineage rule. */
export function topicOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.topicKey) ?? asString(asRecord(state?.executor)?.topicKey)
}

/** When one organization object last changed. Used to describe a fact in words. */
export function updatedAtOf(ctx: Context, kind: string, id: string): number | undefined {
  return asNumber(ctx.get('yzjGraph')?.rawObject(kind, id)?.updatedAt)
}
