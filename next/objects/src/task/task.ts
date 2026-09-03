/**
 * The task object: what an agent-executed piece of work leaves on the graph,
 * and where the ONE unsolved factor of the whole design gets its raw material.
 *
 * Completion quality — "did the agent actually do it right" — is deliberately
 * not designed (§10). What is designed is that every rejection records its
 * round, its reason, and the artifact versions involved, so the day there are
 * real rejection samples the learning loop has something to learn from. That
 * is why `task/rejected` carries more structure than it currently consumes.
 */

import { artifactRef, z, type GraphFamily } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'
import type { CardDefinition } from '@yzj-next/cards'

export type TaskStatus = 'open' | 'terminal' | 'accepted' | 'rework' | 'voided' | 'interrupted'

export interface TaskArtifact {
  readonly uri: string
  readonly placeKey: string
  readonly title?: string
}

export interface TaskState {
  readonly taskId: string
  readonly status: TaskStatus
  readonly what: string
  readonly topicKey: string
  readonly sourceAnchor: string
  /**
   * 谁把这件活派出来的 —— 验收权的一半 (v4.15 收紧③).
   *
   * 「验收自己委派的活」是主权本义:一个同事在群里让 agent 做了件事,凭什么由
   * 别人替他说这活干得行。P1 单操作者下这个人通常就是操作者本人,但**记下来
   * 和推出来是两回事**——记下来才经得起多人在场的那一天。
   */
  readonly delegatedBy?: string
  /** 当时跑这条会话的操作者账号 —— 验收权的另一半。 */
  readonly operator?: string
  readonly audience?: readonly string[]
  readonly summary?: string
  readonly artifacts?: readonly TaskArtifact[]
  /** Rework rounds so far. The learning loop's denominator. */
  readonly round?: number
  readonly reason?: string
  readonly acceptedBy?: string
  readonly voidedBy?: string
  readonly resumedBy?: string
  /** 认领胜出的证据 (决策 #63)。没有它 = 单实例部署或旧日志。 */
  readonly claim?: {
    readonly contenders: readonly string[]
    readonly tier: 'speaker' | 'presence' | 'standby'
    readonly tiebreak: 'sole' | 'tier' | 'msgId'
  }
}

export const taskFamily: GraphFamily = {
  kind: 'task',
  events: {
    'task/opened': {
      schema: z.object({
        taskId: z.string().min(1),
        what: z.string().min(1),
        topicKey: z.string().min(1),
        sourceAnchor: z.string().min(1),
        status: z.literal('open').default('open'),
        audience: z.array(z.string()).optional(),
        delegatedBy: z.string().optional(),
        operator: z.string().optional(),
        /**
         * 认领胜出的证据 (决策 #63)：`task/opened` 即胜出，不另设事件。
         *
         * `contenders` 是当时观察到的同侪在岗实例；`tier` 是本实例赢在哪一梯队
         * （发言者实例 › 对群在岗 › 备岗）；`tiebreak` 说明怎么赢的——没有对手、梯队
         * 更高、或同梯队按群消息流的服务端总序更早。
         */
        claim: z.object({
          contenders: z.array(z.string()).default([]),
          tier: z.enum(['speaker', 'presence', 'standby']),
          tiebreak: z.enum(['sole', 'tier', 'msgId']),
        }).optional(),
      }),
    },
    'task/terminal': {
      schema: z.object({
        taskId: z.string().min(1),
        summary: z.string(),
        artifacts: z.array(artifactRef).default([]),
        status: z.literal('terminal').default('terminal'),
      }),
    },
    'task/accepted': {
      schema: z.object({
        taskId: z.string().min(1),
        acceptedBy: z.string().min(1),
        status: z.literal('accepted').default('accepted'),
      }),
    },
    'task/rejected': {
      schema: z.object({
        taskId: z.string().min(1),
        round: z.number().int().min(1),
        reason: z.string().min(1),
        artifacts: z.array(artifactRef).default([]),
        rejectedBy: z.string().min(1),
        // Rework, not death: the task returns to open with the round counted.
        status: z.literal('rework').default('rework'),
      }),
    },
    /**
     * The death a failed turn needs.
     *
     * Before this, a task whose turn errored out could only leave the inbox by
     * being ACCEPTED — signing off on a result that does not exist. Voiding is
     * the honest terminal: nothing was delivered, the reason is on the record,
     * and it never counts as a rework round because nobody reworked anything.
     */
    /**
     * 载体死了，意图没死 —— the state a transport failure deserves.
     *
     * A model 502 is not a decision about the work; it is the carrier dropping.
     * Voiding it made the intent die with the carrier: the record was closed,
     * the trigger forgotten, and the only way to get the work finished was to
     * nudge the agent privately — at which point the answer had **nowhere to be
     * delivered**, because the destination lived on the turn that had already
     * ended. Measured live: a 452KB zip analysed in full, never spoken.
     *
     * `interrupted` keeps the intent answerable, and 「继续」 resumes it into the
     * SAME landing point it was born with. Same reasoning the approval family
     * already carries: 重启杀死的是载体，不是意图.
     */
    'task/interrupted': {
      schema: z.object({
        taskId: z.string().min(1),
        reason: z.string().min(1),
        status: z.literal('interrupted').default('interrupted'),
      }),
    },
    /** 继续 — the intent picks up where the carrier dropped it. */
    'task/resumed': {
      schema: z.object({
        taskId: z.string().min(1),
        resumedBy: z.string().min(1),
        status: z.literal('open').default('open'),
      }),
    },
    'task/voided': {
      schema: z.object({
        taskId: z.string().min(1),
        reason: z.string().min(1),
        voidedBy: z.string().min(1),
        status: z.literal('voided').default('voided'),
      }),
    },
  },
  /** A finished task is WAITING for acceptance — that is its answerable state. */
  pendingStatuses: ['terminal', 'interrupted'],
  objectIdOf: (_type, data) => asString(asRecord(data)?.taskId),
  /**
   * 墓碑律：终局是吸收态，不可复活.
   *
   * Caught in the real log: `opened → voided → terminal`. A turn that timed
   * out voided its task — the honest death for work nobody delivered — and
   * then finished late and appended `terminal` anyway, resurrecting a task the
   * operator had already been told was dead. It then sat in the inbox as
   * 待验收 forever, asking to accept a delivery that had been written off.
   *
   * Acceptance is absorbing for the same reason from the other side: a late
   * `terminal` must not reopen a demand somebody already answered.
   *
   * The late event is not discarded — it is in the log, and the trace shows
   * it. What it may not do is move the object.
   */
  reduce: (previous, event) => {
    const base = asRecord(previous) ?? {}
    const next = asRecord(event.data) ?? {}
    const settled = asString(base.status)
    if (settled === 'voided' || settled === 'accepted') {
      // Only a reopening verb may speak after the end, and a late `terminal`
      // is not one: `rejected` sends an ACCEPTED task back to rework, which is
      // the operator changing their mind and is allowed.
      if (asString(next.status) !== 'rework') return previous
    }
    return { ...base, ...next }
  },
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'interrupted': return '中断·可继续'
    case 'terminal': return '待验收'
    case 'accepted': return '已验收'
    case 'voided': return '已作废'
    case 'rework': return '返工中'
    default: return '进行中'
  }
}

/**
 * 谁能对这张卡说话 = 委派者 ∪ 操作者 (v3.8r 收紧③).
 *
 * 「有 openId」从来不是一道检验——它放行了房间里的每一个人。委派者验收自己委派
 * 的活是主权本义;操作者是这条会话的主人。别人不是。
 *
 * 两个字段都没记的老任务退回旧行为:**一张没人能答的卡本身就是一种失败**,而它
 * 会发生在那些正等着被验收的历史任务上。
 */
function mayJudge(openId: string | undefined, state: TaskState): boolean {
  if (openId === undefined) return false
  if (state.delegatedBy === undefined && state.operator === undefined) return true
  return openId === state.delegatedBy || openId === state.operator
}

export const taskCard: CardDefinition<TaskState> = {
  type: 'task',
  updateStrategy: 'append-echo',

  actions: [
    {
      id: 'accept',
      label: '验收',
      style: 'primary',
      keywords: ['验收', '收了', '可以', '通过', 'done'],
      // 验收是人签发的裁决终态：如实声明（家族即接口），判据留给听的人（私账侧的比值分子）。
      verdict: 'acceptance',
      allowedActors: (actor, state) => mayJudge(actor.openId, state),
      available: state => state.status === 'terminal',
    },
    {
      id: 'reject',
      label: '打回重做',
      style: 'danger',
      keywords: ['打回', '不行', '重做', 'reject'],
      needsInput: true,
      verdict: 'rework',
      allowedActors: (actor, state) => mayJudge(actor.openId, state),
      available: state => state.status === 'terminal',
    },
    {
      /*
        继续 —— 载体断了之后唯一该有的那个动作。

        Its whole point is that the RESULT goes where the original was going:
        the task remembers its landing point, so resuming does not need the
        operator to say where, and a private nudge no longer strands the answer.
      */
      id: 'resume',
      label: '继续',
      style: 'primary',
      keywords: ['继续', '接着做', '重试'],
      allowedActors: (actor, state) => mayJudge(actor.openId, state),
      available: state => state.status === 'interrupted',
    },
    {
      // Reachable from OPEN too: the tasks that need voiding most are the ones
      // whose turn died without ever reaching a terminal, and those would
      // otherwise sit in the inbox forever with no verb that fits them.
      id: 'void',
      label: '作废',
      keywords: ['作废', '取消这个任务', 'void'],
      needsInput: true,
      allowedActors: (actor, state) => mayJudge(actor.openId, state),
      // Interrupted too: 「不做了」 must be reachable from the state that is
      // waiting to be resumed, or 继续 becomes the only door out of it.
      available: state => state.status === 'open' || state.status === 'terminal'
        || state.status === 'interrupted',
    },
  ],

  isResolved: state => state.status === 'accepted' || state.status === 'voided',

  /**
   * **验收卡 —— 可应答对象家族第六员**（v4.14 交付即出卡）。
   *
   * 「找不到验收项」的病根不是它滚走了,是**它长得不像一个等你的东西**。可应答
   * 检验当年点名了确认、裁决、租约、询问,唯独漏了验收——于是终态回帖只是一段
   * 话,而一段话没有脸。这里给它一张脸:③双动词验收,拒收→返工→再验收在同一张
   * 卡上循环,轮次看得见。
   *
   * 中断是另一回事:没有交付可验,人要答的是「还做不做」,那是⑥待答询问。把两者
   * 说成同一种,等于请人去验收一份不存在的产出——正是此前修过的僵尸问题。
   *
   * 失败/超时/空回合根本走不到这里(它们直接作废,不出卡),所以「只有有交付的
   * 完成终态出验收卡」在这一层是**结构性成立**的,不靠这个函数把关。
   *
   * 返工轮次**不写进徽标**。徽标是一格固定词汇（待确认/待裁决/待验收…），塞进
   * 「待验收 · 第 2 版」就把一个变长的事实挤进了一个不变长的槽。轮次的位置在卡上,
   * 设计原话就是「轮次在卡上可见」——`renderText` 里那一行「已返工 N 轮」。
   */
  demand: (state) => {
    if (state.status === 'terminal') {
      return {
        layer: 'blocking',
        mode: 'two-verb-acceptance',
        label: state.summary === undefined || state.summary === '' ? state.what : state.summary,
      }
    }
    if (state.status === 'interrupted') {
      return {
        layer: 'blocking',
        mode: 'open-question',
        label: state.what,
        badge: '待继续',
      }
    }
    return undefined
  },

  renderText: state => ({
    body: [
      `【任务·${statusLabel(state.status)}】${state.what}`,
      ...(state.summary === undefined || state.summary === '' ? [] : [state.summary]),
      ...((state.artifacts ?? []).map(artifact => `· ${artifact.title ?? artifact.uri}`)),
      ...(state.round === undefined ? [] : [`已返工 ${String(state.round)} 轮${state.reason === undefined ? '' : `：${state.reason}`}`]),
      `[card#task:${state.taskId}]`,
    ].join('\n'),
    replyHints: state.status === 'terminal'
      ? ['验收', '打回 <原因>', '作废 <原因>']
      : state.status === 'interrupted' ? ['继续', '作废 <原因>'] : [],
  }),

  onResolved: state => ({
    echoText: state.status === 'voided'
      ? `🗑 已作废：${state.what}${state.reason === undefined ? '' : `（${state.reason}）`}`
      : `✅ 已验收：${state.what}`,
  }),

  apply: (state, action, actor, input) => {
    if (action.id === 'resume') {
      return {
        events: [{
          type: 'task/resumed',
          data: { taskId: state.taskId, resumedBy: actor.openId ?? actor.kind },
          actor,
        }],
      }
    }
    if (action.id === 'void') {
      return {
        events: [{
          type: 'task/voided',
          data: {
            taskId: state.taskId,
            reason: input === undefined || input.trim() === '' ? '未说明原因' : input.trim(),
            voidedBy: actor.openId ?? actor.kind,
          },
          actor,
        }],
      }
    }
    if (action.id === 'reject') {
      return {
        events: [{
          type: 'task/rejected',
          data: {
            taskId: state.taskId,
            round: (state.round ?? 0) + 1,
            reason: input === undefined || input.trim() === '' ? '未说明原因' : input.trim(),
            artifacts: (state.artifacts ?? []).map(artifact => ({ ...artifact })),
            rejectedBy: actor.openId ?? actor.kind,
          },
          actor,
        }],
      }
    }
    return {
      events: [{
        type: 'task/accepted',
        data: { taskId: state.taskId, acceptedBy: actor.openId ?? actor.kind },
        actor,
      }],
    }
  },
}
