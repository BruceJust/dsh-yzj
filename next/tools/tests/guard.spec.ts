/**
 * Guard specs. Each case is one of the five gates, in the order the guard
 * applies them — escape denial, identity re-pin, live revocation, hard
 * contract, and finally the ask — plus the once-per-turn environment snapshot.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import type { PendingAsk, TurnBinding } from '@yzj-next/objects'
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
function execution(name: string, args: Record<string, unknown> = {}): ToolExecution {
  return {
    name,
    arguments: args,
    callId: `call-${name}`,
    agent: {
      session: {
        id: 'session-yzj-topic-abc',
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
