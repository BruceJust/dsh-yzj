/**
 * The commitment family — the work unit the graph was missing.
 *
 * Five scenarios independently hit the same hole: "让张三负责 B" never entered
 * the graph, a six-week hire had no body, action items vanished on utterance,
 * the month-end close was rebuilt from scratch every month. A commitment is
 * what a conversation leaves behind when it has agreed that something will
 * happen.
 *
 * Three shapes here carry design rulings that are easy to lose:
 *
 * - **`parentGoalRef` is a URI, not a node.** The organisation's goals live in
 *   Yunzhijia objects, because their stakeholders include people who will
 *   never be operators of this product — the graph records the REFERENCE and
 *   nothing else (TD-18). A goal node here would be a second source of truth
 *   for something we do not own.
 * - **`parentCommitmentId` is the generic edge.** A goal is a composite
 *   commitment; a process is a composite commitment with a template. One edge
 *   covers decomposition, and there is no goal tree type to build.
 * - **`audience` is inherited from the utterance that registered it.** That is
 *   what makes the manager's "all of it in one frame" and "each utterance
 *   knows who hears it" the same rule instead of opposing ones: a manager sees
 *   everything delegated in their presence, precisely because it was.
 */

import { createHash } from 'node:crypto'
import { artifactRef, z, type GraphFamily } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

export type CommitmentStatus = 'open' | 'closed' | 'voided' | 'merged'

/** Who owes the work. An agent executor IS a topic; a human executor is watched. */
export type CommitmentExecutor =
  | { readonly kind: 'agent'; readonly topicKey: string }
  | { readonly kind: 'human'; readonly openId: string; readonly name?: string }

export interface CommitmentState {
  readonly commitmentId: string
  readonly status: CommitmentStatus
  readonly what: string
  readonly executor: CommitmentExecutor
  readonly due?: string
  /** URI of the goal artifact in Yunzhijia. The goal has no node here. */
  readonly parentGoalRef?: string
  /**
   * The goal真身 THIS commitment is.
   *
   * 「立目标」不是新动词 (v4.8). A goal is a compound commitment, so declaring
   * one is registering a commitment whose executor is its owner, whose
   * acceptance is manual, and whose body lives in a Yunzhijia document — this
   * field is that body's URI. Zero new node types: children still carry
   * `parentGoalRef` pointing at the same URI, and the board resolves the two
   * sides by URI rather than by an edge nobody would maintain.
   */
  readonly goalRef?: string
  /** Parent commitment — the generic decomposition edge. */
  readonly parentCommitmentId?: string
  /** The listener set of the utterance that registered this. */
  readonly audience?: readonly string[]
  readonly idemKey?: string
  /** Anchor of the utterance this was registered from. */
  readonly sourceAnchor: string
  /**
   * The topic this was registered IN — independent of who executes it.
   *
   * 挂接引用是语境的属性 (v4.8), and the context is the topic. This used to be
   * readable only off `executor.topicKey`, which exists solely for AGENT
   * executors — so a commitment somebody else owes, registered in a topic that
   * plainly serves a goal, belonged to no context at all. Inheritance and
   * `/link` both走 this field now, because both are asking the same question:
   * where was this promised.
   */
  readonly topicKey?: string
  readonly processTemplateRef?: string
  /** How the parent reference got attached — shown in the ack so it can be corrected. */
  readonly attachedVia?:
    | 'explicit' | 'inferred' | 'linked' | 'inherited' | 'object-context' | 'chip'
    /** Moved back to 无归属 — the provenance of NOT being attached. */
    | 'detached'
  readonly cause?: string
  readonly mergedInto?: string
  readonly lastReceipt?: string
  /**
   * 怎么算完成 — only on a commitment that IS a goal.
   *
   * 磨点在「可验收」(v4.10): the value of grinding a goal with an agent is that
   * it ends up with success criteria, and criteria nobody wrote down cannot be
   * assessed later. The body of these words belongs in the Yunzhijia document —
   * this is the copy the operator SIGNED at declaration, kept because the
   * assessment has to compare against something and the 真身 is not readable
   * from here yet (P1 降级形态，明标于 §7.4 与偏离清单).
   */
  readonly criteria?: string
  /**
   * Where the registration utterance must be posted when this commitment is
   * minted from a proposal. Consumed once, by the delivery listener.
   */
  readonly notifyPlaceKey?: string
  /**
   * 幽灵承诺禁令 (v4.9): whether the person who owes this was actually told.
   *
   * `sent` means the registration utterance reached the place they are in;
   * `failed` means it did not, and the board must say so out loud. A commitment
   * that exists in the graph but was never spoken anywhere is work assigned to
   * somebody who does not know — the exact failure mode 落库即代发 exists to
   * prevent, so its failure mode must never be silent.
   */
  readonly notified?: 'sent' | 'failed'
}

const executor = z.union([
  z.object({ kind: z.literal('agent'), topicKey: z.string().min(1) }),
  z.object({ kind: z.literal('human'), openId: z.string().min(1), name: z.string().optional() }),
])

const attachedVia = z.enum([
  'explicit', 'inferred', 'linked', 'inherited', 'object-context', 'chip', 'detached',
])

export const commitmentFamily: GraphFamily = {
  kind: 'commitment',
  events: {
    'commitment/opened': {
      schema: z.object({
        commitmentId: z.string().min(1),
        what: z.string().min(1),
        executor,
        sourceAnchor: z.string().min(1),
        topicKey: z.string().optional(),
        status: z.literal('open').default('open'),
        due: z.string().optional(),
        parentGoalRef: z.string().optional(),
        goalRef: z.string().optional(),
        parentCommitmentId: z.string().optional(),
        processTemplateRef: z.string().optional(),
        attachedVia: attachedVia.optional(),
        audience: z.array(z.string()).optional(),
        idemKey: z.string().optional(),
        criteria: z.string().optional(),
        notifyPlaceKey: z.string().optional(),
        /**
         * Born already marked.
         *
         * Only ever `'failed'` here, and only for a commitment minted with
         * nowhere to announce it: it is owed by somebody who has not been told
         * and never will be by this system, so the board has to say so from
         * the first render. `'sent'` can never be true at birth — the utterance
         * has not gone out yet.
         */
        notified: z.literal('failed').optional(),
      }),
    },
    'commitment/updated': {
      schema: z.object({
        commitmentId: z.string().min(1),
        what: z.string().optional(),
        due: z.string().optional(),
        /**
         * 移交：换人,不换承诺 (v4.12 修理动词族).
         *
         * 走 `updated` 而不是造一个 `commitment/handed-off`,因为发生的事就是
         * 这条承诺的一个字段变了。更要紧的是**它不能是新建一条**:新建会把
         * 出生边、听众、已有的回执统统留在一条没人再看的旧记录上,而承诺的
         * 历史正是它可信的全部理由。人走了,事没走。
         */
        executor: executor.optional(),
        parentGoalRef: z.string().optional(),
        goalRef: z.string().optional(),
        parentCommitmentId: z.string().optional(),
        attachedVia: attachedVia.optional(),
        lastReceipt: z.string().optional(),
        criteria: z.string().optional(),
        notified: z.enum(['sent', 'failed']).optional(),
        audience: z.array(z.string()).optional(),
        /**
         * 上一次看到的真身长什么样 (§1.9-4 真身之变).
         *
         * 只对目标有意义:目标的真身是云之家上那份文档,而我们手里的 `criteria`
         * 只是抄下来的一份副本。记下看到过的样子,「它被改过没有」才从一个谁也
         * 答不了的问题,变成一次比较。
         *
         * 是**带来源的字符串**而不是数字:在线文档比正文版本、上传的文件比节点
         * 更新时间,两者不在一个量纲上,混着比会凭空报出一次并不存在的改动。
         */
        truthFingerprint: z.string().optional(),
      }),
    },
    'commitment/closed': {
      schema: z.object({
        commitmentId: z.string().min(1),
        cause: z.enum(['accepted', 'done', 'receipt']),
        status: z.literal('closed').default('closed'),
      }),
    },
    'commitment/reopened': {
      schema: z.object({
        commitmentId: z.string().min(1),
        cause: z.string(),
        status: z.literal('open').default('open'),
      }),
    },
    /** The zombie guard: the other side never accepted, or never will answer. */
    'commitment/voided': {
      schema: z.object({
        commitmentId: z.string().min(1),
        cause: z.string(),
        status: z.literal('voided').default('voided'),
      }),
    },
    /**
     * Explicit merge — the dual of "never auto-merge". The anchor stops the
     * same registration arriving twice; two registrations that MEAN the same
     * thing are a human judgement and get a verb, not a similarity score.
     */
    'commitment/merged': {
      schema: z.object({
        commitmentId: z.string().min(1),
        mergedInto: z.string().min(1),
        status: z.literal('merged').default('merged'),
      }),
    },
  },
  pendingStatuses: ['open'],
  objectIdOf: (_type, data) => asString(asRecord(data)?.commitmentId),
  /**
   * 墓碑律: 作废 and 合并 are absorbing.
   *
   * A voided commitment is one the other side never accepted, and a merged one
   * has already been folded into its twin. Both are graves. Every other verb in
   * the system — a late 「完成」 keyword typed into a group, an acceptance
   * pressed on a stale assessment card, a receipt parsed out of an old reply —
   * would otherwise resurrect them as live rows on the board, which is exactly
   * the zombie accumulation 作废 exists to end. `commitment/reopened` is the one
   * way back, because reopening is a decision somebody makes on purpose.
   */
  reduce: (previous, event) => {
    const base = asRecord(previous) ?? {}
    const next = asRecord(event.data) ?? {}
    const settled = asString(base.status)
    if ((settled === 'voided' || settled === 'merged') && event.type !== 'commitment/reopened') {
      return previous
    }
    return { ...base, ...next }
  },
}

/**
 * Processes: the compounding unit. `templated` turns an existing artifact (the
 * checklist dragged into the conversation for the 109th time) into a template;
 * `instantiated` stamps it into a commitment tree and records WHICH VERSION it
 * came from — an environment-class fact.
 */
export const processFamily: GraphFamily = {
  kind: 'process',
  events: {
    'process/templated': {
      schema: z.object({
        templateId: z.string().min(1),
        name: z.string().min(1),
        version: z.number().int().min(1),
        steps: z.array(z.object({
          what: z.string().min(1),
          executorHint: z.string().optional(),
          dueOffsetDays: z.number().optional(),
        })).min(1),
        sourceArtifact: artifactRef.optional(),
      }),
    },
    'process/instantiated': {
      schema: z.object({
        instanceId: z.string().min(1),
        templateId: z.string().min(1),
        templateVersion: z.number().int().min(1),
        rootCommitmentId: z.string().min(1),
      }),
    },
  },
  objectIdOf: (type, data) => (
    type === 'process/templated'
      ? asString(asRecord(data)?.templateId)
      : asString(asRecord(data)?.instanceId)
  ),
}

/**
 * Idempotency anchor for a commitment. Computed from the SOURCE of the
 * registration, never from its wording — the same utterance reached through
 * two paths (minutes proposal, spoken delegation, inherited context) must
 * collapse onto one object (§3.2 幂等锚计算铁律; the model never supplies it).
 */
export function commitmentIdemKeyFor(sourceAnchor: string, what: string): string {
  const hash = createHash('sha256')
    .update('yzj-next-commitment-v1').update('\0')
    .update(sourceAnchor).update('\0')
    .update(what.replace(/\s+/gu, ' ').trim().toLowerCase())
    .digest('hex')
    .slice(0, 24)
  return `cmt:${hash}`
}

export function commitmentIdFor(sourceAnchor: string, what: string): string {
  return commitmentIdemKeyFor(sourceAnchor, what).replace('cmt:', 'cmt-')
}

/**
 * Whether an agent-executed task has earned a commitment record.
 *
 * "帮我查下 X" must not mint one: the commitment pool is the evidence base for
 * whether commitments are worth anything, and filling it with trivia destroys
 * the very signal it exists to produce ("asking for one number should not get
 * you the whole family package"). A write, a stated deadline, or explicit
 * delegation language is the bar.
 */
export function earnsCommitment(input: {
  readonly hadWriteAction: boolean
  readonly explicitDue?: string
  readonly delegationLanguage: boolean
}): boolean {
  return input.hadWriteAction
    || (input.explicitDue !== undefined && input.explicitDue !== '')
    || input.delegationLanguage
}

/** Terminal statuses: the work is no longer owed. */
export function isSettled(status: CommitmentStatus): boolean {
  return status !== 'open'
}
