/**
 * 账 × 宿主真实的工具注册表（技术方案-下一代ERP账本 §13.8 的进程内替身）。
 *
 * `guard.spec.ts` 用手搭的瀑布驱动守门人；这里换成 dsh-tools 真正的 `ToolRuntime`：
 * pre-execute 瀑布 → ask 交给确认面（真的 `ApprovalAnswerer`，真的卡片服务）→ 单调守卫
 * → `tools/execute` 瀑布 → 真的 `yzj_doc_*` 工具体。缺的只有两样：云之家 CLI（假桥）与
 * 模型（调用由测试直接发起）。三条放行路各走一次写，审计对每一条给出「放行就有结算、
 * 链不断」——与实测同一个判据。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YzjRunResult } from '@yzj-next/bridge'
import { YzjCards } from '@yzj-next/cards'
import { YzjGraph, auditLedger, type GraphEvent } from '@yzj-next/graph'
import {
  ApprovalAnswerer, approvalCard, approvalFamily, approvalIdFor, leaseCard, leaseFamily, leasesService,
  proposeLease, type PendingAsk, type TurnBinding,
} from '@yzj-next/objects'
import { applyDocTools } from '../src/doc.ts'
import { applyApprovalGuard } from '../src/guard.ts'

const OPERATOR = { kind: 'operator' as const, openId: 'op-1' }
const GATEWAY: TurnBinding = {
  viewer: { kind: 'place', placeKey: 'yzj-group-a' }, decider: 'op-1', accountKey: 'acct-1',
  accountOrgId: 'org-1', accountOpenId: 'op-1', topicKey: 'yzj-topic-1', placeKey: 'yzj-group-a',
  messageId: 'msg-1', senderOpenId: 'u-asker', writeMode: 'standard',
}
const DESK: TurnBinding = {
  viewer: { kind: 'operator', openId: 'op-1' }, decider: 'op-1', accountKey: 'acct-1',
  accountOrgId: 'org-1', accountOpenId: 'op-1',
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let binding: TurnBinding
let bridgeCalls: string[][]
let hostAnswer: 'allowed-once' | 'unavailable'
let session = 0
/** Swappable per test: cordis does not let a service be provided twice. */
let bridgeRun: (command: readonly string[]) => Promise<YzjRunResult>
let recordAsk: (anchor: string, ask: PendingAsk) => void

const agent = { session: { id: 'session-yzj-topic-1', events: [{ type: 'turn/start', seq: 1 }] } }

function ok(json: unknown): YzjRunResult {
  return { ok: true, exitCode: 0, stdout: JSON.stringify(json), stderr: '', json, truncated: false, timedOut: false, durationMs: 1 }
}

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-ledger-int-')) })
  graph.defineFamily(approvalFamily)
  graph.defineFamily(leaseFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(approvalCard)
  cards.register(leaseCard)
  cards.setDesktopActor(OPERATOR, '操作者')
  binding = GATEWAY
  bridgeCalls = []
  hostAnswer = 'unavailable'
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined })
  bridgeRun = async (command) => {
    bridgeCalls.push([...command])
    if (command.join(' ') === 'contact user get') return ok([{ orgId: 'org-1', openId: 'op-1', name: '操作者' }])
    if (command[1] === 'create') return ok({ id: `doc-${String(bridgeCalls.length)}`, title: 't' })
    return ok({})
  }
  ctx.provide('yzjBridge', { run: (command: readonly string[]) => bridgeRun(command) })
  ctx.provide('yzjTurns', { bindingFor: () => binding, defaultBinding: () => binding })
  ctx.provide('yzjLeases', leasesService(ctx))
  // 宿主的 ApprovalService 只做一件事：把请求交给 `approval/request` 瀑布；没人认领就落到宿主自己的界面。
  ctx.provide('approval', { request: (request: unknown) => ctx.waterfall('approval/request', request as never, async () => hostAnswer) })
  const answerer = new ApprovalAnswerer(ctx, { ttlMs: 60_000 })
  recordAsk = (anchor, ask) => { answerer.record(anchor, ask) }
  ctx.provide('yzjAsks', { record: (anchor: string, ask: PendingAsk) => { recordAsk(anchor, ask) } })
  ctx.on('approval/request', (request, next) => answerer.handle(request, next), { prepend: true })
  new ToolRuntime(ctx)
  applyApprovalGuard(ctx)
  applyDocTools(ctx, { timeoutMs: 10_000, maxRenderChars: 4_000, maxMetaChars: 4_000 })
})

function run(name: string, args: Record<string, unknown>, signal = new AbortController().signal): Promise<ToolExecutionResult> {
  session += 1
  return ctx.tools.execute({ callId: `call-${String(session)}`, name, arguments: args, agent: agent as never, signal })
}
const released = (): readonly GraphEvent[] => graph.rawEvents(['action/released'])
const authorityOf = (event: GraphEvent | undefined): unknown => (event?.data as { authority?: unknown } | undefined)?.authority
const writes = (): string[][] => bridgeCalls.filter(command => command[0] === 'doc')

describe('三条放行路，走宿主真实的工具注册表', () => {
  it('消息：接纳回合里的标准写凭那条消息放行，账上记发消息的人', async () => {
    const result = await run('yzj_doc_create', { workspace: 'kb-1', title: 'E0' })
    expect(result.isError).toBe(false)
    expect(writes()).toHaveLength(1)
    expect(authorityOf(released()[0])).toEqual({ kind: 'message', messageId: 'msg-1', senderOpenId: 'u-asker' })
  })

  it('确认：桌面回合问一次，人在卡上批了才执行，账上记批卡的人', async () => {
    binding = DESK
    const pending = run('yzj_doc_create', { workspace: 'kb-1', title: 'E0' })
    await vi.waitFor(() => { expect(graph.rawEvents(['approval/opened'])).toHaveLength(1) })
    // 卡已经开了，工具体还没动：先问后做。
    expect(writes()).toHaveLength(0)
    expect(released()).toHaveLength(0)
    const approvalId = (graph.rawEvents(['approval/opened'])[0]?.data as { approvalId: string }).approvalId
    expect(approvalId).toBe(approvalIdFor('session-yzj-topic-1', `call-${String(session)}`))
    await cards.act({ kind: 'approval', id: approvalId }, 'approve', OPERATOR, 'desktop')
    expect((await pending).isError).toBe(false)
    expect(authorityOf(released()[0])).toEqual({ kind: 'approval', approvalId, decidedBy: 'op-1' })
  })

  it('确认被拒：没有 released，工具体一次都没跑', async () => {
    binding = DESK
    const pending = run('yzj_doc_create', { workspace: 'kb-1', title: 'E0' })
    await vi.waitFor(() => { expect(graph.rawEvents(['approval/opened'])).toHaveLength(1) })
    const approvalId = (graph.rawEvents(['approval/opened'])[0]?.data as { approvalId: string }).approvalId
    await cards.act({ kind: 'approval', id: approvalId }, 'reject', OPERATOR, 'desktop', '先别建')
    expect((await pending).isError).toBe(true)
    expect(writes()).toHaveLength(0)
    expect(released()).toHaveLength(0)
  })

  it('宿主审批：不是我们的卡，由宿主界面放行，账上记本实例的操作者', async () => {
    binding = DESK
    // 宿主自己的审批界面：我们的应答器不认领（询问没登记），落到下游。
    recordAsk = () => undefined
    hostAnswer = 'allowed-once'
    expect((await run('yzj_doc_create', { workspace: 'kb-1', title: 'E0' })).isError).toBe(false)
    expect(authorityOf(released()[0])).toEqual({ kind: 'operator', openId: 'op-1', via: 'host-approval' })
  })

  it('租约：签发过的租约先于消息放行，账上记签租约的人；强写照旧要问', async () => {
    const leaseId = await proposeLease(ctx, { decider: 'op-1', toolClass: 'doc', days: 1, family: 'write-confirm', reason: 'x', now: Date.now() - 1_000 })
    await cards.act({ kind: 'lease', id: leaseId }, 'grant', OPERATOR, 'desktop')
    expect((await run('yzj_doc_create', { workspace: 'kb-1', title: 'E0' })).isError).toBe(false)
    expect(authorityOf(released()[0])).toEqual({ kind: 'lease', leaseId, grantedBy: 'op-1' })

    const pending = run('yzj_doc_delete', { id: 'doc-1' })
    await vi.waitFor(() => { expect(graph.rawEvents(['approval/opened'])).toHaveLength(1) })
    const approvalId = (graph.rawEvents(['approval/opened'])[0]?.data as { approvalId: string }).approvalId
    await cards.act({ kind: 'approval', id: approvalId }, 'approve', OPERATOR, 'desktop')
    expect((await pending).isError).toBe(false)
    expect(authorityOf(released()[1])).toMatchObject({ kind: 'approval', approvalId })
  })

  it('派发前就取消：注册表根本不进 tools/execute——没有放行，也就没有账', async () => {
    const controller = new AbortController()
    controller.abort()
    expect((await run('yzj_doc_create', { workspace: 'kb-1', title: 'E0' }, controller.signal)).isError).toBe(true)
    expect(released()).toHaveLength(0)
    expect(writes()).toHaveLength(0)
  })

  it('工具体跑着时被取消：settled 记 aborted-after-body——效果可能已经发生', async () => {
    const controller = new AbortController()
    bridgeRun = async (command) => {
      bridgeCalls.push([...command])
      if (command[0] === 'doc') controller.abort()
      return ok(command[0] === 'doc' ? { id: 'doc-x' } : [{ orgId: 'org-1', openId: 'op-1' }])
    }
    const result = await run('yzj_doc_create', { workspace: 'kb-1', title: 'E0' }, controller.signal)
    expect(result.isError).toBe(true)
    expect(writes()).toHaveLength(1)
    expect(graph.rawEvents(['action/settled'])[0]?.data).toMatchObject({ outcome: 'aborted-after-body', errorCode: 'ABORTED' })
  })

  it('审计：每一条放行都有结算，链不断，没有孤儿', async () => {
    await run('yzj_doc_create', { workspace: 'kb-1', title: 'a' })
    await run('yzj_doc_create', { workspace: 'kb-1', title: 'b' })
    await run('yzj_doc_list', { workspace: 'kb-1' })
    const audit = auditLedger(graph.rawEvents(['ledger/genesis', 'action/released', 'action/settled', 'env/snapshot']))
    expect(audit.byType['action/released']).toBe(2)
    expect(audit.byType['action/settled']).toBe(2)
    expect(audit.orphanActions).toBe(0)
    expect(graph.integrity()).toMatchObject({ genesisSeq: 1, orphanActions: 0 })
    expect(graph.integrity().breakAt).toBeUndefined()
  })
})
