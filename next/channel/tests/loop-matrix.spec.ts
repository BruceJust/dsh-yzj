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
import { KERNEL_FAMILIES, YzjGraph, asRecord, asString, type GraphFamily } from '@yzj-next/graph'
import { YzjCards, labelOf, type CardAction, type CardProjection } from '@yzj-next/cards'
import {
  applyCommitmentTools, applyConflictTools, applyMemoryTools,
  approvalCard, approvalFamily, assessmentCard, assessmentFamily, createCommitmentCard, commitmentFamily,
  conflictCard, createProposalCard, leaseCard, leaseFamily, processFamily, proposalFamily,
  taskCard, taskFamily, waitingCard, waitingFamily,
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

const DEFINED: readonly GraphFamily[] = [
  approvalFamily, taskFamily, waitingFamily, commitmentFamily, processFamily,
  leaseFamily, proposalFamily, assessmentFamily,
]

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let tools: Map<string, Registered>
let echoes: { cardRef: { kind: string; id: string }; echoText: string; projections: readonly CardProjection[] }[]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-matrix-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  for (const family of DEFINED) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  // 线上注册的是哪几张，这里就是哪几张：少登记一张，那一族就整个不受下面任何一条管。
  for (const card of [
    approvalCard, taskCard, waitingCard, createCommitmentCard(ctx), conflictCard,
    leaseCard, createProposalCard(ctx), assessmentCard,
  ]) {
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
      // 「要你」那一段认的落脚处就这两种：话题，或（没有话题的本地会话里）会话。
      const context = asString(state?.topicKey)
        ?? asString(asRecord(state?.executor)?.topicKey)
        ?? asString(state?.sessionAnchor)
      if (context === undefined) stranded.push(`${kind}:${id}`)
    }
    expect(stranded, '有在等人答的对象不属于任何一段对话').toEqual([])
  })

  it('凡是声明了 pendingStatuses 的家族都配了卡', () => {
    // 「在等一个回答」和「有办法回答」必须同时成立，否则收件箱会指向一个
    // 无法结束的东西。
    const answerable = cards.types()
    for (const family of [...DEFINED, ...KERNEL_FAMILIES].filter(one => (one.pendingStatuses ?? []).length > 0).map(one => one.kind)) {
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
    case 'lease':
    case 'proposal':
    case 'assessment': {
      // 这三族的出生在下面那张状态表里写过一遍，这里不再抄第二份。
      const born = STATES[kind]?.[FIRST[kind] ?? '']
      for (const step of born?.(id) ?? []) await graph.append({ ...step, actor: { kind: 'agent' } })
      return id
    }
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

// ---------------------------------------------------------------------------
// 5. 每一个可见状态 —— 出口不是「这一族有」，是「此刻这一张有」。
// ---------------------------------------------------------------------------

/**
 * 每一族、每一个够得着的状态，过同一组不变式 (实测 2026-10-22).
 *
 * 上面那几条每族只开一种状态（`openOne`）：任务只测了「交付待验收」，承诺只测了「刚登记」，
 * 租约、提案、差距简报三族根本没登记进来。这两天修掉的洞全长在它没走到的地方——打回之后卡上
 * 一个动词都没有；返工停了，提示的词不是关键词；卡上按钮的字回过去不认；问一句也要人验收；
 * 过了期的确认中断之后永远挂着。每一处都是「某一族在某一个状态下没有出口」，每一处都是事后
 * 一个一个撞见的。
 *
 * 所以把状态表摊开：每一族从出生到每一种死法都有一格，每一格过同一组不变式。新加一个状态、
 * 一种卡，表里补一行，下面每一条自动管到它；漏补，第一条就红。
 */
interface Step { readonly type: string; readonly data: Record<string, unknown> }

const TOPIC = 'yzj-topic-1'
const LATER = Date.now() + 7 * 24 * 60 * 60 * 1000

const task = {
  opened: (id: string): Step => ({ type: 'task/opened', data: { taskId: id, what: '改价格页', topicKey: TOPIC, sourceAnchor: 'yzj:m-1', audience: [PLACE] } }),
  delivered: (id: string): Step => ({ type: 'task/terminal', data: { taskId: id, summary: '改好了', artifacts: [] } }),
  answered: (id: string): Step => ({ type: 'task/answered', data: { taskId: id, summary: '星期四。' } }),
  sentBack: (id: string): Step => ({ type: 'task/rejected', data: { taskId: id, round: 1, reason: '口径不对', rejectedBy: 'op-1' } }),
  dropped: (id: string): Step => ({ type: 'task/interrupted', data: { taskId: id, reason: '模型连不上' } }),
  resumed: (id: string, status: 'open' | 'rework'): Step => ({ type: 'task/resumed', data: { taskId: id, resumedBy: 'op-1', status } }),
}
const asked = (id: string): Step => ({
  type: 'approval/opened',
  data: {
    approvalId: id, toolName: 'yzj_doc_create', reason: '新建文档', level: 'standard',
    args: { 标题: '周报' }, argsDigest: 'd', decider: 'op-1',
    deadline: LATER, topicKey: TOPIC, placeKey: PLACE, audience: [PLACE],
  },
})
const waited = (id: string, kind = 'third-party'): Step => ({
  type: 'waiting/opened',
  data: { waitingId: id, kind, what: '等张锐的分析', openedAt: Date.now(), topicKey: TOPIC, placeKey: PLACE },
})
/** 人执行的承诺照线上的样子出生：带名字、不带话题（线上 62 条里 45 条如此）。 */
const promised = (id: string, extra: Record<string, unknown> = {}): Step => ({
  type: 'commitment/opened',
  data: {
    commitmentId: id, what: '出周报', sourceAnchor: 'yzj:m-1',
    executor: { kind: 'human', openId: 'p-9', name: '张锐' }, audience: [PLACE], ...extra,
  },
})
const claimed = (id: string, round?: number): Step => ({
  type: 'commitment/delivered',
  data: { commitmentId: id, delivery: { claim: '周报发了', at: Date.now(), ...(round === undefined ? {} : { round }) } },
})
const byAgent = { executor: { kind: 'agent', topicKey: TOPIC }, topicKey: TOPIC }
const leased = (id: string): Step => ({
  type: 'lease/proposed',
  data: {
    leaseId: id, scope: { toolClass: 'doc' }, period: { from: Date.now(), to: LATER }, periodText: '7 天',
    family: 'approval', decider: 'op-1', reason: '往文档里新加内容不用每次问', sessionAnchor: 'session-1', idemKey: `lease:${id}`,
  },
})
const granted = (id: string): Step => ({
  type: 'lease/granted',
  data: { leaseId: id, grantedBy: 'op-1', scope: { toolClass: 'doc' }, periodText: '7 天', family: 'approval' },
})
const TWO_ITEMS = [
  { what: '拆出数据口径', executorOpenId: 'p-9', executorName: '张锐' },
  { what: '拆出页面改版', executorOpenId: 'p-8', executorName: '李雷' },
]
const proposed = (id: string, kind: string, extra: Record<string, unknown> = {}): Step => ({
  type: 'proposal/opened',
  data: {
    proposalId: id, kind, title: 'v37 上线', items: TWO_ITEMS, sourceAnchor: 'yzj:m-1',
    topicKey: TOPIC, placeKey: PLACE, audience: [PLACE], decider: 'op-1', ...extra,
  },
})
const decided = (id: string, index: number, decision: string): Step => ({
  type: 'proposal/item-decided',
  data: { proposalId: id, index, decision, ...(decision === 'confirmed' ? { commitmentId: `cmt-${String(index)}` } : {}) },
})
const reported = (id: string): Step => ({
  type: 'assessment/reported',
  data: {
    assessmentId: id, goalRef: 'goal-1', goalName: 'v37 上线', summary: '三条标准达成两条',
    lines: [{ criterion: '上线', verdict: 'met', evidence: '已发版' }],
    sourceAnchor: 'yzj:m-1', topicKey: TOPIC, decider: 'op-1',
  },
})

const STATES: Record<string, Record<string, (id: string) => readonly Step[]>> = {
  task: {
    进行中: id => [task.opened(id)],
    交付待验收: id => [task.opened(id), task.delivered(id)],
    已答复: id => [task.opened(id), task.answered(id)],
    答复被打回: id => [task.opened(id), task.answered(id), task.sentBack(id)],
    返工中: id => [task.opened(id), task.delivered(id), task.sentBack(id)],
    中断: id => [task.opened(id), task.dropped(id)],
    续跑: id => [task.opened(id), task.dropped(id), task.resumed(id, 'open')],
    返工停了: id => [task.opened(id), task.delivered(id), task.sentBack(id), task.dropped(id)],
    返工续跑: id => [task.opened(id), task.delivered(id), task.sentBack(id), task.dropped(id), task.resumed(id, 'rework')],
    已验收: id => [task.opened(id), task.delivered(id), { type: 'task/accepted', data: { taskId: id, acceptedBy: 'op-1' } }],
    已作废: id => [task.opened(id), { type: 'task/voided', data: { taskId: id, reason: '需求撤了', voidedBy: 'op-1' } }],
  },
  approval: {
    待确认: id => [asked(id)],
    中断待重试: id => [asked(id), { type: 'approval/interrupted', data: { approvalId: id } }],
    已放行: id => [asked(id), { type: 'approval/decided', data: { approvalId: id, status: 'approved', decidedBy: 'op-1' } }],
    已拒绝: id => [asked(id), { type: 'approval/decided', data: { approvalId: id, status: 'rejected', decidedBy: 'op-1' } }],
    已过期: id => [asked(id), { type: 'approval/expired', data: { approvalId: id, cause: 'timeout' } }],
    已重试: id => [
      asked(id), { type: 'approval/interrupted', data: { approvalId: id } },
      { type: 'approval/superseded', data: { approvalId: id, retryTaskAnchor: 'yzj:m-2' } },
    ],
  },
  waiting: {
    等待中: id => [waited(id)],
    已升级: id => [waited(id), { type: 'waiting/escalated', data: { waitingId: id, escalations: 1, detail: '催过一次' } }],
    系统等待: id => [waited(id, 'system')],
    已解除: id => [waited(id), { type: 'waiting/closed', data: { waitingId: id, cause: 'resolved' } }],
  },
  commitment: {
    进行中: id => [promised(id)],
    交付待验收: id => [promised(id), claimed(id)],
    本地会话里交付: id => [promised(id, { sourceAnchor: 'session:s-local', audience: undefined }), claimed(id)],
    返工中: id => [promised(id), claimed(id), { type: 'commitment/rework', data: { commitmentId: id, reason: '口径不对', round: 1 } }],
    再交待验收: id => [
      promised(id), claimed(id), { type: 'commitment/rework', data: { commitmentId: id, reason: '口径不对', round: 1 } }, claimed(id, 1),
    ],
    挂着目标: id => [promised(id, { parentGoalRef: 'goal-1', attachedVia: 'explicit' })],
    云小助在做: id => [promised(id, byAgent)],
    云小助交付: id => [promised(id, byAgent), claimed(id)],
    已完成: id => [promised(id), claimed(id), { type: 'commitment/closed', data: { commitmentId: id, cause: 'accepted' } }],
    自报完成: id => [promised(id), { type: 'commitment/closed', data: { commitmentId: id, cause: 'done' } }],
    回执完成: id => [promised(id), { type: 'commitment/closed', data: { commitmentId: id, cause: 'receipt' } }],
    已作废: id => [promised(id), { type: 'commitment/voided', data: { commitmentId: id, cause: '不做了' } }],
    已合并: id => [promised(id), { type: 'commitment/merged', data: { commitmentId: id, mergedInto: 'cmt-other' } }],
    已移交: id => [promised(id), {
      type: 'commitment/transferred',
      data: { commitmentId: id, transferredTo: { commitmentId: 'cmt-next', executor: { kind: 'human', openId: 'p-8', name: '李雷' }, at: Date.now() } },
    }],
  },
  conflict: {
    待裁: id => [{ type: 'conflict/flagged', data: { conflictId: id, topicKey: TOPIC, inflightAnchor: 'a', incomingAnchor: 'b', note: '相反指令' } }],
    已裁: id => [
      { type: 'conflict/flagged', data: { conflictId: id, topicKey: TOPIC, inflightAnchor: 'a', incomingAnchor: 'b', note: '相反指令' } },
      { type: 'conflict/resolved', data: { conflictId: id, resolution: 'continue', by: 'op-1' } },
    ],
  },
  lease: {
    等你签: id => [leased(id)],
    生效中: id => [leased(id), granted(id)],
    没签: id => [leased(id), { type: 'lease/declined', data: { leaseId: id } }],
    已收回: id => [leased(id), granted(id), { type: 'lease/revoked', data: { leaseId: id, revokedBy: 'op-1', reason: '换人了' } }],
    已到期: id => [leased(id), granted(id), { type: 'lease/expired', data: { leaseId: id } }],
  },
  proposal: {
    拆解: id => [proposed(id, 'breakdown', { goalRef: 'goal-1' })],
    拆解裁了一条: id => [proposed(id, 'breakdown', { goalRef: 'goal-1' }), decided(id, 0, 'confirmed')],
    拆解全挂起: id => [proposed(id, 'breakdown', { goalRef: 'goal-1' }), decided(id, 0, 'held'), decided(id, 1, 'held')],
    拆解裁完: id => [proposed(id, 'breakdown', { goalRef: 'goal-1' }), decided(id, 0, 'confirmed'), decided(id, 1, 'rejected')],
    立目标: id => [proposed(id, 'goal', { items: [{ what: 'v37 上线' }], goalRef: 'https://www.yunzhijia.com/d/1', criteria: '上线' })],
    立目标缺真身: id => [proposed(id, 'goal', { items: [{ what: 'v37 上线' }] })],
    发现: id => [proposed(id, 'finding')],
    交付推断: id => [proposed(id, 'delivery', {
      items: [{ what: '周报.xlsx 是「出周报」的交付', commitmentId: 'cmt-1' }],
      artifact: { msgId: 'm-5', fileId: 'f-1', name: '周报.xlsx', placeKey: PLACE },
    })],
    已收起: id => [proposed(id, 'breakdown', { goalRef: 'goal-1' }), { type: 'proposal/settled', data: { proposalId: id, cause: '收起' } }],
  },
  assessment: {
    待判: id => [reported(id)],
    已验收: id => [reported(id), { type: 'assessment/closed', data: { assessmentId: id, status: 'accepted', decidedBy: 'op-1' } }],
    继续跑: id => [reported(id), { type: 'assessment/closed', data: { assessmentId: id, status: 'continued', decidedBy: 'op-1' } }],
  },
}

/** `openOne` 给那三族用的出生格。 */
const FIRST: Record<string, string> = { lease: '等你签', proposal: '拆解', assessment: '待判' }

interface Reached {
  readonly at: string
  readonly kind: string
  readonly id: string
  readonly state: unknown
  readonly actions: readonly CardAction<unknown>[]
  readonly live: readonly CardAction<unknown>[]
  readonly resolved: boolean
}

/** 把整张表在一张图上走一遍。 */
async function reachAll(): Promise<readonly Reached[]> {
  const out: Reached[] = []
  let n = 0
  for (const [kind, states] of Object.entries(STATES)) {
    for (const [name, steps] of Object.entries(states)) {
      n += 1
      const id = `${kind}-s${String(n)}`
      for (const step of steps(id)) await graph.append({ ...step, actor: { kind: 'agent' } })
      const definition = cards.definitionOf(kind)
      const state = graph.rawObject(kind, id)?.state
      const actions = (definition?.actions ?? []) as readonly CardAction<unknown>[]
      out.push({
        at: `${kind}·${name}`,
        kind,
        id,
        state,
        actions,
        live: actions.filter(action => action.available?.(state) ?? true),
        resolved: definition?.isResolved(state as never) === true,
      })
    }
  }
  return out
}

/** 照家族的词表说出它声明过的每一个状态——zod 那一层直接读，不另抄一份名单。 */
function declaredStatuses(family: GraphFamily): readonly string[] {
  const out = new Set<string>()
  for (const definition of Object.values(family.events)) {
    let status = (definition.schema as unknown as { shape?: Record<string, unknown> }).shape?.status as
      | { unwrap?: () => unknown; values?: Iterable<string>; options?: readonly string[]; _zod?: { def?: { type?: string } } }
      | undefined
    while (status?._zod?.def?.type === 'default' || status?._zod?.def?.type === 'optional') {
      status = status.unwrap?.() as typeof status
    }
    for (const value of status?.options ?? [...(status?.values ?? [])]) out.add(value)
  }
  return [...out]
}

/** 「打回 <原因>」照人会怎么回把空填上。 */
function filled(hint: string): string {
  return hint
    .replace(/<原因>/gu, '口径不对')
    .replace(/<编号>/gu, '1')
    .replace(/<姓名>/gu, '张锐')
    .replace(/<真身链接>/gu, 'https://www.yunzhijia.com/d/1')
}
const spoken = (action: CardAction<unknown>, word: string): string => (action.needsInput === true ? `${word} 口径不对` : word)

/** 内部的状态词、原因码、执行者种类——落到人眼前的字里，就是没翻译的机器话。 */
const MACHINE_WORDS = /\b(?:open|terminal|answered|accepted|rework|voided|interrupted|pending|approved|rejected|expired|superseded|escalated|closed|merged|transferred|flagged|resolved|proposed|active|declined|revoked|settled|continued|done|receipt|timeout|agent|human)\b/u
const withoutHandles = (text: string): string => text.replace(/\[card#[^\]]+\]/gu, '')

describe('每一个可见状态都有出口', () => {
  it('表里每一张注册了的卡都在，每一族声明过的每个状态都走到了', async () => {
    const reached = await reachAll()
    const missingKinds = cards.types().filter(kind => STATES[kind] === undefined)
    expect(missingKinds, '有卡型没进状态表——下面每一条都管不到它').toEqual([])
    const families = new Map([...DEFINED, ...KERNEL_FAMILIES].map(family => [family.kind, family]))
    const unreached: string[] = []
    for (const kind of cards.types()) {
      const family = families.get(kind)
      if (family === undefined) continue
      const seen = new Set(reached.filter(one => one.kind === kind).map(one => asString(asRecord(one.state)?.status)))
      for (const status of declaredStatuses(family)) {
        if (!seen.has(status)) unreached.push(`${kind}:${status}`)
      }
    }
    expect(unreached, '有声明过的状态表里没有一格走到').toEqual([])
  })

  it('没收口的，此刻至少有一扇门；收口了的，一扇都不剩', async () => {
    const wrong: string[] = []
    for (const one of await reachAll()) {
      if (!one.resolved && one.live.length === 0) wrong.push(`${one.at}：没收口，却没有一个动作可用`)
      if (one.resolved && one.live.length > 0) wrong.push(`${one.at}：已经收口，还摆着 ${one.live.map(action => action.id).join('、')}`)
    }
    expect(wrong).toEqual([])
  })

  it('说「要你」的，「要你」里真有它，点下去有地方去，按得动', async () => {
    // 「要你」那一段读的就是这个查询，落脚处也是同样两种（surface `needs`）。
    const reached = await reachAll()
    const listed = new Map(cards.demands({ kind: 'operator', openId: 'op-1' }).map(pending => [`${pending.ref.kind}:${pending.ref.id}`, pending]))
    const wrong: string[] = []
    for (const one of reached) {
      const object = graph.rawObject(one.kind, one.id)
      const demand = object === undefined ? undefined : cards.demandOf(object)
      if (demand?.layer !== 'blocking') continue
      const pending = listed.get(`${one.kind}:${one.id}`)
      if (pending === undefined) {
        wrong.push(`${one.at}：说在等人答，可它不在待答状态里——「要你」不会列它`)
        continue
      }
      // 落脚处：话题、会话；承诺另有板上它那一行（surface `needs`，见 needs.spec「没有话题的交付」）。
      if (pending.topicKey === undefined && pending.sessionAnchor === undefined && one.kind !== 'commitment') {
        wrong.push(`${one.at}：在等人答，却既没有话题也没有会话——「要你」会把它当成落不了脚的丢掉`)
      }
      const signable = one.live.some(action => action.allowedActors?.(OPERATOR, one.state) ?? true)
      if (!signable) wrong.push(`${one.at}：在等人答，可该答的人一个动作都按不了`)
      if (/(?:^|\D)0 条/u.test(demand.label)) wrong.push(`${one.at}：在等人答，字面却是「${demand.label}」`)
    }
    expect(wrong).toEqual([])
  })

  it('提示回过去的每一句，此刻都落到一扇开着的门上', async () => {
    const wrong: string[] = []
    for (const one of await reachAll()) {
      if (one.resolved) continue
      const hints = cards.renderText({ kind: one.kind, id: one.id })?.replyHints ?? []
      for (const hint of hints) {
        const said = filled(hint)
        const resolved = cards.resolveKeyword({ kind: one.kind, id: one.id }, said)
        const opens = resolved !== undefined && one.live.some(action => action.id === resolved.actionId)
        if (!opens) wrong.push(`${one.at}：提示「${hint}」，回「${said}」${resolved === undefined ? '认不出' : `落到了关着的 ${resolved.actionId}`}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('卡上编了号的字，回号、回字都落到同一扇门', async () => {
    const wrong: string[] = []
    for (const one of await reachAll()) {
      if (one.resolved) continue
      const numbered = cards.numberedActions(one.kind, one.state as never)
      const shown = cards.renderText({ kind: one.kind, id: one.id })?.numbered ?? []
      numbered.forEach((action, index) => {
        const label = labelOf(action, one.state)
        if (shown[index] !== label) wrong.push(`${one.at}：第 ${String(index + 1)} 号卡上写「${shown[index] ?? ''}」，动作叫「${label}」`)
        const byNumber = cards.resolveKeyword({ kind: one.kind, id: one.id }, String(index + 1))
        if (byNumber?.actionId !== action.id) wrong.push(`${one.at}：回「${String(index + 1)}」落到 ${byNumber?.actionId ?? '无'}，卡上那一号是 ${action.id}`)
        const byWord = cards.resolveKeyword({ kind: one.kind, id: one.id }, spoken(action, label))
        if (byWord?.actionId !== action.id) wrong.push(`${one.at}：回卡上的字「${label}」落到 ${byWord?.actionId ?? '无'}，不是 ${action.id}`)
      })
    }
    expect(wrong).toEqual([])
  })

  it('开着的门，它自己的每个关键词都回到它自己——不被关着的门截走', async () => {
    const wrong: string[] = []
    for (const one of await reachAll()) {
      for (const action of one.live) {
        for (const word of action.keywords) {
          const resolved = cards.resolveKeyword({ kind: one.kind, id: one.id }, spoken(action, word))
          if (resolved?.actionId !== action.id) wrong.push(`${one.at}：「${word}」该是 ${action.id}，落到了 ${resolved?.actionId ?? '无'}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('落到人眼前的字说人话：活着的卡带句柄、不说机器词、不对不等你的人说「等你」；收口的回声也一样', async () => {
    const wrong: string[] = []
    for (const one of await reachAll()) {
      const definition = cards.definitionOf(one.kind)
      if (!one.resolved) {
        const body = cards.renderText({ kind: one.kind, id: one.id })?.body ?? ''
        const object = graph.rawObject(one.kind, one.id)
        const demand = object === undefined ? undefined : cards.demandOf(object)
        if (!body.includes(`[card#${one.kind}:${one.id}]`)) wrong.push(`${one.at}：卡面没有句柄——活着的卡在云之家里都靠这一行被指名`)
        const leak = MACHINE_WORDS.exec(withoutHandles(body))
        if (leak !== null) wrong.push(`${one.at}：卡面漏了机器词「${leak[0]}」`)
        if (body.includes('等你') && demand?.layer !== 'blocking') wrong.push(`${one.at}：卡面说「等你」，可它此刻不等任何人`)
        continue
      }
      const echo = definition?.onResolved?.(one.state as never)?.echoText ?? ''
      const leak = MACHINE_WORDS.exec(withoutHandles(echo))
      if (leak !== null) wrong.push(`${one.at}：回声漏了机器词「${leak[0]}」：${echo}`)
    }
    expect(wrong).toEqual([])
  })
})
