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
  /**
   * **交付已被主张，等人验收**（v4.21 第一档⑥「验收断链接通」）。
   *
   * 此前板上人执行的行是一条**断头路**：登记有呼吸（登记消息投进场所、对方能回执），
   * 交付却没有验收落座——执行者说一句「做完了」，系统直接把它判成终态。于是「他说
   * 做完了」和「我认了这份交付」被压成同一件事，而它们是两个不同的人的两次判断。
   *
   * **刻意不新增 status**：`open` 的含义是「这件事还欠着」，而在有人验收之前，它**确实
   * 还欠着**——这句话一个字都不用改。新增一个 `delivered` 状态则要审 55 处判终态的
   * 代码，而其中任何一处漏掉，都会让一条没验收的活在某个面上显示成已完成。
   *
   * `round` 在**承诺上**，不在这份 `delivery` 里——因为打回会把 `delivery` 变回不存在
   * （见 reduce），住在里面的轮次会跟着一起消失。这里的 `round` 是「这一版交付是第几次
   * 重交」，由承诺上的那个计数抄过来。
   */
  readonly delivery?: {
    readonly claim: string
    readonly at: number
    /** 交付锚：引用了工件就锚工件，纯话语回执锚那条回执本身。 */
    readonly anchor?: string
    readonly round?: number
  }
  /**
   * 谁签发的这条承诺 —— **由 reduce 从事件的 actor 盖上**，生产者不必配合。
   *
   * 验收权是 `委派者 ∪ 操作者`（§5.2），而 `allowedActors` 只看得见 `state`，所以这个
   * 事实必须落在对象上。让每个生产者去传它，意味着历史上所有承诺永远没有它、且漏传
   * 一处就静默失权；而内核本来就给每条事件记着 actor——**事实一直在，读它就行**。
   */
  readonly delegatedBy?: string

  /**
   * 已经被打回过几次 —— **轮次的家在承诺上**。
   *
   * 打回把 `delivery` 变回不存在（否则被打回的活一直挂着一份假的待验收信号），所以轮次
   * 不能住在里面：住进去，下一次主张时它就没了，第二版交付上不再写「已返工 N 轮」，
   * 验收的人看不出这是重交的——而「轮次在卡上可见」正是这个循环存在的意义。
   */
  readonly round?: number
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
    /**
     * 交付被主张 —— 话语门/行为门/结构化门任一确认时。
     *
     * 「生效即出卡」：主张立刻生效（这一门本属默认生效可纠类，无第二道确认），
     * 而它生效的结果**不是终态，是一张待验收的卡**。
     */
    'commitment/delivered': {
      schema: z.object({
        commitmentId: z.string().min(1),
        delivery: z.object({
          claim: z.string().min(1),
          at: z.number().int(),
          anchor: z.string().optional(),
          round: z.number().int().optional(),
        }),
      }),
    },
    /** 拒收 → 返工。承诺没死，交付主张被撤回，轮次 +1。 */
    'commitment/rework': {
      schema: z.object({
        commitmentId: z.string().min(1),
        reason: z.string().min(1),
        round: z.number().int().min(1),
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
    /*
      **委派者由内核记的 actor 盖上，生产者不必配合。**

      验收权是「委派者 ∪ 操作者」，而 `allowedActors` 只看得见 `state`——这个事实必须
      落在对象上。让每个生产者去传它，意味着历史上所有承诺永远没有它，而且漏传一处就
      静默失权（没人会报错，只是那条活谁都验收不了）。内核本来就给每条事件记着 actor，
      在这里盖一次，**重放老日志一样补得上**。

      只在出生那一刻盖：后来的更新是别人写的（agent 记回执、系统回写指纹），把它们的
      actor 盖上去，等于每写一次就换一个验收人。
    */
    const born = event.type === 'commitment/opened'
      ? (event.actor as { openId?: string }).openId
      : undefined
    /*
      拒收 = 交付主张被撤回。

      合并式 reduce 里，「把一个字段变回不存在」要显式写：`{...base, ...next}` 只会
      新增与覆盖，不会删除。不写这一行，拒收之后那张验收卡还在——被打回的活会一直
      挂着一份「等你验收」的假信号。
    */
    if (event.type === 'commitment/rework') {
      const { delivery: _dropped, ...rest } = base
      return { ...rest, ...next }
    }
    return {
      ...base,
      ...next,
      ...(typeof born === 'string' && born !== '' && base.delegatedBy === undefined
        ? { delegatedBy: born }
        : {}),
    }
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

/**
 * 这条承诺归谁管 —— **动词主权 = 节点主权的派生** (v4.22 裁决②).
 *
 * 修理动词族（催／顺延／作废／合并／移交／收养／摘除）与三个 CTA 的主权，是**该节点
 * owner** 的属性，不是「谁看得见这一行」的属性。承诺的 owner 就是当初把它说出口、
 * 登记下来的那个人；执行者对自己那条承诺是**再委派的 owner**（他的动词是登记族与
 * 回执族），而不是修理它的人。
 *
 * 三条推论，都是设计明写的：
 *
 * - **越级不便利**：上级目标的 owner 对孙辈承诺不渲染催——不禁社交追问，只是不造
 *   按钮；
 * - **无主权的动词不渲染，不灰化**：灰按钮是「你不配」的展示；不渲染不禁言——人人
 *   可以在会话里用话说任何事，系统只是不替无主权者造一个按钮；
 * - **渲染过滤与执行校验共用这一个谓词**：只在界面上不画，而端点照收，等于把主权
 *   做成了一层皮肤——绕过它只需要一次直接调用。
 *
 * 老数据里没有 `delegatedBy` 时**放行**：一条谁都动不了的承诺，比放宽一点更坏
 * （板上那一行会变回断头路）。宁可宽，不可锁死——和验收席位同一条纪律，也共用同一个
 * 事实源（`delegatedBy` 由 reduce 从出生事件的 actor 盖上）。
 */
export function ownsCommitment(
  openId: string | undefined, state: Pick<CommitmentState, 'delegatedBy'>,
): boolean {
  if (openId === undefined) return false
  return state.delegatedBy === undefined || state.delegatedBy === openId
}
