/**
 * Loop-completeness specs (设计 §5.5 环路完整性检验).
 *
 * The rule the design states: every object left in P1 must have a minimal IM
 * idiom for getting in AND getting out — otherwise it can never collect the
 * real usage evidence that opens its gate, and "nobody used it" is
 * indistinguishable from "there was no way to".
 *
 * A card with `keywords[]` proves nothing on its own. The keywords only
 * resolve against a REGISTERED PROJECTION, so an object that is never
 * delivered anywhere has a dead answer path no unit test of `act()` would
 * catch. These tests walk the whole chain — deliver → reply → triage →
 * action — once per answerable card type.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  approvalCard, approvalFamily, commitmentCard, commitmentFamily,
  conflictCard, taskCard, taskFamily, waitingCard, waitingFamily,
} from '@yzj-next/objects'
import type { YzjRunResult } from '@yzj-next/bridge'
import { YzjCardDelivery } from '../src/delivery.ts'
import { YzjChannelClient } from '../src/client.ts'
import { ChannelState } from '../src/state.ts'
import { triage } from '../src/triage.ts'
import { placeKeyFor, type YzjGroup, type YzjMessage } from '../src/protocol.ts'

const IDENTITY = { orgId: 'org-1', openId: 'op-1', name: '操作者' }
const GROUP: YzjGroup = {
  groupId: 'g-1', groupName: 'dsh-2', groupType: 2,
  lastMsgId: 'm-0', lastMsgSendTime: '2026-08-18 10:00:00',
}
const PLACE = placeKeyFor('group', 'g-1')

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let delivery: YzjCardDelivery
let outbound: { groupId?: string; content: string }[]

/** A client whose sends are captured and answered with a fresh message id. */
function scriptedClient(): YzjChannelClient {
  let counter = 0
  const bridgeCtx = {
    yzjBridge: {
      run: async (command: readonly string[]): Promise<YzjRunResult> => {
        counter += 1
        const groupIndex = command.indexOf('--group-id')
        outbound.push({
          ...(groupIndex < 0 ? {} : { groupId: command[groupIndex + 1] }),
          content: command[command.indexOf('--content') + 1] ?? '',
        })
        const json = { msgId: `sent-${String(counter)}`, groupId: 'g-1' }
        return Promise.resolve({
          ok: true, exitCode: 0, stdout: JSON.stringify(json), stderr: '',
          json, truncated: false, timedOut: false, durationMs: 1,
        })
      },
    },
  } as unknown as Context
  const state = new ChannelState(join(tmpdir(), 'unused-answer.json'))
  void state.load()
  state.selectAccount('acct-1')
  return new YzjChannelClient(bridgeCtx, state, 5_000)
}

/** The operator replying to a delivered card with one keyword. */
function replyTo(anchor: string, text: string): YzjMessage {
  return {
    msgId: `reply-${anchor}`, content: text, fromOpenId: 'op-1', msgType: 'text',
    sendTime: '2026-08-18 10:05:00', param: { replyMsgId: anchor },
  }
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-answer-'))
  outbound = []
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  for (const family of [approvalFamily, taskFamily, waitingFamily, commitmentFamily]) {
    graph.defineFamily(family)
  }
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  for (const card of [approvalCard, taskCard, waitingCard, commitmentCard, conflictCard]) {
    cards.register(card)
  }
  delivery = new YzjCardDelivery(ctx, scriptedClient(), 'op-1')
})

/** Open one object of each answerable kind. */
async function open(kind: string): Promise<string> {
  const id = `${kind}-1`
  switch (kind) {
    case 'approval':
      await graph.append({
        type: 'approval/opened',
        data: {
          approvalId: id, toolName: 'yzj_doc_create', reason: '新建知识库文档',
          level: 'standard', args: { title: 'x' }, argsDigest: 'd', decider: 'op-1',
          deadline: Date.now() + 60_000, topicKey: 't-1', placeKey: PLACE, audience: [PLACE],
        },
        actor: { kind: 'agent' },
      })
      return id
    case 'task':
      await graph.append({
        type: 'task/opened',
        data: { taskId: id, what: '改价格页', topicKey: 't-1', sourceAnchor: 'yzj:m-1' },
        actor: { kind: 'agent' },
      })
      await graph.append({
        type: 'task/terminal', data: { taskId: id, summary: '好了', artifacts: [] },
        actor: { kind: 'agent' },
      })
      return id
    case 'waiting':
      await graph.append({
        type: 'waiting/opened',
        data: {
          waitingId: id, kind: 'third-party', what: '等张锐的分析',
          openedAt: Date.now(), topicKey: 't-1', placeKey: PLACE,
        },
        actor: { kind: 'agent' },
      })
      return id
    case 'commitment':
      await graph.append({
        type: 'commitment/opened',
        data: {
          commitmentId: id, what: '出周报', sourceAnchor: 'yzj:m-1',
          executor: { kind: 'human', openId: 'p-9' }, audience: [PLACE],
        },
        actor: { kind: 'agent' },
      })
      return id
    default:
      await graph.append({
        type: 'conflict/flagged',
        data: {
          conflictId: id, topicKey: 't-1', inflightAnchor: 'a',
          incomingAnchor: 'b', note: '相反指令',
        },
        actor: { kind: 'agent' },
      })
      return id
  }
}

/** Every card type that offers a keyword, and the word that answers it. */
const ANSWERABLE = [
  { kind: 'approval', word: '确认', expect: 'approved' },
  { kind: 'task', word: '验收', expect: 'accepted' },
  { kind: 'waiting', word: '已解决', expect: 'closed' },
  { kind: 'commitment', word: '完成', expect: 'closed' },
  { kind: 'conflict', word: '继续', expect: 'resolved' },
] as const

describe('every answerable object has a working IM exit', () => {
  for (const { kind, word, expect: expected } of ANSWERABLE) {
    it(`${kind}: delivered to its place, its keyword resolves and applies`, async () => {
      const id = await open(kind)
      const projection = await delivery.deliverToPlace({ kind, id }, PLACE)
      expect(projection, `${kind} could not be delivered`).toBeDefined()
      const anchor = projection?.msgAnchors[0] ?? ''

      // The delivered message must actually carry the words that answer it —
      // an operator reading it in Yunzhijia has nothing else to go on.
      expect(outbound.at(-1)?.content).toContain(word)

      const outcome = triage({
        group: GROUP,
        message: replyTo(anchor, word),
        isOwnOutbound: false,
        isSelfChat: false,
        aliases: ['@next'],
        acceptAccountMentions: false,
        operatorOpenId: IDENTITY.openId,
        cardForAnchor: candidate => cards.cardForAnchor(candidate),
        resolveKeyword: (cardRef, text) => cards.resolveKeyword(cardRef, text),
      })
      expect(outcome.kind, `${kind} reply did not triage to an action`).toBe('card-action')
      if (outcome.kind !== 'card-action') return

      const result = await cards.act(
        outcome.projection.cardRef, outcome.actionId,
        { kind: 'operator', openId: 'op-1' }, 'yzj-text', outcome.input,
      )
      expect(result.outcome).toBe('applied')
      expect(asString(asRecord(graph.rawObject(kind, id)?.state)?.status)).toBe(expected)
    })
  }

  it('covers every registered card type — a new card cannot ship without an exit', () => {
    // The guard against silently adding a sixth answerable object whose only
    // answer path is the desktop.
    const registered = cards.types().filter(type => cards.actionsOf(type).length > 0)
    expect([...registered].sort()).toEqual([...ANSWERABLE.map(entry => entry.kind)].sort())
  })
})
