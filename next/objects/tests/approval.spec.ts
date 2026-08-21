/**
 * Approval-object specs — the P1 vertical slice's centre of gravity.
 *
 * The cases that carry the design are the lifecycle edges, not the happy path:
 * timeout denies, a withdrawn turn cancels, a restart re-opens the question as
 * INTERRUPTED (intent alive, carrier dead) rather than either losing it or
 * letting a stale answer execute, and the single retry re-issues the work
 * instead of granting a standing permission.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards, type CardProjection, type CardRef } from '@yzj-next/cards'
import { approvalCard } from '../src/approval/card.ts'
import { approvalFamily, approvalIdFor, type ApprovalState } from '../src/approval/family.ts'
import { ApprovalAnswerer, YZJ_TEXT_SURFACE } from '../src/approval/answerer.ts'
import type { TurnBinding } from '../src/turns.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const COLLEAGUE: GraphActor = { kind: 'person', openId: 'other-1' }
const SESSION = 'session-yzj-topic-abc'
const CALL_ID = 'call-1'

const BINDING: TurnBinding = {
  viewer: { kind: 'operator', openId: 'op-1' },
  decider: 'op-1',
  accountKey: 'acct-1',
  topicKey: 'yzj-topic-1',
  placeKey: 'group-a',
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let answerer: ApprovalAnswerer
let delivered: { cardRef: CardRef; body: string }[]
let echoed: { surface: string; text: string }[]
let anchorSeq: number
let binding: TurnBinding | undefined
let detachAnswerer: (() => unknown) | undefined

/** A minimal stand-in for the agent an approval request carries. */
function fakeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    agent: { session: { id: SESSION } },
    toolName: 'yzj_doc_create',
    callId: CALL_ID,
    reason: '云之家操作确认：新建知识库文档',
    ...overrides,
  } as unknown as ApprovalRequest
}

function recordAsk(args: Record<string, unknown> = { title: '价格页 v2' }): void {
  answerer.record(SESSION, {
    callId: CALL_ID,
    toolName: 'yzj_doc_create',
    level: 'standard',
    reason: '云之家操作确认：新建知识库文档',
    args: args as never,
  })
}

/**
 * Wait for the graph write chain to settle. Appends are serialized behind one
 * promise chain, so a single microtask tick is not enough to observe them.
 */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** The card has been opened and put in front of the operator. */
async function untilDelivered(count = 1): Promise<void> {
  await until(() => delivered.length >= count, 'card delivery')
}

function stateOf(approvalId: string): ApprovalState | undefined {
  return graph.rawObject('approval', approvalId)?.state as unknown as ApprovalState | undefined
}

/**
 * Stand up a fresh answerer, detaching the previous one's graph listener the
 * way the plugin's own disposer would. A "restart" that left the old listener
 * attached would emit every retry twice and hide the bug it is testing for.
 */
function newAnswerer(ttlMs = 30 * 60_000): ApprovalAnswerer {
  detachAnswerer?.()
  const next = new ApprovalAnswerer(ctx, { ttlMs })
  detachAnswerer = ctx.on('yzj-graph/appended', (event) => { next.onGraphEvent(event) })
  return next
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-approval-'))
  delivered = []
  echoed = []
  anchorSeq = 0
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(approvalFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(approvalCard)
  binding = BINDING
  ctx.provide('yzjTurns', {
    bindingFor: () => binding,
    defaultBinding: () => binding,
  })
  ctx.provide('yzjCardChannel', {
    deliverToOperator: async (cardRef: CardRef): Promise<CardProjection | undefined> => {
      const rendered = cards.renderText(cardRef)
      if (rendered === undefined) return undefined
      anchorSeq += 1
      const projection: CardProjection = {
        cardRef,
        surface: YZJ_TEXT_SURFACE,
        msgAnchors: [`msg-${String(anchorSeq)}`],
        placeKey: 'dm',
      }
      delivered.push({ cardRef, body: rendered.body })
      await cards.project(projection)
      return projection
    },
    echo: async (projection: CardProjection, text: string): Promise<void> => {
      echoed.push({ surface: projection.surface, text })
      await Promise.resolve()
    },
  })
  detachAnswerer = undefined
  answerer = newAnswerer()
})

describe('opening the card from a gated call', () => {
  it('opens one approval carrying the full arguments and delivers it to the operator', async () => {
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    const pending = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()

    const state = stateOf(approvalId)
    expect(state).toMatchObject({ status: 'pending', toolName: 'yzj_doc_create', decider: 'op-1' })
    expect(state?.argsDigest).toMatch(/^[0-9a-f]{16}$/)
    expect(delivered[0]?.body).toContain('价格页 v2')
    expect(delivered[0]?.body).toContain('回复「确认」放行')

    await cards.act({ kind: 'approval', id: approvalId }, 'approve', OPERATOR, 'desktop')
    expect(await pending).toBe<ApprovalOutcome>('allowed-once')
  })

  it('passes an ask the guard never recorded down the waterfall', async () => {
    let fellThrough = false
    const outcome = await answerer.handle(fakeRequest(), async () => {
      fellThrough = true
      return 'unavailable'
    })
    expect(fellThrough).toBe(true)
    expect(outcome).toBe('unavailable')
    expect(graph.rawEvents(['approval/opened'])).toHaveLength(0)
  })

  it('passes through when no turn binding exists (no identity, no decider)', async () => {
    binding = undefined
    const bare = newAnswerer()
    bare.record(SESSION, {
      callId: CALL_ID, toolName: 'yzj_doc_create', level: 'standard', reason: 'r', args: {},
    })
    let fellThrough = false
    await bare.handle(fakeRequest(), async () => { fellThrough = true; return 'unavailable' })
    expect(fellThrough).toBe(true)
  })
})

describe('answering', () => {
  it('rejects with the operator note carried onto the object', async () => {
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    const pending = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()

    await cards.act({ kind: 'approval', id: approvalId }, 'reject', OPERATOR, 'yzj-text', '价格还没定')

    expect(await pending).toBe<ApprovalOutcome>('rejected')
    expect(stateOf(approvalId)).toMatchObject({ status: 'rejected', note: '价格还没定' })
  })

  it('refuses an answer from somebody who is not the decider', async () => {
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    const pending = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()

    const refused = await cards.act({ kind: 'approval', id: approvalId }, 'approve', COLLEAGUE, 'yzj-text')
    expect(refused.outcome).toBe('unauthorized')
    expect(stateOf(approvalId)?.status).toBe('pending')

    await cards.act({ kind: 'approval', id: approvalId }, 'approve', OPERATOR, 'desktop')
    expect(await pending).toBe<ApprovalOutcome>('allowed-once')
  })

  it('echoes the terminal state to every text surface the card reached', async () => {
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    const resolved: string[] = []
    ctx.on('yzj-cards/resolved', (payload) => { resolved.push(payload.echoText) })
    const pending = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()

    await cards.act({ kind: 'approval', id: approvalId }, 'approve', OPERATOR, 'desktop')
    await pending

    expect(resolved[0]).toContain('已放行')
    expect(cards.projectionsOf({ kind: 'approval', id: approvalId })).toHaveLength(1)
  })
})

describe('timeout and withdrawal', () => {
  it('denies on TTL and records the expiry as a graph fact', async () => {
    answerer = newAnswerer(60_000)
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    // Backdate the deadline so the wait computes a zero-length timer.
    await graph.append({
      type: 'approval/opened',
      data: {
        approvalId, toolName: 'yzj_doc_create', reason: 'r', level: 'standard',
        args: {}, argsDigest: 'deadbeefdeadbeef', decider: 'op-1',
        deadline: Date.now() - 1, callId: CALL_ID, sessionAnchor: SESSION,
      },
      actor: { kind: 'agent' },
    })

    expect(await answerer.handle(fakeRequest(), async () => 'unavailable'))
      .toBe<ApprovalOutcome>('rejected')
    expect(stateOf(approvalId)).toMatchObject({ status: 'expired' })
  })

  it('cancels when the turn withdraws the question', async () => {
    recordAsk()
    const controller = new AbortController()
    const pending = answerer.handle(
      fakeRequest({ signal: controller.signal }),
      async () => 'unavailable',
    )
    await untilDelivered()
    controller.abort()
    expect(await pending).toBe<ApprovalOutcome>('cancelled')
    // A withdrawn question is not a decided one: the card stays answerable.
    expect(stateOf(approvalIdFor(SESSION, CALL_ID))?.status).toBe('pending')
  })

  it('cancels in-flight waits when the plugin is disposed', async () => {
    recordAsk()
    const pending = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()
    answerer.dispose()
    expect(await pending).toBe<ApprovalOutcome>('cancelled')
  })

  it('adopts an already-settled approval instead of asking twice', async () => {
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    const first = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()
    await cards.act({ kind: 'approval', id: approvalId }, 'reject', OPERATOR, 'desktop')
    await first

    recordAsk()
    expect(await answerer.handle(fakeRequest(), async () => 'unavailable'))
      .toBe<ApprovalOutcome>('rejected')
    expect(graph.rawEvents(['approval/opened'])).toHaveLength(1)
  })
})

describe('restart (§5.5 中断可恢复)', () => {
  it('re-opens an un-expired pending card as interrupted and re-reaches the operator', async () => {
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    const abandoned = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()
    answerer.dispose()
    await abandoned

    const restarted = newAnswerer()
    await restarted.recoverPending(BINDING)

    expect(stateOf(approvalId)?.status).toBe('interrupted')
    // The card already had a text projection, so the operator gets a line on
    // it rather than a second copy of the whole card.
    expect(echoed.at(-1)?.text).toContain('重试')
    expect(delivered).toHaveLength(1)
  })

  it('lets TTL win over interruption for a card that timed out while down', async () => {
    const approvalId = 'apv-timedout'
    await graph.append({
      type: 'approval/opened',
      data: {
        approvalId, toolName: 'yzj_doc_create', reason: 'r', level: 'standard',
        args: {}, argsDigest: 'aaaaaaaaaaaaaaaa', decider: 'op-1',
        deadline: Date.now() - 1_000, callId: 'c9', sessionAnchor: SESSION,
      },
      actor: { kind: 'agent' },
    })

    await answerer.recoverPending(BINDING)
    expect(stateOf(approvalId)).toMatchObject({ status: 'expired' })
  })

  it('back-fills a card whose graph event landed but whose DM never went out', async () => {
    const approvalId = 'apv-unprojected'
    await graph.append({
      type: 'approval/opened',
      data: {
        approvalId, toolName: 'yzj_doc_create', reason: '补投用例', level: 'standard',
        args: {}, argsDigest: 'bbbbbbbbbbbbbbbb', decider: 'op-1',
        deadline: Date.now() + 60_000, callId: 'c8', sessionAnchor: SESSION,
      },
      actor: { kind: 'agent' },
    })

    await answerer.recoverPending(BINDING)

    expect(stateOf(approvalId)?.status).toBe('interrupted')
    expect(delivered.at(-1)?.cardRef).toEqual({ kind: 'approval', id: approvalId })
    expect(echoed).toHaveLength(0)
  })
})

describe('retry (§5.5 一次性重试)', () => {
  async function interrupted(): Promise<string> {
    recordAsk()
    const approvalId = approvalIdFor(SESSION, CALL_ID)
    const abandoned = answerer.handle(fakeRequest(), async () => 'unavailable')
    await untilDelivered()
    answerer.dispose()
    await abandoned
    answerer = newAnswerer()
    await answerer.recoverPending(BINDING)
    return approvalId
  }

  it('re-issues the work as a new turn rather than granting a standing pass', async () => {
    const approvalId = await interrupted()
    const retries: { retryTaskAnchor: string; toolName: string }[] = []
    ctx.on('yzj-approval/retry-requested', (payload) => { retries.push(payload) })

    const result = await cards.act({ kind: 'approval', id: approvalId }, 'retry', OPERATOR, 'yzj-text')

    expect(result.outcome).toBe('applied')
    expect(stateOf(approvalId)).toMatchObject({ status: 'superseded', retried: true })
    expect(retries[0]?.toolName).toBe('yzj_doc_create')
    expect(retries[0]?.retryTaskAnchor).toContain(approvalId)
  })

  it('folds a second retry press into a duplicate answer with no second turn', async () => {
    const approvalId = await interrupted()
    const retries: unknown[] = []
    ctx.on('yzj-approval/retry-requested', (payload) => { retries.push(payload) })

    await cards.act({ kind: 'approval', id: approvalId }, 'retry', OPERATOR, 'yzj-text')
    const again = await cards.act({ kind: 'approval', id: approvalId }, 'retry', OPERATOR, 'yzj-text')

    expect(again.outcome).toBe('duplicate')
    expect(retries).toHaveLength(1)
    expect(graph.rawEvents(['approval/superseded'])).toHaveLength(1)
  })

  it('tells the operator why 确认 no longer applies to an interrupted card', async () => {
    const approvalId = await interrupted()
    const late = await cards.act({ kind: 'approval', id: approvalId }, 'approve', OPERATOR, 'yzj-text')
    expect(late.outcome).toBe('superseded')
    expect(late.receipt).toContain('确认')
    expect(stateOf(approvalId)?.status).toBe('interrupted')
  })
})
