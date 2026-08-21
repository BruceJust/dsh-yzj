/**
 * 目标的三个补齐件：提案裁决、差距简报、语境挂接。
 *
 * All three exist because a goal's life has three moments where a human must
 * appear and a machine must not (v4.9/v4.10 的人机分工表)：
 *
 * - **签发** — the agent may draft a goal but never author one. `proposal` with
 *   `kind: 'goal'` is that draft: it holds the words until somebody presses.
 * - **裁决** — a decomposition is a list of proposals, decided ONE BY ONE. The
 *   per-item confirmation IS the signature; there is no second confirmation
 *   card, because one sovereign moment deserves one press and a second one is
 *   just approval fatigue wearing a safety costume.
 * - **验收** — `assessment` is the evidence bundle written down. It never
 *   closes a goal by itself; it gives the person who does the material to
 *   decide with (验收权 ≠ 验收材料).
 *
 * `goal-context` is the fourth piece and the least visible: 挂接引用是语境的属性.
 * When work is delegated from a goal, the CONVERSATION it lands in starts
 * carrying that goal's reference, and every commitment born there inherits it
 * without anybody typing anything. That is what "挂接零操作" means mechanically —
 * inheritance is a fact about where work was born, not a guess about what it
 * resembles.
 */

import { createHash } from 'node:crypto'
import { z, type GraphFamily, type JsonValue } from '@yzj-next/graph'
import { asNumber, asRecord, asString } from '@yzj-next/graph'

// ---------------------------------------------------------------------------
// 提案裁决 (obj-verdict 的 P1 形态)
// ---------------------------------------------------------------------------

/** What a proposal is proposing: one goal, or the children of one. */
export type ProposalKind = 'goal' | 'breakdown'

/** 逐条裁决 — three outcomes, because "not now" is not the same as "no". */
export type ProposalDecision = 'confirmed' | 'rejected' | 'held'

/**
 * One proposed commitment.
 *
 * `placeKey` is not decoration and not a default: it is where the registration
 * utterance will be POSTED if this item is confirmed, and it is chosen by a
 * person. 场所（听众）是委派话语的一等参数，人选不推导 — public delegation is
 * pressure and transparency, private delegation leaves room, and a machine that
 * picks between them has made a social decision on somebody's behalf (§1.6).
 */
export interface ProposalItem {
  readonly what: string
  readonly executorOpenId?: string
  readonly executorName?: string
  readonly due?: string
  readonly placeKey?: string
  readonly placeName?: string
}

export interface ProposalState {
  readonly proposalId: string
  readonly kind: ProposalKind
  readonly title: string
  /** The goal being decomposed (breakdown) or proposed (goal). */
  readonly goalRef?: string
  readonly goalName?: string
  /** 磨出来的成功标准 — only on `kind: 'goal'`. */
  readonly criteria?: string
  readonly items: readonly ProposalItem[]
  /** Item index (as a string key) → what was decided about it. */
  readonly decisions?: Readonly<Record<string, ProposalDecision>>
  /** Item index → the commitment its confirmation minted. */
  readonly minted?: Readonly<Record<string, string>>
  readonly status: 'open' | 'settled'
  readonly sourceAnchor: string
  readonly topicKey?: string
  readonly placeKey?: string
  readonly audience?: readonly string[]
  /**
   * Whose signature this is waiting for.
   *
   * A proposal read in a group is readable by everyone there — but 签发 is not
   * a group act. Without this the card admitted any member with an openId, and
   * the registration utterance that follows a confirmation goes out **under
   * the operator's account** into a conversation the confirmer may not even be
   * in. The approval family has always named its decider; so does this one.
   */
  readonly decider?: string
}

const proposalItem = z.object({
  what: z.string().min(1),
  executorOpenId: z.string().optional(),
  executorName: z.string().optional(),
  due: z.string().optional(),
  placeKey: z.string().optional(),
  placeName: z.string().optional(),
})

export const proposalFamily: GraphFamily = {
  kind: 'proposal',
  events: {
    'proposal/opened': {
      schema: z.object({
        proposalId: z.string().min(1),
        kind: z.enum(['goal', 'breakdown']),
        title: z.string().min(1),
        items: z.array(proposalItem).min(1),
        sourceAnchor: z.string().min(1),
        status: z.literal('open').default('open'),
        goalRef: z.string().optional(),
        goalName: z.string().optional(),
        criteria: z.string().optional(),
        topicKey: z.string().optional(),
        placeKey: z.string().optional(),
        audience: z.array(z.string()).optional(),
        decider: z.string().optional(),
      }),
    },
    'proposal/item-decided': {
      schema: z.object({
        proposalId: z.string().min(1),
        index: z.number().int().min(0),
        decision: z.enum(['confirmed', 'rejected', 'held']),
        /** The commitment a confirmation minted, so the card can point at it. */
        commitmentId: z.string().optional(),
      }),
    },
    /**
     * 收起 — the exit every door owes (环路完整性检验 §5.5).
     *
     * A proposal with items held forever is a card that can never resolve, and
     * a card that can never resolve is the zombie this family exists to avoid.
     */
    'proposal/settled': {
      schema: z.object({
        proposalId: z.string().min(1),
        status: z.literal('settled').default('settled'),
        cause: z.string().optional(),
      }),
    },
  },
  pendingStatuses: ['open'],
  objectIdOf: (_type, data) => asString(asRecord(data)?.proposalId),
  /**
   * Per-item decisions accumulate; a shallow merge would replace the whole map
   * with each event and leave one decision standing where five were made.
   */
  reduce: (previous, event) => {
    const base = asRecord(previous) ?? {}
    const next = asRecord(event.data) ?? {}
    if (event.type !== 'proposal/item-decided') return { ...base, ...next }
    const index = String(asNumber(next.index) ?? -1)
    const decisions = { ...(asRecord(base.decisions) ?? {}), [index]: next.decision as JsonValue }
    const mintedId = asString(next.commitmentId)
    const minted = mintedId === undefined
      ? asRecord(base.minted) ?? {}
      : { ...(asRecord(base.minted) ?? {}), [index]: mintedId as JsonValue }
    return { ...base, decisions, minted }
  },
}

/** Every item has an answer that is not 「挂起」. */
export function proposalSettled(state: ProposalState): boolean {
  if (state.status === 'settled') return true
  const decisions = state.decisions ?? {}
  return state.items.every((_item, index) => {
    const decision = decisions[String(index)]
    return decision === 'confirmed' || decision === 'rejected'
  })
}

/**
 * Parse 「1,3」 / 「1 3」 / 「全部」 / empty into item indices.
 *
 * The same string arrives from a desktop input box and from a Yunzhijia text
 * reply, so it is parsed in ONE place — the card's state machine — rather than
 * once per surface. An empty selection means every item still undecided, which
 * is what somebody pressing 「确认」 with nothing typed plainly meant.
 */
export function itemsFrom(
  input: string | undefined,
  state: ProposalState,
): { readonly indices: readonly number[]; readonly bad: readonly string[] } {
  const open = state.items
    .map((_item, index) => index)
    .filter(index => (state.decisions ?? {})[String(index)] !== 'confirmed'
      && (state.decisions ?? {})[String(index)] !== 'rejected')
  const raw = (input ?? '').trim()
  if (raw === '' || raw === '全部' || raw === 'all') return { indices: open, bad: [] }
  const indices: number[] = []
  const bad: string[] = []
  const take = (value: number, token: string): void => {
    // Displayed 1-based, stored 0-based. Somebody typing "0" meant nothing.
    if (!Number.isFinite(value) || value < 1 || value > state.items.length) {
      bad.push(token)
      return
    }
    if (!indices.includes(value - 1)) indices.push(value - 1)
  }
  for (const token of raw.split(/[\s,，、]+/u).filter(part => part !== '')) {
    /*
      Ranges and decorated numbers, because those are what people type.

      `parseInt` alone read 「1-2」 as 1 and silently dropped the second item,
      and 「第2条」 as NaN — deciding nothing while the bus still answered
      「已记录。」. Both are wrong in the quiet direction.
    */
    const span = /^(\d+)\s*[-–—~到]\s*(\d+)$/u.exec(token)
    if (span !== null) {
      const from = Number(span[1])
      const to = Number(span[2])
      if (from <= to) for (let n = from; n <= to; n += 1) take(n, token)
      else bad.push(token)
      continue
    }
    const digits = /\d+/u.exec(token)
    if (digits === null) {
      bad.push(token)
      continue
    }
    take(Number(digits[0]), token)
  }
  return { indices, bad }
}

/** Deterministic proposal id — one drafting turn, one proposal. */
export function proposalIdFor(sourceAnchor: string, title: string): string {
  const hash = createHash('sha256')
    .update('yzj-next-proposal-v1').update('\0')
    .update(sourceAnchor).update('\0')
    .update(title.replace(/\s+/gu, ' ').trim().toLowerCase())
    .digest('hex')
    .slice(0, 24)
  return `prp-${hash}`
}

// ---------------------------------------------------------------------------
// 差距简报 (完成度评估)
// ---------------------------------------------------------------------------

/** One success criterion measured against what the graph can actually show. */
export interface AssessmentLine {
  readonly criterion: string
  readonly verdict: 'met' | 'partial' | 'missing'
  /** The evidence anchor — a commitment, an artifact, or the absence of both. */
  readonly evidence: string
}

export interface AssessmentState {
  readonly assessmentId: string
  readonly goalRef: string
  readonly goalName?: string
  readonly summary: string
  readonly lines: readonly AssessmentLine[]
  readonly status: 'open' | 'accepted' | 'continued'
  readonly sourceAnchor: string
  readonly topicKey?: string
  /** Whose acceptance this is waiting for — 验收 is not a room-wide button. */
  readonly decider?: string
  readonly decidedBy?: string
}

export const assessmentFamily: GraphFamily = {
  kind: 'assessment',
  events: {
    'assessment/reported': {
      schema: z.object({
        assessmentId: z.string().min(1),
        goalRef: z.string().min(1),
        summary: z.string().min(1),
        lines: z.array(z.object({
          criterion: z.string().min(1),
          verdict: z.enum(['met', 'partial', 'missing']),
          evidence: z.string(),
        })).default([]),
        sourceAnchor: z.string().min(1),
        status: z.literal('open').default('open'),
        goalName: z.string().optional(),
        topicKey: z.string().optional(),
        decider: z.string().optional(),
        /**
         * 这份简报当时是照着哪一版成功标准写的（环境快照律 §1.9-5）。
         *
         * 没有它，「标准改了」和「简报过时了」就是同一件说不清的事：一份三周前
         * 按旧标准判出的「达成」，在新标准下可能根本不成立，而页面会把它当作
         * 仍然有效的结论继续展示。记下依据的那一版，**真身之变就成了一个可推导
         * 的事实**而不是一个要谁去维护的字段。
         */
        criteriaBasis: z.string().optional(),
        /**
         * 下这份结论时，真身长什么样（环境快照律 §1.9-5）。
         *
         * `criteriaBasis` 记的是我们那份**副本**当时长什么样；这一条记的是
         * **真身**当时的指纹。少了它，一份三周前的结论在正文被改过之后仍然
         * 看起来成立——而它是照着另一份正文判出来的。
         */
        truthFingerprint: z.string().optional(),
      }),
    },
    'assessment/closed': {
      schema: z.object({
        assessmentId: z.string().min(1),
        status: z.enum(['accepted', 'continued']),
        decidedBy: z.string().optional(),
      }),
    },
  },
  pendingStatuses: ['open'],
  objectIdOf: (_type, data) => asString(asRecord(data)?.assessmentId),
  /**
   * 墓碑律: an answered report does not reopen.
   *
   * The id is stable per turn anchor, and on the desktop that anchor is the
   * whole SESSION — so a second report on the same goal folded onto the same
   * object and rewrote an accepted assessment back to `open`, keeping the old
   * `decidedBy`. The already-echoed 【目标·已验收】 card became answerable
   * again, and pressing 验收 re-closed a closed goal. A new reading is a new
   * report; it gets its own object.
   */
  reduce: (previous, event) => {
    const base = asRecord(previous) ?? {}
    const next = asRecord(event.data) ?? {}
    if (asString(base.status) !== undefined && asString(base.status) !== 'open') return previous
    return { ...base, ...next }
  },
}

/**
 * One assessment per goal per drafting turn.
 *
 * Deriving it from the anchor rather than from a counter means a re-run of the
 * same turn overwrites its own report instead of stacking a second opinion the
 * board would then have to choose between.
 */
export function assessmentIdFor(sourceAnchor: string, goalRef: string): string {
  const hash = createHash('sha256')
    .update('yzj-next-assessment-v1').update('\0')
    .update(sourceAnchor).update('\0')
    .update(goalRef)
    .digest('hex')
    .slice(0, 24)
  return `asm-${hash}`
}

// ---------------------------------------------------------------------------
// 语境挂接 (goal-context)
// ---------------------------------------------------------------------------

/**
 * The goal a CONVERSATION is working toward.
 *
 * 挂接引用是语境的属性 (v4.8/v4.9): this is the fact that makes 出生时刻挂接 cost
 * zero operations. It is armed by a human act — teleporting from a goal into a
 * conversation and speaking there — so it is inheritance, never inference, and
 * the ack says so in those words.
 *
 * Disarming writes an empty ref rather than deleting the object: 更正即追加
 * (§1.9-3), and a graph that forgets that a topic ONCE served a goal cannot
 * explain why the commitments under it are attached.
 */
export interface GoalContextState {
  readonly topicKey: string
  readonly goalRef: string
  readonly goalName?: string
  readonly armedBy?: string
}

export const goalContextFamily: GraphFamily = {
  kind: 'goal-context',
  events: {
    'goal-context/armed': {
      schema: z.object({
        topicKey: z.string().min(1),
        goalRef: z.string().min(1),
        goalName: z.string().optional(),
        armedBy: z.string().optional(),
      }),
    },
    'goal-context/cleared': {
      schema: z.object({
        topicKey: z.string().min(1),
        goalRef: z.literal('').default(''),
      }),
    },
  },
  objectIdOf: (_type, data) => asString(asRecord(data)?.topicKey),
}

/** The goal this topic carries, or undefined when it carries none. */
export function armedGoalOf(
  raw: { readonly state: JsonValue } | undefined,
): string | undefined {
  const ref = asString(asRecord(raw?.state)?.goalRef)
  return ref === undefined || ref === '' ? undefined : ref
}

// ---------------------------------------------------------------------------
// 目标承诺的身份
// ---------------------------------------------------------------------------

/**
 * The id of the commitment that DECLARES a goal, derived from its body's URI.
 *
 * One URI, one goal. Derivation rather than storage is what makes 「同一个链接
 * 不能重复立目标」 checkable from any surface without a lookup table somebody
 * has to keep in step — and it is why the board, the assessment card and the
 * declare endpoint all arrive at the same object without talking to each other.
 */
export function goalCommitmentIdFor(goalRef: string): string {
  return `cmt-goal-${createHash('sha256')
    .update('yzj-next-goal-v1').update(goalRef).digest('hex').slice(0, 20)}`
}
