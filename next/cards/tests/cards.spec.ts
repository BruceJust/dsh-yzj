/**
 * Action-bus specs. The interesting cases are all arbitration: first answer
 * wins, every answer leaves a trace, a losing answer gets a loud receipt, and
 * authorization is enforced in the bus rather than in whichever surface asked.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, z, type GraphActor, type GraphFamily, type GraphViewer } from '@yzj-next/graph'
import { YzjCards } from '../src/service.ts'
import { CARD_TEXT_MAX_CHARS, type CardDefinition } from '../src/types.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const COLLEAGUE: GraphActor = { kind: 'person', openId: 'other-1' }
const OPERATOR_VIEW: GraphViewer = { kind: 'operator', openId: 'op-1' }

interface ConfirmState {
  confirmId: string
  status: 'pending' | 'approved' | 'rejected'
  what: string
  decider: string
  note?: string
}

const confirmFamily: GraphFamily = {
  kind: 'confirm',
  events: {
    'confirm/opened': {
      schema: z.object({
        confirmId: z.string(),
        what: z.string(),
        decider: z.string(),
        status: z.literal('pending').default('pending'),
      }),
    },
    'confirm/decided': {
      schema: z.object({
        confirmId: z.string(),
        status: z.enum(['approved', 'rejected']),
        note: z.string().optional(),
      }),
    },
  },
  pendingStatuses: ['pending'],
  objectIdOf: (_type, data) => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
    const id = (data as Record<string, unknown>).confirmId
    return typeof id === 'string' ? id : undefined
  },
}

const confirmCard: CardDefinition<ConfirmState> = {
  type: 'confirm',
  actions: [
    {
      id: 'approve',
      label: '确认',
      keywords: ['确认', '同意', 'ok'],
      allowedActors: (actor, state) => actor.openId === state.decider,
    },
    {
      id: 'reject',
      label: '取消',
      keywords: ['取消', '拒绝'],
      needsInput: true,
      allowedActors: (actor, state) => actor.openId === state.decider,
    },
  ],
  isResolved: state => state.status !== 'pending',
  renderText: state => ({
    body: `【确认】${state.what}`,
    replyHints: ['回复「确认」放行', '回复「取消」拒绝'],
  }),
  onResolved: state => ({ echoText: `【已决】${state.what} → ${state.status}` }),
  apply: (state, action, _actor, input) => ({
    events: [{
      type: 'confirm/decided',
      data: {
        confirmId: state.confirmId,
        status: action.id === 'approve' ? 'approved' : 'rejected',
        ...(input === undefined ? {} : { note: input }),
      },
      actor: _actor,
    }],
  }),
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards

async function openConfirm(id: string, what = '写入知识库文档'): Promise<void> {
  await graph.append({
    type: 'confirm/opened',
    data: { confirmId: id, what, decider: 'op-1' },
    actor: OPERATOR,
  })
}

/** Every `answer/recorded` on the log, oldest first. */
function answers(): { actionId: string; outcome: string; actor: string }[] {
  return graph.rawEvents(['answer/recorded']).map((event) => {
    const data = event.data as Record<string, unknown>
    return {
      actionId: String(data.actionId),
      outcome: String(data.outcome),
      actor: String(data.actor),
    }
  })
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-cards-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(confirmFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(confirmCard)
})

describe('registry and keyword resolution', () => {
  it('refuses a duplicate card type', () => {
    expect(() => cards.register(confirmCard)).toThrow(/already registered/)
  })

  it('maps a free-text reply onto an action id through the card own keywords', () => {
    const ref = { kind: 'confirm', id: 'c1' }
    expect(cards.resolveKeyword(ref, '确认')).toEqual({ actionId: 'approve' })
    expect(cards.resolveKeyword(ref, '  同意 ')).toEqual({ actionId: 'approve' })
    expect(cards.resolveKeyword(ref, '再想想')).toBeUndefined()
    // The leftover comes back with the action, with or without a separating
    // space — the card knows where its own keyword ends.
    expect(cards.resolveKeyword(ref, '取消 价格没定')).toEqual({ actionId: 'reject', input: '价格没定' })
    expect(cards.resolveKeyword(ref, '取消，理由是价格没定'))
      .toEqual({ actionId: 'reject', input: '理由是价格没定' })
  })
})

describe('act arbitration', () => {
  it('records the answer before the effect and applies the transition', async () => {
    await openConfirm('c1')
    const result = await cards.act({ kind: 'confirm', id: 'c1' }, 'approve', OPERATOR, 'desktop')

    expect(result.outcome).toBe('applied')
    expect(graph.rawObject('confirm', 'c1')?.state).toMatchObject({ status: 'approved' })
    const log = graph.rawEvents(['answer/recorded', 'confirm/decided'])
    expect(log.map(event => event.type)).toEqual(['answer/recorded', 'confirm/decided'])
  })

  it('carries the free text of an input-taking action into the transition', async () => {
    await openConfirm('c1')
    await cards.act({ kind: 'confirm', id: 'c1' }, 'reject', OPERATOR, 'yzj-text', '价格没定')
    expect(graph.rawObject('confirm', 'c1')?.state).toMatchObject({
      status: 'rejected', note: '价格没定',
    })
  })

  it('refuses an actor who is not the decider but still records the answer', async () => {
    await openConfirm('c1')
    const result = await cards.act({ kind: 'confirm', id: 'c1' }, 'approve', COLLEAGUE, 'yzj-text')

    expect(result.outcome).toBe('unauthorized')
    expect(graph.rawObject('confirm', 'c1')?.state).toMatchObject({ status: 'pending' })
    expect(answers()).toEqual([{ actionId: 'approve', outcome: 'unauthorized', actor: 'other-1' }])
  })

  it('gives a repeated identical answer a duplicate receipt and no second effect', async () => {
    await openConfirm('c1')
    await cards.act({ kind: 'confirm', id: 'c1' }, 'approve', OPERATOR, 'desktop')
    const again = await cards.act({ kind: 'confirm', id: 'c1' }, 'approve', OPERATOR, 'yzj-text')

    expect(again.outcome).toBe('duplicate')
    expect(graph.rawEvents(['confirm/decided'])).toHaveLength(1)
    expect(answers().map(answer => answer.outcome)).toEqual(['applied', 'duplicate'])
  })

  it('gives a late opposing answer a loud conflict receipt naming who decided where', async () => {
    await openConfirm('c1')
    await cards.act({ kind: 'confirm', id: 'c1' }, 'approve', OPERATOR, 'desktop')
    const late = await cards.act({ kind: 'confirm', id: 'c1' }, 'reject', OPERATOR, 'yzj-text')

    expect(late.outcome).toBe('superseded')
    expect(late.receipt).toContain('桌面工作台')
    expect(late.receipt).toContain('op-1')
    expect(graph.rawObject('confirm', 'c1')?.state).toMatchObject({ status: 'approved' })
  })

  it('lets exactly one of two concurrent answers take effect', async () => {
    await openConfirm('c1')
    const [first, second] = await Promise.all([
      cards.act({ kind: 'confirm', id: 'c1' }, 'approve', OPERATOR, 'desktop'),
      cards.act({ kind: 'confirm', id: 'c1' }, 'reject', OPERATOR, 'yzj-text'),
    ])

    const outcomes = [first.outcome, second.outcome].sort()
    expect(outcomes).toEqual(['applied', 'superseded'])
    expect(graph.rawEvents(['confirm/decided'])).toHaveLength(1)
    // Both answers are on the log — the loser is evidence, not noise.
    expect(answers()).toHaveLength(2)
  })

  it('rejects an unknown card, action, or object outright', async () => {
    await expect(cards.act({ kind: 'nope', id: 'x' }, 'approve', OPERATOR, 'desktop'))
      .rejects.toThrow(/unknown card type/)
    await expect(cards.act({ kind: 'confirm', id: 'missing' }, 'approve', OPERATOR, 'desktop'))
      .rejects.toThrow(/does not exist/)
    await openConfirm('c1')
    await expect(cards.act({ kind: 'confirm', id: 'c1' }, 'nope', OPERATOR, 'desktop'))
      .rejects.toThrow(/has no action/)
  })
})

describe('terminal echo and projections', () => {
  it('registers every fragment and resolves a card from any one anchor', async () => {
    await openConfirm('c1')
    const cardRef = { kind: 'confirm', id: 'c1' }
    await cards.project({ cardRef, surface: 'yzj:dm', msgAnchors: ['m1', 'm2'], placeKey: 'dm' })

    expect(cards.cardForAnchor('m2')?.cardRef).toEqual(cardRef)
    expect(cards.cardForAnchor('nope')).toBeUndefined()
    expect(cards.projectionsOf(cardRef)).toHaveLength(1)
  })

  it('emits the terminal echo owed to every projected text surface', async () => {
    await openConfirm('c1')
    const cardRef = { kind: 'confirm', id: 'c1' }
    await cards.project({ cardRef, surface: 'yzj:dm', msgAnchors: ['m1'] })
    const echoes: string[] = []
    ctx.on('yzj-cards/resolved', (payload) => { echoes.push(payload.echoText) })

    const result = await cards.act(cardRef, 'approve', OPERATOR, 'desktop')

    expect(result.echoText).toContain('已决')
    expect(result.projections).toHaveLength(1)
    expect(echoes).toHaveLength(1)
  })
})

describe('text projection contract', () => {
  it('clips an overlong body and points at the desktop', async () => {
    await openConfirm('c1', 'x'.repeat(CARD_TEXT_MAX_CHARS + 500))
    const rendered = cards.renderText({ kind: 'confirm', id: 'c1' })
    expect(rendered?.degraded).toBe(true)
    expect(rendered?.body.length).toBeLessThanOrEqual(CARD_TEXT_MAX_CHARS)
    expect(rendered?.body).toContain('详见桌面')
  })

  it('leaves a short body intact', async () => {
    await openConfirm('c1')
    expect(cards.renderText({ kind: 'confirm', id: 'c1' })).toMatchObject({ degraded: false })
  })
})

describe('pending recovery', () => {
  it('lists only pending cards of registered types', async () => {
    await openConfirm('c1')
    await openConfirm('c2')
    await cards.act({ kind: 'confirm', id: 'c2' }, 'approve', OPERATOR, 'desktop')
    expect(cards.pending(OPERATOR_VIEW).map(object => object.id)).toEqual(['c1'])
  })
})
