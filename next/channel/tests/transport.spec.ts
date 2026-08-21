/**
 * Full-transport specs: the patterns that only matter when something goes
 * wrong — an outage nobody is watching, a crash between admission and
 * execution, a first-seen scan that runs out of pages, a replay that must not
 * re-run a settled task.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { waitingFamily, type WaitingState } from '@yzj-next/objects'
import type { YzjRunResult } from '@yzj-next/bridge'
import { ChannelHealth } from '../src/health.ts'
import { ChannelState, READ_EMPTY, type PendingTask } from '../src/state.ts'
import { YzjChannelClient } from '../src/client.ts'
import { deskBinding, priorTurnFor, renderMemory } from '../src/orchestrator.ts'
import { deskSendPlan } from '../src/poller.ts'
import { sourceFor } from '../src/source.ts'
import {
  NO_MESSAGE_TIME, isAgentTrigger, parseGroup, topicRouteFor,
  type YzjGroup, type YzjMessage,
} from '../src/protocol.ts'
import { sessionIdOfTopic, topicKeyOfSession } from '../src/topics.ts'

const IDENTITY = { orgId: 'org-1', openId: 'op-1', name: '操作者' }
const GROUP: YzjGroup = {
  groupId: 'g-1', groupName: 'dsh-2', groupType: 2,
  lastMsgId: 'm-9', lastMsgSendTime: '2026-08-18 10:00:00',
}

function message(overrides: Partial<YzjMessage> = {}): YzjMessage {
  return {
    msgId: 'm-1', content: 'hi', fromOpenId: 'op-1', msgType: 'text',
    sendTime: '2026-08-18 10:00:00', param: {}, ...overrides,
  }
}

let ctx: Context
let graph: YzjGraph

function systemWaits(): WaitingState[] {
  return graph.query({ kind: 'operator', openId: 'op-1' }, { kind: 'waiting' })
    .map(object => object.state as unknown as WaitingState)
    .filter(state => state.kind === 'system')
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-transport-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(waitingFamily)
  await graph.selectAccount('acct-1')
})

describe('channel health (§6.5)', () => {
  it('stays quiet below the threshold, then makes the outage a visible object', async () => {
    const health = new ChannelHealth(ctx, { failureThreshold: 3 })
    await health.recordFailure(new Error('connect ETIMEDOUT'))
    await health.recordFailure(new Error('connect ETIMEDOUT'))
    expect(systemWaits()).toHaveLength(0)

    await health.recordFailure(new Error('connect ETIMEDOUT'))
    expect(systemWaits()).toHaveLength(1)
    expect(health.offline).toBe(true)
  })

  it('opens exactly one object no matter how long the outage lasts', async () => {
    const health = new ChannelHealth(ctx, { failureThreshold: 1 })
    for (let attempt = 0; attempt < 5; attempt += 1) await health.recordFailure(new Error('down'))
    expect(systemWaits()).toHaveLength(1)
  })

  it('names the remedy when the failure is an expired login, not a network blip', async () => {
    const health = new ChannelHealth(ctx, { failureThreshold: 1 })
    await health.recordFailure(new Error('request failed: 10000400 invalid token'))
    expect(systemWaits()[0]?.what).toContain('auth login')
  })

  it('closes the outage on the first successful poll', async () => {
    const health = new ChannelHealth(ctx, { failureThreshold: 1 })
    await health.recordFailure(new Error('down'))
    await health.recordSuccess()
    expect(systemWaits()[0]?.status).toBe('closed')
    expect(health.offline).toBe(false)
  })

  it('adopts an outage a previous run left open instead of opening a second one', async () => {
    const first = new ChannelHealth(ctx, { failureThreshold: 1 })
    await first.recordFailure(new Error('down'))
    const outageId = first.outageId

    const restarted = new ChannelHealth(ctx, { failureThreshold: 1 })
    restarted.adopt()
    expect(restarted.outageId).toBe(outageId)
    await restarted.recordFailure(new Error('still down'))
    expect(systemWaits()).toHaveLength(1)
  })

  it('treats a later outage as a new wait rather than resurrecting the old one', async () => {
    const health = new ChannelHealth(ctx, { failureThreshold: 1 })
    await health.recordFailure(new Error('down'))
    await health.recordSuccess()
    await health.recordFailure(new Error('down again'))
    const waits = systemWaits()
    expect(waits).toHaveLength(2)
    // The recovered one stays closed; the elapsed time of the new one starts now.
    expect(waits.filter(state => state.status === 'closed')).toHaveLength(1)
  })
})

describe('durable admission', () => {
  let state: ChannelState
  let file: string

  const task = (msgId: string): PendingTask => ({
    group: GROUP,
    message: message({ msgId }),
    route: topicRouteFor(IDENTITY, GROUP, message({ msgId }), [], 'root-1'),
    admittedAt: Date.now(),
  })

  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'yzj-next-transport-')), 'state.json')
    state = new ChannelState(file)
    await state.load()
    state.selectAccount('acct-1')
  })

  it('admits once and replays what never finished', async () => {
    expect(state.admit(task('m-1'))).toBe(true)
    expect(state.admit(task('m-1'))).toBe(false)
    await state.save()

    const restarted = new ChannelState(file)
    await restarted.load()
    restarted.selectAccount('acct-1')
    expect(restarted.pendingTasks().map(entry => entry.message.msgId)).toEqual(['m-1'])
    // …and the replay cannot re-admit it.
    expect(restarted.isProcessed('m-1')).toBe(true)
  })

  it('drops the pending row once the task completes', async () => {
    state.admit(task('m-1'))
    state.completeTask('m-1')
    await state.save()
    const restarted = new ChannelState(file)
    await restarted.load()
    restarted.selectAccount('acct-1')
    expect(restarted.pendingTasks()).toEqual([])
    expect(restarted.isProcessed('m-1')).toBe(true)
  })

  it('un-admits cleanly when the persistence that follows admission fails', () => {
    state.admit(task('m-1'))
    state.forget('m-1')
    expect(state.isProcessed('m-1')).toBe(false)
    expect(state.pendingTasks()).toEqual([])
  })

  it('keeps a pending task dedupe row through trimming', async () => {
    state.admit(task('m-old'))
    // Anything older than the retention window is normally dropped.
    state.markProcessed('m-stale', Date.now() - 30 * 24 * 60 * 60 * 1_000)
    await state.save()
    const restarted = new ChannelState(file)
    await restarted.load()
    restarted.selectAccount('acct-1')
    expect(restarted.isProcessed('m-old')).toBe(true)
    expect(restarted.isProcessed('m-stale')).toBe(false)
  })

  it('reads a partition written before pending tasks existed', async () => {
    const legacy = new ChannelState(file)
    await legacy.load()
    legacy.selectAccount('acct-1')
    expect(legacy.pendingTasks()).toEqual([])
  })
})

describe('terminal replay', () => {
  const route = topicRouteFor(IDENTITY, GROUP, message(), [], 'root-1')

  function log(messageId: string): SessionEvent[] {
    return [
      {
        seq: 1, type: 'user/message',
        data: { source: sourceFor(route, messageId, 'op-1') },
      },
      {
        seq: 2, type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: '文档已建好' }] } },
      },
      { seq: 3, type: 'turn/end', data: { reason: 'completed' } },
    ] as unknown as SessionEvent[]
  }

  it('finds the earlier turn for a message and reports what it said', () => {
    expect(priorTurnFor(log('m-1'), 'm-1')?.text).toBe('文档已建好')
  })

  it('reports nothing for a message that never ran', () => {
    expect(priorTurnFor(log('m-1'), 'm-2')).toBeUndefined()
  })

  it('ignores turns that are not ours', () => {
    const foreign = [{
      seq: 1, type: 'user/message', data: { source: { kind: 'user' } },
    }] as unknown as SessionEvent[]
    expect(priorTurnFor(foreign, 'm-1')).toBeUndefined()
  })
})

describe('first-seen discovery paging', () => {
  /** A client over a scripted CLI, one page of history per call. */
  function clientWith(pages: YzjMessage[][]): YzjChannelClient {
    let call = 0
    const scriptedCtx = {
      yzjBridge: {
        run: async (): Promise<YzjRunResult> => {
          const list = pages[Math.min(call, pages.length - 1)] ?? []
          call += 1
          const json = { list, more: call < pages.length }
          return Promise.resolve({
            ok: true, exitCode: 0, stdout: JSON.stringify(json), stderr: '',
            json, truncated: false, timedOut: false, durationMs: 1,
          })
        },
      },
    } as unknown as Context
    const state = new ChannelState(join(tmpdir(), 'unused.json'))
    return new YzjChannelClient(scriptedCtx, state, 5_000)
  }

  /**
   * The CLI reports `sendTime` as LOCAL time with no zone suffix
   * ("2026-08-18 15:03:35"), and the transport parses it as local. A fixture
   * built from `toISOString()` would be UTC and silently shift by the machine's
   * offset — so build it the way the wire does.
   */
  const at = (minutesAgo: number, id: string): YzjMessage => {
    const when = new Date(Date.now() - minutesAgo * 60_000)
    const pad = (part: number): string => String(part).padStart(2, '0')
    return message({
      msgId: id,
      sendTime: `${String(when.getFullYear())}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} `
        + `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`,
    })
  }

  it('stops once the scan crosses the freshness cutoff', async () => {
    const client = clientWith([[at(1, 'a'), at(2, 'b')], [at(90, 'old')]])
    const batch = await client.messagesSince('g-1', Date.now() - 10 * 60_000, 5)
    expect(batch.truncated).toBe(false)
    expect(batch.messages.map(entry => entry.msgId)).toEqual(['a', 'b'])
  })

  it('reports an incomplete scan so the caller holds its cursor back', async () => {
    // Every page is fresh and the budget runs out: the cursor must NOT move,
    // or the unread pages are skipped forever.
    const client = clientWith([[at(1, 'a')], [at(2, 'b')], [at(3, 'c')]])
    const batch = await client.messagesSince('g-1', Date.now() - 60 * 60_000, 2)
    expect(batch.truncated).toBe(true)
    expect(batch.nextAnchor).toBeDefined()
  })
})

describe('session id ⇄ topic key', () => {
  // Caught by the first real end-to-end run: the router mints
  // `session-yzj-next-<hash>` while the reader looked for
  // `session-yzj-topic-<hash>`, so the desktop could never map a live topic
  // session back to its conversation. Derive the pair from the ROUTER, never
  // from what the names suggest.
  const route = topicRouteFor(IDENTITY, GROUP, message(), [], 'root-1')

  it('round-trips the id the router actually mints', () => {
    expect(topicKeyOfSession(route.sessionId)).toBe(route.topicKey)
    expect(sessionIdOfTopic(route.topicKey)).toBe(route.sessionId)
  })

  it('declines a session that is not a topic', () => {
    expect(topicKeyOfSession('session-242f30ed-6b49')).toBeUndefined()
  })
})

describe('topic titles', () => {
  const route = (content: string): string => topicRouteFor(
    IDENTITY, GROUP, message({ content }), [], 'root-1',
  ).topicLabel

  it('strips the trigger alias — that is how the agent was addressed, not what the topic is', () => {
    // Left in, every title in the sidebar starts with the same four characters,
    // which is the same as having no titles.
    expect(route('@next 帮我看下我有哪些知识库')).toBe('帮我看下我有哪些知识库')
    expect(route('@下一代 把价格页改一下')).toBe('把价格页改一下')
  })

  it('falls back rather than producing an empty title', () => {
    expect(route('@next')).toBe('新话题')
  })

  it('leaves ordinary text alone', () => {
    expect(route('把价格页改一下')).toBe('把价格页改一下')
  })
})

/**
 * Memory has to REACH the turn, or it is a panel nobody's work is affected by.
 *
 * Read per turn rather than pinned into the system prompt at Agent creation: a
 * convention learned at 10:05 has to hold at 10:06, and a topic's Agent can
 * live for hours.
 */
describe('what this place has already taught us', () => {
  const ROUTE = topicRouteFor(IDENTITY, GROUP, message(), [], 'm-1', 1)

  async function learn(axis: string, scope: string, summary: string): Promise<void> {
    await graph.append({
      type: 'memory/distilled',
      data: {
        memoryId: `mem-${summary}`, axis, scope, summary,
        sourceAnchors: ['yzj:m-0'], audience: [ROUTE.placeKey],
      },
      actor: { kind: 'agent' },
    })
  }

  it('says nothing at all when nothing has been learned', () => {
    expect(renderMemory(ctx, ROUTE)).toBe('')
  })

  it('carries the id, so the model can retire a line the moment it is corrected', async () => {
    await learn('place', ROUTE.placeKey, '对账差异逐条列出')
    const block = renderMemory(ctx, ROUTE)
    expect(block).toContain('[mem-对账差异逐条列出]')
    expect(block).toContain('memory_forget')
  })

  it('does not leak another place\'s conventions into this one', async () => {
    await learn('place', ROUTE.placeKey, '这里的')
    await learn('place', 'yzj-group-somewhere-else', '别处的')
    const block = renderMemory(ctx, ROUTE)
    expect(block).toContain('这里的')
    expect(block).not.toContain('别处的')
  })

  it('drops a forgotten line out of the next turn entirely', async () => {
    await learn('place', ROUTE.placeKey, '过期口径')
    await graph.append({
      type: 'memory/forgotten',
      data: { memoryId: 'mem-过期口径', reason: '改了' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    expect(renderMemory(ctx, ROUTE)).toBe('')
  })
})

/**
 * The CLI's own ceiling, owned by the class that owns the CLI contract.
 *
 * Caught in the browser: the place view asked for 40 and `yzj-cli` answered
 * `invalid value for --limit: must be between 1 and 20` — so the read returned
 * NOTHING, not fewer messages. Clamping at each call site means every caller
 * has to remember a number none of them can see.
 */
describe('message page ceiling', () => {
  it('never asks the CLI for more than it accepts', async () => {
    const asked: string[] = []
    const scope = new Context()
    scope.provide('yzjBridge', {
      run: async (command: readonly string[]): Promise<YzjRunResult> => {
        const at = command.indexOf('--limit')
        if (at >= 0) asked.push(command[at + 1] ?? '')
        return Promise.resolve({
          ok: true, exitCode: 0, stdout: '', stderr: '',
          json: { list: [] }, truncated: false, timedOut: false, durationMs: 1,
        })
      },
    })
    const client = new YzjChannelClient(
      scope, new ChannelState(join(tmpdir(), 'yzj-limit-state.json')), 5_000,
    )
    await client.messages('g-1', 40)
    await client.messages('g-1', 200)
    await client.messages('g-1', 0)
    expect(asked).toEqual(['20', '20', '1'])
  })
})

/**
 * 桌面发起的回合也在场所里（变更记录 #45）.
 *
 * Caught in the browser: `memory_note` run from the desk inside a dsh-2 topic
 * filed its lesson under `scope: 'desktop'`. The orchestrator only tracks
 * turns it started itself, so a prompt the operator typed fell through to the
 * desktop default — which has no place — and everything that turn learned or
 * produced landed at a coordinate nothing ever reads back.
 */
describe('a turn typed at the desk', () => {
  const BASE = {
    viewer: { kind: 'operator' as const, openId: 'op-1' },
    decider: 'op-1',
    accountKey: 'acct-1',
    accountOpenId: 'op-1',
    accountOrgId: 'org-1',
  }
  const TOPIC = {
    topicKey: 'yzj-topic-1', sessionId: 'session-yzj-topic-1',
    placeKey: 'yzj-group-g1', groupId: 'g1', groupName: 'dsh-2',
    topicRootId: 'root-1', label: '改价格页', generation: 1,
    conversationKind: 'group' as const,
  }

  it('runs in the topic\'s place, so what it learns is filed where it was learned', () => {
    const binding = deskBinding(BASE, TOPIC)
    expect(binding?.placeKey).toBe('yzj-group-g1')
    expect(binding?.topicKey).toBe('yzj-topic-1')
    expect(binding?.audience).toEqual(['yzj-group-g1'])
    // Who typed does not decide the read domain — the audience set does.
    expect(binding?.viewer).toEqual({ kind: 'place', placeKey: 'yzj-group-g1' })
  })

  it('keeps the operator viewer in a direct chat, where there is no room', () => {
    const binding = deskBinding(BASE, { ...TOPIC, conversationKind: 'direct' })
    expect(binding?.viewer).toEqual(BASE.viewer)
    expect(binding?.placeKey).toBe('yzj-group-g1')
  })

  it('leaves a session that is in no place exactly as it was', () => {
    expect(deskBinding(BASE, undefined)).toEqual(BASE)
    expect(deskBinding(undefined, TOPIC)).toBeUndefined()
  })
})

/**
 * 会话名录 (v4.8) — 「谁在找我」的底账.
 *
 * The left column has to BE the IM surface, not a slice of it shaped like the
 * agent's work queue. That needs a roster: every conversation the poll has
 * ever seen, kept across restarts, because `im group recent` is paged and the
 * platform has no group-search API — filtering over what we have seen IS the
 * search.
 */
describe('the conversation roster', () => {
  const row = (over: Partial<YzjGroup> = {}): YzjGroup => ({
    groupId: 'g-1', groupName: '产品讨论群', groupType: 2,
    lastMsgId: 'm-9', lastMsgSendTime: '2026-08-19 10:00:00.000',
    unreadCount: 3, headerUrl: 'https://static.example/avatar.png',
    lastMsg: {
      msgId: 'm-9', content: '这版价格页什么时候能好', fromOpenId: 'p-2',
      msgType: 'text', sendTime: '2026-08-19 10:00:00.000', param: {},
    },
    ...over,
  })

  let store: ChannelState
  let statePath: string

  beforeEach(async () => {
    statePath = join(await mkdtemp(join(tmpdir(), 'yzj-roster-')), 'state.json')
    store = new ChannelState(statePath)
    await store.load()
    store.selectAccount('acct-1')
  })

  it('remembers what the poll saw, with the fields a conversation list needs', () => {
    store.rememberConversation(row(), 1_000)
    expect(store.conversations()).toMatchObject([{
      groupId: 'g-1', name: '产品讨论群', type: 2, unread: 3,
      preview: '这版价格页什么时候能好', avatarUrl: 'https://static.example/avatar.png',
    }])
  })

  it('takes the unread count down to zero once this desk has read the last message', () => {
    store.rememberConversation(row(), 1_000)
    expect(store.conversations()[0]?.unreadEffective).toBe(3)
    store.markRead('g-1', 'm-9')
    // min(server, local): the one thing this side knows better is "I have seen
    // it". There is no mark-read API, so this never leaves the desk.
    expect(store.conversations()[0]?.unreadEffective).toBe(0)
  })

  it('lets the badge come back when the conversation moves on', () => {
    store.rememberConversation(row(), 1_000)
    store.markRead('g-1', 'm-9')
    store.rememberConversation(row({ lastMsgId: 'm-10', unreadCount: 1 }), 2_000)
    expect(store.conversations()[0]?.unreadEffective).toBe(1)
  })

  it('keeps a conversation that has never carried a message', () => {
    // The server returns these with no `lastMsg`, a 2018 sentinel time and a
    // real unread count. Requiring a lastMsgId dropped every one of them.
    const parsed = parseGroup({
      groupId: 'g-empty', groupName: '新建的群', groupType: 2,
      lastMsgSendTime: NO_MESSAGE_TIME, unreadCount: 6,
    })
    expect(parsed).toMatchObject({ groupId: 'g-empty', lastMsgId: '', unreadCount: 6 })
  })

  it('survives a reload, which is the whole point of writing it down', async () => {
    store.rememberConversation(row(), 1_000)
    await store.save()
    const reopened = new ChannelState(statePath)
    await reopened.load()
    reopened.selectAccount('acct-1')
    expect(reopened.conversations().map(entry => entry.groupId)).toEqual(['g-1'])
  })
})

/**
 * 人看人发不受限制，agent 触发仍限接单场所 (v4.8).
 *
 * Two different things share one send key. Talking to colleagues is the
 * product's whole point and is never gated. Addressing the agent where it does
 * not answer must be refused BEFORE the message leaves — posting it would put
 * a public @ in front of colleagues that nothing will ever answer, and a
 * silent non-answer teaches people the product randomly does nothing.
 */
describe('addressing the agent where it is not on duty', () => {
  const plan = (over: Parameters<typeof deskSendPlan>[0]): string => deskSendPlan(over)

  it('refuses to post an @ into a place the agent does not serve', () => {
    expect(plan({ addressesAgent: true, repliesToAgent: false, onDuty: false })).toBe('refuse')
  })

  it('lets people talk to people anywhere', () => {
    expect(plan({ addressesAgent: false, repliesToAgent: false, onDuty: false })).toBe('send')
  })

  it('ignites where the agent IS on duty', () => {
    expect(plan({ addressesAgent: true, repliesToAgent: false, onDuty: true }))
      .toBe('send-and-ignite')
  })

  it('treats replying to the agent as addressing it, on both sides of the gate', () => {
    // 回复某人的消息就是向其受话 (v4.7) — the gate has to see the same thing
    // the trigger rule sees, or one of them is wrong about what a reply is.
    expect(plan({ addressesAgent: false, repliesToAgent: true, onDuty: true }))
      .toBe('send-and-ignite')
    expect(plan({ addressesAgent: false, repliesToAgent: true, onDuty: false })).toBe('refuse')
  })
})

/**
 * 复盘修掉的那几个（对抗性评审 2026-08-19）.
 *
 * Each of these shipped in the first cut of v4.8 and each was reachable with
 * real data. They are pinned here because none of them is visible from a
 * screenshot.
 */
describe('what the review caught', () => {
  let store: ChannelState

  beforeEach(async () => {
    store = new ChannelState(join(await mkdtemp(join(tmpdir(), 'yzj-review-')), 'state.json'))
    await store.load()
    store.selectAccount('acct-1')
  })

  it('tells the agent\'s own words from the operator\'s, in the same registry', () => {
    // Both are "ours" for echo suppression — that is what the registry is for.
    // 受话判定 asks a different question, and answering it with "did this desk
    // send it" made replying to your OWN message read as delegating.
    store.registerOutbound('n1', 'g-1', 'fp-agent', 'agent')
    store.confirmOutbound('n1', 'm-agent')
    store.registerOutbound('n2', 'g-1', 'fp-desk', 'desk')
    store.confirmOutbound('n2', 'm-desk')

    expect(store.isOwnOutboundId('m-agent')).toBe(true)
    expect(store.isOwnOutboundId('m-desk')).toBe(true)
    expect(store.isAgentOutboundId('m-agent')).toBe(true)
    expect(store.isAgentOutboundId('m-desk')).toBe(false)
  })

  it('can clear the badge of a conversation that has no message to mark', () => {
    // These rows arrive with `lastMsgId: ''` and a real unread count. A read
    // mark keyed on the message id could never be written, so no gesture in
    // the UI could ever clear them.
    store.rememberConversation({
      groupId: 'g-empty', groupName: '新建的群', groupType: 2,
      lastMsgId: '', lastMsgSendTime: NO_MESSAGE_TIME, unreadCount: 6,
    }, 0)
    expect(store.conversations()[0]?.unreadEffective).toBe(6)
    store.markRead('g-empty', READ_EMPTY)
    expect(store.conversations()[0]?.unreadEffective).toBe(0)
  })

  it('drops read marks for conversations that left the roster', async () => {
    store.rememberConversation({
      groupId: 'g-1', groupName: 'a', groupType: 2, lastMsgId: 'm-1', lastMsgSendTime: '',
    }, 1_000)
    store.markRead('g-1', 'm-1')
    store.markRead('g-gone', 'm-9')
    await store.save()
    // Pruning used to live inside a cap branch that cannot run below 1000
    // conversations — i.e. it was collected by code that never executed.
    expect(store.readAtKeys()).toEqual(['g-1'])
  })
})
