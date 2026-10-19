/**
 * Guard specs. Each case is one of the five gates, in the order the guard
 * applies them — escape denial, identity re-pin, live revocation, hard
 * contract, and finally the ask — plus the once-per-turn environment snapshot.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH,
  type PreToolDecision, type ToolExecution, type ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YzjGraph, type GraphEvent } from '@yzj-next/graph'
import {
  approvalFamily, approvalIdFor, leaseFamily, leasesService, type PendingAsk, type TurnBinding,
} from '@yzj-next/objects'
import { markOrphans } from '../src/action.ts'
import { applyApprovalGuard, denialFor, WRITE_SPECS } from '../src/guard.ts'

const IDENTITY = { orgId: 'org-1', openId: 'op-1', name: '操作者' }

const GATEWAY_BINDING: TurnBinding = {
  viewer: { kind: 'operator', openId: 'op-1' },
  decider: 'op-1',
  accountKey: 'acct-1',
  accountOrgId: 'org-1',
  accountOpenId: 'op-1',
  topicKey: 'yzj-topic-1',
  placeKey: 'group-a',
  messageId: 'msg-1',
  senderOpenId: 'u-asker',
  writeMode: 'standard',
}

const DESKTOP_BINDING: TurnBinding = {
  viewer: { kind: 'operator', openId: 'op-1' },
  decider: 'op-1',
  accountKey: 'acct-1',
  accountOrgId: 'org-1',
  accountOpenId: 'op-1',
}

let ctx: Context
let graph: YzjGraph
let asks: { sessionAnchor: string; ask: PendingAsk }[]
let binding: TurnBinding | undefined
let identityPayload: unknown
let turnStartSeq: number
let guards: ((exec: ToolExecution) => string | undefined)[]

/** A minimal execution: the guard reads name, args, callId and the agent's log. */
function execution(
  name: string, args: Record<string, unknown> = {},
  call: { sessionId?: string; callId?: string } = {},
): ToolExecution {
  return {
    name,
    arguments: args,
    callId: call.callId ?? `call-${name}`,
    agent: {
      session: {
        id: call.sessionId ?? 'session-yzj-topic-abc',
        events: [{ type: 'turn/start', seq: turnStartSeq }],
      },
    },
  } as unknown as ToolExecution
}

/**
 * Run one call the way the registry does: the `tools/pre-execute` waterfall
 * first, then the monotonic guard layer, which can turn an allow into a deny
 * but never the reverse.
 */
async function decide(exec: ToolExecution): Promise<PreToolDecision> {
  const decision: PreToolDecision = await ctx.waterfall(
    'tools/pre-execute', exec, async () => ({ kind: 'allow' }),
  )
  if (decision.kind === 'deny') return decision
  for (const guard of guards) {
    const reason = guard(exec)
    if (reason !== undefined) return { kind: 'deny', reason }
  }
  return decision
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-guard-'))
  asks = []
  binding = GATEWAY_BINDING
  identityPayload = [IDENTITY]
  turnStartSeq = 1
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  await graph.selectAccount('acct-1')
  ctx.provide('yzjBridge', {
    run: async () => Promise.resolve({
      ok: true, exitCode: 0, stdout: '', stderr: '',
      json: identityPayload, truncated: false, timedOut: false, durationMs: 1,
    }),
  })
  ctx.provide('yzjTurns', { bindingFor: () => binding, defaultBinding: () => binding })
  ctx.provide('yzjAsks', {
    record: (sessionAnchor: string, ask: PendingAsk) => { asks.push({ sessionAnchor, ask }) },
  })
  guards = []
  ctx.provide('tools', {
    guard: (guard: (exec: ToolExecution) => string | undefined) => {
      guards.push(guard)
      return () => undefined
    },
  })
  applyApprovalGuard(ctx)
})

describe('escape denial', () => {
  it('denies shell and delegated execution inside a gateway turn', async () => {
    expect(await decide(execution('bash', { command: 'ls' })))
      .toMatchObject({ kind: 'deny' })
  })

  it('leaves those tools alone in a desktop turn', async () => {
    binding = DESKTOP_BINDING
    expect(await decide(execution('bash', { command: 'ls' }))).toMatchObject({ kind: 'allow' })
  })

  it('passes non-yzj tools straight through', async () => {
    expect(await decide(execution('read_file', { path: 'a.ts' }))).toMatchObject({ kind: 'allow' })
    expect(asks).toHaveLength(0)
  })
})

describe('identity and revocation', () => {
  it('refuses a call once the login account has changed under the turn', async () => {
    identityPayload = [{ ...IDENTITY, openId: 'someone-else' }]
    await expect(decide(execution('yzj_doc_list', { workspace: 'kb-1' })))
      .rejects.toThrow(/login account changed/)
  })

  it('reads revocation live, on the call, not from a turn snapshot', async () => {
    expect(await decide(execution('yzj_doc_list', { workspace: 'kb-1' })))
      .toMatchObject({ kind: 'allow' })
    await graph.append({
      type: 'authority/revoked',
      data: { messageId: 'msg-1', reason: 'timeout' },
      actor: { kind: 'system' },
    })
    // A denial, not an exception: the model can read "your authority was
    // revoked" and stop; a thrown error is just a broken tool.
    expect(await decide(execution('yzj_doc_list', { workspace: 'kb-1' })))
      .toMatchObject({ kind: 'deny', reason: expect.stringContaining('撤销') })
  })
})

describe('写前复核 (决策 #63)', () => {
  it('让位落成一条撤销：输了却已进入工作的回合，在第一个写调用处被截断，理由说清让给了谁', async () => {
    expect(await decide(execution('yzj_doc_list', { workspace: 'kb-1' })))
      .toMatchObject({ kind: 'allow' })
    await graph.append({
      type: 'authority/revoked',
      data: { messageId: 'msg-1', reason: '让位给 云小助（张三）' },
      actor: { kind: 'system' },
    })
    const decision = await decide(execution('yzj_doc_list', { workspace: 'kb-1' }))
    expect(decision).toMatchObject({ kind: 'deny' })
    expect((decision as { reason: string }).reason).toContain('云小助（张三）')
    expect((decision as { reason: string }).reason).toContain('不可两人动手')
  })
})

describe('write gating', () => {
  it('asks for a strong write even inside an admitted gateway turn', async () => {
    const decision = await decide(execution('yzj_doc_delete', { id: 'doc-1' }))
    expect(decision).toMatchObject({ kind: 'ask' })
    expect(asks[0]?.ask).toMatchObject({ toolName: 'yzj_doc_delete', level: 'strong' })
    expect(asks[0]?.ask.args).toMatchObject({ id: 'doc-1' })
  })

  it('lets a standard write through on the authority of the message that admitted the turn', async () => {
    expect(await decide(execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' })))
      .toMatchObject({ kind: 'allow' })
    expect(asks).toHaveLength(0)
  })

  it('asks for that same standard write in an ordinary desktop turn', async () => {
    binding = DESKTOP_BINDING
    expect(await decide(execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' })))
      .toMatchObject({ kind: 'ask' })
  })

  /*
    **门看的是确认表，不是名字前缀** (v3.15 裁决② 的实测教训).

    这两条判据此前压在同一行里（`if (!name.startsWith('yzj_')) return next()`）。于是
    三个 `commitment_*` 写进确认表之后，**表里有、门不看**——对着 agent 说一句「把那条
    作废掉」，墓碑当场就立了，一次确认都没弹，而那条裁决的全部要点正是「人签发」。

    上一版我为它写的单测只断言了**表里那一格**（`WRITE_SPECS.commitment_void.level`），
    没断言门真的会开口——一条锁住数据、锁不住行为的断言，正是它自己要防的那种。这里锁
    的是行为。
  */
  it('对象层的写工具也要过门 —— 作废是强确认，一次都不许漏', async () => {
    const decision = await decide(execution('commitment_void', { commitmentId: 'c-1' }))
    expect(decision).toMatchObject({ kind: 'ask' })
    expect(asks[0]?.ask).toMatchObject({ toolName: 'commitment_void', level: 'strong' })
  })

  it('顺延与移交在桌面回合里同样要问', async () => {
    binding = DESKTOP_BINDING
    expect(await decide(execution('commitment_postpone', { commitmentId: 'c-1', due: '下周五' })))
      .toMatchObject({ kind: 'ask' })
    expect(await decide(execution('commitment_handoff', { commitmentId: 'c-1', openId: 'u-2' })))
      .toMatchObject({ kind: 'ask' })
  })

  /*
    **记「不限场所」要问，记「本场所」不问**（Bruce 裁决，2026-08-25）。

    三轴里只有场所轴关在这一间屋子里；本人/全组织两轴的坐标是账号本身，那样一条惯例
    从此在每一个会话的每一轮里对模型生效——改的不是某一件事，是「它在多少个房间里说话」。

    两条断言缺一不可：**该问的问**（否则裁决落空），**不该问的不问**（否则人学会闭着
    眼睛点确认，而那比没有门更糟）。这里锁的是行为，不是表里那一格。
  */
  it('记「不限场所」的惯例要过门，记「本场所」的不打断', async () => {
    expect(await decide(execution('memory_note', { summary: '这个群的数字要注明口径', axis: 'place' })))
      .toMatchObject({ kind: 'allow' })
    expect(asks).toHaveLength(0)

    const decision = await decide(execution('memory_note', { summary: '我一律只看结论', axis: 'entity' }))
    expect(decision).toMatchObject({ kind: 'ask' })
    expect(asks[0]?.ask).toMatchObject({ toolName: 'memory_note', level: 'strong' })

    expect(await decide(execution('memory_note', { summary: '全公司周五交周报', axis: 'org' })))
      .toMatchObject({ kind: 'ask' })
  })

  /*
    不在表里的工具照旧直通：门不是一道「凡是没见过的都拦下」的墙，那会把每一次读都
    变成一次打断。
  */
  it('表外的工具不受影响', async () => {
    expect(await decide(execution('graph_query', {}))).toMatchObject({ kind: 'allow' })
  })

  it('honours a conditional gate (download only asks when it would overwrite)', async () => {
    binding = DESKTOP_BINDING
    expect(await decide(execution('yzj_file_download', { id: 'f1' }))).toMatchObject({ kind: 'allow' })
    expect(await decide(execution('yzj_file_download', { id: 'f1', overwrite: true })))
      .toMatchObject({ kind: 'ask' })
  })

  it('fails closed when no approval object is mounted', async () => {
    const bare = new Context()
    const bareGraph = new YzjGraph(bare, { root: await mkdtemp(join(tmpdir(), 'yzj-next-guard-')) })
    await bareGraph.selectAccount('acct-1')
    bare.provide('yzjTurns', { bindingFor: () => DESKTOP_BINDING, defaultBinding: () => DESKTOP_BINDING })
    bare.provide('tools', { guard: () => () => undefined })
    applyApprovalGuard(bare)
    const decision = await bare.waterfall(
      'tools/pre-execute',
      execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' }),
      async () => ({ kind: 'allow' }),
    )
    expect(decision).toMatchObject({ kind: 'deny' })
  })
})

describe('hard contract (oaRequiredCategories)', () => {
  // P1 assigns no categories, so the seam is exercised by giving one to a real
  // spec for the duration of the test — the boundary has to be live before the
  // first contract that uses it is ever written.
  afterEach(() => { delete (WRITE_SPECS.yzj_doc_create as { category?: string }).category })

  it('denies outright instead of asking when the place routes it to the OA rail', async () => {
    ;(WRITE_SPECS.yzj_doc_create as { category?: string }).category = 'expense'
    await graph.append({
      type: 'contract/updated',
      data: {
        placeKey: 'group-a',
        version: 1,
        oaRequiredCategories: ['expense'],
        memoryPolicy: 'normal',
        processSummary: true,
      },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    binding = { ...GATEWAY_BINDING, writeMode: undefined }
    const decision = await decide(execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' }))
    expect(decision).toMatchObject({ kind: 'deny' })
    expect((decision as { reason: string }).reason).toContain('组织审批')
    expect(asks).toHaveLength(0)
  })
})

describe('environment snapshot', () => {
  it('writes at most one line per turn, and only for turns that touched Yunzhijia', async () => {
    await decide(execution('read_file', { path: 'a.ts' }))
    expect(graph.rawEvents(['env/snapshot'])).toHaveLength(0)

    await decide(execution('yzj_doc_list', { workspace: 'kb-1' }))
    await decide(execution('yzj_doc_get', { id: 'doc-1' }))
    expect(graph.rawEvents(['env/snapshot'])).toHaveLength(1)

    turnStartSeq = 42
    await decide(execution('yzj_doc_list', { workspace: 'kb-1' }))
    expect(graph.rawEvents(['env/snapshot'])).toHaveLength(2)
  })

  it('records the contract version the turn was standing on', async () => {
    await graph.append({
      type: 'contract/updated',
      data: {
        placeKey: 'group-a', version: 7, oaRequiredCategories: [],
        memoryPolicy: 'normal', processSummary: true,
      },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    await decide(execution('yzj_doc_list', { workspace: 'kb-1' }))
    expect(graph.rawEvents(['env/snapshot'])[0]?.data).toMatchObject({ contractVersion: 7 })
  })
})

describe('seam ordering', () => {
  // Same lesson as the approval seam: correct logic that runs second is the
  // same as no logic. A competitor is registered FIRST in each case.
  it('sees a gated write before another listener can allow it', async () => {
    const early = new Context()
    const earlyGraph = new YzjGraph(early, { root: await mkdtemp(join(tmpdir(), 'yzj-next-guard-')) })
    await earlyGraph.selectAccount('acct-1')
    early.provide('yzjTurns', { bindingFor: () => DESKTOP_BINDING, defaultBinding: () => DESKTOP_BINDING })
    early.provide('tools', { guard: () => () => undefined })
    const recorded: PendingAsk[] = []
    early.provide('yzjAsks', { record: (_anchor: string, ask: PendingAsk) => { recorded.push(ask) } })
    // A permissive listener already on the seam, registered before us.
    early.on('tools/pre-execute', async () => ({ kind: 'allow' }))
    applyApprovalGuard(early)

    const decision = await early.waterfall(
      'tools/pre-execute',
      execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' }),
      async () => ({ kind: 'allow' }),
    )
    expect(decision).toMatchObject({ kind: 'ask' })
    expect(recorded).toHaveLength(1)
  })

  it('denies through the monotonic guard even when a listener already allowed', async () => {
    // The escape rule cannot be pre-empted: `ctx.tools.guard` has no allow
    // result, so it runs after every listener and still refuses.
    const allowed = await ctx.waterfall(
      'tools/pre-execute', execution('bash', { command: 'ls' }), async () => ({ kind: 'allow' }),
    )
    void allowed
    expect(denialFor(ctx, execution('bash', { command: 'ls' }))).toContain('shell')
    expect(guards).toHaveLength(1)
    expect(guards[0]?.(execution('bash', { command: 'ls' }))).toContain('shell')
  })

  it('keeps denying a revoked task after the confirmation card was approved', async () => {
    // Revocation arriving while a card is pending is the case the monotonic
    // guard exists for: the ask already happened, the answer already came in.
    await graph.append({
      type: 'authority/revoked',
      data: { messageId: 'msg-1', reason: 'timeout' },
      actor: { kind: 'system' },
    })
    expect(guards[0]?.(execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' })))
      .toContain('撤销')
  })
})

/**
 * 轻问 — a projection that could write is not a projection.
 *
 * The refusal lives in the monotonic guard rather than in the prompt, because
 * "ask a question, get a number" stops being true the first time a model
 * decides the helpful thing to do is write the number down somewhere.
 */
describe('read-only turns', () => {
  const READ_ONLY: TurnBinding = { ...DESKTOP_BINDING, writeMode: 'read-only' }

  it('denies every gated write, standard and strong alike', async () => {
    binding = READ_ONLY
    expect(await decide(execution('yzj_doc_create', { title: 'x' })))
      .toMatchObject({ kind: 'deny', reason: expect.stringContaining('轻问') })
    expect(await decide(execution('yzj_doc_delete', { nodeId: 'n1' })))
      .toMatchObject({ kind: 'deny' })
    expect(asks).toHaveLength(0)
  })

  it('still lets it READ, which is the entire point', async () => {
    binding = READ_ONLY
    expect(await decide(execution('yzj_doc_list', { workspace: 'kb-1' })))
      .toMatchObject({ kind: 'allow' })
  })

  it('denies shell and delegation too — a projection has no business there', async () => {
    binding = READ_ONLY
    expect(await decide(execution('bash', { command: 'ls' })))
      .toMatchObject({ kind: 'deny', reason: expect.stringContaining('轻问') })
  })

  it('cannot be talked out of it by an earlier listener that allows', async () => {
    // The pre-execute waterfall runs in registration order, so a competitor
    // registered first would win — unless the denial is ALSO in the guard,
    // which has no allow result and runs after every listener.
    binding = READ_ONLY
    ctx.on('tools/pre-execute', async () => ({ kind: 'allow' as const }), { prepend: true })
    expect(await decide(execution('yzj_doc_create', { title: 'x' })))
      .toMatchObject({ kind: 'deny' })
  })

  it('leaves an ordinary gateway turn\'s standard write alone', async () => {
    binding = GATEWAY_BINDING
    expect(await decide(execution('yzj_doc_create', { title: 'x' })))
      .toMatchObject({ kind: 'allow' })
  })
})

/**
 * 账（技术方案-下一代ERP账本 E0 §13.3–§13.4）：守门人放行的每一次写，执行之前恰好一行
 * `action/released`，带一个追得到人的授权来源；执行之后一行 `action/settled`，记效果
 * 有没有发生。编号对应 §13.7 的验收测试。
 *
 * 驱动方式与注册表一致：`tools/pre-execute` 瀑布 → 单调守卫 → （ask 时由确认面作答）→
 * `tools/execute` 瀑布，最内层是工具体。
 */
describe('the ledger (E0)', () => {
  const OK: ToolExecutionResult = { isError: false, value: null, content: [{ type: 'text', text: 'ok' }] }
  let bodyCalls: number
  let leasesMounted: boolean

  beforeEach(() => {
    bodyCalls = 0
    leasesMounted = false
    graph.defineFamily(approvalFamily)
  })

  const body = (result: ToolExecutionResult = OK) => async (): Promise<ToolExecutionResult> => {
    bodyCalls += 1
    return Promise.resolve(result)
  }
  const dispatch = (exec: ToolExecution, inner = body()): Promise<ToolExecutionResult> => (
    ctx.waterfall('tools/execute', exec as never, inner)
  )
  /** One full call. `answer` is how a confirmation card, if one is asked, gets answered. */
  async function call(
    exec: ToolExecution,
    answer: 'approve' | 'reject' | 'host' = 'approve',
    inner = body(),
  ): Promise<{ decision: PreToolDecision; result?: ToolExecutionResult }> {
    const decision = await decide(exec)
    if (decision.kind === 'deny') return { decision }
    if (decision.kind === 'ask') {
      if (answer === 'reject') return { decision }
      if (answer === 'approve') await decideCard(exec, 'approved')
    }
    return { decision, result: await dispatch(exec, inner) }
  }
  /** What the approval answerer writes when our card is answered. */
  async function decideCard(exec: ToolExecution, status: 'approved' | 'rejected'): Promise<string> {
    const approvalId = approvalIdFor(String(exec.agent?.session.id), String(exec.callId))
    await graph.append({
      type: 'approval/opened',
      data: {
        approvalId, toolName: exec.name, reason: 'x', level: WRITE_SPECS[exec.name]?.level ?? 'standard',
        args: exec.arguments as never, argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 60_000,
      },
      actor: { kind: 'agent' },
    })
    await graph.append({ type: 'approval/decided', data: { approvalId, status, decidedBy: 'op-1' }, actor: { kind: 'operator', openId: 'op-1' } })
    return approvalId
  }
  const released = (): GraphEvent[] => [...graph.rawEvents(['action/released'])]
  const settled = (): GraphEvent[] => [...graph.rawEvents(['action/settled'])]
  /** A real lease, granted on the graph and read through the real lease service. */
  async function grantLease(toolClass: string, leaseId = 'lse-1'): Promise<void> {
    if (!leasesMounted) {
      graph.defineFamily(leaseFamily)
      ctx.provide('yzjLeases', leasesService(ctx))
      leasesMounted = true
    }
    const scope = { toolClass }
    await graph.append({
      type: 'lease/proposed',
      data: {
        leaseId, scope, period: { from: Date.now() - 1_000, to: Date.now() + 86_400_000 }, periodText: '1 天',
        family: 'write-confirm', decider: 'op-1', reason: 'x', idemKey: `lease:${leaseId}`,
      },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    await graph.append({
      type: 'lease/granted',
      data: { leaseId, grantedBy: 'op-1', scope, periodText: '1 天', family: 'write-confirm' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
  }

  // #6
  it('租约路径：authority 是那一张租约、签它的人；随后 settled ok', async () => {
    binding = DESKTOP_BINDING
    await grantLease('doc')
    const { decision, result } = await call(execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' }))
    expect(decision).toMatchObject({ kind: 'allow' })
    expect(result).toBe(OK)
    expect(released()).toHaveLength(1)
    expect(released()[0]?.data).toMatchObject({
      sessionId: 'session-yzj-topic-abc', callId: 'call-yzj_doc_create', toolName: 'yzj_doc_create', level: 'standard',
      authority: { kind: 'lease', leaseId: 'lse-1', grantedBy: 'op-1' },
    })
    expect(released()[0]?.actor).toEqual({ kind: 'agent' })
    expect(settled()[0]?.data).toMatchObject({ callId: 'call-yzj_doc_create', outcome: 'ok' })
    // 先记后做：released 在 settled 之前，而且是同一次调用。
    expect((released()[0]?.seq ?? 0) < (settled()[0]?.seq ?? 0)).toBe(true)
  })

  // #7
  it('消息路径：标准写凭接纳消息放行，记的是发消息的人；说不出是谁发的就问', async () => {
    const { result } = await call(execution('yzj_doc_create', { workspace: 'kb-1', title: 'x' }))
    expect(result).toBe(OK)
    expect(released()[0]?.data).toMatchObject({
      authority: { kind: 'message', messageId: 'msg-1', senderOpenId: 'u-asker' }, topicKey: 'yzj-topic-1', placeKey: 'group-a',
    })

    const { senderOpenId: _sender, ...anonymous } = GATEWAY_BINDING
    binding = anonymous
    expect(await decide(execution('yzj_doc_create', { title: 'y' }, { callId: 'call-2' })))
      .toMatchObject({ kind: 'ask' })
    binding = { ...GATEWAY_BINDING, senderOpenId: '' }
    expect(await decide(execution('yzj_doc_create', { title: 'z' }, { callId: 'call-3' })))
      .toMatchObject({ kind: 'ask' })
  })

  // #8
  it('确认路径：批准记批卡的人；拒绝则没有 released、工具体不执行；宿主审批记操作者', async () => {
    binding = DESKTOP_BINDING
    const approved = execution('yzj_doc_create', { title: 'x' })
    const { decision, result } = await call(approved, 'approve')
    expect(decision).toMatchObject({ kind: 'ask' })
    expect(result).toBe(OK)
    expect(released()[0]?.data).toMatchObject({
      authority: { kind: 'approval', approvalId: approvalIdFor('session-yzj-topic-abc', 'call-yzj_doc_create'), decidedBy: 'op-1' },
    })

    const rejected = execution('yzj_doc_rename', { id: 'd', title: 'y' })
    expect((await call(rejected, 'reject')).result).toBeUndefined()
    expect(released()).toHaveLength(1)
    // 防线：一张被拒的卡不论如何走到了执行，也不认。
    await decideCard(rejected, 'rejected')
    const forced = await dispatch(rejected)
    expect(forced).toMatchObject({ isError: true, error: { message: '找不到这次写入的授权，没有执行' } })
    expect(released()).toHaveLength(1)

    const host = execution('yzj_doc_move', { id: 'd', to: 'p' })
    await call(host, 'host')
    expect(released()[1]?.data).toMatchObject({ authority: { kind: 'operator', openId: 'op-1', via: 'host-approval' } })
    expect(bodyCalls).toBe(2)
  })

  // #9
  it('强写永远不被租约放行：authority 只会是 approval 或宿主审批；memory_note 的场所轴记消息或操作者', async () => {
    await grantLease('doc')
    await call(execution('yzj_doc_delete', { id: 'doc-1' }), 'approve')
    await call(execution('yzj_doc_block_delete', { id: 'b-1' }), 'host')
    const strong = released().map(event => (event.data as { authority: { kind: string; via?: string } }).authority)
    expect(strong).toEqual([
      expect.objectContaining({ kind: 'approval' }),
      expect.objectContaining({ kind: 'operator', via: 'host-approval' }),
    ])

    await call(execution('memory_note', { summary: 's', axis: 'place' }, { callId: 'm-1' }))
    expect(released().at(-1)?.data).toMatchObject({
      level: 'strong', authority: { kind: 'message', messageId: 'msg-1', senderOpenId: 'u-asker' },
    })
    binding = DESKTOP_BINDING
    await call(execution('memory_note', { summary: 's', axis: 'place' }, { callId: 'm-2' }))
    expect(released().at(-1)?.data).toMatchObject({ authority: { kind: 'operator', openId: 'op-1', via: 'exempt' } })
  })

  // #10
  it('fail closed：released 写不下，工具体就不被调用，返回值与 dsh-tools 的错误同形', async () => {
    const append = graph.append.bind(graph)
    vi.spyOn(graph, 'append').mockImplementation(async (input) => {
      if (input.type === 'action/released') throw new Error('disk full')
      return append(input)
    })
    const { result } = await call(execution('yzj_doc_create', { title: 'x' }))
    expect(bodyCalls).toBe(0)
    expect(result).toEqual({
      isError: true,
      error: { message: '账没记上，这次写入没有执行（disk full）' },
      content: [{ type: 'text', text: 'Error: 账没记上，这次写入没有执行（disk full）' }],
    })
  })

  // #11
  it('两个会话用同一个 callId 并发执行：授权不串号，两对 released / settled 各自配对', async () => {
    const left = execution('yzj_doc_create', { title: 'L' }, { sessionId: 'session-L', callId: 'call-x' })
    const right = execution('yzj_doc_delete', { id: 'R' }, { sessionId: 'session-R', callId: 'call-x' })
    expect(await decide(left)).toMatchObject({ kind: 'allow' })
    expect(await decide(right)).toMatchObject({ kind: 'ask' })
    await decideCard(right, 'approved')
    const slow = (ms: number) => async (): Promise<ToolExecutionResult> => {
      await new Promise(resolve => setTimeout(resolve, ms))
      return OK
    }
    await Promise.all([dispatch(left, slow(20)), dispatch(right, slow(5))])
    const bySession = (events: GraphEvent[], sessionId: string): GraphEvent | undefined => (
      events.find(event => (event.data as { sessionId?: string }).sessionId === sessionId)
    )
    expect(bySession(released(), 'session-L')?.data).toMatchObject({ toolName: 'yzj_doc_create', authority: { kind: 'message' } })
    expect(bySession(released(), 'session-R')?.data).toMatchObject({
      toolName: 'yzj_doc_delete', authority: { kind: 'approval', approvalId: approvalIdFor('session-R', 'call-x') },
    })
    expect(bySession(settled(), 'session-L')?.data).toMatchObject({ callId: 'call-x', outcome: 'ok' })
    expect(bySession(settled(), 'session-R')?.data).toMatchObject({ callId: 'call-x', outcome: 'ok' })
    expect(graph.integrity().orphanActions).toBe(0)
  })

  // #12
  it('读工具不产生任何 action 行', async () => {
    await call(execution('yzj_doc_list', { workspace: 'kb-1' }))
    await call(execution('read_file', { path: 'a.ts' }))
    expect(graph.rawEvents(['action/released', 'action/settled', 'action/outcome-unknown'])).toHaveLength(0)
    expect(bodyCalls).toBe(2)
  })

  // #16
  it('env/snapshot.activeLeaseIds 等于当时生效的租约', async () => {
    await grantLease('doc', 'lse-1')
    await grantLease('sheet', 'lse-2')
    await decide(execution('yzj_doc_list', { workspace: 'kb-1' }))
    expect([...((graph.rawEvents(['env/snapshot'])[0]?.data as { activeLeaseIds: string[] }).activeLeaseIds)].sort())
      .toEqual(['lse-1', 'lse-2'])
  })

  // #18
  it('效果有没有发生：派发前取消 = not-dispatched；工具体跑完后取消或超时 = aborted-after-body；报错 = failed', async () => {
    const failure = (code: string): ToolExecutionResult => ({
      isError: true, error: { message: code, info: { name: 'E', code } }, content: [{ type: 'text', text: `Error: ${code}` }],
    })
    const cases: [string, ToolExecutionResult, string][] = [
      ['c-1', failure(TOOL_ABORTED_BEFORE_DISPATCH), 'not-dispatched'],
      ['c-2', failure(TOOL_ABORTED), 'aborted-after-body'],
      ['c-3', failure('TOOL_TIMEOUT'), 'aborted-after-body'],
      ['c-4', failure('YZJ_CLI_FAILED'), 'failed'],
    ]
    for (const [callId, result] of cases) {
      await call(execution('yzj_doc_create', { title: callId }, { callId }), 'approve', body(result))
    }
    expect(settled().map(event => {
      const data = event.data as { outcome: string; errorCode?: string }
      return [data.outcome, data.errorCode]
    })).toEqual([
      ['not-dispatched', TOOL_ABORTED_BEFORE_DISPATCH],
      ['aborted-after-body', TOOL_ABORTED],
      ['aborted-after-body', 'TOOL_TIMEOUT'],
      ['failed', 'YZJ_CLI_FAILED'],
    ])
  })

  it('下游包装器自己抛错：说不清效果，就不编一个 outcome——留成孤儿，integrity() 立刻看得见', async () => {
    await decide(execution('yzj_doc_create', { title: 'x' }))
    await expect(dispatch(execution('yzj_doc_create', { title: 'x' }), async () => Promise.reject(new Error('checkpoint failed'))))
      .rejects.toThrow('checkpoint failed')
    expect(released()).toHaveLength(1)
    expect(settled()).toHaveLength(0)
    expect(graph.integrity().orphanActions).toBe(1)
  })

  // #21
  it('没有任何 binding 时，需要操作者授权的写被拒：找不到这次写入的授权', async () => {
    binding = undefined
    const exempt = await call(execution('memory_note', { summary: 's', axis: 'place' }))
    expect(exempt.result).toMatchObject({ isError: true, error: { message: '找不到这次写入的授权，没有执行' } })
    const host = await call(execution('yzj_doc_create', { title: 'x' }), 'host')
    expect(host.result).toMatchObject({ isError: true, error: { message: '找不到这次写入的授权，没有执行' } })
    expect(bodyCalls).toBe(0)
    expect(released()).toHaveLength(0)
  })

  it('没经过守门人的写到不了工具体：找不到授权就不执行', async () => {
    expect(await dispatch(execution('yzj_doc_create', { title: 'x' }, { callId: 'never-gated' })))
      .toMatchObject({ isError: true, error: { message: '找不到这次写入的授权，没有执行' } })
    expect(bodyCalls).toBe(0)
  })
})

// #13
describe('orphaned writes (§13.4)', () => {
  const RELEASED = (callId: string) => ({
    type: 'action/released',
    data: {
      sessionId: 's-1', callId, toolName: 'yzj_doc_create', level: 'standard', argsDigest: 'd',
      authority: { kind: 'operator', openId: 'op-1', via: 'exempt' },
    },
    actor: { kind: 'agent' as const },
  })

  async function boot(root: string): Promise<{ scoped: Context; scopedGraph: YzjGraph }> {
    const scoped = new Context()
    const scopedGraph = new YzjGraph(scoped, { root })
    scoped.provide('tools', { guard: () => () => undefined })
    applyApprovalGuard(scoped)
    await scopedGraph.selectAccount('acct-1')
    await vi.waitFor(() => { expect(scopedGraph.opened).toBeDefined() })
    return { scoped, scopedGraph }
  }
  const unknowns = (one: YzjGraph): readonly GraphEvent[] => one.rawEvents(['action/outcome-unknown'])

  it('放行了没结算：打开分区两次，恰好一行 outcome-unknown；打开之后才开始的调用不被扫到', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzj-next-orphan-'))
    const first = await boot(root)
    const crashed = await first.scopedGraph.append(RELEASED('crashed'))
    await first.scopedGraph.append(RELEASED('done'))
    await first.scopedGraph.append({
      type: 'action/settled', data: { sessionId: 's-1', callId: 'done', outcome: 'aborted-after-body', durationMs: 3 }, actor: { kind: 'agent' },
    })

    const second = await boot(root)
    await vi.waitFor(() => { expect(unknowns(second.scopedGraph)).toHaveLength(1) })
    expect(unknowns(second.scopedGraph)[0]).toMatchObject({
      actor: { kind: 'system' },
      data: {
        sessionId: 's-1', callId: 'crashed', releasedSeq: crashed.seq,
        rule: { id: 'ledger.orphan-action', version: 1 }, causedBy: [crashed.seq],
      },
    })
    // 打开之后才开始的在途调用：seq 越过了打开那一刻，扫描不碰它。
    await second.scopedGraph.append(RELEASED('in-flight'))
    expect(await markOrphans(second.scoped, second.scopedGraph.opened!)).toBe(0)
    expect(second.scopedGraph.integrity().orphanActions).toBe(1)

    const third = await boot(root)
    await new Promise(resolve => setTimeout(resolve, 20))
    // 第三次打开：crashed 已经标过；in-flight 这才是孤儿（它的进程已经不在了），标一次。
    expect(unknowns(third.scopedGraph).map(event => (event.data as { callId: string }).callId))
      .toEqual(['crashed', 'in-flight'])
    expect(third.scopedGraph.integrity().orphanActions).toBe(0)
  })

  it('分区先于守门人打开（插件晚到）：照样补扫一次', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzj-next-orphan-'))
    const first = await boot(root)
    await first.scopedGraph.append(RELEASED('crashed'))

    const late = new Context()
    const lateGraph = new YzjGraph(late, { root })
    await lateGraph.selectAccount('acct-1')
    late.provide('tools', { guard: () => () => undefined })
    applyApprovalGuard(late)
    await vi.waitFor(() => { expect(unknowns(lateGraph)).toHaveLength(1) })
  })
})
