/**
 * `action` 族 —— 守门人放行一次写，账上留下的三行（技术方案-下一代ERP账本 §3.1 / §13.3 / §13.4）。
 *
 * 守门人决定「谁授权」，但在这之前它**不留任何记录**：一次被租约放行的写、一次凭接纳消息
 * 免确认的写，事后翻账的人看到的只有效果，看不到是谁让它发生的。这里补上的正是那一行：
 *
 * - `action/released` —— **先记后做**：执行之前写下，带授权来源，且来源必能解析到一个人；
 * - `action/settled`  —— 执行之后写下，`outcome` 记的是**效果有没有发生**，不是布尔成败；
 * - `action/outcome-unknown` —— 启动时发现「放行了、没结算」的行，交人去看。
 *
 * 云之家接口**没有幂等键**，所以这里绝不自动重试，也不去对方系统查——查不出可信的答案，
 * 而一次自作主张的重试就是第二次写。
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  ACTION_OUTCOME_UNKNOWN, ACTION_RELEASED, ACTION_SETTLED, actionKey, z,
  type GraphFamily, type GraphOpened,
} from '@yzj-next/graph'

/**
 * 授权来源（§3.1 路一）。四种之一，且每一种都追得到一个人：签租约的、发消息的、批卡的、
 * 或本实例的操作者——寄生期，操作者对自己实例的默认行为负责。
 */
const authority = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lease'), leaseId: z.string().min(1), grantedBy: z.string().min(1) }),
  z.object({ kind: z.literal('message'), messageId: z.string().min(1), senderOpenId: z.string().min(1) }),
  z.object({ kind: z.literal('approval'), approvalId: z.string().min(1), decidedBy: z.string().min(1) }),
  // exempt：spec.when 为假且本回合没有可用的接纳消息；host-approval：确认由宿主自己的审批
  // 界面完成（图上没有审批对象）——那个界面只在操作者桌面上，批准者就是操作者。
  z.object({ kind: z.literal('operator'), openId: z.string().min(1), via: z.enum(['exempt', 'host-approval']) }),
])

export type ActionAuthority = z.infer<typeof authority>

/** 效果有没有发生（§13.3 表）。 */
export type ActionOutcome = 'ok' | 'failed' | 'aborted-after-body' | 'not-dispatched'

/** 结果不明的规则：给定规则版本和起因，结果可以复现——所以它是 `ruled`，不是 `did`。 */
export const ORPHAN_RULE = { id: 'ledger.orphan-action', version: 1 } as const

const call = { sessionId: z.string().min(1), callId: z.string().min(1) }

export const actionFamily: GraphFamily = {
  kind: 'action',
  events: {
    [ACTION_RELEASED]: {
      schema: z.object({
        ...call,
        toolName: z.string().min(1),
        level: z.enum(['standard', 'strong']),
        argsDigest: z.string().min(1),
        authority,
        topicKey: z.string().optional(),
        placeKey: z.string().optional(),
      }),
    },
    [ACTION_SETTLED]: {
      schema: z.object({
        ...call,
        outcome: z.enum(['ok', 'failed', 'aborted-after-body', 'not-dispatched']),
        errorCode: z.string().optional(),
        durationMs: z.number().min(0),
      }),
    },
    // I4：`ruled` 行必带规则与非空起因。E0 只有这一种 ruled 行，由 schema 执行。
    [ACTION_OUTCOME_UNKNOWN]: {
      schema: z.object({
        ...call,
        releasedSeq: z.number().int().min(1),
        rule: z.object({ id: z.literal(ORPHAN_RULE.id), version: z.literal(ORPHAN_RULE.version) }),
        causedBy: z.array(z.number().int().min(1)).min(1),
      }),
    },
  },
}

/**
 * 孤儿扫描（§13.4）：分区打开那一刻之前放行、却既没结算也没被标过的写，各标一行
 * 「结果不明」。只扫 `seq ≤ lastSeqAtOpen`——之后的行是这个进程的在途调用，不是孤儿。
 * `aborted-after-body` 的 settled 不算孤儿：它已经如实记下了「效果可能已发生」。
 */
export async function markOrphans(ctx: Context, opened: GraphOpened): Promise<number> {
  const marked = new Set<string>()
  for (const released of ctx.yzjGraph.orphanActions()) {
    const key = actionKey(released.data)
    if (released.seq > opened.lastSeqAtOpen || key === undefined || marked.has(key)) continue
    marked.add(key)
    const { sessionId, callId } = released.data as { sessionId: string; callId: string }
    await ctx.yzjGraph.append({
      type: ACTION_OUTCOME_UNKNOWN,
      data: { sessionId, callId, releasedSeq: released.seq, rule: { ...ORPHAN_RULE }, causedBy: [released.seq] },
      actor: { kind: 'system' },
    })
  }
  return marked.size
}

/** 注册 `action` 族与孤儿扫描。分区已经先于本插件打开（插件晚到）时，补扫一次。 */
export function applyActionLedger(ctx: Context): () => void {
  const disposeFamily = ctx.yzjGraph.defineFamily(actionFamily)
  const scan = (opened: GraphOpened): void => {
    void markOrphans(ctx, opened).catch((error: unknown) => {
      console.error('[yzj-next-tools] failed to mark orphaned writes', error)
    })
  }
  const disposeOpened = ctx.on('yzj-graph/opened', scan)
  const opened = ctx.yzjGraph.opened
  if (opened !== undefined) scan(opened)
  return () => {
    disposeOpened()
    disposeFamily()
  }
}
