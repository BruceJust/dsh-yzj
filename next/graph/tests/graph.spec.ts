/**
 * Graph kernel specs. The cases that matter here are the data laws, not the
 * plumbing: tombstone folding (correction is an append), the audience × viewer
 * bridge (who can see this), idempotency-anchor collapse, lenient decoding of
 * a log written by a newer build, and the snapshot/tail-replay round trip.
 */

import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '../src/service.ts'
import type { GraphEvent, GraphFamily, GraphViewer } from '../src/types.ts'

const OPERATOR: GraphViewer = { kind: 'operator', openId: 'op-1' }
const PLACE_A: GraphViewer = { kind: 'place', placeKey: 'group-a' }
const PLACE_B: GraphViewer = { kind: 'place', placeKey: 'group-b' }
const ACTOR = { kind: 'operator', openId: 'op-1' } as const

/** A stand-in object family with an audience, an anchor, and a status. */
const noteFamily: GraphFamily = {
  kind: 'note',
  events: {
    'note/opened': {
      schema: z.object({
        noteId: z.string(),
        text: z.string(),
        status: z.literal('open').default('open'),
        audience: z.array(z.string()).optional(),
        idemKey: z.string().optional(),
      }),
    },
    'note/closed': {
      schema: z.object({ noteId: z.string(), status: z.literal('closed').default('closed') }),
    },
  },
  pendingStatuses: ['open'],
  objectIdOf: (_type, data) => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
    const id = (data as Record<string, unknown>).noteId
    return typeof id === 'string' ? id : undefined
  },
}

let root: string

async function openGraph(accountKey = 'acct-1'): Promise<YzjGraph> {
  const graph = new YzjGraph(new Context(), { root })
  graph.defineFamily(noteFamily)
  await graph.selectAccount(accountKey)
  return graph
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yzj-next-graph-'))
})

describe('append and materialize', () => {
  it('folds events into objects and rejects an unregistered type', async () => {
    const graph = await openGraph()
    await graph.append({ type: 'note/opened', data: { noteId: 'n1', text: 'hello' }, actor: ACTOR })

    const [object] = graph.query(OPERATOR, { kind: 'note' })
    expect(object?.id).toBe('n1')
    expect(object?.state).toMatchObject({ text: 'hello', status: 'open' })

    await expect(graph.append({ type: 'note/vanished', data: {}, actor: ACTOR }))
      .rejects.toThrow(/unknown graph event type/)
  })

  it('validates against the family schema before anything is written', async () => {
    const graph = await openGraph()
    await expect(graph.append({ type: 'note/opened', data: { noteId: 'n1' }, actor: ACTOR }))
      .rejects.toThrow()
    const log = join(root, 'acct-1', 'graph.jsonl')
    await expect(readFile(log, 'utf8')).rejects.toThrow()
  })

  it('emits yzj-graph/appended after the line is durable', async () => {
    const ctx = new Context()
    const graph = new YzjGraph(ctx, { root })
    graph.defineFamily(noteFamily)
    await graph.selectAccount('acct-1')
    const seen: GraphEvent[] = []
    ctx.on('yzj-graph/appended', (event) => { seen.push(event) })

    await graph.append({ type: 'note/opened', data: { noteId: 'n1', text: 'x' }, actor: ACTOR })
    const line = await readFile(join(root, 'acct-1', 'graph.jsonl'), 'utf8')

    expect(seen).toHaveLength(1)
    expect(seen[0]?.seq).toBe(1)
    expect(line.trim().split('\n')).toHaveLength(1)
  })

  it('assigns strictly increasing sequences under concurrent appends', async () => {
    const graph = await openGraph()
    await Promise.all(Array.from({ length: 12 }, (_value, index) => graph.append({
      type: 'note/opened', data: { noteId: `n${String(index)}`, text: 't' }, actor: ACTOR,
    })))
    const events = graph.events(OPERATOR, { types: ['note/opened'] })
    expect(events.map(event => event.seq)).toEqual(Array.from({ length: 12 }, (_v, i) => i + 1))
  })
})

describe('tombstone (更正即追加律)', () => {
  it('masks the target event on the read projection without rewriting history', async () => {
    const graph = await openGraph()
    await graph.append({ type: 'note/opened', data: { noteId: 'n1', text: 'first' }, actor: ACTOR })
    const wrong = await graph.append({
      type: 'note/opened', data: { noteId: 'n2', text: 'mistake' }, actor: ACTOR,
    })
    await graph.append({
      type: 'tombstone/appended',
      data: { targetSeq: wrong.seq, reason: 'wrong place', by: 'op-1' },
      actor: ACTOR,
    })

    expect(graph.query(OPERATOR, { kind: 'note' }).map(object => object.id)).toEqual(['n1'])
    // The line itself is still on disk: the projection folds, the log never shrinks.
    const raw = await readFile(join(root, 'acct-1', 'graph.jsonl'), 'utf8')
    expect(raw).toContain('mistake')
  })

  it('re-folds a tombstone that lands on an already-snapshotted event after a restart', async () => {
    const first = await openGraph()
    const wrong = await first.append({
      type: 'note/opened', data: { noteId: 'n1', text: 'mistake' }, actor: ACTOR,
    })
    await first.flush()

    const second = await openGraph()
    expect(second.query(OPERATOR, { kind: 'note' })).toHaveLength(1)
    await second.append({
      type: 'tombstone/appended',
      data: { targetSeq: wrong.seq, reason: 'retracted', by: 'op-1' },
      actor: ACTOR,
    })
    await second.flush()

    const third = await openGraph()
    expect(third.query(OPERATOR, { kind: 'note' })).toEqual([])
  })
})

describe('audience × viewer bridge', () => {
  it('shows a place only what was spoken into it, and the operator everything', async () => {
    const graph = await openGraph()
    await graph.append({
      type: 'note/opened',
      data: { noteId: 'in-a', text: 'a', audience: ['group-a'] },
      actor: ACTOR,
    })
    await graph.append({ type: 'note/opened', data: { noteId: 'private', text: 'p' }, actor: ACTOR })

    expect(graph.query(PLACE_A, { kind: 'note' }).map(object => object.id)).toEqual(['in-a'])
    expect(graph.query(PLACE_B, { kind: 'note' })).toEqual([])
    expect(graph.query(OPERATOR, { kind: 'note' }).map(object => object.id).sort())
      .toEqual(['in-a', 'private'])
  })

  it('keeps the audience declared at open time across later state events', async () => {
    const graph = await openGraph()
    await graph.append({
      type: 'note/opened', data: { noteId: 'n1', text: 'a', audience: ['group-a'] }, actor: ACTOR,
    })
    await graph.append({ type: 'note/closed', data: { noteId: 'n1' }, actor: ACTOR })
    expect(graph.query(PLACE_A, { kind: 'note' })[0]?.state).toMatchObject({ status: 'closed' })
  })

  it('runs every read through the read-domain hook', async () => {
    const graph = await openGraph()
    graph.onRead({ objects: objects => objects.filter(object => object.id !== 'secret') })
    await graph.append({ type: 'note/opened', data: { noteId: 'secret', text: 's' }, actor: ACTOR })
    await graph.append({ type: 'note/opened', data: { noteId: 'plain', text: 'p' }, actor: ACTOR })
    expect(graph.query(OPERATOR, { kind: 'note' }).map(object => object.id)).toEqual(['plain'])
  })
})

describe('idempotency anchor (幂等锚律)', () => {
  it('collapses a second registration under the same anchor onto one object', async () => {
    const graph = await openGraph()
    await graph.append({
      type: 'note/opened', data: { noteId: 'n1', text: 'one', idemKey: 'anchor-1' }, actor: ACTOR,
    })
    expect(graph.findByIdemKey('anchor-1')?.id).toBe('n1')
    expect(graph.findByIdemKey('anchor-2')).toBeUndefined()
  })
})

describe('pending answerables and kernel derivations', () => {
  it('lists objects whose family declares them still waiting', async () => {
    const graph = await openGraph()
    await graph.append({ type: 'note/opened', data: { noteId: 'n1', text: 'a' }, actor: ACTOR })
    await graph.append({ type: 'note/opened', data: { noteId: 'n2', text: 'b' }, actor: ACTOR })
    await graph.append({ type: 'note/closed', data: { noteId: 'n2' }, actor: ACTOR })
    expect(graph.pendingAnswerables(OPERATOR).map(object => object.id)).toEqual(['n1'])
  })

  it('resolves the org default contract and then a written one', async () => {
    const graph = await openGraph()
    expect(graph.contractFor('group-a')).toMatchObject({ version: 0, memoryPolicy: 'normal' })
    await graph.append({
      type: 'contract/updated',
      data: {
        placeKey: 'group-a',
        version: 3,
        oaRequiredCategories: ['expense'],
        memoryPolicy: 'never',
        processSummary: false,
      },
      actor: ACTOR,
    })
    expect(graph.contractFor('group-a')).toMatchObject({
      version: 3, memoryPolicy: 'never', processSummary: false, oaRequiredCategories: ['expense'],
    })
    expect(graph.contractFor('group-b').version).toBe(0)
  })

  /**
   * 场所的**出生故事** (设计 v4.18)：合同族此前只回答「合同是什么」，不回答「怎么出生」。
   *
   * 两件事一起锁：出生记录**留得住**（回头审计要靠它说清这个群为什么存在、出生那一刻
   * 有没有把 agent 一并接进来），以及它**一个合同字段都不动**——加一条血缘不该顺手改掉
   * 这个场所的记忆策略。
   */
  it('记得下一个场所是怎么出生的，而且不顺手改掉它的合同', async () => {
    const graph = await openGraph()
    const before = graph.contractFor('group-new')
    await graph.append({
      type: 'contract/updated',
      data: {
        placeKey: 'group-new',
        // 组织默认那份是 version 0（还没写过合同），而 schema 要 ≥1——所以是 +1，不是原样抄。
        version: before.version + 1,
        oaRequiredCategories: [...before.oaRequiredCategories],
        memoryPolicy: before.memoryPolicy,
        processSummary: before.processSummary,
        birth: {
          sourceAnchor: 'portal:goal:https://y/doc/9',
          inheritedGoalRef: 'https://y/doc/9',
          servedAtBirth: true,
        },
      },
      actor: ACTOR,
    })
    // 原样回写：一个字段的语义都没动。
    expect(graph.contractFor('group-new')).toMatchObject({
      version: before.version + 1,
      memoryPolicy: before.memoryPolicy,
      processSummary: before.processSummary,
    })
    const birth = [...graph.rawEvents(['contract/updated'])]
      .map(event => (event.data as { placeKey?: string; birth?: Record<string, unknown> }))
      .find(data => data.placeKey === 'group-new')?.birth
    expect(birth?.sourceAnchor).toBe('portal:goal:https://y/doc/9')
    expect(birth?.inheritedGoalRef).toBe('https://y/doc/9')
    expect(birth?.servedAtBirth).toBe(true)
  })

  /**
   * 没说勾没勾，就是**没勾** —— 合同默认最严。
   *
   * 这个默认值不是排版：它的读者是三个月后翻审计的人，而「不知道」和「没接入」在那一刻
   * 是两个完全不同的结论。
   */
  it('出生时没说接入，默认就是没接入', async () => {
    const graph = await openGraph()
    await graph.append({
      type: 'contract/updated',
      data: {
        placeKey: 'group-quiet',
        version: 1,
        oaRequiredCategories: [],
        memoryPolicy: 'normal',
        processSummary: false,
        birth: { sourceAnchor: 'portal:event:ev-1' },
      },
      actor: ACTOR,
    })
    const birth = [...graph.rawEvents(['contract/updated'])]
      .map(event => (event.data as { placeKey?: string; birth?: Record<string, unknown> }))
      .find(data => data.placeKey === 'group-quiet')?.birth
    expect(birth?.servedAtBirth).toBe(false)
  })

  it('answers revocation live rather than from a turn snapshot', async () => {
    const graph = await openGraph()
    expect(graph.isRevoked('msg-1')).toBe(false)
    await graph.append({
      type: 'authority/revoked', data: { messageId: 'msg-1', reason: 'timeout' }, actor: ACTOR,
    })
    expect(graph.isRevoked('msg-1')).toBe(true)
  })

  it('resolves a topic handle from its registration and later generation bump', async () => {
    const graph = await openGraph()
    await graph.append({
      type: 'topic/registered',
      data: {
        topicKey: 't1', placeKey: 'group-a', conversationKind: 'group',
        generation: 1, label: '价格页',
      },
      actor: ACTOR,
    })
    await graph.append({
      type: 'topic/generation-advanced', data: { topicKey: 't1', generation: 2 }, actor: ACTOR,
    })
    expect(graph.topicHandle('t1')).toMatchObject({ generation: 2, placeKey: 'group-a' })
    expect(graph.topicHandle('missing')).toBeUndefined()
  })
})

describe('durability and lenient decoding', () => {
  it('replays the log across a restart', async () => {
    const first = await openGraph()
    await first.append({ type: 'note/opened', data: { noteId: 'n1', text: 'kept' }, actor: ACTOR })

    const second = await openGraph()
    expect(second.query(OPERATOR, { kind: 'note' })[0]?.state).toMatchObject({ text: 'kept' })
    // The sequence continues rather than colliding with the replayed prefix.
    const appended = await second.append({
      type: 'note/opened', data: { noteId: 'n2', text: 'new' }, actor: ACTOR,
    })
    expect(appended.seq).toBe(2)
  })

  it('retains an event type this build does not know instead of dropping the line', async () => {
    const graph = await openGraph()
    await graph.append({ type: 'note/opened', data: { noteId: 'n1', text: 'a' }, actor: ACTOR })
    await graph.flush()
    // A newer build wrote a family this one has never heard of.
    await appendFile(join(root, 'acct-1', 'graph.jsonl'), `${JSON.stringify({
      v: 1, sv: 4, seq: 2, time: Date.now(), type: 'verdict/opened',
      data: { verdictId: 'v1' }, actor: ACTOR,
    })}\n`, 'utf8')

    const reopened = await openGraph()
    expect(reopened.query(OPERATOR, {})).toHaveLength(1)
    // Retained on the log — a downgrade must not silently delete the future.
    expect(reopened.events(OPERATOR, { types: ['verdict/opened'] })).toHaveLength(1)
    // …and the next sequence still clears the unknown line.
    const next = await reopened.append({
      type: 'note/opened', data: { noteId: 'n2', text: 'b' }, actor: ACTOR,
    })
    expect(next.seq).toBe(3)
  })

  it('skips an unreadable line without losing the readable ones', async () => {
    const graph = await openGraph()
    await graph.append({ type: 'note/opened', data: { noteId: 'n1', text: 'a' }, actor: ACTOR })
    await appendFile(join(root, 'acct-1', 'graph.jsonl'), 'not json at all\n', 'utf8')
    const reopened = await openGraph()
    expect(reopened.query(OPERATOR, { kind: 'note' })).toHaveLength(1)
  })

  it('ignores a corrupt snapshot and rebuilds from the log', async () => {
    const graph = await openGraph()
    await graph.append({ type: 'note/opened', data: { noteId: 'n1', text: 'a' }, actor: ACTOR })
    await graph.flush()
    await writeFile(join(root, 'acct-1', 'snapshot.json'), '{ broken', 'utf8')
    const reopened = await openGraph()
    expect(reopened.query(OPERATOR, { kind: 'note' })).toHaveLength(1)
  })

  it('refuses to switch accounts once a partition is open', async () => {
    const graph = await openGraph('acct-1')
    await expect(graph.selectAccount('acct-2')).rejects.toThrow(/account changed/)
  })

  it('rejects an append before any partition is selected', async () => {
    const graph = new YzjGraph(new Context(), { root })
    graph.defineFamily(noteFamily)
    await expect(graph.append({
      type: 'note/opened', data: { noteId: 'n1', text: 'a' }, actor: ACTOR,
    })).rejects.toThrow(/no account partition/)
  })
})

describe('family registration', () => {
  it('refuses a duplicate kind or a type another family already owns', async () => {
    const graph = await openGraph()
    expect(() => graph.defineFamily(noteFamily)).toThrow(/already registered/)
    expect(() => graph.defineFamily({ ...noteFamily, kind: 'other' })).toThrow(/already owned/)
  })

  it('lets a family registered after load see its own history', async () => {
    const first = await openGraph()
    await first.append({ type: 'note/opened', data: { noteId: 'n1', text: 'a' }, actor: ACTOR })

    const late = new YzjGraph(new Context(), { root })
    await late.selectAccount('acct-1')
    expect(late.query(OPERATOR, { kind: 'note' })).toEqual([])
    late.defineFamily(noteFamily)
    expect(late.query(OPERATOR, { kind: 'note' })).toHaveLength(1)
  })
})
