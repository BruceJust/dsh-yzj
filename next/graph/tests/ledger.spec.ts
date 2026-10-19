/**
 * 账的内核（技术方案-下一代ERP账本 §13.1 / §13.2 / §13.6）。这里锁的是证据的性质，
 * 不是管道：日志被改过能被发现、旧日志一行不丢、断了也照样能写、两个校验器给同一个
 * 答案。编号对应 §13.7 的验收测试。
 */

import { createHash } from 'node:crypto'
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalJson } from '../src/json.ts'
import {
  GENESIS_PREV, atomOf, auditLedger, eventHash, orphanReleases, verifyChain,
} from '../src/ledger.ts'
import { decodeEvent, parseLog } from '../src/log.ts'
import { YzjGraph } from '../src/service.ts'
import type { GraphEvent, GraphFamily, GraphViewer } from '../src/types.ts'

const OPERATOR: GraphViewer = { kind: 'operator', openId: 'op-1' }
const ACTOR = { kind: 'operator', openId: 'op-1' } as const

const noteFamily: GraphFamily = {
  kind: 'note',
  events: {
    'note/opened': { schema: z.object({ noteId: z.string(), text: z.string() }) },
  },
  objectIdOf: (_type, data) => (data as { noteId?: string }).noteId,
}

let root: string
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const logPath = (account = 'acct-1'): string => join(root, account, 'graph.jsonl')
const lines = async (account = 'acct-1'): Promise<Record<string, unknown>[]> => (
  (await readFile(logPath(account), 'utf8')).split('\n').filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
)

async function openGraph(account = 'acct-1', ctx = new Context()): Promise<YzjGraph> {
  const graph = new YzjGraph(ctx, { root })
  graph.defineFamily(noteFamily)
  await graph.selectAccount(account)
  return graph
}

const note = (graph: YzjGraph, id: string, text = 't'): Promise<GraphEvent> => (
  graph.append({ type: 'note/opened', data: { noteId: id, text }, actor: ACTOR })
)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yzj-next-ledger-'))
})

afterEach(() => { vi.restoreAllMocks() })

describe('行哈希', () => {
  // #2 —— 期望值在 Python 里从规范形状独立算出（键排序、紧凑分隔、UTF-8），没用本仓库的代码。
  it('固定事件 → 固定 hash', () => {
    const event = {
      v: 2 as const, sv: 1, seq: 7, time: 1_760_500_000_000, type: 'action/released',
      data: {
        sessionId: 's-1', callId: 'c-1', toolName: 'yzj_doc_create', title: '季度复盘',
        authority: { kind: 'lease', leaseId: 'lse-1', grantedBy: 'op-1' },
      },
      actor: { kind: 'agent' as const },
      prev: GENESIS_PREV,
    }
    expect(eventHash(event)).toBe('4442bb57c6ca9a652593d38fcdfbe46420b437f6339dee48245ca6f2ccb54aaf')
  })

  it('规范 JSON：键按码元排序，undefined 的键丢弃，与键序无关', () => {
    expect(canonicalJson({ b: 1, a: [1, undefined, 'x'], c: undefined })).toBe('{"a":[1,null,"x"],"b":1}')
    expect(canonicalJson({ y: { q: 1, p: 2 }, x: 0 })).toBe(canonicalJson({ x: 0, y: { p: 2, q: 1 } }))
  })
})

describe('读兼容与起点', () => {
  // #3
  it('只有 v1 行的分区：v1 照常解码、v 仍是 1；第一次追加先写起点，封存那一段 v1', async () => {
    await mkdir(join(root, 'acct-1'), { recursive: true })
    const v1 = [
      { v: 1, sv: 1, seq: 1, time: 1, type: 'note/opened', data: { noteId: 'old-1', text: 'a' }, actor: ACTOR },
      { v: 1, sv: 1, seq: 2, time: 2, type: 'note/opened', data: { noteId: 'old-2', text: 'b' }, actor: ACTOR },
    ].map(line => `${JSON.stringify(line)}\n`).join('')
    await writeFile(logPath(), v1, 'utf8')

    const graph = await openGraph()
    expect(graph.query(OPERATOR, { kind: 'note' })).toHaveLength(2)
    expect(graph.events(OPERATOR, { types: ['note/opened'] }).map(event => event.v)).toEqual([1, 1])
    expect(graph.integrity()).toEqual({ verifiedThrough: 0, orphanActions: 0 })

    const appended = await note(graph, 'new-1')
    const [genesis] = (await lines()).filter(line => line.type === 'ledger/genesis')
    expect(genesis).toMatchObject({
      v: 2, seq: 3, actor: { kind: 'system' }, prev: GENESIS_PREV,
      data: { v1Through: 2, v1Digest: sha256(v1) },
    })
    expect(appended).toMatchObject({ v: 2, seq: 4, prev: genesis?.hash })
    expect(graph.integrity()).toEqual({ genesisSeq: 3, verifiedThrough: 4, orphanActions: 0 })

    // 重载之后旧行仍是 v1、链从起点起校验通过。
    const reopened = await openGraph()
    expect(reopened.events(OPERATOR, { types: ['note/opened'] }).map(event => event.v)).toEqual([1, 1, 2])
    expect(reopened.integrity()).toEqual({ genesisSeq: 3, verifiedThrough: 4, orphanActions: 0 })
  })

  it('空分区的起点：v1Through = 0，v1Digest 是空串的 sha256', async () => {
    const graph = await openGraph()
    await note(graph, 'n1')
    const [genesis] = await lines()
    expect(genesis).toMatchObject({ type: 'ledger/genesis', seq: 1, data: { v1Through: 0, v1Digest: sha256('') } })
  })

  it('起点只有内核能写', async () => {
    const graph = await openGraph()
    await expect(graph.append({
      type: 'ledger/genesis', data: { v1Through: 0, v1Digest: sha256('') }, actor: { kind: 'system' },
    })).rejects.toThrow(/kernel alone/)
  })

  it('v2 行缺 prev 或 hash 就是损坏行；v1 行不需要它们', () => {
    const base = { sv: 1, seq: 1, time: 1, type: 'note/opened', data: {}, actor: ACTOR }
    expect(decodeEvent(JSON.stringify({ ...base, v: 2, prev: GENESIS_PREV }))).toBeUndefined()
    expect(decodeEvent(JSON.stringify({ ...base, v: 2, hash: GENESIS_PREV }))).toBeUndefined()
    expect(decodeEvent(JSON.stringify({ ...base, v: 1 }))?.v).toBe(1)
    expect(decodeEvent(JSON.stringify({ ...base, v: 3, prev: '', hash: '' }))).toBeUndefined()
  })
})

describe('断链能被发现，而且断了照样能写', () => {
  // #4
  it('改动一行 v2 的一个字符：断点报在那一行，加载不抛错，新行接在最后一行存着的 hash 上', async () => {
    const graph = await openGraph()
    await note(graph, 'n1', 'alpha')
    await note(graph, 'n2', 'bravo')
    await note(graph, 'n3', 'charlie')
    const raw = await readFile(logPath(), 'utf8')
    expect(raw).toContain('"bravo"')
    await writeFile(logPath(), raw.replace('"bravo"', '"bravO"'), 'utf8')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const reopened = await openGraph()
    expect(reopened.integrity()).toEqual({ genesisSeq: 1, breakAt: 3, verifiedThrough: 2, orphanActions: 0 })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('breaks at seq 3'))

    const after = await note(reopened, 'n4')
    const stored = (await lines()).find(line => line.seq === 4)
    expect(after.prev).toBe(stored?.hash)
    // 断点冻结：之后的追加不让它前进，也不让它消失。
    expect(reopened.integrity()).toEqual({ genesisSeq: 1, breakAt: 3, verifiedThrough: 2, orphanActions: 0 })
    expect((await openGraph()).integrity().breakAt).toBe(3)
  })

  // #19
  it('起点之后插一行 v1：断点就是那一行的 seq', async () => {
    const graph = await openGraph()
    await note(graph, 'n1')
    await appendFile(logPath(), `${JSON.stringify({
      v: 1, sv: 1, seq: 3, time: Date.now(), type: 'note/opened', data: { noteId: 'forged', text: 'x' }, actor: ACTOR,
    })}\n`, 'utf8')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await openGraph()).integrity()).toMatchObject({ breakAt: 3, verifiedThrough: 2 })
  })

  // #5，以及 seq 空洞里插进去的伪造 v1 行也逃不掉。
  it('写盘失败消耗一个 seq：之后照常成链，空洞不算断链；可空洞里插一行 v1 就是断链', async () => {
    await mkdir(join(root, 'acct-1'), { recursive: true })
    await writeFile(logPath(), `${JSON.stringify({
      v: 1, sv: 1, seq: 1, time: 1, type: 'note/opened', data: { noteId: 'old', text: 'a' }, actor: ACTOR,
    })}\n`, 'utf8')
    const graph = await openGraph()
    await chmod(logPath(), 0o444)
    await expect(note(graph, 'lost')).rejects.toThrow()
    await chmod(logPath(), 0o644)
    const kept = await note(graph, 'kept')

    // 起点那一次写失败吃掉了 seq 2；重试时起点落在 3，仍然只封存到 v1 的最后一行。
    const written = await lines()
    expect(written.map(line => line.seq)).toEqual([1, 3, 4])
    expect(written[1]).toMatchObject({ type: 'ledger/genesis', data: { v1Through: 1 } })
    expect(kept.seq).toBe(4)
    const reopened = await openGraph()
    expect(reopened.integrity()).toEqual({ genesisSeq: 3, verifiedThrough: 4, orphanActions: 0 })

    await appendFile(logPath(), `${JSON.stringify({
      v: 1, sv: 1, seq: 2, time: 2, type: 'note/opened', data: { noteId: 'forged', text: 'x' }, actor: ACTOR,
    })}\n`, 'utf8')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await openGraph()).integrity()).toMatchObject({ breakAt: 2, verifiedThrough: 0 })
  })

  it('第二个起点、或起点不在链首，都是断链', () => {
    const chain: GraphEvent[] = []
    const push = (type: string, data: Record<string, unknown>): void => {
      const unsigned = {
        v: 2 as const, sv: 1, seq: chain.length + 1, time: 1, type, data: data as never,
        actor: { kind: 'system' as const }, prev: chain.at(-1)?.hash ?? GENESIS_PREV,
      }
      chain.push({ ...unsigned, hash: eventHash(unsigned) })
    }
    push('note/opened', { noteId: 'n1', text: 'a' })
    expect(verifyChain(chain)).toMatchObject({ breakAt: 1, verifiedThrough: 0 })
    chain.length = 0
    push('ledger/genesis', { v1Through: 0, v1Digest: sha256('') })
    push('ledger/genesis', { v1Through: 0, v1Digest: sha256('') })
    expect(verifyChain(chain)).toMatchObject({ genesisSeq: 1, breakAt: 2, verifiedThrough: 1 })
  })

  it('校验函数绝不向外抛错', () => {
    const hostile = [{ v: 2, seq: 1, type: 'ledger/genesis', get data(): never { throw new Error('boom') } }]
    expect(verifyChain(hostile as never)).toMatchObject({ breakAt: 1 })
  })
})

describe('落盘的那一行就是事实', () => {
  // #20
  it('快照写失败时 append 仍然 resolve，那一行在盘上，链尾已推进', async () => {
    await mkdir(join(root, 'acct-1', 'snapshot.json'), { recursive: true })
    const graph = await openGraph()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // 起点 + 199 行 = 第 200 次写，触发快照；snapshot.json 是个目录，rename 一定失败。
    for (let index = 0; index < 199; index += 1) await note(graph, `n${String(index)}`)
    expect(error).toHaveBeenCalledWith('[yzj-next-graph] failed to refresh the snapshot', expect.anything())
    const next = await note(graph, 'after')
    const written = await lines()
    expect(written).toHaveLength(201)
    expect(next.prev).toBe(written[199]?.hash)
    expect(graph.integrity()).toEqual({ genesisSeq: 1, verifiedThrough: 201, orphanActions: 0 })
  })

  it('文件尾停在半行上（上次崩在写一半）：新行不会和它粘成一行损坏行', async () => {
    const graph = await openGraph()
    await note(graph, 'n1')
    await appendFile(logPath(), '{"v":2,"sv":1,"seq":3,"ti', 'utf8')
    const reopened = await openGraph()
    await note(reopened, 'n2')
    const { events, damagedLines } = parseLog(await readFile(logPath(), 'utf8'))
    expect(damagedLines).toBe(1)
    expect(events.filter(event => event.type === 'note/opened')).toHaveLength(2)
    expect((await openGraph()).integrity()).toEqual({ genesisSeq: 1, verifiedThrough: 3, orphanActions: 0 })
  })

  // #15
  it('删掉快照全量重放：对象与带快照加载逐字一致', async () => {
    const first = await openGraph()
    for (let index = 0; index < 5; index += 1) await note(first, `n${String(index)}`, `text-${String(index)}`)
    const wrong = await note(first, 'mistake')
    await first.append({ type: 'tombstone/appended', data: { targetSeq: wrong.seq, reason: 'x', by: 'op-1' }, actor: ACTOR })
    await first.flush()
    const withSnapshot = await openGraph()
    await rm(join(root, 'acct-1', 'snapshot.json'))
    const replayed = await openGraph()
    expect(JSON.stringify(replayed.query(OPERATOR, {}))).toBe(JSON.stringify(withSnapshot.query(OPERATOR, {})))
    expect(replayed.integrity()).toEqual(withSnapshot.integrity())
  })
})

describe('opened', () => {
  it('分区打开、hydrate 与校验之后才发出，载荷是打开那一刻的最后一个 seq', async () => {
    const first = await openGraph()
    await note(first, 'n1')
    const ctx = new Context()
    const seen: unknown[] = []
    ctx.on('yzj-graph/opened', (payload) => { seen.push(payload) })
    const graph = await openGraph('acct-1', ctx)
    expect(seen).toEqual([{ accountKey: 'acct-1', lastSeqAtOpen: 2 }])
    expect(graph.opened).toEqual({ accountKey: 'acct-1', lastSeqAtOpen: 2 })
  })
})

describe('四种行与审计', () => {
  const event = (seq: number, type: string, actor: GraphEvent['actor'], data: Record<string, unknown> = {}): GraphEvent => ({
    v: 2, sv: 1, seq, time: seq, type, data: data as never, actor,
  })

  it('atomOf：人说的、agent 做的、规则推出的；认不出的 actor 归「做的」，不归「说的」', () => {
    expect(atomOf(event(1, 'x', { kind: 'person', openId: 'u-1' }))).toBe('said')
    expect(atomOf(event(1, 'x', { kind: 'operator', openId: 'op-1' }))).toBe('said')
    expect(atomOf(event(1, 'x', { kind: 'agent' }))).toBe('did')
    expect(atomOf(event(1, 'x', { kind: 'system' }))).toBe('ruled')
    expect(atomOf(event(1, 'x', { kind: 'robot' } as never))).toBe('did')
  })

  it('孤儿 = 放行了、既没结算也没被标成结果不明；aborted-after-body 不是孤儿，单独计数', () => {
    const agent = { kind: 'agent' } as const
    const events = [
      event(1, 'action/released', agent, { sessionId: 's', callId: 'a' }),
      event(2, 'action/settled', agent, { sessionId: 's', callId: 'a', outcome: 'ok' }),
      event(3, 'action/released', agent, { sessionId: 's', callId: 'b' }),
      event(4, 'action/released', agent, { sessionId: 's', callId: 'c' }),
      event(5, 'action/settled', agent, { sessionId: 's', callId: 'c', outcome: 'aborted-after-body' }),
      event(6, 'action/released', agent, { sessionId: 't', callId: 'b' }),
      event(7, 'action/outcome-unknown', { kind: 'system' }, { sessionId: 't', callId: 'b' }),
      event(8, 'commitment/opened', { kind: 'operator' }),
    ]
    expect(orphanReleases(events).map(one => one.seq)).toEqual([3])
    const audit = auditLedger(events)
    expect(audit).toMatchObject({
      byAtom: { said: 1, did: 6, seen: 0, ruled: 1 },
      saidWithoutOpenId: 1,
      orphanActions: 1,
      abortedAfterBody: 1,
    })
    expect(audit.byType['action/released']).toBe(4)
  })

  // #17
  it('auditLedger 与 integrity() 对同一份被篡改的文件给出相同的答案', async () => {
    const graph = await openGraph()
    for (const id of ['n1', 'n2', 'n3', 'n4']) await note(graph, id, `text-${id}`)
    const raw = await readFile(logPath(), 'utf8')
    await writeFile(logPath(), raw.replace('text-n3', 'text-n9'), 'utf8')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const live = (await openGraph()).integrity()
    const offline = auditLedger(parseLog(await readFile(logPath(), 'utf8')).events).chain
    expect(live.breakAt).toBe(4)
    expect(offline).toEqual(live)
  })
})
