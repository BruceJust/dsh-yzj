/**
 * 动词 × 投影矩阵 与 环路完整性断言（段 5 的具名交付，设计 §5.5）。
 *
 * The design's rule has TWO halves, and only one of them was ever asserted:
 *
 * > 每押后一个视图/通道，必须给留在 P1 的对象配一个最小 IM 习语的**进/出口**，
 * > 否则该对象永远收不到用来开门的真实使用证据。
 *
 * `answer-path.spec.ts` covers the exit — a delivered card whose keyword
 * triages back to its action. Nothing covered the ENTRANCE, and that is
 * exactly where this system had a whole segment's worth of rot: `memory` had
 * kernel vocabulary, a schema, a desktop tab and zero producers, so the panel
 * was permanently empty and no test disagreed. "Nobody used it" and "there was
 * no way to" are indistinguishable from the outside — which is the precise
 * failure the rule exists to prevent.
 *
 * So this file asserts the whole matrix:
 *
 * 1. **进口** — every object family a surface renders has a live producer.
 * 2. **出口** — every ACTION of every card is reachable from Yunzhijia, or is
 *    on an explicit desktop-only list with a stated reason.
 * 3. **两面等价** — the same verb answered on either surface produces the same
 *    event, and the surface that loses the race gets a loud receipt.
 * 4. **回声** — a resolved card owes a terminal line to every surface it
 *    reached, not only to the one that answered it.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { YzjCards, type CardProjection } from '@yzj-next/cards'
import {
  applyCommitmentTools, applyConflictTools, applyMemoryTools,
  approvalCard, approvalFamily, commitmentCard, commitmentFamily,
  conflictCard, processFamily, taskCard, taskFamily, waitingCard, waitingFamily,
  type TurnBinding,
} from '@yzj-next/objects'

const PLACE = 'yzj-group-g1'
const OPERATOR = { kind: 'operator' as const, openId: 'op-1' }

const BINDING: TurnBinding = {
  viewer: { kind: 'place', placeKey: PLACE },
  decider: 'op-1',
  accountKey: 'acct-1',
  accountOpenId: 'op-1',
  accountOrgId: 'org-1',
  topicKey: 'yzj-topic-1',
  placeKey: PLACE,
  audience: [PLACE],
  messageId: 'msg-1',
}

/**
 * Verbs deliberately NOT reachable from Yunzhijia, each with the reason.
 *
 * **Currently empty, and that is the finding.** The first draft of this file
 * listed `approval:retry` here on the assumption that re-issuing a write was
 * too consequential for a bare keyword — but `approvalCard` gives retry
 * keywords, and the design says so too (§重试一次性：回复「重试」). A list that
 * nothing disagrees with does not test anything; it just encodes the author's
 * guess. So the entry is gone and the map stays empty until a real decision
 * puts something in it.
 */
const DESKTOP_ONLY = new Map<string, string>()

interface Registered {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<Record<string, unknown>>
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let tools: Map<string, Registered>
let echoes: { cardRef: { kind: string; id: string }; echoText: string; projections: readonly CardProjection[] }[]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-matrix-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  for (const family of [approvalFamily, taskFamily, waitingFamily, commitmentFamily, processFamily]) {
    graph.defineFamily(family)
  }
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  for (const card of [approvalCard, taskCard, waitingCard, commitmentCard, conflictCard]) {
    cards.register(card)
  }
  cards.setDesktopActor(OPERATOR)
  ctx.provide('yzjTurns', { bindingFor: () => BINDING, defaultBinding: () => BINDING })
  ctx.provide('yzjCardChannel', {
    deliverToPlace: async () => Promise.resolve(undefined),
    deliver: async () => Promise.resolve(undefined),
    echo: async () => Promise.resolve(undefined),
  })
  const captured: Registered[] = []
  ctx.provide('tools', {
    register: (definition: Registered) => { captured.push(definition); return () => undefined },
    guard: () => () => undefined,
  })
  applyCommitmentTools(ctx)
  applyConflictTools(ctx)
  applyMemoryTools(ctx)
  tools = new Map(captured.map(tool => [tool.name, tool]))
  echoes = []
  ctx.on('yzj-cards/resolved', (payload) => { echoes.push(payload) })
})

// ---------------------------------------------------------------------------
// 1. 进口 — every family a surface renders must have something that makes one.
// ---------------------------------------------------------------------------

describe('进口：每个被渲染的对象家族都有生产者', () => {
  /**
   * kind → what brings one into being. A `tool:` entry is checked against the
   * live registry; the others name a code path a spec elsewhere covers.
   *
   * `memory` is in this list because it is the one that was broken: kernel
   * vocabulary since 段 2, a desktop tab, and no producer at all.
   */
  const PRODUCERS: Record<string, readonly string[]> = {
    approval: ['guard:ask'],
    task: ['orchestrator:openTask'],
    waiting: ['tool:waiting_open', 'health:outage'],
    commitment: ['tool:commitment_register', 'orchestrator:promotion'],
    conflict: ['tool:conflict_flag'],
    memory: ['tool:memory_note'],
    lineage: ['tools:lineage recording'],
  }

  it('每个声明的生产者要么是活的工具，要么是有测试的代码路径', () => {
    const missing: string[] = []
    for (const [kind, producers] of Object.entries(PRODUCERS)) {
      const live = producers.some((producer) => {
        if (!producer.startsWith('tool:')) return true
        return tools.has(producer.slice('tool:'.length))
      })
      if (!live) missing.push(`${kind}（声明的工具一个都没注册：${producers.join('、')}）`)
    }
    expect(missing, '有对象家族只有词汇位没有生产者').toEqual([])
  })

  it('记忆有生产者，也有让它去死的动词', async () => {
    // The half that was missing for a whole segment, and the half that keeps a
    // memory store trustworthy once it exists.
    expect(tools.has('memory_note')).toBe(true)
    expect(tools.has('memory_forget')).toBe(true)
    const written = await tools.get('memory_note')?.execute(
      { summary: '对账差异逐条列出', axis: 'place' }, { agent: { session: { id: 's-1' } } },
    )
    expect(graph.rawEvents(['memory/distilled'])).toHaveLength(1)
    await tools.get('memory_forget')?.execute(
      { memoryId: String(written?.memoryId), reason: '口径改了' }, { agent: { session: { id: 's-1' } } },
    )
    expect(graph.rawEvents(['memory/forgotten'])).toHaveLength(1)
  })

  it('每张卡都能被渲染成 IM 文本 —— 投不出去的卡等于没有出口', async () => {
    const unrenderable: string[] = []
    for (const kind of cards.types()) {
      const id = await openOne(kind)
      const text = cards.renderText({ kind, id })
      if (text === undefined || text.body.trim() === '') unrenderable.push(kind)
    }
    expect(unrenderable, '有卡型渲染不出 IM 文本').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. 出口 — every ACTION, not just one keyword per card.
// ---------------------------------------------------------------------------

describe('出口：每个动词都能从云之家够到', () => {
  it('没有一个动作是既无关键词、又不在明示的桌面专属清单里', () => {
    const orphans: string[] = []
    for (const kind of cards.types()) {
      const definition = cards.definitionOf(kind)
      for (const action of definition?.actions ?? []) {
        const key = `${kind}:${action.id}`
        const reachable = (action.keywords ?? []).length > 0
        if (!reachable && !DESKTOP_ONLY.has(key)) orphans.push(key)
      }
    }
    // An action reachable only from the desktop is a decision, never an
    // oversight — so it has to be written down to exist.
    expect(orphans, '有动作在云之家侧无法应答，且没有登记理由').toEqual([])
  })

  it('登记为桌面专属的动作都还带着它的理由', () => {
    for (const [key, reason] of DESKTOP_ONLY) {
      expect(reason.length, `${key} 的桌面专属理由是空的`).toBeGreaterThan(8)
    }
  })

  it('同一张卡里没有两个动作抢同一个词', () => {
    // 「作废」解析到别的动作，比解析不出来更糟：人打了一个词，发生了另一件事。
    const collisions: string[] = []
    for (const kind of cards.types()) {
      const seen = new Map<string, string>()
      for (const action of cards.definitionOf(kind)?.actions ?? []) {
        for (const word of action.keywords ?? []) {
          const owner = seen.get(word)
          if (owner !== undefined) collisions.push(`${kind}:「${word}」被 ${owner} 与 ${action.id} 同时认领`)
          seen.set(word, action.id)
        }
      }
    }
    expect(collisions).toEqual([])
  })

  it('处于可应答状态的卡，至少有一个动作真的可用', async () => {
    // pendingStatuses 说它在等人答，而 available() 一个都不放行 —— 那是死胡同：
    // 收件箱把它排在「需要我」，点开却无事可做。
    const deadEnds: string[] = []
    for (const kind of cards.types()) {
      const id = await openOne(kind)
      const state = graph.rawObject(kind, id)?.state
      const usable = (cards.definitionOf(kind)?.actions ?? [])
        .filter(action => action.available?.(state as never) !== false)
      if (usable.length === 0) deadEnds.push(kind)
    }
    expect(deadEnds, '有卡在可应答状态下没有任何可用动作').toEqual([])
  })

  /**
   * 每一张卡都说得出自己在等什么 (v4.15 家族即接口)。
   *
   * 服务对没声明的家族有个兜底（按「阻塞待答」收编，字面取文本投影第一行）——那是
   * **安全网**，不是主路：漏声明会发生，漏显示不可以。可一旦兜底成了常态，六种模式
   * 就退化成一种，徽标、排序、条上的字面全部回到「视图自己猜」。所以主路要被守住。
   */
  it('每一张卡都自己声明了 demand，兜底只是安全网', () => {
    const silent = cards.types().filter(kind => typeof cards.definitionOf(kind)?.demand !== 'function')
    expect(silent, '有卡型没说自己在等什么，只能靠兜底').toEqual([])
  })

  /**
   * 阻塞待答必须有一段语境可去 —— 「没有不可到达的待答」。
   *
   * 逐级兑付管的是「信号点得动」；这一条管的是它的对偶：一个在等人答、却不属于任何
   * 一段对话的对象，在决断条上不出现、在收件箱里没有行、在群视图里没有卡——它谁也
   * 不吵，只是永远没人答。信号层（承诺、等待）不受此限：它们的动词就近长在板上。
   */
  it('每一个阻塞待答都归属一段语境，否则它哪儿都不会出现', async () => {
    const stranded: string[] = []
    for (const kind of cards.types()) {
      const id = await openOne(kind, 'ctx')
      const object = graph.rawObject(kind, id)
      if (object === undefined) continue
      const demand = cards.demandOf(object)
      if (demand?.layer !== 'blocking') continue
      const state = asRecord(object.state)
      const context = asString(state?.topicKey)
        ?? asString(asRecord(state?.executor)?.topicKey)
      if (context === undefined) stranded.push(`${kind}:${id}`)
    }
    expect(stranded, '有在等人答的对象不属于任何一段对话').toEqual([])
  })

  it('凡是声明了 pendingStatuses 的家族都配了卡', () => {
    // 「在等一个回答」和「有办法回答」必须同时成立，否则收件箱会指向一个
    // 无法结束的东西。
    const answerable = cards.types()
    for (const family of ['approval', 'task', 'waiting', 'commitment']) {
      expect(answerable, `${family} 声明了待答状态却没有卡`).toContain(family)
    }
  })

  it('每个带关键词的动作，关键词真的解析回它自己', async () => {
    const broken: string[] = []
    for (const kind of cards.types()) {
      const id = await openOne(kind)
      const definition = cards.definitionOf(kind)
      for (const action of definition?.actions ?? []) {
        for (const word of action.keywords ?? []) {
          const resolved = cards.resolveKeyword({ kind, id }, word)
          if (resolved?.actionId !== action.id) broken.push(`${kind}:${action.id} ← 「${word}」`)
        }
      }
    }
    // A keyword that resolves to a DIFFERENT action is worse than none: the
    // operator types 「作废」 and something else happens.
    expect(broken, '有关键词解析到了别的动作，或解析不出来').toEqual([])
  })

  it('每张卡的 replyHints 只承诺它此刻真能做的事', async () => {
    const lying: string[] = []
    for (const kind of cards.types()) {
      const id = await openOne(kind)
      const state = graph.rawObject(kind, id)?.state
      const hints = cards.renderText({ kind, id })?.replyHints ?? []
      const available = new Set(
        (cards.definitionOf(kind)?.actions ?? [])
          .filter(action => action.available?.(state as never) !== false)
          .flatMap(action => action.keywords ?? []),
      )
      for (const hint of hints) {
        const word = hint.split(' ')[0] ?? hint
        if (!available.has(word)) lying.push(`${kind}: 提示了「${hint}」但此刻做不到`)
      }
    }
    expect(lying, '有卡在提示它做不到的动作').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. 两面等价 — the same verb, either surface, one effect.
// ---------------------------------------------------------------------------

describe('两面等价：同一个动词，哪一面答都一样', () => {
  const PARITY = [
    { kind: 'task', actionId: 'accept', expected: 'accepted' },
    { kind: 'task', actionId: 'void', input: '需求撤了', expected: 'voided' },
    /*
      承诺这一格换成 `void`：**`done` 现在不是一步终态**（v4.21 第一档⑥）——它是
      交付主张，终态在「验收」那一步。这张表考的是「同一个动词、哪一面答都一样」，
      所以它要一个**一步可达**的终态；两步的那条另有用例，见下。
    */
    { kind: 'commitment', actionId: 'void', input: '不做了', expected: 'voided' },
    { kind: 'waiting', actionId: 'resolve', expected: 'closed' },
    { kind: 'conflict', actionId: 'continue', expected: 'resolved' },
  ] as const

  for (const { kind, actionId, expected, ...rest } of PARITY) {
    const input = 'input' in rest ? (rest as { input: string }).input : undefined
    it(`${kind}:${actionId} 在桌面与云之家产生同一个终态`, async () => {
      const fromDesktop = await openOne(kind, `${kind}-desk`)
      await cards.act({ kind, id: fromDesktop }, actionId, OPERATOR, 'desktop', input)
      const fromPlace = await openOne(kind, `${kind}-im`)
      await cards.act({ kind, id: fromPlace }, actionId, OPERATOR, 'yzj-text', input)

      expect(asString(asRecord(graph.rawObject(kind, fromDesktop)?.state)?.status)).toBe(expected)
      expect(asString(asRecord(graph.rawObject(kind, fromPlace)?.state)?.status)).toBe(expected)
      // The surface is recorded, because "who answered where" is audit
      // material — but it must not change WHAT happened.
      const answers = graph.rawEvents(['answer/recorded'])
        .map(event => asString(asRecord(event.data)?.via))
      expect(answers).toContain('desktop')
      expect(answers).toContain('yzj-text')
    })
  }

  it('输掉竞态的那一面拿到的是响亮的回执，不是沉默', async () => {
    const id = await openOne('task')
    const first = await cards.act({ kind: 'task', id }, 'accept', OPERATOR, 'yzj-text')
    const second = await cards.act({ kind: 'task', id }, 'accept', OPERATOR, 'desktop')
    expect(first.outcome).toBe('applied')
    expect(second.outcome).not.toBe('applied')
    // Silence here is how two people end up believing they each decided it.
    expect(second.receipt.length).toBeGreaterThan(4)
  })
})

// ---------------------------------------------------------------------------
// 4. 回声 — a settled card owes a line to every surface it reached.
// ---------------------------------------------------------------------------

describe('回声：终态欠每一个它到过的面一句话', () => {
  it('结算后按投影逐个回声，而不是只回答题的那一面', async () => {
    const id = await openOne('task')
    for (const anchor of ['m-a', 'm-b']) {
      await cards.project({
        cardRef: { kind: 'task', id }, surface: 'yzj:text',
        msgAnchors: [anchor], placeKey: PLACE,
      })
    }
    await cards.act({ kind: 'task', id }, 'accept', OPERATOR, 'desktop')
    expect(echoes).toHaveLength(1)
    expect(echoes[0]?.projections).toHaveLength(2)
    expect(echoes[0]?.echoText).toContain('已验收')
  })

  it('作废也回声 —— 一种死法不通报,就是悄悄消失', async () => {
    const id = await openOne('task')
    await cards.project({
      cardRef: { kind: 'task', id }, surface: 'yzj:text',
      msgAnchors: ['m-a'], placeKey: PLACE,
    })
    await cards.act({ kind: 'task', id }, 'void', OPERATOR, 'desktop', '模型连不上')
    expect(echoes[0]?.echoText).toContain('已作废')
    expect(echoes[0]?.echoText).toContain('模型连不上')
  })
})

/** Bring one card of each kind into being, in its answerable state. */
async function openOne(kind: string, suffix = 'one'): Promise<string> {
  const id = `${kind}-${suffix}`
  switch (kind) {
    case 'approval':
      await graph.append({
        type: 'approval/opened',
        data: {
          approvalId: id, toolName: 'yzj_doc_create', reason: '新建文档', level: 'standard',
          args: { title: 'x' }, argsDigest: 'd', decider: 'op-1',
          deadline: Date.now() + 60_000, topicKey: 'yzj-topic-1', placeKey: PLACE, audience: [PLACE],
        },
        actor: { kind: 'agent' },
      })
      return id
    case 'task':
      await graph.append({
        type: 'task/opened',
        data: {
          taskId: id, what: '改价格页', topicKey: 'yzj-topic-1',
          sourceAnchor: 'yzj:m-1', audience: [PLACE],
        },
        actor: { kind: 'agent' },
      })
      await graph.append({
        type: 'task/terminal',
        data: { taskId: id, summary: '改好了', artifacts: [] },
        actor: { kind: 'agent' },
      })
      return id
    case 'waiting':
      await graph.append({
        type: 'waiting/opened',
        data: {
          waitingId: id, kind: 'third-party', what: '等张锐的分析',
          openedAt: Date.now(), topicKey: 'yzj-topic-1', placeKey: PLACE,
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
          conflictId: id, topicKey: 'yzj-topic-1', inflightAnchor: 'a',
          incomingAnchor: 'b', note: '相反指令',
        },
        actor: { kind: 'agent' },
      })
      return id
  }
}

/**
 * 两步出口的两面等价 (v4.21 第一档⑥)。
 *
 * 人执行的承诺现在要走「完成 → 验收」两步。**两步各自在两面等价还不够**——要紧的是
 * 两步**跨面接得上**：在云之家说完成、回桌面验收，和全程在一面上做，必须落到同一个
 * 终态。跨面接不上的话，人会被逼着在一个面上把一件事做完，而这套设计的整个前提是
 * 「同一条会话的两个投影」。
 */
describe('承诺的两步出口跨面接得上', () => {
  it('云之家说完成、桌面验收，与全程一面等价', async () => {
    const crossed = await openOne('commitment', 'commitment-cross')
    await cards.act({ kind: 'commitment', id: crossed }, 'done', OPERATOR, 'yzj-text')
    await cards.act({ kind: 'commitment', id: crossed }, 'accept', OPERATOR, 'desktop')

    const single = await openOne('commitment', 'commitment-single')
    await cards.act({ kind: 'commitment', id: single }, 'done', OPERATOR, 'desktop')
    await cards.act({ kind: 'commitment', id: single }, 'accept', OPERATOR, 'desktop')

    for (const id of [crossed, single]) {
      const state = asRecord(graph.rawObject('commitment', id)?.state)
      expect(asString(state?.status)).toBe('closed')
      expect(asString(state?.cause)).toBe('accepted')
    }
  })
})
