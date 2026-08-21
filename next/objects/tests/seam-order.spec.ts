/**
 * Seam-ordering specs.
 *
 * These exist because the unit specs did not catch a blocking defect: they
 * called `answerer.handle()` and the guard listener DIRECTLY, which proves the
 * logic and proves nothing about who gets to run. In the real deployment the
 * host's own approval answerer and several tool gates are already registered
 * on the same seams, and a cordis waterfall runs listeners in registration
 * order — so "correct handler, second in line" is the same as "no handler".
 *
 * Every test here therefore registers a competitor FIRST and dispatches
 * through the real waterfall / the real monotonic-guard contract.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { YzjCards, type CardProjection, type CardRef } from '@yzj-next/cards'
import { approvalCard } from '../src/approval/card.ts'
import { approvalFamily, approvalIdFor } from '../src/approval/family.ts'
import { ApprovalAnswerer, YZJ_TEXT_SURFACE } from '../src/approval/answerer.ts'
import type { TurnBinding } from '../src/turns.ts'

const SESSION = 'session-yzj-next-abc'
const CALL_ID = 'call-1'
const OPERATOR = { kind: 'operator', openId: 'op-1' } as const

const BINDING: TurnBinding = {
  viewer: { kind: 'operator', openId: 'op-1' },
  decider: 'op-1',
  accountKey: 'acct-1',
  accountOrgId: 'org-1',
  accountOpenId: 'op-1',
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let answerer: ApprovalAnswerer
/** What the host's own answerer would have done, had it been reached. */
let hostAnswererCalls: number

function fakeRequest(callId = CALL_ID): ApprovalRequest {
  return {
    agent: { session: { id: SESSION } },
    toolName: 'yzj_doc_create',
    callId,
    reason: '云之家操作确认：新建知识库文档',
  } as unknown as ApprovalRequest
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error(`timed out waiting for ${label}`)
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-order-'))
  hostAnswererCalls = 0
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(approvalFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(approvalCard)
  ctx.provide('yzjTurns', { bindingFor: () => BINDING, defaultBinding: () => BINDING })
  ctx.provide('yzjCardChannel', {
    deliverToOperator: async (cardRef: CardRef): Promise<CardProjection | undefined> => {
      const projection: CardProjection = {
        cardRef, surface: YZJ_TEXT_SURFACE, msgAnchors: ['dm-1'], placeKey: 'yzj-dm-x',
      }
      await cards.project(projection)
      return projection
    },
    echo: async () => Promise.resolve(),
  })

  // The host's answerer, registered FIRST exactly as the web layer does. It
  // claims unconditionally — which is what the real one effectively does,
  // because ApprovalService appends `approval/asked` before dispatching.
  ctx.on('approval/request', async (): Promise<ApprovalOutcome> => {
    hostAnswererCalls += 1
    return 'rejected'
  })

  answerer = new ApprovalAnswerer(ctx, { ttlMs: 30 * 60_000 })
  // …and ours second, the way the bundle's rows mount — with the prepend that
  // is the only reason it is ever reached.
  ctx.on(
    'approval/request',
    (request, next) => answerer.handle(request, next),
    { prepend: true },
  )
})

describe('approval seam ordering', () => {
  it('reaches our answerer even though the host answerer registered first', async () => {
    answerer.record(SESSION, {
      callId: CALL_ID, toolName: 'yzj_doc_create', level: 'standard',
      reason: '云之家操作确认：新建知识库文档', args: { title: 'x' },
    })
    const approvalId = approvalIdFor(SESSION, CALL_ID)

    const pending = ctx.waterfall(
      'approval/request', fakeRequest(), async (): Promise<ApprovalOutcome> => 'unavailable',
    )
    await until(() => graph.rawObject('approval', approvalId) !== undefined, 'card open')

    // The card exists and the host answerer was never consulted.
    expect(hostAnswererCalls).toBe(0)
    await cards.act({ kind: 'approval', id: approvalId }, 'approve', OPERATOR, 'desktop')
    expect(await pending).toBe<ApprovalOutcome>('allowed-once')
  })

  it('still hands an ask we did not gate to the host answerer', async () => {
    // No `record()` — this is somebody else's tool asking.
    const outcome = await ctx.waterfall(
      'approval/request', fakeRequest('call-other'), async (): Promise<ApprovalOutcome> => 'unavailable',
    )
    expect(hostAnswererCalls).toBe(1)
    expect(outcome).toBe<ApprovalOutcome>('rejected')
    expect(graph.rawEvents(['approval/opened'])).toHaveLength(0)
  })
})

/**
 * Injection-scope specs.
 *
 * Caught live, twice, in two packages: a plugin registers its tools inside
 * `ctx.inject(['tools'], …)` and the tool BODY then reads `ctx.yzjGraph` off
 * that scoped context. Registration succeeds, boot succeeds, and the failure
 * only appears when the model calls the tool — as a narrated workaround
 * ("图记忆这次没写上，先落在 CONVENTIONS.md") rather than as an error anybody
 * would see. The direct-call unit specs cannot catch it, because they hand the
 * function a context that has everything.
 *
 * So these mount the REAL plugin and call the tool through the registry.
 */
describe('a tool can reach what its body reads', () => {
  interface Registered {
    name: string
    execute: (args: Record<string, unknown>, exec: unknown) => Promise<{ content: string }>
  }

  async function mount(): Promise<Map<string, Registered>> {
    const root = await mkdtemp(join(tmpdir(), 'yzj-next-inject-'))
    const scope = new Context()
    const store = new YzjGraph(scope, { root })
    await store.selectAccount('acct-1')
    // Both services register themselves on construction.
    void new YzjCards(scope)
    scope.provide('yzjTurns', { bindingFor: () => BINDING, defaultBinding: () => BINDING })
    const registered: Registered[] = []
    scope.provide('tools', {
      register: (definition: Registered) => { registered.push(definition); return () => undefined },
      guard: () => () => undefined,
    })
    scope.plugin(await import('../src/index.ts'), {})
    await new Promise(resolve => setTimeout(resolve, 20))
    return new Map(registered.map(tool => [tool.name, tool]))
  }

  it('writes a memory instead of reporting that it could not', async () => {
    const tools = await mount()
    const result = await tools.get('memory_note')?.execute({
      summary: '对账差异逐条列出', axis: 'place',
    }, { agent: { session: { id: 'session-1' } } })
    expect(result?.content).toContain('已记入')
  })

  it('answers a graph query instead of throwing inside the model\'s turn', async () => {
    const tools = await mount()
    const result = await tools.get('graph_query')?.execute(
      { kind: 'commitment' }, { agent: { session: { id: 'session-1' } } },
    )
    expect(result?.content).toBeTypeOf('string')
  })
})
