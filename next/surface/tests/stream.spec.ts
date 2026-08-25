/**
 * Stream specs — the claim the center column makes.
 *
 * A topic is ONE conversation. So the column must not make one utterance look
 * like two, must not reorder what happened, must fold the agent's machinery
 * into something a human reads as one event, and must say when a read failed
 * rather than showing an empty room.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  approvalCard, approvalFamily, assessmentCard, createCommitmentCard, commitmentFamily,
  conflictCard, memoriesFor, taskCard, taskFamily, waitingCard,
} from '@yzj-next/objects'
import type { TopicDescriptor, TopicMessage, YzjTopics } from '@yzj-next/channel'
import { buildStream, clockOf, type TrajectoryNode, isPlaceholderOnly, withoutImageMarks } from '../src/client/stream.ts'
import { backTarget, currentFrame, popFrame, pushFrame, setFrame } from '../src/client/store.ts'
import { safeHref } from '../src/client/Board.tsx'
import {
  artifactsFor, boardFrame, boardView, cardsFor, chipsFor, fusedWindow, inboxView, objectFace,
  placeView,
} from '../src/rpc.ts'

const TOPIC: TopicDescriptor = {
  topicKey: 'yzj-topic-abc',
  sessionId: 'session-yzj-topic-abc',
  placeKey: 'yzj-group-g1',
  groupId: 'g1',
  groupName: 'dsh-2',
  topicRootId: 'root-1',
  label: '改价格页',
  generation: 1,
  conversationKind: 'group',
}

/**
 * 挂上完整的卡注册表 —— **决断层就是它** (v4.15 家族即接口).
 *
 * 收件箱的「需要你」、群视图的话题卡徽标、会话决断条，读的都是同一个抽象查询:
 * 「谁还在等人答」。回答它的是各家族自己声明的 `demand`。所以一个不挂注册表的夹具
 * 测的是另一套系统——那里没有任何一个对象能说出自己在等什么，于是每一屏都恰好是空的，
 * 而空的东西看起来总是对的。
 */
function mountCards(context: Context): YzjCards {
  const cards = new YzjCards(context)
  cards.register(approvalCard)
  cards.register(taskCard)
  cards.register(waitingCard)
  cards.register(conflictCard)
  cards.register(createCommitmentCard(context))
  cards.register(assessmentCard)
  return cards
}

function message(overrides: Partial<TopicMessage> = {}): TopicMessage {
  return {
    msgId: 'm-1', fromOpenId: 'p-9', fromName: '张锐', content: '看一下',
    msgType: 'text', time: 1_000, own: false, ...overrides,
  }
}

/**
 * Node fixtures in the shapes the host runtime ACTUALLY emits.
 *
 * The first version of these specs used invented kinds (`user-message`,
 * `assistant-message`) with a flat `text` field. They passed, and the column
 * they were testing rendered not one word anybody had said — a spec that
 * agrees with the code about a shape neither of them checked against the
 * runtime proves only that they agree.
 */
function said(seq: number, text: string, time: number): TrajectoryNode {
  return { kind: 'user', seq, time, content: [{ type: 'text', text }], source: {} }
}

/** A turn admitted from a group, exactly as the orchestrator writes it. */
function admitted(seq: number, text: string, time: number, messageId = ''): TrajectoryNode {
  return {
    kind: 'context', seq, time,
    content: [{ type: 'text', text: `[云之家话题上下文]\n...\n\n[用户任务]\n${text}` }],
    source: { kind: 'yzj-next', messageId, writeMode: 'standard' },
  }
}

function answered(seq: number, text: string, time: number): TrajectoryNode {
  return { kind: 'assistant', seq, time, blocks: [{ kind: 'reasoning', text: '想了想' }, { kind: 'text', text }] }
}

function toolRan(seq: number, name: string, time: number): TrajectoryNode {
  return { kind: 'tool-result', seq, time, call: { name, argsRaw: '{}' }, content: 'ok' }
}

/**
 * 进行中 vs 已完成 (变更记录 #40).
 *
 * The facts that say "still going" — the call that has gone out and not come
 * back, the answer being streamed — are NOT in `nodes`: nodes are the
 * finalized log. A column that reads only nodes therefore stands perfectly
 * still for an entire run and then produces a finished-looking work block,
 * which is exactly the state a reader cannot tell apart from done.
 */
describe('a turn in flight says so', () => {
  it('folds a call that has not come back into the block, as a running step', () => {
    const rows = buildStream(
      [said(1, '来', 1_000), toolRan(2, 'yzj_doc_get', 1_100)],
      [], [], [], true,
      { running: true, calls: [{ callId: 'c1', name: 'yzj_doc_block_update', argsRaw: '{}', time: 1_200 }] },
    )
    const work = rows.filter(row => row.kind === 'work')
    // One block, not two: the call in flight is the same run of machinery.
    expect(work).toHaveLength(1)
    expect(work[0]?.kind === 'work' && work[0].steps.map(step => step.state))
      .toEqual(['done', 'running'])
    expect(work[0]?.kind === 'work' && work[0].state).toBe('running')
  })

  it('reports how long a settled block took, and nothing while it runs', () => {
    const settled = buildStream(
      [{ kind: 'tool-result', seq: 1, time: 3_400, callTime: 1_400, call: { name: 'a', argsRaw: '{}' } }],
      [], [],
    )
    const block = settled.find(row => row.kind === 'work')
    expect(block?.kind === 'work' && block.ms).toBe(2_000)
    expect(block?.kind === 'work' && block.steps[0]?.ms).toBe(2_000)

    const live = buildStream([], [], [], [], true, {
      running: true, calls: [{ callId: 'c', name: 'a', argsRaw: '{}', time: 9_000 }],
    })
    const open = live.find(row => row.kind === 'work')
    // A duration for something that has not finished would be a guess.
    expect(open?.kind === 'work' && open.ms).toBe(0)
    expect(open?.kind === 'work' && open.steps[0]?.since).toBe(9_000)
  })

  it('does not draw a failed call with the same ✓ as a successful one', () => {
    const rows = buildStream(
      [
        toolRan(1, 'ok_tool', 1_000),
        { kind: 'tool-result', seq: 2, time: 1_100, isError: true, call: { name: 'yzj_doc_create', argsRaw: '{}' } },
      ],
      [], [],
    )
    const block = rows.find(row => row.kind === 'work')
    expect(block?.kind === 'work' && block.steps.map(step => step.state)).toEqual(['done', 'failed'])
    expect(block?.kind === 'work' && block.state).toBe('failed')
  })

  it('renders the answer being streamed, which no node carries', () => {
    const rows = buildStream([said(1, '来', 1_000)], [], [], [], true, {
      running: true,
      partial: { blocks: [{ kind: 'reasoning', text: '想想' }, { kind: 'text', text: '正在写…' }] },
    })
    expect(rows.at(-1)).toMatchObject({ kind: 'live', mode: 'text', text: '正在写…' })
  })

  it('shows the thought while there is nothing else to show', () => {
    const rows = buildStream([], [], [], [], true, {
      running: true,
      partial: { blocks: [{ kind: 'reasoning', text: '第一步\n第二步：查一下价格页' }] },
    })
    expect(rows.at(-1)).toMatchObject({ kind: 'live', mode: 'thinking', text: '第二步：查一下价格页' })
  })

  it('says the request is out even before the first token', () => {
    const rows = buildStream([], [], [], [], true, { running: true })
    expect(rows.at(-1)).toMatchObject({ kind: 'live', mode: 'waiting' })
  })

  it('does not add a live row while a tool is out — the block already says it', () => {
    const rows = buildStream([], [], [], [], true, {
      running: true, calls: [{ callId: 'c', name: 'a', argsRaw: '{}', time: 1_000 }],
    })
    expect(rows.filter(row => row.kind === 'live')).toEqual([])
  })

  it('renders nothing live once the turn is over', () => {
    const rows = buildStream([answered(1, '好了', 1_000)], [], [], [], true, { running: false })
    expect(rows.filter(row => row.kind === 'live')).toEqual([])
  })
})

/**
 * 精简，不是原始（变更记录 #44）.
 *
 * The work block is an ENTRY. A step that pastes `{"command":"…","timeoutMs":
 * 15000}` into the middle of the conversation is not a summary of what the
 * agent did — it is the log, in the wrong place. What it did is a question
 * only the tool can answer, and `dsh-tools` has a contract for asking.
 */
describe('a step says what the tool says it did', () => {
  it('takes a shell step\'s sentence, not its command line', () => {
    const rows = buildStream(
      [{
        kind: 'tool-result', seq: 1, time: 2_000, callTime: 1_000,
        call: { name: 'bash', argsRaw: '{"command":"rm -rf ./tmp && pnpm build"}' },
        callView: { card: 'terminal', title: 'rm -rf ./tmp && pnpm build', description: '清掉临时目录并重新构建' },
      }],
      [], [],
    )
    const step = rows.find(row => row.kind === 'work')?.steps[0]
    expect(step?.detail).toBe('清掉临时目录并重新构建')
  })

  it('prefers the completed card\'s title, which knows how it turned out', () => {
    const rows = buildStream(
      [{
        kind: 'tool-result', seq: 1, time: 2_000,
        call: { name: 'grep', argsRaw: '{"pattern":"x"}' },
        callView: { card: 'generic', title: '搜索 x' },
        resultView: { card: 'search', shape: 'matches', title: '搜索 x · 12 处' },
      }],
      [], [],
    )
    expect(rows.find(row => row.kind === 'work')?.steps[0]?.detail).toBe('搜索 x · 12 处')
  })

  it('says NOTHING rather than the raw arguments when a tool declared no view', () => {
    // Deriving a label from argsRaw here would be this column guessing about a
    // package it does not own. The name is honest; the arguments are in 完整轨迹.
    const rows = buildStream(
      [{
        kind: 'tool-result', seq: 1, time: 2_000,
        call: { name: 'mystery_tool', argsRaw: '{"secret":"sauce","timeoutMs":15000}' },
      }],
      [], [],
    )
    const step = rows.find(row => row.kind === 'work')?.steps[0]
    expect(step?.tool).toBe('mystery_tool')
    expect(step?.detail).toBe('')
  })

  it('does not paste a system reminder into the conversation', () => {
    const rows = buildStream(
      [{
        kind: 'context', seq: 1, time: 1_000,
        provenance: { name: 'runtime-context' },
        content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes…' }],
        source: {},
      }],
      [], [],
    )
    expect(rows.find(row => row.kind === 'work')?.steps[0])
      .toMatchObject({ tool: 'runtime-context', detail: '上下文注入' })
  })

  it('labels a call still in flight the same way', () => {
    const rows = buildStream([], [], [], [], true, {
      running: true,
      calls: [{
        callId: 'c1', name: 'yzj_doc_create', argsRaw: '{"title":"价格页"}', time: 1_000,
        callView: { card: 'generic', title: '新建文档《价格页》', kind: 'edit' },
      }],
    })
    expect(rows.find(row => row.kind === 'work')?.steps[0]?.detail).toBe('新建文档《价格页》')
  })
})

describe('one column, one conversation', () => {
  it('interleaves what people said with what the agent said, by time', () => {
    const rows = buildStream(
      [said(1, '改一下价格', 2_000), answered(2, '改好了', 4_000)],
      [message({ msgId: 'm-a', time: 3_000, content: '等下' })],
      [],
    )
    expect(rows.filter(row => row.kind !== 'divider').map(row => row.key))
      .toEqual(['s:1:user', 'm:m-a', 's:2:assistant'])
  })

  it('folds consecutive machinery into one work block', () => {
    // Six tool calls are ONE event to a reader and six to a log.
    const rows = buildStream(
      [
        said(1, '来', 1_000),
        toolRan(2, 'yzj_doc_get', 1_100),
        toolRan(3, 'yzj_doc_block_update', 1_200),
        toolRan(4, 'yzj_doc_get', 1_300),
        answered(5, '好了', 1_400),
      ],
      [], [],
    )
    const work = rows.filter(row => row.kind === 'work')
    expect(work).toHaveLength(1)
    expect(work[0]?.kind === 'work' && work[0].steps).toHaveLength(3)
  })

  it('breaks the block when somebody speaks in the middle', () => {
    const rows = buildStream(
      [
        toolRan(1, 'a', 1_000),
        answered(2, '中间说了句', 1_100),
        toolRan(3, 'b', 1_200),
      ],
      [], [],
    )
    expect(rows.filter(row => row.kind === 'work')).toHaveLength(2)
  })

  it('never shows the agent\'s own outbound twice', () => {
    const rows = buildStream(
      [answered(1, '改好了', 2_000)],
      [message({ msgId: 'mine', time: 2_100, own: true, content: '改好了' })],
      [],
    )
    expect(rows.filter(row => row.kind === 'message')).toHaveLength(0)
  })

  it('inserts a day divider only when the day changes', () => {
    const now = Date.now()
    const rows = buildStream(
      [
        said(1, 'x', now - 26 * 60 * 60 * 1_000),
        said(2, 'y', now),
        said(3, 'z', now + 1_000),
      ],
      [], [],
    )
    expect(rows.filter(row => row.kind === 'divider')).toHaveLength(2)
  })

  it('renders a clock only for rows that have a real time', () => {
    expect(clockOf(0)).toBe('')
    expect(clockOf(Date.parse('2026-08-18T09:05:00'))).toBe('09:05')
  })

  it('shows a group utterance once, not once per stream it appears in', () => {
    // A turn admitted from a place exists twice — the Yunzhijia message and
    // the session's own node for it. The message id is what makes them the
    // same utterance.
    const rows = buildStream(
      [admitted(1, '改一下价格', 2_000, 'm-x'), answered(2, '改好了', 3_000)],
      [message({ msgId: 'm-x', time: 2_000, content: '@next 改一下价格' })],
      [],
    )
    expect(rows.filter(row => row.kind === 'message' || row.kind === 'said')).toHaveLength(2)
  })

  it('falls back to the session node when the IM read did not produce it', () => {
    // A lagging read must not silently delete the operator's own words.
    const rows = buildStream(
      [admitted(1, '改一下价格', 2_000, 'm-x')],
      [],
      [],
    )
    expect(rows.filter(row => row.kind === 'said'))
      .toMatchObject([{ text: '改一下价格', voice: 'public' }])
  })

  it('strips the turn preamble so the operator sees their sentence, not our plumbing', () => {
    const rows = buildStream([admitted(1, '改一下价格', 2_000)], [], [])
    expect(rows.filter(row => row.kind === 'said')[0]?.text).toBe('改一下价格')
  })
})

describe('what the host assembles for the column', () => {
  let ctx: Context
  let graph: YzjGraph

  const topics = (overrides: Partial<YzjTopics> = {}): YzjTopics => ({
    topicOf: () => TOPIC,
    tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
    messagesFor: async () => Promise.resolve([message()]),
    sendToPlace: async () => Promise.resolve({}),
      conversations: () => [],
      markRead: () => undefined,
      aliases: () => ['@next'],
    ...overrides,
  })

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-column-')) })
    graph.defineFamily(commitmentFamily)
    graph.defineFamily(approvalFamily)
    await graph.selectAccount('acct-1')
  })

  async function openApproval(): Promise<void> {
    await graph.append({
      type: 'approval/opened',
      data: {
        approvalId: 'ap-1', toolName: 'yzj_doc_create', reason: '新建知识库文档',
        level: 'standard', args: { title: '价格页' }, argsDigest: 'd', decider: 'op-1',
        deadline: Date.now() + 60_000, topicKey: TOPIC.topicKey, placeKey: TOPIC.placeKey,
        audience: [TOPIC.placeKey],
      },
      actor: { kind: 'agent' },
    })
  }

  it('puts a pending confirmation in the stream, with its actions', async () => {
    // A confirmation belongs INSIDE the conversation that produced it; moving
    // it to a panel is how "please confirm" gets orphaned from its context.
    await openApproval()
    const cards = cardsFor(ctx, TOPIC)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.resolved).toBe(false)
    expect(cards[0]?.actions.filter(action => action.available).map(action => action.id))
      .toEqual(['approve', 'reject'])
  })

  it('dates a card by when it came into being, not by a field its family may not keep', async () => {
    // Caught in the browser: cards sorted to epoch zero and piled ABOVE the
    // whole conversation, because the state of most families carries no
    // timestamp at all. A confirmation that does not sit where it was asked
    // for has lost the only argument for rendering it inline.
    await openApproval()
    const card = cardsFor(ctx, TOPIC)[0]
    expect(card?.at).toBeGreaterThan(0)
    const rows = buildStream(
      [said(1, '删一下', (card?.at ?? 0) - 1_000)],
      [], card === undefined ? [] : [card],
    )
    expect(rows.filter(row => row.kind !== 'divider').map(row => row.kind))
      .toEqual(['said', 'card'])
  })

  it('says a read failed rather than showing an empty room', async () => {
    ctx.provide('yzjTopics', topics({
      messagesFor: async () => Promise.reject(new Error('yzj-cli timed out')),
    }))
    const window_ = await fusedWindow(ctx, TOPIC.sessionId, 40)
    expect(window_.messages).toEqual([])
    expect(window_.staleReason).toContain('timed out')
  })

  it('hangs this topic\'s open commitment off the head and marks an inferred goal', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'cmt-1', what: '改价格页', sourceAnchor: 'yzj:m-1',
        executor: { kind: 'agent', topicKey: TOPIC.topicKey },
        parentGoalRef: 'yzj://doc/goal-1', attachedVia: 'inferred', due: '周五',
        audience: [TOPIC.placeKey],
      },
      actor: { kind: 'agent' },
    })
    expect(chipsFor(ctx, TOPIC)).toEqual([{
      kind: 'commitment', id: 'cmt-1', what: '改价格页', status: 'open',
      due: '周五', parentGoalRef: 'yzj://doc/goal-1', inferred: true,
    }])
  })
})

describe('the inbox is ordered by attention', () => {
  let ctx: Context
  let graph: YzjGraph

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-inbox-')) })
    graph.defineFamily(approvalFamily)
    graph.defineFamily(commitmentFamily)
    graph.defineFamily(taskFamily)
    await graph.selectAccount('acct-1')
    ctx.provide('yzjTopics', {
      topicOf: () => TOPIC,
      tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
      messagesFor: async () => Promise.resolve([]),
      sendToPlace: async () => Promise.resolve({}),
      conversations: () => [],
      markRead: () => undefined,
      aliases: () => ['@next'],
    })
  })

  it('lists a pending confirmation under 需要我', async () => {
    await graph.append({
      type: 'approval/opened',
      data: {
        approvalId: 'ap-1', toolName: 'yzj_doc_create', reason: '新建知识库文档',
        level: 'standard',
        args: {}, argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 60_000,
        topicKey: TOPIC.topicKey, placeKey: TOPIC.placeKey, audience: [],
      },
      actor: { kind: 'agent' },
    })
    const inbox = inboxView(ctx)
    const row = inbox.places[0]?.topics[0]
    expect(row?.badge).toBe('待确认')
    expect(row?.sessionId).toBe(TOPIC.sessionId)
    /*
      第二行说的是**那个对象自己要什么**，用它自己的话 (v4.15 家族即接口)。

      徽标已经说了「待确认」；预览再说一遍「待确认」，就是把一行字花在重复上。
      现在这句由家族自己写（`确认：新建知识库文档`），视图一个字都没拼。
    */
    expect(row?.preview).toContain('新建知识库文档')
    expect(row?.preview).not.toContain(TOPIC.label)
    // The header carries its loudest child, so a collapsed place still says
    // whether anything under it needs answering.
    expect(inbox.places[0]?.tone).toBe('confirm')
    expect(inbox.counts.confirm).toBe(1)
    expect(inbox.firstOf.confirm).toBe(TOPIC.sessionId)
  })

  it('says a topic is running even while it owes an older answer', async () => {
    /*
      Reported in use: send `@next …` into a topic that already had an
      unaccepted task, and the row instantly reads 待验收 — with the OLD task's
      summary — which reads as "your new request finished instantly".

      Both facts are true. The badge keeps the DEMAND (loudest-wins is right:
      an unanswered ask must not hide behind activity), and the row now also
      carries the live fact, with the preview following the live one — the
      newest thing is what somebody who just pressed send is looking for.
    */
    for (const type of ['task/opened', 'task/terminal'] as const) {
      await graph.append({
        type,
        data: {
          taskId: 'tsk-old', what: '老任务', topicKey: TOPIC.topicKey,
          sourceAnchor: 'yzj:m', summary: '老任务的结论', artifacts: [],
        },
        actor: { kind: 'agent' },
      })
    }
    await graph.append({
      type: 'task/opened',
      data: {
        taskId: 'tsk-new', what: '刚发的这句', topicKey: TOPIC.topicKey, sourceAnchor: 'yzj:m2',
      },
      actor: { kind: 'agent' },
    })
    const row = inboxView(ctx).places[0]?.topics[0]
    expect(row?.tone).toBe('review')
    expect(row?.live).toBe(true)
    expect(row?.preview).toContain('刚发的这句')
  })

  it('lets the loudest state win when one topic is doing several things', async () => {
    for (const type of ['task/opened', 'task/terminal'] as const) {
      await graph.append({
        type,
        data: {
          taskId: 'tsk-1', what: '改价格页', topicKey: TOPIC.topicKey,
          sourceAnchor: 'yzj:m', summary: '改好了', artifacts: [],
        },
        actor: { kind: 'agent' },
      })
    }
    await graph.append({
      type: 'approval/opened',
      data: {
        approvalId: 'ap-2', toolName: 'yzj_doc_delete', reason: '删除文档', level: 'strong',
        args: {}, argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 60_000,
        topicKey: TOPIC.topicKey, placeKey: TOPIC.placeKey, audience: [],
      },
      actor: { kind: 'agent' },
    })
    // A pending confirmation blocks real work; being also 待验收 must not hide it.
    expect(inboxView(ctx).places[0]?.topics[0]?.tone).toBe('confirm')
  })

  it('releases the row of a settled topic — 注意力租约', async () => {
    for (const type of ['task/opened', 'task/terminal', 'task/accepted'] as const) {
      await graph.append({
        type,
        data: {
          taskId: 'tsk-1', what: '改价格页', topicKey: TOPIC.topicKey,
          sourceAnchor: 'yzj:m', summary: '改好了', artifacts: [], acceptedBy: 'op-1',
        },
        actor: { kind: 'agent' },
      })
    }
    const place = inboxView(ctx).places[0]
    // Not deleted — moved. The count is what makes the archive a door rather
    // than a hole, so the sidebar can say where the rows went.
    expect(place?.topics).toEqual([])
    expect(place?.archived).toBe(1)
  })

  it('counts an overdue commitment only when the deadline is a real past date', async () => {
    for (const [id, due] of [['c1', '2020-01-01'], ['c2', '下周'], ['c3', '2099-01-01']]) {
      await graph.append({
        type: 'commitment/opened',
        data: {
          commitmentId: id as string, what: 'x', sourceAnchor: 'a', due: due as string,
          executor: { kind: 'human', openId: 'p-9' },
        },
        actor: { kind: 'agent' },
      })
    }
    const inbox = inboxView(ctx)
    expect(inbox.commitments.open).toBe(3)
    // A vague due date is not evidence of lateness.
    expect(inbox.commitments.overdue).toBe(1)
  })

  it('keeps the place header even when the lease has taken every row', () => {
    // The header is the door to the group view, where the archive lives. Losing
    // it would make finished work unreachable from this column entirely.
    const inbox = inboxView(ctx)
    expect(inbox.counts).toEqual({ confirm: 0, review: 0, running: 0 })
    expect(inbox.places[0]?.groupName).toBe('dsh-2')
    // Nothing is doing anything, so the lease holds every row back — and the
    // header still stands, because it is the way into the group view.
    expect(inbox.places[0]?.topics).toEqual([])
    expect(inbox.places[0]?.archived).toBe(1)
  })
})

describe('the commitment board', () => {
  let ctx: Context
  let graph: YzjGraph

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-board-')) })
    graph.defineFamily(commitmentFamily)
    await graph.selectAccount('acct-1')
    ctx.provide('yzjTopics', {
      topicOf: () => TOPIC,
      tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
      messagesFor: async () => Promise.resolve([]),
      sendToPlace: async () => Promise.resolve({}),
      conversations: () => [],
      markRead: () => undefined,
      aliases: () => ['@next'],
    })
  })

  async function open(id: string, what: string, extra: Record<string, unknown>): Promise<void> {
    await graph.append({
      type: 'commitment/opened',
      data: { commitmentId: id, what, sourceAnchor: 'a', ...extra },
      actor: { kind: 'agent' },
    })
  }

  it('puts people and agents in one frame, overdue first', async () => {
    await open('c1', '出周报', { executor: { kind: 'agent', topicKey: TOPIC.topicKey } })
    await open('c2', '返修数据分析', {
      executor: { kind: 'human', openId: 'p-9', name: '张锐' }, due: '2020-01-01',
    })
    const rows = boardView(ctx)
    expect(rows[0]?.id).toBe('c2')
    expect(rows[0]).toMatchObject({ executorKind: 'human', who: '张锐', overdue: true })
    expect(rows[1]).toMatchObject({ executorKind: 'agent', overdue: false })
    // An agent commitment carries the way back into its conversation.
    expect(rows[1]?.sessionId).toBe(TOPIC.sessionId)
  })

  it('sinks settled commitments below the live ones', async () => {
    await open('c1', '做完的', { executor: { kind: 'agent', topicKey: TOPIC.topicKey } })
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'done' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    await open('c2', '还在做的', { executor: { kind: 'agent', topicKey: TOPIC.topicKey } })
    expect(boardView(ctx).map(row => row.id)).toEqual(['c2', 'c1'])
  })

  it('never calls a vague deadline overdue', async () => {
    await open('c1', 'x', { executor: { kind: 'human', openId: 'p' }, due: '下周' })
    expect(boardView(ctx)[0]?.overdue).toBe(false)
  })
})

/**
 * 承诺板 GOALS 视图 (v4.8) — 目标 = 复合承诺，零新节点类型.
 *
 * The join is a URI: a goal commitment declares one, and work that serves it
 * names the same one. Nothing draws an edge, so nothing has to maintain one —
 * and the goal's body stays where it lives, in Yunzhijia.
 */
describe('the board, grouped by goal', () => {
  let ctx: Context
  let graph: YzjGraph

  const GOAL = 'yzj://doc/goal-q3'

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-goals-')) })
    graph.defineFamily(commitmentFamily)
    await graph.selectAccount('acct-1')
    ctx.provide('yzjTopics', {
      topicOf: () => TOPIC,
      tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
      conversations: () => [],
      markRead: () => undefined,
      aliases: () => ['@next'],
      messagesFor: async () => Promise.resolve([]),
      sendToPlace: async () => Promise.resolve({}),
    })
  })

  const open = async (id: string, what: string, extra: Record<string, unknown>): Promise<void> => {
    await graph.append({
      type: 'commitment/opened',
      data: { commitmentId: id, what, sourceAnchor: 'a', ...extra },
      actor: { kind: 'agent' },
    })
  }

  it('joins a goal to the work serving it by URI, with no new node type', async () => {
    await open('g1', 'Q3 把对账周期压到 3 天内', {
      goalRef: GOAL, executor: { kind: 'human', openId: 'op-1', name: '我' },
    })
    await open('c1', '返修数据分析', {
      parentGoalRef: GOAL, executor: { kind: 'human', openId: 'p-9', name: '张锐' }, due: '2020-01-01',
    })
    await open('c2', '出周报', { parentGoalRef: GOAL, executor: { kind: 'agent', topicKey: TOPIC.topicKey } })
    const frame = boardFrame(ctx)
    expect(frame.goals).toHaveLength(1)
    expect(frame.goals[0]?.row?.what).toBe('Q3 把对账周期压到 3 天内')
    expect(frame.goals[0]?.children.map(child => child.what).sort())
      .toEqual(['出周报', '返修数据分析'])
    // 聚合是信号不是状态: counts, never a derived completion of the parent.
    expect(frame.goals[0]?.counts).toEqual({ open: 1, overdue: 1, settled: 0 })
  })

  it('keeps unattached work visible instead of demanding it be attached', async () => {
    // 未挂是合法状态，不是错误. What the group buys is that the alignment DEBT
    // stops being invisible — not that everything must be aligned.
    await open('g1', '目标', { goalRef: GOAL, executor: { kind: 'human', openId: 'op-1' } })
    await open('c1', '挂上的', { parentGoalRef: GOAL, executor: { kind: 'human', openId: 'p-9' } })
    await open('c2', '没挂的', { executor: { kind: 'human', openId: 'p-8' } })
    const frame = boardFrame(ctx)
    expect(frame.unattached.map(row => row.what)).toEqual(['没挂的'])
    expect(frame.goals[0]?.children.map(row => row.what)).toEqual(['挂上的'])
  })

  it('groups work under a goal whose body we were only told about', async () => {
    // 真身外部原则: the goal document exists whether or not anybody declared a
    // commitment for it here. Work that names it still groups.
    await open('c1', '只知道 URI', { parentGoalRef: GOAL, executor: { kind: 'human', openId: 'p-9' } })
    const frame = boardFrame(ctx)
    expect(frame.goals).toHaveLength(1)
    expect(frame.goals[0]?.row).toBeUndefined()
    expect(frame.goals[0]?.children).toHaveLength(1)
  })

  it('retires an emptied goal, and keeps one that still has work under it', async () => {
    // The board surfaces what is outstanding, not a complete archive — but a
    // retired goal whose work is still open must keep its group, because that
    // work did not stop existing.
    await open('g1', '空掉的目标', { goalRef: GOAL, executor: { kind: 'human', openId: 'op-1' } })
    await open('g2', '还有活的目标', {
      goalRef: 'yzj://doc/goal-2', executor: { kind: 'human', openId: 'op-1' },
    })
    await open('c1', '仍在跑', {
      parentGoalRef: 'yzj://doc/goal-2', executor: { kind: 'human', openId: 'p-9' },
    })
    for (const id of ['g1', 'g2']) {
      await graph.append({
        type: 'commitment/voided',
        data: { commitmentId: id, cause: '不做了' },
        actor: { kind: 'operator', openId: 'op-1' },
      })
    }
    const frame = boardFrame(ctx)
    expect(frame.goals.map(goal => goal.goalRef)).toEqual(['yzj://doc/goal-2'])
  })

  it('does not file a goal under itself', async () => {
    await open('g1', '目标', { goalRef: GOAL, executor: { kind: 'human', openId: 'op-1' } })
    const frame = boardFrame(ctx)
    expect(frame.goals[0]?.children).toEqual([])
    expect(frame.unattached).toEqual([])
  })
})

describe('the object face', () => {
  let ctx: Context
  let graph: YzjGraph

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-objects-')) })
    await graph.selectAccount('acct-1')
  })

  /** Another topic in the SAME place as TOPIC. */
  const SIBLING: TopicDescriptor = {
    ...TOPIC, topicKey: 'yzj-topic-sib', sessionId: 'session-sib', topicRootId: 'root-sib',
    label: '同一个群里的另一件事',
  }

  /** A topic in a DIFFERENT place. */
  const FAR: TopicDescriptor = {
    ...TOPIC, topicKey: 'yzj-topic-far', sessionId: 'session-far', topicRootId: 'root-far',
    placeKey: 'yzj-group-g9', groupId: 'g9', groupName: '别的群', label: '别的群里的事',
  }

  function mountTree(): void {
    ctx.provide('yzjTopics', {
      topicOf: () => TOPIC,
      tree: () => [
        { place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC, SIBLING] },
        { place: { placeKey: FAR.placeKey, groupName: FAR.groupName }, topics: [FAR] },
      ],
      messagesFor: async () => Promise.resolve([]),
      sendToPlace: async () => Promise.resolve({}),
      conversations: () => [],
      markRead: () => undefined,
      aliases: () => ['@next'],
    })
  }

  async function produced(topicKey: string, uri: string, title: string): Promise<void> {
    await graph.append({
      type: 'lineage/produced',
      data: { topicKey, action: '新建文档', artifact: { uri, placeKey: 'yzj-kb-1', title } },
      actor: { kind: 'agent' },
    })
  }

  async function learned(axis: string, scope: string, summary: string): Promise<void> {
    await graph.append({
      type: 'memory/distilled',
      data: {
        memoryId: `mem-${scope}-${summary}`, axis, scope, summary,
        sourceAnchors: ['yzj:m-1'],
      },
      actor: { kind: 'agent' },
    })
  }

  it('shows this topic\'s own artifacts, and its PLACE\'s as the wider radius', async () => {
    mountTree()
    await produced(TOPIC.topicKey, 'yzj://doc/a', '价格页')
    await produced(SIBLING.topicKey, 'yzj://doc/b', '同群另一件')
    await produced(FAR.topicKey, 'yzj://doc/c', '别的群的')
    const face = objectFace(ctx, TOPIC)
    expect(face.current.map(row => row.title)).toEqual(['价格页'])
    // The place's pool, not the account's: another group's work is not a
    // resource of this one, and showing it made every conversation identical.
    expect(face.resources.map(row => row.title).sort()).toEqual(['价格页', '同群另一件'])
    expect(face.scope).toEqual({ kind: 'place', placeName: 'dsh-2' })
  })

  it('gives a desk session the other desk sessions, not every group\'s output', async () => {
    mountTree()
    await produced(TOPIC.topicKey, 'yzj://doc/a', '群里的')
    await produced('session:local-1', 'yzj://doc/d', '这台机器上做的')
    await produced('session:local-2', 'yzj://doc/e', '另一个本地会话做的')
    const face = objectFace(ctx, undefined, 'local-1')
    expect(face.current.map(row => row.title)).toEqual(['这台机器上做的'])
    // A desk session's neighbours are the other desk sessions — sharing no
    // room is exactly what they have in common.
    expect(face.resources.map(row => row.title).sort())
      .toEqual(['另一个本地会话做的', '这台机器上做的'])
    expect(face.scope).toEqual({ kind: 'local' })
  })

  it('reads a place\'s conventions only inside that place', async () => {
    mountTree()
    await learned('place', TOPIC.placeKey, '对账差异逐条列出')
    await learned('place', FAR.placeKey, '别的群的规矩')
    await learned('org', 'org-1', '全公司周五交周报')
    // 与写入侧 scopeFor 同一推导 —— 两边不一致就会写得进读不出。
    expect(objectFace(ctx, TOPIC).memory.map(row => row.summary).sort())
      .toEqual(['全公司周五交周报', '对账差异逐条列出'])
    // A local session has no place, so a place convention is about nowhere it is.
    expect(objectFace(ctx, undefined, 'local-1').memory.map(row => row.summary))
      .toEqual(['全公司周五交周报'])
  })

  it('reads memory as empty until distillation exists, rather than inventing it', () => {
    expect(objectFace(ctx, TOPIC).memory).toEqual([])
  })

  /*
    **面板显示的，必须正好是 agent 在这里会读到的。**

    这一栏是「注入了什么」的窗口，不是一份另编的清单。两边各写各的筛选，症状就是实测
    报上来的那一条：切到另一个群，同一条「关于某人」的惯例又跟过来了——它确实会被注入
    （实体/组织轴的坐标是账号，每个会话都读），错的是**面板把它顶在「在这个群里成立」
    那句话下面**。

    所以修的是标题与分节，不是把它藏起来：**藏起来就成了幽灵注入**——一条你看不见、
    却真的在每一轮里对模型生效的惯例。这条用例钉住「不许藏」：面板的三节合起来，必须
    等于三条轴各自读出来的那些。
  */
  it('面板 = 注入的那一份：三轴一条不多、一条不少', async () => {
    mountTree()
    await learned('place', TOPIC.placeKey, '这个群的规矩')
    await learned('place', FAR.placeKey, '别的群的规矩')
    await learned('entity', 'op-1', '操作者本人的习惯')
    await learned('org', 'org-1', '全公司的规矩')

    const face = objectFace(ctx, TOPIC)
    const injected = [
      ...memoriesFor(ctx, 'place', TOPIC.placeKey),
      ...memoriesFor(ctx, 'entity', 'op-1'),
      ...memoriesFor(ctx, 'org', 'org-1'),
    ].map(row => row.summary).sort()
    expect(face.memory.map(row => row.summary).sort()).toEqual(injected)

    // 分节的判据就是轴：只有场所轴那一节才配说「在这个群里成立」。
    expect(face.memory.filter(row => row.axis === 'place').map(row => row.summary))
      .toEqual(['这个群的规矩'])
    expect(face.memory.filter(row => row.axis !== 'place').map(row => row.summary).sort())
      .toEqual(['全公司的规矩', '操作者本人的习惯'])
    // 别的群那条不在这里，而且它被数进了「另有 N 条记在别的场所」。
    expect(face.memoryElsewhere).toBe(1)
  })
})

/**
 * The rail is the claim this column makes: every row says who could hear it.
 * A product that renders a thought and a statement to your colleagues in the
 * same grey bubble has quietly decided they are the same thing.
 */
describe('who could hear this', () => {
  it('marks the agent\'s answer public and the operator\'s typing private', () => {
    const rows = buildStream(
      [said(1, '改一下价格', 1_000), answered(2, '改好了', 2_000)],
      /*
        公要有**证据**。

        这个夹具原本是空的，而空窗口曾经让每一条答案都读成「已发到群里」——这条
        用例当时也就是靠那个漏洞绿的。它想锁的是**轨道分得清谁在说话**，不是
        「凭空判公」，所以现在给 agent 那句一份真实的投递痕迹。
      */
      [message({ own: true, time: 1_500, content: '改好了' })],
      [],
    )
    const rendered = rows.filter(row => row.kind === 'said')
    expect(rendered.map(row => [row.speaker, row.voice]))
      .toEqual([['operator', 'private'], ['agent', 'public']])
  })

  it('does NOT call the agent public in a session that is in no place at all', () => {
    // A local session has no room for anything to be public in, and marking
    // its rows 公 would be a lie about who is listening.
    const rows = buildStream(
      [answered(1, '好了', 2_000)],
      [], [], [], false,
    )
    expect(rows.filter(row => row.kind === 'said')[0]?.voice).toBe('private')
  })

  it('keeps the work block private even though the answer it produced was public', () => {
    const rows = buildStream(
      [toolRan(1, 'yzj_doc_get', 1_100), answered(2, '好了', 2_000)],
      [], [],
    )
    expect(rows.find(row => row.kind === 'work')?.voice).toBe('private')
  })

  it('marks memory steps apart from tool calls inside the block', () => {
    const rows = buildStream(
      [toolRan(1, 'yzj_doc_get', 1_000), toolRan(2, 'memory_note', 1_100)],
      [], [],
    )
    const work = rows.find(row => row.kind === 'work')
    expect(work?.steps.map(step => step.memory)).toEqual([false, true])
  })

  it('renders a slash command as machinery, not as something somebody said', () => {
    const rows = buildStream(
      [{ kind: 'command', seq: 1, name: 'status', time: 1_000 }],
      [], [],
    )
    expect(rows.filter(row => row.kind !== 'divider'))
      .toMatchObject([{ kind: 'sysline', text: '/status' }])
  })

  it('strips the 轻问 marker and flags the row as a projection', () => {
    const rows = buildStream(
      [{
        kind: 'context', seq: 1, time: 1_000,
        content: [{ type: 'text', text: '只读说明\n\n[轻问]\n上周几单' }],
        source: { kind: 'yzj-next', messageId: '', writeMode: 'read-only' },
      }],
      [], [],
    )
    expect(rows.filter(row => row.kind === 'said'))
      .toMatchObject([{ speaker: 'ask', voice: 'private', text: '上周几单' }])
  })
})

describe('artifacts in the stream', () => {
  let ctx: Context
  let graph: YzjGraph

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-artifacts-')) })
    await graph.selectAccount('acct-1')
  })

  async function produce(uri: string, topicKey: string, placeKey: string): Promise<void> {
    await graph.append({
      type: 'lineage/produced',
      data: {
        topicKey, action: '新建文档', toolName: 'yzj_doc_create',
        artifact: { uri, placeKey, title: `文档 ${uri}` },
      },
      actor: { kind: 'agent' },
    })
  }

  it('shows what this topic produced, and only this topic', async () => {
    await produce('yzj://doc/a', TOPIC.topicKey, TOPIC.placeKey)
    await produce('yzj://doc/b', 'other-topic', TOPIC.placeKey)
    expect(artifactsFor(ctx, TOPIC).map(row => row.uri)).toEqual(['yzj://doc/a'])
  })

  it('marks a document written into another place — that is the crossing audit', async () => {
    await produce('yzj://doc/here', TOPIC.topicKey, TOPIC.placeKey)
    await produce('yzj://doc/elsewhere', TOPIC.topicKey, 'yzj-kb-9')
    expect(artifactsFor(ctx, TOPIC).map(row => row.foreign)).toEqual([false, true])
  })

  it('lands on the same time axis as everything else in the column', () => {
    const rows = buildStream(
      [said(1, '建个文档', 1_000)],
      [],
      [],
      [{ uri: 'yzj://doc/a', title: '价格页', action: '新建文档', time: 2_000, foreign: false }],
    )
    expect(rows.filter(row => row.kind !== 'divider').map(row => row.kind))
      .toEqual(['said', 'artifact'])
  })
})

/**
 * 群视图 (§7.3) — the place seen whole.
 *
 * The claim under test: a topic card sits AT the message it grew from. A
 * topic is not a folder somebody filed a conversation into; it is a branch,
 * and this is the only view where the sentence it branched from is still
 * visible next to it.
 */
describe('the place seen whole', () => {
  let ctx: Context
  let graph: YzjGraph

  const ROOT = 'root-1'
  const OTHER: TopicDescriptor = {
    ...TOPIC, topicKey: 'yzj-topic-cold', sessionId: 'session-yzj-topic-cold',
    topicRootId: 'root-cold', label: '上周那件事',
  }

  const topicsFace = (messages: readonly TopicMessage[]): YzjTopics => ({
    topicOf: () => TOPIC,
    tree: () => [{
      place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName },
      topics: [TOPIC, OTHER],
    }],
    messagesFor: async () => Promise.resolve([]),
    messagesInPlace: async () => Promise.resolve(messages),
    sendToPlace: async () => Promise.resolve({}),
      conversations: () => [],
      markRead: () => undefined,
      aliases: () => ['@next'],
    lightAsk: async () => Promise.resolve(''),
  })

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-place-')) })
    graph.defineFamily(taskFamily)
    await graph.selectAccount('acct-1')
  })

  it('marks a topic hot only while something in it still wants attention', async () => {
    await graph.append({
      type: 'task/opened',
      data: {
        taskId: 'tsk-1', what: '改价格页', topicKey: TOPIC.topicKey,
        sourceAnchor: 'yzj:m', audience: [TOPIC.placeKey],
      },
      actor: { kind: 'agent' },
    })
    ctx.provide('yzjTopics', topicsFace([]))
    const view = await placeView(ctx, TOPIC.placeKey, 40)
    const byKey = new Map(view.topics.map(topic => [topic.topicKey, topic]))
    expect(byKey.get(TOPIC.topicKey)?.hot).toBe(true)
    // The other topic has nothing outstanding: a permanent address, not a
    // demand for attention.
    expect(byKey.get(OTHER.topicKey)?.hot).toBe(false)
    expect(byKey.get(OTHER.topicKey)?.badge).toBe('已归档')
  })

  it('cools a topic down once its work is settled', async () => {
    for (const type of ['task/opened', 'task/terminal', 'task/accepted']) {
      await graph.append({
        type,
        data: {
          taskId: 'tsk-1', what: '改价格页', topicKey: TOPIC.topicKey,
          sourceAnchor: 'yzj:m', audience: [TOPIC.placeKey],
          summary: '好了', artifacts: [], acceptedBy: 'op-1',
        },
        actor: { kind: 'agent' },
      })
    }
    ctx.provide('yzjTopics', topicsFace([]))
    const view = await placeView(ctx, TOPIC.placeKey, 40)
    expect(view.topics.every(topic => !topic.hot)).toBe(true)
  })

  it('reports a failed read instead of showing an empty room', async () => {
    ctx.provide('yzjTopics', {
      ...topicsFace([]),
      messagesInPlace: async () => Promise.reject(new Error('yzj-cli timed out')),
    })
    const view = await placeView(ctx, TOPIC.placeKey, 40)
    expect(view.staleReason).toContain('timed out')
    // The topics are still addressable — a lagging message read must not take
    // the archive down with it.
    expect(view.topics).toHaveLength(2)
  })

  it('carries each topic\'s root so the view can place its card at it', async () => {
    ctx.provide('yzjTopics', topicsFace([message({ msgId: ROOT, time: 1_000 })]))
    const view = await placeView(ctx, TOPIC.placeKey, 40)
    expect(view.topics.map(topic => topic.topicRootId)).toEqual([ROOT, 'root-cold'])
  })
})

describe('轻问的答复也是投影', () => {
  it('答复不画成公开回复 —— 它从来没到过群里', () => {
    const rows = buildStream(
      [
        {
          kind: 'context', seq: 1, time: 1_000,
          content: [{ type: 'text', text: '只读说明\n\n[轻问]\n上周几单' }],
          source: { kind: 'yzj-next', messageId: '', writeMode: 'read-only' },
        },
        answered(2, '上周 14 单', 2_000),
      ],
      [], [],
    )
    expect(rows.filter(row => row.kind === 'said').map(row => [row.speaker, row.voice]))
      .toEqual([['ask', 'private'], ['askAnswer', 'private']])
  })

  it('轻问之前的回答仍然是公开回复', () => {
    const rows = buildStream(
      [
        answered(1, '改好了', 1_000),
        {
          kind: 'context', seq: 2, time: 2_000,
          content: [{ type: 'text', text: '[轻问]\n上周几单' }],
          source: { kind: 'yzj-next', messageId: '', writeMode: 'read-only' },
        },
        answered(3, '14 单', 3_000),
      ],
      [], [],
    )
    expect(rows.filter(row => row.kind === 'said').map(row => row.speaker))
      .toEqual(['agent', 'ask', 'askAnswer'])
  })
})

describe('the local-session fallback', () => {
  let ctx: Context
  let graph: YzjGraph

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-locals-')) })
    graph.defineFamily(taskFamily)
    await graph.selectAccount('acct-1')
    ctx.provide('yzjTopics', {
      topicOf: () => TOPIC,
      tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
      messagesFor: async () => Promise.resolve([]),
      messagesInPlace: async () => Promise.resolve([]),
      sendToPlace: async () => Promise.resolve({}),
      conversations: () => [],
      markRead: () => undefined,
      aliases: () => ['@next'],
      lightAsk: async () => Promise.resolve(''),
    })
  })

  it('still names a leased-away topic as a topic', () => {
    // Caught in the browser: the desktop's local list is defined by
    // subtraction, so when the lease removed a settled topic from the visible
    // rows it reappeared under 本地会话 — every finished topic came back, in
    // the wrong group, which is the exact opposite of the lease's purpose.
    const inbox = inboxView(ctx)
    expect(inbox.places[0]?.topics).toEqual([])
    expect(inbox.topicSessionIds).toEqual([TOPIC.sessionId])
  })
})

/**
 * Back 与 Up 分立 (D13②).
 *
 * Back returns to the frame you came from, at the pixel you left it. Up climbs
 * the hierarchy. Conflating them is the bug: scroll deep into a busy group,
 * open one topic, come back, and be at the top with no idea where you were.
 */
describe('navigation remembers where you were', () => {
  beforeEach(() => {
    // Drain any stack a previous case left behind.
    while (backTarget() !== undefined) popFrame()
    setFrame({ kind: 'session' })
  })

  it('returns to the frame it left, at the pixel it left', () => {
    setFrame({ kind: 'place', placeKey: 'yzj-group-g1', groupName: 'dsh-2' })
    pushFrame({ kind: 'session' }, 1_280)
    expect(currentFrame()).toEqual({ kind: 'session' })
    expect(backTarget()).toMatchObject({ kind: 'place', placeKey: 'yzj-group-g1' })

    expect(popFrame()).toBe(1_280)
    expect(currentFrame()).toMatchObject({ kind: 'place', placeKey: 'yzj-group-g1' })
  })

  it('offers no Back when nothing was pushed', () => {
    expect(backTarget()).toBeUndefined()
  })

  it('unwinds one level per pop, not all of them', () => {
    setFrame({ kind: 'place', placeKey: 'p1', groupName: 'A' })
    pushFrame({ kind: 'place', placeKey: 'p2', groupName: 'B' }, 40)
    pushFrame({ kind: 'session' }, 900)
    expect(popFrame()).toBe(900)
    expect(currentFrame()).toMatchObject({ placeKey: 'p2' })
    expect(popFrame()).toBe(40)
    expect(currentFrame()).toMatchObject({ placeKey: 'p1' })
  })
})

/**
 * 会话基座 (v4.8) — 左栏必须是完整的 IM 面.
 *
 * The first-principle is one line: dsh + 云之家 is the ONLY work interface, so
 * a left column that lists agent topics alone sends the operator back to the
 * native client for everything else — the entrance fragmentation this product
 * exists to end. 「谁在找我」和「什么需要我」是两个正交问题，两个段；注意力租约
 * 只管后者。
 */
describe('the conversation base', () => {
  let ctx: Context
  let graph: YzjGraph

  const CONVERSATIONS = [
    // On duty, with work in it: a place row.
    {
      groupId: 'g1', placeKey: 'yzj-group-g1', name: 'dsh-2', type: 2, kind: 'group' as const,
      lastMsgTime: 5_000, preview: '看一下', unread: 2, onDuty: true, selfChat: false,
    },
    // Not on duty: a plain conversation row, and it MUST still be listed.
    {
      groupId: 'g9', placeKey: 'yzj-group-g9', name: '销售部大群', type: 2, kind: 'group' as const,
      lastMsgTime: 9_000, preview: '这个月的口径', unread: 7, onDuty: false, selfChat: false,
    },
    {
      groupId: 'p1-p2', placeKey: 'yzj-dm-p1-p2', name: '李婷', type: 1, kind: 'direct' as const,
      lastMsgTime: 7_000, preview: '周四来不及', unread: 1, onDuty: false, selfChat: false,
    },
    {
      groupId: 'p1-p1', placeKey: 'yzj-dm-p1-p1', name: '我自己', type: 1, kind: 'direct' as const,
      lastMsgTime: 3_000, preview: '审批', unread: 4, onDuty: true, selfChat: true,
    },
    {
      groupId: 'XT-1-XT-2', placeKey: 'yzj-group-XT-1-XT-2', name: '待办通知', type: 3,
      kind: 'assistant' as const,
      lastMsgTime: 8_000, preview: '你有 3 个待办', unread: 40, onDuty: false, selfChat: false,
    },
  ]

  beforeEach(async () => {
    ctx = new Context()
    mountCards(ctx)
    graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-base-')) })
    graph.defineFamily(taskFamily)
    await graph.selectAccount('acct-1')
    ctx.provide('yzjTopics', {
      topicOf: () => TOPIC,
      tree: () => [{ place: { placeKey: TOPIC.placeKey, groupName: TOPIC.groupName }, topics: [TOPIC] }],
      messagesFor: async () => Promise.resolve([]),
      messagesInPlace: async () => Promise.resolve([message()]),
      sendToPlace: async () => Promise.resolve({}),
      conversations: () => CONVERSATIONS,
      markRead: () => undefined,
      aliases: () => ['@next'],
    } as unknown as YzjTopics)
  })

  it('lists every conversation, not the agent-shaped slice of them', () => {
    const view = inboxView(ctx)
    expect(view.conversations.map(row => row.name))
      .toEqual(['dsh-2', '销售部大群', '李婷', '我自己', '待办通知'])
    // The place tree still holds only where work happened — the two lists
    // answer two different questions and neither replaces the other.
    expect(view.places.map(place => place.groupName)).toEqual(['dsh-2'])
  })

  it('says which conversations the agent answers in, because the row shape follows it', () => {
    const byName = new Map(inboxView(ctx).conversations.map(row => [row.name, row]))
    expect(byName.get('dsh-2')?.onDuty).toBe(true)
    expect(byName.get('销售部大群')?.onDuty).toBe(false)
  })

  it('opens a conversation the agent has never worked in, by name and with its messages', async () => {
    // Before this, every place outside the allow-list opened as a view titled
    // `yzj-group-<hash>` with nothing in it: the tree only knows places where
    // work happened, and the tree was the only source of a name.
    const view = await placeView(ctx, 'yzj-group-g9', 20)
    expect(view.groupName).toBe('销售部大群')
    expect(view.onDuty).toBe(false)
    expect(view.messages).toHaveLength(1)
    // …and it still knows where the agent IS on duty.
    expect((await placeView(ctx, 'yzj-group-g1', 20)).onDuty).toBe(true)
  })
})

/**
 * 群里来的文本不能变成一个活的 href（对抗性评审 2026-08-20）.
 *
 * `parentGoalRef` is writable from a served group: `/link <anything>` takes
 * the raw message text. The board turned that stored string into an `href`,
 * and a `javascript:` URL runs in the document that holds the loopback RPC
 * channel — the one this file's own header calls "as privileged as the
 * desktop itself".
 */
describe('a goal reference is a link only when it provably is one', () => {
  it('refuses every scheme a browser would execute', () => {
    for (const hostile of [
      'javascript:fetch("/yzj-next-surface")',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '不是链接，是一句话',
      '',
    ]) {
      expect(safeHref(hostile)).toBeUndefined()
    }
  })

  it('keeps the real ones', () => {
    expect(safeHref('https://www.yunzhijia.com/doc/goal-1'))
      .toBe('https://www.yunzhijia.com/doc/goal-1')
    expect(safeHref('http://intranet/goal')).toBe('http://intranet/goal')
  })
})

describe('附件消息的正文就是占位符', () => {
  it('recognises the placeholder Yunzhijia sends with a file', () => {
    // 真实报文：content 是 `[文件]:r29-summary.md`，param.name 是同一个名字。
    expect(isPlaceholderOnly('[文件]:r29-summary.md', 'r29-summary.md')).toBe(true)
    expect(isPlaceholderOnly('[文件]：r29-summary.md', 'r29-summary.md')).toBe(true)
    expect(isPlaceholderOnly('[图片]', undefined)).toBe(true)
    /*
      占位符**不止中文那一个**：同一个租户里实测到 `[图片]`/`[Image]`/`[Images]`，
      取决于发送方客户端的语言。只认中文那个的后果，是屏幕上出现一条内容为
      「[Images]」的消息，紧接着下面才是那张图——占位符和它要占位的东西并排站着。
    */
    expect(isPlaceholderOnly('[Image]', undefined)).toBe(true)
    expect(isPlaceholderOnly('[Images]', undefined)).toBe(true)
    expect(isPlaceholderOnly('   ', undefined)).toBe(true)
  })

  it('never eats a sentence somebody actually wrote', () => {
    // 有人正经写了一句带方括号的话,不能因为长得像占位符就吞掉。
    expect(isPlaceholderOnly('[文件]:计划 你看下这个', 'r29-summary.md')).toBe(false)
    expect(isPlaceholderOnly('这个文件叫 r29-summary.md，注意版本', 'r29-summary.md')).toBe(false)
    expect(isPlaceholderOnly('[文件]:别的名字.md', 'r29-summary.md')).toBe(false)
  })
})

describe('「已发到群里」得有证据（实测缺陷）', () => {
  const answer = '单国鑫发的 yapi_export.zip（约 452KB）不是安装包，是接口文档包。'
  const nodes = [answered(9, answer, 5_000)]
  const voiceOf = (rows: ReturnType<typeof buildStream>): string | undefined => {
    const row = rows.find(entry => entry.kind === 'said')
    return row?.kind === 'said' ? row.voice : undefined
  }

  it('says public when the answer really went out', () => {
    // 投递文本以答案正文开头,后面才是摘要与验收行。
    expect(voiceOf(buildStream(nodes, [message({
      own: true,
      time: 6_000,
      content: `${answer}\n\n回复「验收」或「打回 <原因>」定终态。[card#task:t1]`,
    })], [], [], true))).toBe('public')
  })

  it('says private when the window covers it and it is not there', () => {
    /*
      现场：任务被 502 判死,操作者私语「继续完成」,agent 干完了活——
      一个字都没发出去,而这一列写着「已发到 X · 群内所有人可见」。
    */
    expect(voiceOf(buildStream(nodes, [message({
      own: false, time: 1_000, content: '别人说的话',
    })], [], [], true))).toBe('private')
  })

  it('keeps the old assumption for anything older than the window', () => {
    // 窗口看不到那么早——不知道就别改口,也别提供「发到群里」再发一遍。
    expect(voiceOf(buildStream(nodes, [message({
      own: false, time: 9_000, content: '晚得多的一条',
    })], [], [], true))).toBe('public')
  })

  it('never claims delivery in a local session', () => {
    expect(voiceOf(buildStream(nodes, [], [], [], false))).toBe('private')
  })

  /*
    **空窗口不是「很久以前」**（真装配里抓到的）。

    「比窗口更早就维持旧假定」这一条，在一条消息都没读到时会套到**全部**答案头上——
    包括刚刚生成的那一条。现场：在一个群话题里按下 ⚡ 拆解，agent 私下答了一句，
    这一列写着「已发到 dsh-2 · 群内所有人可见」，而那句话在群里根本不存在。

    两个方向的谎都要看代价：说成公的，人以为同事看见了（没有），而且**「↗ 发到群里」
    那颗键只长在私的行上**——于是那句话再也送不出去，是一条死路。说成私的，最坏是
    多发一遍，而那一下是人自己按的。何况这里根本没有证据：一条消息都没读到的时候，
    「群里所有人可见」是一句关于房间的断言，而我们对这个房间一无所知。
  */
  it('claims nothing when the window holds no messages at all', () => {
    expect(voiceOf(buildStream(nodes, [], [], [], true))).toBe('private')
  })
})


/**
 * 夹在句子中间的图片占位符。
 *
 * `isPlaceholderOnly` 管的是「整条就是一个占位符」；这里管的是另一半：
 * 「梳理的一版术语 FYI\n[图片]」——整条不等于占位符，于是那四个字原样印在屏幕上，
 * 而它要占位的那张图就画在下面一行。
 */
describe('正文里的图片占位符', () => {
  it('这条消息真的带着图时，才抹掉占位符', () => {
    expect(withoutImageMarks('梳理的一版术语 FYI\n[图片]', true)).toBe('梳理的一版术语 FYI')
    expect(withoutImageMarks('最小化后有个全局浮层。 [图片][图片]', true))
      .toBe('最小化后有个全局浮层。')
    expect(withoutImageMarks('[Images]', true)).toBe('')
  })

  it('没有图的时候一个字都不动 —— 那是有人在说话', () => {
    /*
      这是这里唯一的安全绳。占位符是平台写给「画不出图的客户端」看的描述，我们画得出，
      所以它是重复；但只有当这条消息**确实带着图**，这句话才成立。
    */
    expect(withoutImageMarks('这个 [图片] 标记是什么意思？', false))
      .toBe('这个 [图片] 标记是什么意思？')
    expect(withoutImageMarks('[图片]', false)).toBe('[图片]')
  })

  it('抹完只剩空行的，交给整条占位符那条路', () => {
    expect(isPlaceholderOnly(withoutImageMarks('[图片]\n[图片]', true), undefined)).toBe(true)
  })
})
