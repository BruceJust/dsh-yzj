/**
 * 私账层验收断言 —— 分册 §10 的**二十七条**，全绿才并.
 *
 * 十五条是 v1.1 的门槛；v2.0（#62 十条修法）补 ⑯–㉕，v2.1（#61 对象面澄清 ×
 * #62-A 接缝）补 ㉖㉗。
 *
 * 每一个 `describe` 的名字就是那一条断言的编号，因为合并门槛要能被机械核对：一份
 * 「大概都测了」的测试文件，在下一次有人删掉一条的时候不会报警。
 *
 * 这里刻意**跑真路径**：真的组织图、真的卡动作总线、真的私账日志文件。三不入那一条
 * 尤其如此——它断言的是「私账对象结构性地不在那个查询的定义域里」，而一个用 mock
 * 顶掉存储的测试，恰恰会把这条唯一要测的东西 mock 掉。
 */

import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, type GraphActor, type GraphViewer } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  assessmentCard, assessmentFamily, commitmentFamily, createCommitmentCard,
} from '@yzj-next/objects'
import { PledgerCards } from '../src/bus.ts'
import { calibrationCard } from '../src/calibration.ts'
import { CAPABILITY_ENTRIES, createDesk, evidenceRowsOf, type PledgerDesk } from '../src/desk.ts'
import { DESTROY_PHRASE } from '../src/destroy.ts'
import {
  FAMILY_DELIVERY_ACCEPTANCE, FAMILY_GOAL_BREAKDOWN, expectationIdFor, inviteIdFor,
} from '../src/families.ts'
import { inviteCard } from '../src/invite.ts'
import { upgradeLegacy } from '../src/compat.ts'
import { casebookOf, readmeOf } from '../src/export.ts'
import { inject as pledgerInject } from '../src/index.ts'
import { PledgerLog } from '../src/log.ts'
import { attributionDistribution, patternsIn } from '../src/patterns.ts'
import {
  inviteGate, inviteOnVerdict, inviteRender, openCalibration, quotaOf,
  reflowOnGraphEvent, reflowOnNotedFact, tickCheckpoints,
} from '../src/ring.ts'
import { renderWhen, structuralFactFor, watchedVerdicts } from '../src/reflow.ts'
import { YzjPledger } from '../src/service.ts'
import { CONTRACT_CHIPS, FORBIDDEN_VERBS, vaultView } from '../src/vault.ts'
import { PLEDGER_KINDS, expectationFamily } from '../src/vocabulary.ts'
import {
  DEFAULT_PATTERN_WINDOW, FOLD_THRESHOLD, PLEDGER_FOLD_VERSION, SETTLE_DAYS,
  anchoredJson, snapshot,
} from '../src/types.ts'
import { VERDICT_SPECTRUM, isPledgeable, type SeenVerdict } from '../src/verdicts.ts'

/** 一次裁决，测试里的最小形态。`titleText` 是立此存照律的原料。 */
function verdictOn(id: string, family: string, at = Date.now()): SeenVerdict {
  return {
    anchor: { kind: 'commitment', id },
    kind: 'acceptance',
    actionId: 'accept',
    family,
    at,
    seq: 0,
    titleText: `探针 ${id}`,
  }
}

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const VIEWER: GraphViewer = { kind: 'operator', openId: 'op-1' }
const GOAL = 'https://yzj.example/doc/goal-1'
const TOPIC = 'yzj-topic-1'

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let pledger: YzjPledger
let bus: PledgerCards
let desk: PledgerDesk
let graphRoot: string
let pledgerRoot: string
/** Every private message the ledger tried to put in the operator's own chat. */
let delivered: string[]

/** Wait for the append chains to settle; both stores serialize behind promises. */
async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

beforeEach(async () => {
  graphRoot = await mkdtemp(join(tmpdir(), 'yzj-pledger-graph-'))
  pledgerRoot = await mkdtemp(join(tmpdir(), 'yzj-pledger-vault-'))
  delivered = []
  ctx = new Context()

  graph = new YzjGraph(ctx, { root: graphRoot })
  graph.defineFamily(commitmentFamily)
  graph.defineFamily(assessmentFamily)
  await graph.selectAccount('acct-1')

  // `Service` 的构造函数自己就挂上了座位——再 provide 一次是重复注册。
  cards = new YzjCards(ctx)
  cards.setDesktopActor(OPERATOR, '我')
  cards.register(createCommitmentCard(ctx))
  cards.register(assessmentCard)

  pledger = new YzjPledger(ctx, { root: pledgerRoot })
  await pledger.open('op-1')

  bus = new PledgerCards(ctx)
  bus.register(inviteCard)
  bus.register(calibrationCard)
  desk = createDesk(ctx, bus)
  ctx.provide('yzjPledgerDesk', desk)

  // 接缝①③ 的测试形态：和插件里挂的是同一对订阅。
  ctx.on('yzj-cards/verdict-settled', (payload) => {
    void inviteOnVerdict(ctx, payload).then(async (inviteId) => {
      if (inviteId === undefined) return
      const rendered = bus.renderText({ kind: 'invite', id: inviteId })
      if (rendered !== undefined) delivered.push(rendered.body)
    })
  })
  ctx.on('yzj-graph/appended', (event) => { void reflowOnGraphEvent(ctx, event) })
  ctx.on('yzj-pledger/appended', (event) => {
    void (async () => {
      if (event.type === 'fact/noted') await reflowOnNotedFact(ctx, event)
      if (event.type === 'calibration/opened') {
        const id = (event.data as { calibrationId?: string }).calibrationId
        if (id === undefined) return
        const rendered = bus.renderText({ kind: 'calibration', id })
        if (rendered !== undefined) delivered.push(rendered.body)
      }
    })()
  })
})

/** Register one commitment, claim delivery on it — the state `accept` needs. */
async function deliverCommitment(id: string, what = '竞品对比表'): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id,
      what,
      executor: { kind: 'human', openId: 'zr-1', name: '张锐', topicKey: TOPIC },
      sourceAnchor: `session:${TOPIC}`,
      topicKey: TOPIC,
      parentGoalRef: GOAL,
      delegatedBy: 'op-1',
    },
    actor: OPERATOR,
  })
  await graph.append({
    type: 'commitment/delivered',
    data: { commitmentId: id, delivery: { claim: '做完了', at: Date.now() } },
    actor: { kind: 'person', openId: 'zr-1' },
  })
}

/** 验收 —— 高信息裁决，环的第一环。 */
async function accept(id: string): Promise<void> {
  const result = await cards.act({ kind: 'commitment', id }, 'accept', OPERATOR, 'desktop')
  expect(result.outcome).toBe('applied')
  await settle()
}

const inviteOf = (id: string): string => inviteIdFor({ kind: 'commitment', id })

/** 立约 —— 人的那一句话，经现行邀约卡。 */
async function pledgeOn(id: string, text: string): Promise<void> {
  const result = await desk.pledge({ kind: 'commitment', id }, text)
  expect(result.ok).toBe(true)
  await settle()
}

describe('① 三不入负样本：走完全链，可应答聚合一个数都不动', () => {
  it('验收 → 邀约 → 立约 → 回执，pendingAnswerables 前后 diff 为空', async () => {
    await deliverCommitment('c-1')
    const before = graph.pendingAnswerables(VIEWER).map(object => `${object.kind}:${object.id}`)
    const demandsBefore = cards.demands(VIEWER).length

    await accept('c-1')
    expect(pledger.object('invite', inviteOf('c-1'))).toBeDefined()
    await pledgeOn('c-1', '评审能过，不返工')
    // 事实回流：这条被打回了 —— 结构匹配的第一种。
    await graph.append({
      type: 'commitment/reopened',
      data: { commitmentId: 'c-1', cause: '定价策略被追问' },
      actor: OPERATOR,
    })
    await settle()
    expect(pledger.query('calibration')).toHaveLength(1)

    const after = graph.pendingAnswerables(VIEWER).map(object => `${object.kind}:${object.id}`)
    /*
      **零 filter**：这里没有「排除私账」的一步，因为 `pendingAnswerables` 跑在
      组织图上，而私账对象根本不在那个 store 里 (PTD-2)。
    */
    expect(after.filter(key => PLEDGER_KINDS.some(kind => key.startsWith(`${kind}:`)))).toEqual([])
    // 验收把承诺推到终态，所以数会变；变的只该是**那一条**，一条私账对象都不该混进来。
    expect(before.every(key => !PLEDGER_KINDS.some(kind => key.startsWith(`${kind}:`)))).toBe(true)
    expect(cards.demands(VIEWER).length).toBeLessThanOrEqual(demandsBefore)
  })

  it('私账家族不声明 pendingStatuses —— 徽标聚合在定义域上碰不到它们', () => {
    for (const kind of PLEDGER_KINDS) {
      expect(graph.query(VIEWER, { kind })).toEqual([])
    }
    expect(expectationFamily.pendingStatuses).toBeUndefined()
  })
})

describe('② 单向引用双保险：依赖面 + schema 面', () => {
  it('组织侧包的 src 里不出现 pledger（import-ban lint）', async () => {
    const banned = ['objects', 'tools', 'channel', 'graph', 'cards']
    const offenders: string[] = []
    for (const pkg of banned) {
      const root = new URL(`../../${pkg}/src/`, import.meta.url)
      for (const file of await walk(root.pathname)) {
        const body = await readFile(file, 'utf8')
        if (body.includes('@yzj-next/pledger') || /\bpledger\b/i.test(body)) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('组织图事件 schema 无私账字段：写进去的会被剥掉', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-schema',
        what: 'x',
        executor: { kind: 'agent', topicKey: TOPIC },
        sourceAnchor: 'session:x',
        // 组织图上没有这个字段——它不是被拒绝，是根本没有位置。
        expectationId: 'exp-should-not-survive',
      } as never,
      actor: OPERATOR,
    })
    const state = graph.rawObject('commitment', 'c-schema')?.state as Record<string, unknown>
    expect(state.expectationId).toBeUndefined()
  })
})

describe('③ 不可改笔：改赌注 = 撤回 + 不可再立', () => {
  it('同一裁决二次 opened 幂等 no-op，withdrawn 之后也一样', async () => {
    await deliverCommitment('c-2')
    await accept('c-2')
    await pledgeOn('c-2', '第一版赌注')

    const second = await desk.pledge({ kind: 'commitment', id: 'c-2' }, '临近检验点改口')
    expect(second.ok).toBe(false)
    expect(second.ok === false && second.refusal.kind).toBe('duplicate')

    await desk.withdraw(expectationIdFor({ kind: 'commitment', id: 'c-2' }), '前提消失')
    await settle()
    const third = await desk.pledge({ kind: 'commitment', id: 'c-2' }, '撤回之后再立一个')
    expect(third.ok).toBe(false)
    // 撤回之后仍然是 duplicate：幂等锚把它吸收掉，史上只有那一条。
    expect(third.ok === false && third.refusal.kind).toBe('duplicate')
    expect(pledger.query('expectation')).toHaveLength(1)
  })

  it('词汇表上没有 expectation/updated —— 改笔的通道不存在', () => {
    expect(Object.keys(expectationFamily.events)).not.toContain('expectation/updated')
    expect(Object.keys(expectationFamily.events).some(type => type.endsWith('/updated'))).toBe(false)
  })
})

describe('④ 回执幂等：同（裁决,事实）不出第二执', () => {
  it('二次回流不出第二执；dismissed 之后不再出；reopened 可再答', async () => {
    await deliverCommitment('c-3')
    await accept('c-3')
    const verdict = verdictOn('c-3', FAMILY_DELIVERY_ACCEPTANCE)
    const shot = (text: string) => snapshot(text, { kind: 'commitment', id: 'c-3' })
    const source = { kind: 'org', why: 'reopened' } as const

    const first = await openCalibration(ctx, { verdict, fact: shot('被打回'), source })
    expect(first).toBeDefined()
    const second = await openCalibration(ctx, { verdict, fact: shot('被打回（又来一次）'), source })
    expect(second).toBeUndefined()
    expect(pledger.query('calibration')).toHaveLength(1)

    const id = first as string
    expect((await desk.act('calibration', id, 'dismiss')).outcome).toBe('applied')
    await settle()
    const third = await openCalibration(ctx, { verdict, fact: shot('第三次'), source })
    expect(third).toBeUndefined()

    expect((await desk.act('calibration', id, 'reopen')).outcome).toBe('applied')
    await settle()
    expect((await desk.act('calibration', id, 'q3')).outcome).toBe('applied')
    await settle()
    const state = pledger.object('calibration', id)?.state as Record<string, unknown>
    expect(state.status).toBe('answered')
    expect(state.attribution).toBe('q3')
  })
})

describe('⑤ 滚动模式：窗口必填，窗外不入计数、日志仍在', () => {
  it('窗外的判例不进模式，但它还在日志里', async () => {
    const now = Date.now()
    for (const id of ['c-5a', 'c-5b']) {
      await deliverCommitment(id)
      await accept(id)
      const calibrationId = await openCalibration(ctx, {
        verdict: verdictOn(id, FAMILY_GOAL_BREAKDOWN),
        fact: snapshot('被打回', { kind: 'commitment', id }),
        source: { kind: 'org', why: 'reopened' },
      })
      await desk.act('calibration', calibrationId as string, 'q3')
      await settle()
    }
    expect(patternsIn(pledger, { days: 90 }, now).map(one => one.count)).toEqual([2])
    /*
      窗口挪到未来一年之后，同一批判例一条都不进计数——而日志一行都没少。
      **滚动是派生窗口，不是删除**：金库照现在的你，不给你建档案。
    */
    const far = now + 400 * 24 * 60 * 60 * 1000
    expect(patternsIn(pledger, { days: 90 }, far)).toEqual([])
    // 判例永续：窗口挪走了，日志里那两条归因一行都没少。
    expect(pledger.events(['calibration/answered'])).toHaveLength(2)
  })
})

describe('⑥ 邀约输入面：生成器看不见镜子', () => {
  it('inviteFor 的签名里没有任何私账句柄（静态断言）', async () => {
    const source = await readFile(new URL('../src/invite.ts', import.meta.url), 'utf8')
    const signature = source.slice(
      source.indexOf('export function inviteFor'),
      source.indexOf('}): {'),
    )
    // 出处只能引用组织侧事实：签名里出现 pledger / pattern / mirror 任一即越界。
    for (const forbidden of ['YzjPledger', 'pledger', 'pattern', 'mirror', 'Case']) {
      expect(signature).not.toContain(forbidden)
    }
    expect(signature).toContain('OrgAnchor')
  })

  it('笔（inviteRender）的调用栈里没有任何一次 pgraph 读取——门可以读，笔不可以', async () => {
    await deliverCommitment('c-6')
    const reads: string[] = []
    for (const method of ['query', 'object', 'events', 'findByIdemKey'] as const) {
      const original = pledger[method].bind(pledger) as (...args: never[]) => unknown
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(pledger as unknown as Record<string, unknown>)[method] = (...args: never[]): unknown => {
        reads.push(method)
        return original(...args)
      }
    }
    inviteRender(ctx, {
      anchor: { kind: 'commitment', id: 'c-6' },
      kind: 'acceptance', actionId: 'accept', family: FAMILY_DELIVERY_ACCEPTANCE,
      at: Date.now(), seq: 1,
    })
    expect(reads).toEqual([])
  })
})

describe('⑦ 疲劳治理：连续三次不立就停问，重开在金库', () => {
  it('第四次触发点静默；invite/reopened 之后恢复', async () => {
    /*
      先把**全局日配额**开到最大 —— 这一层是 v2.0 新加的治理面（扩触发面的对偶）。

      族级降频治的是「这一类你不想聊」，日配额治的是「今天已经够了」。这条用例测的
      是前者，所以把后者让开；两层都在的时候，先撞上的是日配额——那本身就是设计要的
      效果（五个入口各自克制、合起来仍是骚扰）。
    */
    await desk.setQuota(3)
    await settle()
    /*
      **两层治理各测各的.**

      日配额（3/日）会先于族级降频撞上——那本身就是设计要的效果，可它会盖住这条
      用例要看的东西。所以族级那三次走 `inviteGate` 直接问判据（不消耗配额），
      配额那一层由它自己的用例看着。
    */
    for (const id of ['c-7a', 'c-7b', 'c-7c']) {
      await deliverCommitment(id)
      await accept(id)
      const invite = pledger.object('invite', inviteOf(id))
      expect(invite, `第 ${id} 次该开口`).toBeDefined()
      await desk.decline(inviteOf(id))
      await settle()
    }
    // 人用脚投票就是应答：第四次这一族整体不再开口。
    const quiet = inviteGate(ctx, verdictOn('c-7d', FAMILY_DELIVERY_ACCEPTANCE))
    expect(quiet).toBe('family-quiet')

    await desk.reopenInvites(FAMILY_DELIVERY_ACCEPTANCE)
    await settle()
    // 重开之后族级那一道让开了；剩下拦路的只有配额（今天已经开过三次口）。
    expect(inviteGate(ctx, verdictOn('c-7e', FAMILY_DELIVERY_ACCEPTANCE))).toBe('quota-spent')
    await desk.setQuota(3)
    await settle()
  })
})

describe('⑧ 通道纪律：私账内容离开桌面通道即事故', () => {
  it('组织侧卡的 renderText 里没有任何一句金库文案（canary）', async () => {
    await deliverCommitment('c-8')
    await accept('c-8')
    await pledgeOn('c-8', '这句赌注绝不许出现在任何一条组织侧文本里')
    await graph.append({
      type: 'commitment/reopened',
      data: { commitmentId: 'c-8', cause: '返工' },
      actor: OPERATOR,
    })
    await settle()

    const canaries = [
      '这句赌注绝不许出现在任何一条组织侧文本里',
      '仅你可见',
      '金库',
      '后视镜',
      '归因',
      '判例',
    ]
    for (const kind of cards.types()) {
      for (const object of graph.query(VIEWER, { kind })) {
        const rendered = cards.renderText({ kind, id: object.id })
        const body = `${rendered?.body ?? ''}${(rendered?.replyHints ?? []).join('')}`
        for (const canary of canaries) expect(body).not.toContain(canary)
      }
    }
  })

  it('后视镜条只经桌面组合点，`stripFor` 在未开镜时是空的', async () => {
    expect(desk.stripFor('commitment')).toBeUndefined()
  })
})

describe('⑨ viewer 单态：place viewer 构造不出私账查询', () => {
  it('私账每一个读取方法的签名里都没有 viewer；组织图那一侧每一个都有', async () => {
    /*
      这一条断言的是**签名**，不是行为——因为它要挡住的正是「有人给读取面加一个
      viewer 参数」这件事，而那件事本身不会让任何一条现有用例变红。所以它扫源码：
      和 import 禁令同一种门，同一种可机械判定的形态。
    */
    const service = await readFile(new URL('../src/service.ts', import.meta.url), 'utf8')
    for (const method of ['object(', 'query(', 'events(', 'findByIdemKey(']) {
      const line = service.split('\n').find(one => one.trimStart().startsWith(method))
      expect(line, `${method} 不在 service.ts 里`).toBeDefined()
      expect(line).not.toContain('viewer')
    }
    // 组织图那一侧恰恰相反：每一个公开读取都带着查看者，而这正是两本账的分界。
    const graphService = await readFile(
      new URL('../../graph/src/service.ts', import.meta.url), 'utf8',
    )
    for (const method of ['object(', 'query(', 'events(']) {
      const line = graphService.split('\n').find(one => one.trimStart().startsWith(method))
      expect(line, `${method} 不在 graph/service.ts 里`).toBeDefined()
      expect(line).toContain('viewer')
    }

    // `PledgerViewer` 是**单态**：没有 `place` 那一支，也就构造不出一个别人。
    const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
    expect(types).toContain("kind: 'operator'")
    expect(types).not.toMatch(/readonly kind:\s*'place'/)
  })

  it('云之家场所触发的回合碰不到这本账 —— 单调拒绝，别人的 allow 翻不回来', async () => {
    const { pledgerDenial, PLEDGER_TOOLS } = await import('../src/tools.ts')
    const placeAgent = { session: { id: 'sess-place' } } as never
    /*
      turn binding 由编排层给，模型永远拿不到这个参数——所以这里造的是**编排层的
      那一侧**：一个来自群里的回合，viewer 是 place。
    */
    ctx.provide('yzjTurns', {
      bindingFor: () => ({
        viewer: { kind: 'place', placeKey: 'yzj-group-g1' },
        decider: 'op-1',
        accountKey: 'acct-1',
      }),
      defaultBinding: () => undefined,
    } as never)
    for (const name of PLEDGER_TOOLS) {
      expect(pledgerDenial(ctx, { name, agent: placeAgent })).toContain('私账')
    }
    // 组织侧的工具一个都不受影响：这道门只认这两个名字。
    expect(pledgerDenial(ctx, { name: 'yzj_doc_create', agent: placeAgent })).toBeUndefined()
  })

  it('私账目录不出现在审计导出会走的组织图分区里', async () => {
    const graphFiles = await readdir(join(graphRoot, 'acct-1'))
    expect(graphFiles.some(name => name.includes('pledger'))).toBe(false)
  })
})

describe('⑩ 部署开关：关掉就是什么都没有', () => {
  it('enabled=false：零目录、零服务、零入口', async () => {
    const bare = new Context()
    const root = await mkdtemp(join(tmpdir(), 'yzj-pledger-off-'))
    const plugin = await import('../src/index.ts')
    plugin.apply(bare, { enabled: false, root })
    await settle()
    expect(bare.get('yzjPledgerDesk')).toBeUndefined()
    expect(bare.get('yzjPledger')).toBeUndefined()
    expect(await readdir(root)).toEqual([])
  })

  it('六接缝在没有 desk 的上下文里全部回落成「什么都没有」', () => {
    const bare = new Context()
    expect(bare.get('yzjPledgerDesk')?.stripFor('commitment')).toBeUndefined()
    expect(bare.get('yzjPledgerDesk')?.twoReadFor('commitment')).toBeUndefined()
    expect(bare.get('yzjPledgerDesk')?.vault()).toBeUndefined()
  })
})

describe('⑪ 取走与销毁', () => {
  it('目录拷走之后独立可读（自包含）', async () => {
    await deliverCommitment('c-11')
    await accept('c-11')
    await pledgeOn('c-11', '拷贝之后还读得出来')
    await pledger.flush()

    const copy = await mkdtemp(join(tmpdir(), 'yzj-pledger-copy-'))
    await cp(join(pledgerRoot, 'op-1'), join(copy, 'op-1'), { recursive: true })
    const loaded = await new PledgerLog(join(copy, 'op-1')).load()
    expect(loaded.damagedLines).toBe(0)
    expect(loaded.events.some(event => (
      event.type === 'expectation/opened'
      && (event.data as { text?: string }).text === '拷贝之后还读得出来'
    ))).toBe(true)
  })

  it('销毁是两段式，执行后目录不在了', async () => {
    await deliverCommitment('c-11b')
    await accept('c-11b')
    await expect(desk.destroy('删掉')).rejects.toThrow(/不可逆/)
    await desk.destroy(DESTROY_PHRASE)
    await expect(readdir(join(pledgerRoot, 'op-1'))).rejects.toThrow()
  })
})

describe('⑫ 八环走查：每一环既可见又可动', () => {
  it('裁决 → 立约 → 回流 → 归因 → 判例 → 模式 → 后视镜 → 下一张卡在场', async () => {
    // 环1 裁决
    await deliverCommitment('c-12a', '竞品对比表')
    await accept('c-12a')
    expect(delivered.some(text => text.includes('立个预期'))).toBe(true)

    // 环2 立约（人的原话）
    await pledgeOn('c-12a', '评审能过，不返工')

    // 环3 事实回流（结构匹配）
    await graph.append({
      type: 'commitment/reopened',
      data: { commitmentId: 'c-12a', cause: '定价策略被追问' },
      actor: OPERATOR,
    })
    await settle()
    const receipt = pledger.query('calibration')[0]
    expect(receipt).toBeDefined()
    expect(delivered.some(text => text.includes('当时裁决 × 后来事实'))).toBe(true)

    // 环4 归因（人自己下）
    expect((await desk.act('calibration', receipt?.id as string, 'q3')).outcome).toBe('applied')
    await settle()

    // 环5 判例入账 —— 预期同时归档
    const expectation = pledger.object('expectation', expectationIdFor({ kind: 'commitment', id: 'c-12a' }))
    expect((expectation?.state as { status?: string }).status).toBe('settled')

    // 环6 模式浮现（第二条同族判例之后）
    await deliverCommitment('c-12b', '价格页 v2')
    await accept('c-12b')
    const second = await openCalibration(ctx, {
      verdict: verdictOn('c-12b', FAMILY_DELIVERY_ACCEPTANCE),
      fact: snapshot('也被打回了', { kind: 'commitment', id: 'c-12b' }),
      source: { kind: 'org', why: 'reopened' },
    })
    await desk.act('calibration', second as string, 'q3')
    await settle()
    const patterns = vaultView(pledger).patterns
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.count).toBe(2)

    // 环7 回喂：人签发后视镜
    expect(desk.stripFor('commitment')).toBeUndefined()
    await desk.mirror(FAMILY_DELIVERY_ACCEPTANCE, patterns[0]?.patternKey as string, true)
    await settle()
    const strip = desk.stripFor('commitment')
    expect(strip?.cases.length).toBeGreaterThan(0)
    expect(strip?.note).toContain('判断仍由你下')

    // 环8 再裁决：下一张同族卡上，判例在场
    await deliverCommitment('c-12c', '下一份交付')
    expect(desk.stripFor('commitment')?.cases.length).toBeGreaterThan(0)

    // 合环阀：换挡台就在同一屏上，而且真的动得了
    await desk.shift(FAMILY_DELIVERY_ACCEPTANCE, 'weight', 'vault')
    await settle()
    expect(desk.gearEffectFor('commitment')).toMatchObject({
      gear: 'weight', preselect: false, quickAccept: false, spreadEvidence: true,
    })

    // 金库每一行都带着它自己的动词——说明文字占位同罪
    const view = vaultView(pledger)
    expect(view.settled.every(row => row.verbs.includes('reattribute'))).toBe(true)
    expect(view.patterns.every(row => row.verbs.includes('mirror'))).toBe(true)
    expect(view.gears.every(row => row.verbs.includes('shift'))).toBe(true)
    expect(view.invites.every(row => row.verbs.includes('invite-reopen'))).toBe(true)
    // 已撤回区是终态：一个动词都没有，而那是有理由的。
    for (const row of view.withdrawn) expect(row.verbs).toEqual([])
  })
})

describe('⑬ 原话直存：模型没有 text 这个参数', () => {
  it('pledger_register 的 schema 上不存在 text', async () => {
    const registered: { name: string; parameters?: Record<string, unknown> }[] = []
    const toolCtx = new Context()
    toolCtx.provide('tools', {
      register: (definition: { name: string; parameters?: Record<string, unknown> }) => {
        registered.push(definition)
        return () => undefined
      },
      guard: () => () => undefined,
    } as never)
    toolCtx.provide('yzjPledger', pledger)
    const { applyPledgerTools } = await import('../src/tools.ts')
    applyPledgerTools(toolCtx)
    /*
      **参数名在 `properties` 里，不在 `parameters` 上**。

      `defineTool` 把参数规范化成 JSON Schema（`{ type, properties }`），所以
      `Object.keys(parameters)` 拿到的永远是 `['type','properties']`——那个写法
      检查不到任何一个参数名，这条断言在它自己的门槛上**空转了整整一轮**。
      一条永远为真的断言比没有断言更坏：它会让人以为这里有人看着。
    */
    const propsOf = (one?: { parameters?: Record<string, unknown> }): string[] => (
      Object.keys((one?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {})
    )
    const register = registered.find(one => one.name === 'pledger_register')
    expect(register).toBeDefined()
    // 先证明这个读法真的读到了参数名，再拿它去证明 `text` 不在里面。
    expect(propsOf(register)).toContain('action')
    expect(propsOf(register)).not.toContain('text')
    // 只读那一个也不该有 —— 读的东西没有理由带一句话进来。
    const query = registered.find(one => one.name === 'pledger_query')
    expect(propsOf(query)).toContain('zone')
    expect(propsOf(query)).not.toContain('text')
  })

  it('expectation.text 与人的原话逐字节一致', async () => {
    const words = '评审能过，但定价策略那一段大概率被追问 —— 返 1 轮以内'
    await deliverCommitment('c-13')
    await accept('c-13')
    await pledgeOn('c-13', words)
    const state = pledger.object('expectation', expectationIdFor({ kind: 'commitment', id: 'c-13' }))
      ?.state as { text?: string }
    expect(state.text).toBe(words)
  })
})

describe('⑭ 立约时窗：越窗与重复是两种拒因', () => {
  it('没有现行邀约时对历史裁决锚立约 = no-invite，不是 duplicate', async () => {
    // 这次裁决从来没开过口（该族已停问的等价情形：邀约根本不存在）。
    await deliverCommitment('c-14')
    const refused = await desk.pledge({ kind: 'commitment', id: 'c-14' }, '事后补立')
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.refusal.kind).toBe('no-invite')
    expect(refused.ok === false && refused.refusal.message).toContain('预期只在裁决时刻出生')
    expect(pledger.query('expectation')).toEqual([])
  })

  it('按下不表之后邀约关上 = window-closed，也不是 duplicate', async () => {
    await deliverCommitment('c-14b')
    await accept('c-14b')
    await desk.decline(inviteOf('c-14b'))
    await settle()
    const refused = await desk.pledge({ kind: 'commitment', id: 'c-14b' }, '反悔了想立')
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.refusal.kind).toBe('window-closed')
  })
})

describe('⑮ 事实回流三分', () => {
  it('结构匹配①：被裁决的对象被打回', async () => {
    await deliverCommitment('c-15a')
    await accept('c-15a')
    await graph.append({
      type: 'commitment/reopened',
      data: { commitmentId: 'c-15a', cause: '返工' },
      actor: OPERATOR,
    })
    await settle()
    const state = pledger.query('calibration')[0]?.state as { factSource?: { why?: string } }
    expect(state.factSource?.why).toBe('reopened')
  })

  it('结构匹配②：同目标下回指本次裁决的血缘新边', async () => {
    await deliverCommitment('c-15b')
    await accept('c-15b')
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-15b-child',
        what: '补一版定价对比',
        executor: { kind: 'human', openId: 'zr-1', name: '张锐', topicKey: TOPIC },
        sourceAnchor: `session:${TOPIC}`,
        topicKey: TOPIC,
        parentGoalRef: GOAL,
      },
      actor: OPERATOR,
    })
    await settle()
    const state = pledger.query('calibration')[0]?.state as { factSource?: { why?: string } }
    expect(state.factSource?.why).toBe('lineage')
  })

  it('结构匹配②的时间边界：三周后同一段对话里的新活，不再算这次裁决的后来', async () => {
    await deliverCommitment('c-15b-old')
    await accept('c-15b-old')
    const before = pledger.query('calibration').length
    /*
      时间由 `structuralFactFor` 直接读事件的 `time`，而测试造不出一条三周后的
      事件——所以这里直接问那个纯函数，用一条**时间戳在三周后**的事件。
      这一条守的是：忙碌的目标里，每一次新登记都不该对着你上一次验收出一张回执。
    */
    const verdict = watchedVerdicts(ctx).find(one => one.anchor.id === 'c-15b-old')
    expect(verdict).toBeDefined()
    const late = {
      v: 1 as const,
      sv: 1,
      seq: 9_999,
      time: (verdict?.at ?? 0) + 21 * 24 * 60 * 60 * 1000,
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-15b-late',
        what: '三周后的另一件事',
        parentGoalRef: GOAL,
        sourceAnchor: `session:${TOPIC}`,
      },
      actor: { kind: 'operator' as const, openId: 'op-1' },
    }
    expect(structuralFactFor(ctx, verdict as never, late)).toBeUndefined()
    expect(pledger.query('calibration').length).toBe(before)
  })

  it('结构匹配③：同一目标上后来的差距简报', async () => {
    await deliverCommitment('c-15c')
    await accept('c-15c')
    await graph.append({
      type: 'assessment/reported',
      data: {
        assessmentId: 'as-1',
        goalRef: GOAL,
        summary: '两条达成，一条有差距',
        sourceAnchor: `session:${TOPIC}`,
        decider: 'op-1',
      },
      actor: { kind: 'agent' },
    })
    await settle()
    const state = pledger.query('calibration')[0]?.state as { factSource?: { why?: string } }
    expect(state.factSource?.why).toBe('assessed')
  })

  it('人工补登：图外事实经一句话进来，指认错了可经第五出口消解', async () => {
    await deliverCommitment('c-15d')
    await accept('c-15d')
    await pledgeOn('c-15d', '线下评审能过')
    const expectationId = expectationIdFor({ kind: 'commitment', id: 'c-15d' })
    await desk.note('线下评审过了，但被追问定价', { kind: 'expectation', expectationId })
    await settle()
    const receipt = pledger.query('calibration')[0]
    const state = receipt?.state as { factSource?: { kind?: string }; fact?: { text?: string } }
    expect(state.factSource?.kind).toBe('noted')
    expect(state.fact?.text).toBe('线下评审过了，但被追问定价')

    // 指认错了 → 第五出口（与断言④连通）
    expect((await desk.act('calibration', receipt?.id as string, 'dismiss')).outcome).toBe('applied')
    await settle()
    expect(vaultView(pledger).settled).toEqual([])
  })

  it('补登也可以直接指认一次裁决（隐式预期路径）', async () => {
    await deliverCommitment('c-15e')
    await accept('c-15e')
    // 没立预期。**回执照样会来**——裁决本身就是隐式预期。
    await desk.note('线下听说这版被客户直接用了', {
      kind: 'verdict',
      verdict: snapshot('二轮探针', { kind: 'commitment', id: 'c-15e' }),
    })
    await settle()
    const state = pledger.query('calibration')[0]?.state as {
      expectationId?: string; thenText?: string; factSource?: { kind?: string }
    }
    expect(state.factSource?.kind).toBe('noted')
    expect(state.expectationId).toBeUndefined()
    /*
      **隐式预期不措辞化** (v2.0 / #62-C7)：没有显式预期时，「当时」栏只陈列裁决
      事实本身，**不代人推演其含义**。v1.x 写的「隐式预期即『它已经够好』」是 agent
      替你写好了你当时在想什么——和预填出处律、归因候选措辞是同一族违规。
    */
    expect(state.thenText ?? '').toContain('你在')
    expect(state.thenText ?? '').not.toContain('已经够好')
  })

  it('ambient 语义识别路径不存在（P1）', () => {
    const sources = pledger.query('calibration')
      .map(object => (object.state as { factSource?: { kind?: string } }).factSource?.kind)
    expect(sources.every(source => source === undefined || source === 'org' || source === 'noted')).toBe(true)
  })
})

describe('时间轮：检验点到了问一次，不再追（PTD-14）', () => {
  it('到期问一次并落账；第二次滴答不再问', async () => {
    await deliverCommitment('c-tick')
    await accept('c-tick')
    // 检验点带得出戳的那一支——含糊的检验点不参与时间轮，也永远不算逾期。
    const expectationId = expectationIdFor({ kind: 'commitment', id: 'c-tick' })
    await pledger.append({
      type: 'expectation/opened',
      data: {
        expectationId,
        text: '周五前签回',
        checkpoint: { text: '2020-01-01', ts: Date.parse('2020-01-01') },
        verdict: anchoredJson(snapshot('周五前签回', { kind: 'commitment', id: 'c-tick' })),
        inviteId: inviteOf('c-tick'),
        family: FAMILY_DELIVERY_ACCEPTANCE,
        idemKey: `expectation:commitment:c-tick-clock`,
      },
      actor: OPERATOR,
    })
    const asked: string[] = []
    const first = await tickCheckpoints(ctx, async (text) => { asked.push(text) })
    expect(first).toContain(expectationId)
    expect(asked[0]).toContain('后来怎么样了')
    const second = await tickCheckpoints(ctx, async (text) => { asked.push(text) })
    expect(second).toEqual([])
  })
})

/** Every `.ts` file under one directory, recursively. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('自聊 DM 的文本投影：P1 只出不进，所以报信不提问', () => {
  it('邀约与回执的字面里没有一句「回复…」，也不给回复提示', async () => {
    await deliverCommitment('c-dm')
    await accept('c-dm')
    const invite = bus.renderText({ kind: 'invite', id: inviteOf('c-dm') })
    expect(invite?.replyHints).toEqual([])
    expect(invite?.body).not.toContain('回复「')
    expect(invite?.body).toContain('桌面工作台')

    await pledgeOn('c-dm', '一轮过')
    await graph.append({
      type: 'commitment/reopened',
      data: { commitmentId: 'c-dm', cause: '返工' },
      actor: OPERATOR,
    })
    await settle()
    const receipt = bus.renderText({
      kind: 'calibration', id: pledger.query('calibration')[0]?.id as string,
    })
    expect(receipt?.replyHints).toEqual([])
    expect(receipt?.body).not.toContain('回复「')
    expect(receipt?.body).toContain('未答不成欠账')
  })

  it('关键词状态机仍然是齐的 —— 缺的只是运输（押 P5 移动形态）', async () => {
    await deliverCommitment('c-kw')
    await accept('c-kw')
    const ref = { kind: 'invite', id: inviteOf('c-kw') }
    expect(bus.resolveKeyword(ref, '立约 评审能过')).toEqual({ actionId: 'pledge', input: '评审能过' })
    expect(bus.resolveKeyword(ref, '不立')).toEqual({ actionId: 'decline' })
  })
})

describe('自审补的四条：这些改坏了都不会报错，只会安静地伤人', () => {
  it('一份事实至多出一张执 —— 一份简报不该同时配十次裁决', async () => {
    for (const id of ['c-fan-a', 'c-fan-b', 'c-fan-c']) {
      await deliverCommitment(id)
      await accept(id)
    }
    const before = pledger.query('calibration').length
    // 一份差距简报落在同一个目标上：三条裁决在结构上都「匹配」得到它。
    await graph.append({
      type: 'assessment/reported',
      data: {
        assessmentId: 'as-fan',
        goalRef: GOAL,
        summary: '两条达成，一条有差距',
        sourceAnchor: `session:${TOPIC}`,
        decider: 'op-1',
      },
      actor: { kind: 'agent' },
    })
    await settle()
    /*
      只出一张，而且是配**最近那一次**裁决的。

      三张回执里至少两张，人打开就知道该按「配对错了」——第五出口存在是因为配对可能
      错，不是因为我们该批量制造错配。剩下那两次裁决没有丢：它们在金库的待对表里，
      人可以自己补登事实来配对。
    */
    const after = pledger.query('calibration')
    expect(after.length - before).toBe(1)
    const born = after.find(one => (one.state as { fact?: { anchor?: { id?: string } } })
      .fact?.anchor?.id === 'as-fan')
    expect((born?.state as { verdict?: { anchor?: { id?: string } } }).verdict?.anchor?.id)
      .toBe('c-fan-c')
  })

  it('检验点必须在未来：交付期限早已过去时不拿它当检验点', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-past',
        what: '早就该交的活',
        executor: { kind: 'human', openId: 'zr-1', name: '张锐', topicKey: TOPIC },
        sourceAnchor: `session:${TOPIC}`,
        topicKey: TOPIC,
        parentGoalRef: GOAL,
        delegatedBy: 'op-1',
        // 验收发生在交付之后，所以到你下判断的时候这个日子早过了。
        due: '2020-01-01',
      },
      actor: OPERATOR,
    })
    await graph.append({
      type: 'commitment/delivered',
      data: { commitmentId: 'c-past', delivery: { claim: '补上了', at: Date.now() } },
      actor: { kind: 'person', openId: 'zr-1' },
    })
    await accept('c-past')
    const invite = pledger.object('invite', inviteOf('c-past'))?.state as {
      checkpointText?: string; checkpointTs?: number
    }
    // 不给戳：无戳的预期不参与时间轮，等结构性事实或人自己回来对表。
    expect(invite.checkpointTs).toBeUndefined()
    expect(invite.checkpointText).toBe('下一次这件事在图上有动静时')

    await pledgeOn('c-past', '这次不会再返工')
    const asked: string[] = []
    await tickCheckpoints(ctx, async (text) => { asked.push(text) })
    // 立完约当场被追问「后来怎么样了」，是这条修法要防的那一幕。
    expect(asked).toEqual([])
  })

  it('检验点到了但回执已经在等你了，就不该再问一遍', async () => {
    await deliverCommitment('c-dup-ask')
    await accept('c-dup-ask')
    const expectationId = expectationIdFor({ kind: 'commitment', id: 'c-dup-ask' })
    await pledger.append({
      type: 'expectation/opened',
      data: {
        expectationId,
        text: '一轮过',
        checkpoint: { text: '2020-01-01', ts: Date.parse('2020-01-01') },
        verdict: anchoredJson(snapshot('一轮过', { kind: 'commitment', id: 'c-dup-ask' })),
        inviteId: inviteOf('c-dup-ask'),
        family: FAMILY_DELIVERY_ACCEPTANCE,
        idemKey: 'expectation:commitment:c-dup-ask-clock',
      },
      actor: OPERATOR,
    })
    // 结构性事实先到：回执已经躺在私语流里了。
    await graph.append({
      type: 'commitment/reopened',
      data: { commitmentId: 'c-dup-ask', cause: '返工' },
      actor: OPERATOR,
    })
    await settle()
    expect(pledger.query('calibration')).toHaveLength(1)

    const asked: string[] = []
    await tickCheckpoints(ctx, async (text) => { asked.push(text) })
    // 问一个自己刚刚答过的问题，比不问更伤信任。
    expect(asked).toEqual([])
  })

  it('销毁口令由服务端发，界面不写第二份字面', () => {
    expect(desk.destroyPhrase).toBe(DESTROY_PHRASE)
    expect(desk.vault()?.destroyPhrase).toBe(DESTROY_PHRASE)
  })
})

/* ——————————— v2.0 十条（#62）× v2.1 两条（#61 对象面澄清 × #62-A 接缝） ——————————— */

/** 事件条数 —— 「零事件写入」那几条断言的量尺。落盘之后数，不数内存。 */
async function eventCount(): Promise<number> {
  await pledger.flush()
  return (await new PledgerLog(join(pledgerRoot, 'op-1')).load()).events.length
}

/**
 * 一本**没有组织图**的账 —— 拷走目录，在另一个上下文里打开它。
 *
 * 这是「自包含」唯一诚实的测法：在同一个进程里 mock 掉 graph，测的是 mock；把
 * 目录拷到一个连 `yzjGraph` 都没 provide 过的 Context 里打开，测的才是那句话。
 */
async function loneReader(): Promise<{
  ctx: Context; pledger: YzjPledger; bus: PledgerCards; desk: PledgerDesk
}> {
  await pledger.flush()
  const copy = await mkdtemp(join(tmpdir(), 'yzj-pledger-lone-'))
  await cp(join(pledgerRoot, 'op-1'), join(copy, 'op-1'), { recursive: true })
  const bare = new Context()
  const lone = new YzjPledger(bare, { root: copy })
  await lone.open('op-1')
  const loneBus = new PledgerCards(bare)
  loneBus.register(inviteCard)
  loneBus.register(calibrationCard)
  return { ctx: bare, pledger: lone, bus: loneBus, desk: createDesk(bare, loneBus) }
}

/** 走完一整环并把归因下了 —— 判例册与证据面都要有东西可摆。 */
async function settledCase(id: string, bet: string, what = '竞品对比表'): Promise<string> {
  await deliverCommitment(id, what)
  await accept(id)
  await pledgeOn(id, bet)
  await graph.append({
    type: 'commitment/reopened',
    data: { commitmentId: id, cause: '定价策略被追问' },
    actor: OPERATOR,
  })
  await settle()
  const receipt = pledger.query('calibration').find(one => (
    (one.state as { verdict?: { anchor?: { id?: string } } }).verdict?.anchor?.id === id
  ))
  expect(receipt).toBeDefined()
  await desk.act('calibration', receipt?.id as string, 'q3')
  await settle()
  return receipt?.id as string
}

describe('⑯ 立此存照：schema 上没有裸锚的位置', () => {
  it('词汇表里 orgAnchor 只出现两处：它自己，和 anchoredText 的那个可空字段', async () => {
    const source = await readFile(new URL('../src/vocabulary.ts', import.meta.url), 'utf8')
    /*
      扫的是**代码**，不是注释——文档当然要提到这两个词。

      这一条挡的不是笔误，是**下一个人的顺手**：给某个事件加一个 `verdictRef:
      orgAnchor` 只要一行，而那一行会让判例在拷走的目录里退回成一串 id。
    */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const uses = code.split('\n').map(line => line.trim()).filter(line => line.includes('orgAnchor'))
    expect(uses).toEqual([
      'const orgAnchor = z.object({',
      'anchor: orgAnchor.optional(),',
    ])
  })

  it('断开组织图之后：六区 / 回执正文 / 判例册全部零缺字', async () => {
    const receiptId = await settledCase('c-16', '评审能过，不返工')
    const lone = await loneReader()

    // 这个上下文里**根本没有** yzjGraph——不是被 mock 掉，是没 provide 过。
    expect(lone.ctx.get('yzjGraph')).toBeUndefined()

    const view = lone.desk.vault()
    const one = view?.settled[0]
    expect(one?.thenText).toContain('评审能过，不返工')
    expect(one?.verdict.text).toBe('竞品对比表')
    expect(one?.fact.text.length).toBeGreaterThan(0)
    expect(JSON.stringify(view)).not.toContain('undefined')

    /*
      回执正文：**当时 / 事实 / 证据**三段全是照片，所以在这里一个字都不少。

      「当时」那一段渲染的是**你自己那句赌注**（有立约时）而不是裁决标题——裁决
      标题的照片在金库行与判例册上。三处读的都是照片，没有一处回图。
    */
    const body = lone.bus.renderText({ kind: 'calibration', id: receiptId })?.body
    expect(body).toContain('评审能过，不返工')
    expect(body).not.toContain('undefined')

    // 判例册同理——它本来就只读照片。
    const casebook = casebookOf(lone.pledger)
    expect(casebook).toContain('评审能过，不返工')
    expect(casebook).toContain('竞品对比表')
  })

  it('正文渲染路径上没有 labelOf —— 取内容只发生在拍照那一刻', async () => {
    /*
      `labelOf` 是这个包里唯一一处读组织侧文本的函数。它只该出现在**写入**路径上
      （拍照）。出现在任何投影/渲染文件里，就是「判例是空壳」在下一次重演。
    */
    const renderers = ['vault.ts', 'desk.ts', 'export.ts', 'calibration.ts', 'invite.ts', 'patterns.ts']
    for (const file of renderers) {
      const body = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')
      expect(body.includes('labelOf(')).toBe(false)
    }
  })
})

describe('⑰ 人可读取走：拷得走 ≠ 取得走', () => {
  it('判例册是纯 markdown，每条三段，且没有 id-only 的悬挂引用', async () => {
    await settledCase('c-17', '这一轮能过')
    const casebook = casebookOf(pledger)

    expect(casebook.startsWith('# ')).toBe(true)
    expect(casebook).toContain('- **当时**：')
    expect(casebook).toContain('- **事实**：')
    /*
      **悬挂引用扫描**：正文那三段里不许出现「只有坐标没有话」的行。

      锚可以在，但只许出现在那一行明说自己是坐标的括注里——一份读者得回到本系统
      才看得懂的「可取走」，等于没有取走。
    */
    for (const line of casebook.split('\n')) {
      // 「证据：」是嵌套清单的表头，它的话在下面几行——不是空值。
      if (!line.startsWith('- **') || line.trim().endsWith('**证据**：')) continue
      const value = line.slice(line.indexOf('：') + 1).trim()
      expect(value).not.toMatch(/^(commitment|goal|assessment|approval):[\w-]+$/)
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('README 说清这本账是什么、格式是什么、不依赖谁', async () => {
    const readme = readmeOf(pledger.owner)
    expect(readme).toContain('不依赖任何外部系统')
    for (const refusal of ['无分数', '无排名', '无画像']) expect(readme).toContain(refusal)
  })

  it('导出是**读**操作：前后事件流一行不增', async () => {
    await settledCase('c-17b', '这次不返工')
    const before = await eventCount()
    const taken = desk.exportVault()
    expect(taken?.casebook.length).toBeGreaterThan(0)
    expect(taken?.readme.length).toBeGreaterThan(0)
    // 读自己的账是自由——一次导出不该在账上留下「你看过了」。
    expect(await eventCount()).toBe(before)
  })
})

describe('⑱ 锚死显形：显形，且只显形', () => {
  it('被锚的承诺作废 → 双出口出现，而事件流一行不增', async () => {
    await deliverCommitment('c-18')
    await accept('c-18')
    await pledgeOn('c-18', '这条会签回来')
    const before = await eventCount()

    await graph.append({
      type: 'commitment/voided',
      data: { commitmentId: 'c-18', cause: '客户转观望' },
      actor: OPERATOR,
    })
    await settle()

    const row = desk.vault()?.testing.find(one => one.verdict.anchor?.id === 'c-18')
    expect(row?.premise).toBe('changed')
    /*
      **双出口**，不是一个通知：撤回（诚实）或照旧对表（你说了算）。

      系统**不自动写 withdrawn**——代撤即代产。一个替你宣布「你这条不算了」的
      账本，记的就不再是你的判断了。
    */
    expect(row?.verbs).toContain('withdraw')
    expect(row?.verbs).toContain('settle-anyway')
    expect(await eventCount()).toBe(before)

    // 第二个出口按下去也**什么都不写**：它只是一句话。
    expect(desk.settleAnyway().note).toContain('照旧对表')
    expect(await eventCount()).toBe(before)
  })

  it('目标锚不是天生的死人 —— 它没有对象族，可它活得好好的', async () => {
    /*
      **这一条是在浏览器面板里看出来的**，不是想出来的。

      目标没有 `kind: 'goal'` 的对象族（它是一条 `state.goalRef` 等于该 URI 的
      承诺），于是 `rawObject('goal', uri)` 恒为 undefined —— 每一个目标锚都常年
      挂着「真身已变 / 已亡」。**少一块预览是没说话，一枚假徽记是说了假话**，而
      它说的偏偏是这本账最要紧的那一句：你当时押的前提还在不在。
    */
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-goal-alive',
        what: '把宏图续约签回来',
        executor: { kind: 'human', openId: 'op-1', name: '我', topicKey: TOPIC },
        sourceAnchor: `session:${TOPIC}`,
        topicKey: TOPIC,
        goalRef: GOAL,
      },
      actor: OPERATOR,
    })
    const { isAlive } = await import('../src/verdicts.ts')
    expect(isAlive(ctx, { kind: 'goal', id: GOAL })).toBe('live')

    // 目标真的死了的时候，它照旧显形——修的是假阳，不是把这条探测关掉。
    await graph.append({
      type: 'commitment/voided',
      data: { commitmentId: 'c-goal-alive', cause: '这个目标不做了' },
      actor: OPERATOR,
    })
    await settle()
    expect(isAlive(ctx, { kind: 'goal', id: GOAL })).toBe('changed')
    // 从来没有过的那个 URI 仍然是 changed（找过了，确实不在）。
    expect(isAlive(ctx, { kind: 'goal', id: 'https://yzj.example/doc/never' })).toBe('changed')
  })

  it('组织图不可达时 premise=unknown 且不显形，内容照旧完整', async () => {
    await deliverCommitment('c-18b')
    await accept('c-18b')
    await pledgeOn('c-18b', '拷走之后还认得出自己')
    const lone = await loneReader()

    const row = lone.desk.vault()?.testing.find(one => one.text === '拷走之后还认得出自己')
    // 读不到组织图时说一句「前提已变」是**编造**。认识论诚实的同款落点。
    expect(row?.premise).toBe('unknown')
    expect(row?.verbs).not.toContain('settle-anyway')
    expect(row?.verdict.text.length).toBeGreaterThan(0)
  })
})

describe('⑲ 判据三段式：谱纯 / 门读账 / 笔不读账', () => {
  it('谱是纯函数，且八类各自说得出为什么', () => {
    // 一个字符串进、一个布尔出。没有 ctx、没有 pgraph、没有 IO。
    expect(isPledgeable.length).toBe(1)

    const spectrum = Object.entries(VERDICT_SPECTRUM)
    expect(spectrum).toHaveLength(8)
    const yes = spectrum.filter(([, spec]) => spec.verdict === 'yes').map(([kind]) => kind)
    const no = spectrum.filter(([, spec]) => spec.verdict === 'no').map(([kind]) => kind)
    const gated = spectrum.filter(([, spec]) => spec.verdict === 'gated').map(([kind]) => kind)

    expect(yes.sort()).toEqual(['acceptance', 'assessment', 'delegation', 'lease-grant', 'rework'])
    /*
      **信息量否决位**：标准写确认每天几十次、每次都「有留痕、有下一步、有回流」，
      判据①②③ 全过——而它承载的判断量近乎零。在那里问立约，邀约就退化成 nag，
      **一个会 nag 的镜子没有人会再照第二次**。
    */
    expect(no).toEqual(['write-confirm'])
    // 押证据门的两种是**明标**，不是遗漏：谱上写着为什么押。
    expect(gated.sort()).toEqual(['disposal', 'goal-issuance'])
    for (const [, spec] of spectrum) {
      expect(spec.checkpoint.length).toBeGreaterThan(0)
      expect(spec.reflow.length).toBeGreaterThan(0)
    }
    for (const kind of yes) expect(isPledgeable(kind)).toBe(true)
    for (const kind of [...no, ...gated]) expect(isPledgeable(kind)).toBe(false)
  })

  it('门读账、笔不读账 —— 两个签名各在各的位置', async () => {
    const source = await readFile(new URL('../src/ring.ts', import.meta.url), 'utf8')
    const pen = source.slice(source.indexOf('export function inviteRender'))
    const penBody = pen.slice(0, pen.indexOf('\n}\n') + 1)
    // 笔只把话写出来：它的函数体里没有一次 pgraph 读取。
    expect(penBody.includes('yzjPledger')).toBe(false)
    expect(penBody.includes('pledger.query')).toBe(false)
  })
})

describe('⑳ 就地合环 + 入口不垄断', () => {
  it('answered 终态的回执行必带合环动词条', async () => {
    await settledCase('c-20', '这次能一轮过')
    const row = desk.privateRows().find(one => one.kind === 'calibration' && one.resolved)
    expect(row?.loopback).toBeDefined()
    expect(row?.loopback?.note).toContain('金库是汇总处')
    // 就地开镜落 `entry: 'receipt'` —— 入口的出处本身要留痕。
    await desk.mirror(FAMILY_DELIVERY_ACCEPTANCE, `${FAMILY_DELIVERY_ACCEPTANCE}:q3`, true, 'receipt')
    await settle()
    const events = pledger.events(['mirror/toggled'])
    expect((events.at(-1)?.data as { entry?: string }).entry).toBe('receipt')
    await desk.shift(FAMILY_DELIVERY_ACCEPTANCE, 'weight', 'receipt')
    await settle()
    expect((pledger.events(['gear/shifted']).at(-1)?.data as { entry?: string }).entry).toBe('receipt')
  })

  it('合环行只留在最近答完的那一张上 —— 否则它自己就成了 nag', async () => {
    await settledCase('c-20b', '第一条')
    await settledCase('c-20c', '第二条')
    const withLoopback = desk.privateRows().filter(row => row.loopback !== undefined)
    /*
      二十次确认 = 二十行「要不要给这类卡开后视镜」，而它问的偏偏是「你被问烦了没有」
      ——用重复二十遍的方式问这个问题，本身就是答案（与条尾两读同一条治理）。
    */
    expect(withLoopback).toHaveLength(1)
    const answered = desk.privateRows().filter(row => row.resolved)
    expect(withLoopback[0]?.seq).toBe(Math.max(...answered.map(row => row.seq)))
  })

  it('能力入口注册表：任一能力的入口 ≥ 2，且不许全落在金库', () => {
    /*
      #61 那条「凡只能在金库获得的能力即违规」此前只是一句文字。

      **给自己立的法要有自己的执法机关**——这张表就是它，而这一条用例就是执法。
    */
    expect(CAPABILITY_ENTRIES.length).toBeGreaterThan(0)
    for (const one of CAPABILITY_ENTRIES) {
      expect(one.entries.length).toBeGreaterThanOrEqual(2)
      // 同一个入口写两遍**不算两个入口**——凑数在这里凑不出来。
      expect(new Set(one.entries).size).toBe(one.entries.length)
    }

    /*
      「凡只能在金库获得的能力即违规」——而 P1 有**一处**还没做到，它在表上明标着。

      这里断言的是那个集合**恰好**是已知的那一个：认下的欠账冻在原地，新长出来的
      金库独占能力当场变红。一处不写下来的欠账，半年后就成了「本来就这样」。
    */
    const vaultOnly = CAPABILITY_ENTRIES.filter(one => (
      one.entries.every(entry => entry.startsWith('vault:'))
    ))
    expect([...vaultOnly.map(one => one.capability)].sort()).toEqual(['撤回预期', '补登事实'])
    for (const one of vaultOnly) expect(one.vaultOnly).toBe(true)
    // 反过来也要对得上：标了 `vaultOnly` 却其实有别的入口，是另一种谎。
    for (const one of CAPABILITY_ENTRIES) {
      expect(one.vaultOnly === true).toBe(vaultOnly.includes(one))
    }
  })
})

describe('㉑ 静默沉降：不变红、不计数、不催', () => {
  it('沉降与折叠是查询层产物 —— 零事件写入', async () => {
    await deliverCommitment('c-21a')
    await accept('c-21a')
    await pledgeOn('c-21a', '一个月后回头看')
    const before = await eventCount()

    const future = Date.now() + (SETTLE_DAYS + 30) * 24 * 60 * 60 * 1000
    const view = vaultView(pledger, { now: future })
    // 沉降只是这一次查询的分区结果——它没有在账上写下任何一行。
    expect(view.testing.length + view.awaiting.length + view.sunk.length).toBeGreaterThan(0)
    expect(await eventCount()).toBe(before)
  })

  it('沉降之后组织侧一个计数都不动，而那一行仍然可动', async () => {
    await deliverCommitment('c-21b')
    await accept('c-21b')
    await pledgeOn('c-21b', '这条会拖很久')
    const pending = graph.pendingAnswerables(VIEWER).length
    const demands = cards.demands(VIEWER).length

    const future = Date.now() + (SETTLE_DAYS + 1) * 24 * 60 * 60 * 1000
    const sunk = vaultView(pledger, { now: future }).sunk
    for (const row of sunk) {
      // 沉了不代表不可动：不再打扰 ≠ 不再可答。
      expect(row.verbs.length).toBeGreaterThan(0)
      expect(row.zone).toBe('settled')
    }
    expect(graph.pendingAnswerables(VIEWER).length).toBe(pending)
    expect(cards.demands(VIEWER).length).toBe(demands)
  })

  it('折叠归并条是门不是徽标：一句话 + 一次跳转', async () => {
    for (const id of ['c-21c', 'c-21d', 'c-21e']) {
      await deliverCommitment(id)
      await accept(id)
    }
    const open = desk.privateRows().filter(row => !row.resolved && row.zone === 'live')
    expect(open.length).toBeLessThan(FOLD_THRESHOLD + 1)
    const fold = desk.privateFold()
    if (fold !== undefined) {
      expect(fold.to).toBe('vault')
      // 归并条自己说清门后是什么。数字在句子里，不在角标里。
      expect(fold.label).toContain('一起看')
    }
  })
})

describe('㉒ 隐式预期不措辞化：第三种输入构造不出来', () => {
  it('renderWhen 是纯函数，两输入，输出逐字节可推导', () => {
    expect(renderWhen({ expectationText: '评审能过' })).toBe('预期「评审能过」')

    const photo = snapshot('竞品对比表', { kind: 'commitment', id: 'c-22' }, 1_700_000_000_000)
    const implicit = renderWhen({ verdictSnapshot: photo })
    /*
      **裁决本身即隐式预期**——可这句话不许被「措辞」。

      模板拼装陈列事实：照片里的那句话原样出现，其余全是常量。一旦这里改成模型
      生成，「当时」栏就成了系统替你回忆你当时在想什么。
    */
    expect(implicit).toContain('竞品对比表')
    expect(implicit.startsWith('你在 ')).toBe(true)
    expect(implicit).toBe(renderWhen({ verdictSnapshot: photo }))
  })

  it('这条路径的调用栈里没有任何一次模型调用', async () => {
    const source = await readFile(new URL('../src/reflow.ts', import.meta.url), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const forbidden of ['agent', 'llm', 'chat(', 'complete(', 'prompt']) {
      expect(code.includes(forbidden)).toBe(false)
    }
  })
})

describe('㉓ 分布镜无判词：陈列是镜子，解读是教练', () => {
  it('返回值里没有一句话 —— 只有四个数和一串本账里的 id', async () => {
    await settledCase('c-23', '这次能过')
    const distribution = attributionDistribution(pledger, DEFAULT_PATTERN_WINDOW)

    for (const cell of ['q1', 'q2', 'q3', 'q4'] as const) {
      expect(typeof distribution[cell]).toBe('number')
    }
    /*
      `cases` 里确实有字符串，可它们**只能是这本账里的 calibrationId**——
      标识符，不是替你写好的结论。这一条就是这么验的：每一个字符串都必须在账上
      找得到同名对象。**能返回文本的接口迟早会返回判词**，所以这里不留那个位置。
    */
    for (const ids of Object.values(distribution.cases)) {
      for (const id of ids) expect(pledger.object('calibration', id)).toBeDefined()
    }
    // 界面上的四个名字取自静态常量表，不来自这个查询。
    expect(JSON.stringify(distribution)).not.toContain('因判断')
  })

  it('分布查询同样强制滚动窗口 —— 没有「不限」这个取值', async () => {
    await settledCase('c-23b', '窗外那一条')
    const narrow = attributionDistribution(pledger, { days: 0 })
    expect(narrow.q1 + narrow.q2 + narrow.q3 + narrow.q4).toBe(0)
  })
})

describe('㉔ 动词族明拒：不给动词就不会误用', () => {
  it('私账卡与金库行的动作集合 ∩ 转发族 = ∅', async () => {
    await settledCase('c-24', '这条能过')
    expect(FORBIDDEN_VERBS).toEqual(['forward', 'quote', 'share', 'cite', 'mention'])

    for (const row of desk.privateRows()) {
      for (const action of row.actions) expect(FORBIDDEN_VERBS).not.toContain(action.id)
    }
    const view = desk.vault()
    const verbs = [
      ...(view?.testing ?? []).flatMap(row => row.verbs),
      ...(view?.settled ?? []).flatMap(row => row.verbs),
      ...(view?.patterns ?? []).flatMap(row => row.verbs),
      ...(view?.gears ?? []).flatMap(row => row.verbs),
    ]
    for (const verb of verbs) expect(FORBIDDEN_VERBS).not.toContain(verb)
  })

  it('转发/引用的取材面上没有 pgraph —— 组织侧的 source picker 不认识这个存储', async () => {
    // 与断言② 同一条链接器保证：组织侧 src 里 `pledger` 出现零次。
    const surface = new URL('../../surface/src/', import.meta.url)
    const offenders: string[] = []
    for (const file of await walk(surface.pathname)) {
      const body = await readFile(file, 'utf8')
      for (const verb of FORBIDDEN_VERBS) {
        if (body.includes(`'${verb}'`) && body.includes('pledger')) offenders.push(`${file}:${verb}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('㉕ 搜索面（两段：现在必绿 / 随全局搜索面解锁）', () => {
  it('金库内检索：命中只落金库行，且这个面上没有 viewer 参数', async () => {
    await settledCase('c-25', '搜得到这一句')
    // **仅本人可构造**：签名上没有「以谁的身份搜」这一问。
    expect(desk.search.length).toBe(1)

    const hits = desk.search('搜得到')
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) expect(pledger.object('expectation', hit.id) ?? pledger.object('calibration', hit.id)).toBeDefined()
    expect(desk.search('这本账里没有的一句话')).toEqual([])
  })

  it('组织侧的索引/检索构建栈里没有一次 pgraph 读取', async () => {
    /*
      **不需要过滤器**：组织侧的索引器根本不认识这个 store。

      这一条现在就成立，而且是负向的——它断言的是一件**没有发生**的事。
    */
    const banned = ['objects', 'tools', 'channel', 'graph', 'cards']
    const offenders: string[] = []
    for (const pkg of banned) {
      for (const file of await walk(new URL(`../../${pkg}/src/`, import.meta.url).pathname)) {
        const body = await readFile(file, 'utf8')
        if (/search|index/i.test(body) && /pledger/i.test(body)) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  /*
    第二段**明标为 skip**，而不是假装断言了一个不存在的面。

    2026-09-03 起平台**有**跨会话内容检索了（yzj-cli 0.1.6 `im message search`），
    可主册 §7 的**搜索面**仍未落座——skip 的理由从「平台无能力」变成「产品面未定」。
    **不把不存在的面写成已存在的接缝**——这一行随全局搜索面落座解锁。
  */
  it.skip('（押全局搜索面落座）place viewer 下 pledger provider 未注册，而非返回空', () => {
    expect(true).toBe(true)
  })
})

describe('㉖ 证据面：摘要为主、锚为辅、锚死显形', () => {
  it('渲染函数的入参里没有组织图 service —— 它连取内容的通道都没有', () => {
    /*
      两个参数：一串照片，和一个**只回状态不回内容**的探针。

      于是「锚失效不蒸发内容」不是一条要记得遵守的纪律——这个函数**做不到**
      去解析锚里的内容。
    */
    expect(evidenceRowsOf.length).toBe(2)

    const at = new Date(1_700_000_000_000).toISOString()
    const rows = evidenceRowsOf(
      [
        { text: '竞品对比表', at, anchor: { kind: 'commitment', id: 'dead' } },
        { text: '当时在档：挂在目标下', at, anchor: { kind: 'goal', id: 'live' } },
        { text: '人工补登：这条由你说出', at },
      ],
      anchor => (anchor.id === 'dead' ? 'changed' : anchor.id === 'live' ? 'live' : 'unknown'),
    )
    // 锚死：快照原样在场 + 一枚徽记。
    expect(rows[0]).toMatchObject({ text: '竞品对比表', premise: 'changed', mark: '真身已变 / 已亡' })
    expect(rows[1]?.mark).toBeUndefined()
    // 无锚 → unknown，**不显形**：说一句「真身已变」是编造。
    expect(rows[2]).toMatchObject({ premise: 'unknown' })
    expect(rows[2]?.mark).toBeUndefined()
    expect(rows[2]?.anchor).toBeUndefined()
  })

  it('断开组织图之后证据面零缺字，且 unknown 一枚徽记都不长', async () => {
    const receiptId = await settledCase('c-26', '这次能一轮过')
    const lone = await loneReader()
    const face = lone.desk.evidenceFor('calibration', receiptId)

    expect(face?.rows.length).toBeGreaterThan(0)
    for (const row of face?.rows ?? []) {
      expect(row.text.length).toBeGreaterThan(0)
      // 组织图不可达 → 三态里的 unknown，而 unknown 不显形。
      expect(row.premise).toBe('unknown')
      expect(row.mark).toBeUndefined()
    }
    expect(face?.note).toContain('备料不定案')
  })

  it('默认态 = 待对表首项的备料；对表不出屏 —— 证据在场时四格仍在行上', async () => {
    await deliverCommitment('c-26b')
    await accept('c-26b')
    await pledgeOn('c-26b', '默认态摆的就是它')

    const face = desk.evidenceDefault()
    expect(face?.title).toContain('出处')
    expect(face?.rows.some(row => row.text.length > 0)).toBe(true)

    // **对表不出屏**：证据面在场，而归因那一格仍然长在中栏那一行上。
    const receiptId = await settledCase('c-26c', '边看边答')
    expect(desk.evidenceFor('calibration', receiptId)?.rows.length).toBeGreaterThan(0)
    const row = desk.vault()?.settled.find(one => one.calibrationId === receiptId)
    expect(row?.verbs).toContain('reattribute')
    expect(row?.verbs).toContain('loopback')
  })
})

describe('㉘ 私账合同面板：与场所合同同语法，但没有对方代表', () => {
  it('硬区每一条都说得出自己的机械保证 —— 陈列「为什么改不了」不是「请勿修改」', () => {
    const contract = desk.contract()
    expect(contract.hard.length).toBeGreaterThanOrEqual(5)
    for (const term of contract.hard) {
      /*
        一条 guard 拦得住而面板说不清的规矩，和一条没人执行的规矩一样不可信。

        所以这里不许出现那句占位——**没写出机械保证本身就是问题**，而这条用例
        就是让它当场变红的地方。
      */
      expect(term.guarantee).not.toContain('还没写出它的机械保证')
      expect(term.guarantee.length).toBeGreaterThan(0)
      expect(term.how.length).toBeGreaterThan(0)
    }
    // chips 是这一面的入口摘要，不是它的第二份副本：两处 label 必须逐条对上。
    expect(contract.hard.map(term => term.label))
      .toEqual(CONTRACT_CHIPS.map(chip => chip.label))
  })

  it('软区 = 换挡台参数，每条说得出改在哪儿、以及两个方向的代价', () => {
    const contract = desk.contract()
    expect(contract.soft.map(term => term.label))
      .toEqual(['全局日配额', '沉降天数', '折叠阈值', '族级降频阈值'])
    for (const term of contract.soft) {
      // 说不出在哪儿改的「可调」，和不可调没有分别。
      expect(term.where.length).toBeGreaterThan(0)
      /*
        **两个方向的代价都要写**：一个只说「调大更宽松」的参数面，会让人一路
        调到底然后关掉整个功能。
      */
      expect(term.cost).toContain('；')
    }
    expect(contract.soft[0]?.value).toContain('/ 天')
  })

  it('agent 无提议权 —— 不是一条运行时检查，是模型工具动作枚举上的一处缺席', async () => {
    expect(desk.contract().agentMayPropose).toBe(false)
    expect(desk.contract().signedBy).toBe('你自己')

    const registered: { name: string; parameters?: Record<string, unknown> }[] = []
    const probe = new Context()
    probe.provide('tools', {
      register: (definition: { name: string; parameters?: Record<string, unknown> }) => {
        registered.push(definition)
        return () => undefined
      },
      guard: () => () => undefined,
    } as never)
    probe.provide('yzjPledger', pledger)
    const { applyPledgerTools } = await import('../src/tools.ts')
    applyPledgerTools(probe)

    const register = registered.find(one => one.name === 'pledger_register')
    const actions = (register?.parameters as {
      properties?: { action?: { enum?: string[] } }
    } | undefined)?.properties?.action?.enum
    expect(actions).toBeDefined()
    // 先证明读到的确实是那张枚举，再拿它去证明该缺席的都缺席。
    expect(actions).toContain('shift-gear')
    /*
      **另一半签署人是你自己，没有对方代表可以递案。**

      场所合同的软项 agent 可以提议修改；这一份不行。而它不靠一条运行时检查——
      枚举里根本没有这些值，模型连提议的通道都不存在。
    */
    for (const forbidden of ['quota', 'set-quota', 'settle-days', 'fold', 'fatigue', 'contract']) {
      expect(actions).not.toContain(forbidden)
    }
    // 配额确实可调——只是**只有人调得动**（金库配额行），工具面上没有它。
    expect(desk.setQuota).toBeTypeOf('function')
  })
})

describe('㉗ 记忆隔离：两本复利账互不蒸馏', () => {
  it('私账层的依赖面上没有 memory 服务 —— 金库写不进记忆库', () => {
    /*
      **免费于依赖方向铁律，但必须成文**。

      顺手把金库判例蒸进记忆库只需要一行代码；禁令必须先于那一行存在。
    */
    expect(pledgerInject).toEqual(['yzjGraph', 'yzjCards', 'tools'])
    expect(pledgerInject.some(one => /memory/i.test(one))).toBe(false)
  })

  it('私账层的源码里没有一行 import 碰记忆面 —— 反向同禁', async () => {
    const offenders: string[] = []
    for (const file of await walk(new URL('../src/', import.meta.url).pathname)) {
      const body = await readFile(file, 'utf8')
      for (const line of body.split('\n')) {
        // 只看 import 与服务取用两处；硬合同 chip 上写着「金库 ≠ 记忆」，那是文案。
        if (/^\s*import\b/.test(line) && /memory/i.test(line)) offenders.push(`${file}: ${line.trim()}`)
        if (/get\(['\"]\w*[Mm]emory/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('蒸馏器的输入面上没有 pgraph，而金库的 canary 永不出现在记忆里', async () => {
    const canary = '金库私账 canary：这句话只该活在第二本账上'
    await deliverCommitment('c-27')
    await accept('c-27')
    await pledgeOn('c-27', canary)
    await settle()

    // 蒸馏器：组织侧的那一个，它的源码里 pledger 出现零次（与断言② 同法）。
    const distiller = await readFile(
      new URL('../../objects/src/memory/tools.ts', import.meta.url), 'utf8',
    )
    expect(/pledger/i.test(distiller)).toBe(false)

    // canary 不在组织图的任何一条记忆事件里——也不在组织图的任何一条事件里。
    const memories = JSON.stringify(graph.rawEvents(['memory/distilled', 'memory/forgotten']))
    expect(memories).not.toContain(canary)
    expect(JSON.stringify(graph.rawEvents([]))).not.toContain(canary)
  })
})

/* ————— 读时升级：立此存照律之前写下的行，读回来仍然是一本完整的账 ————— */

describe('v1.x 账本：不迁移，读时升级', () => {
  /** 一行 v1.x 形态的日志。文本都在，只是叫别的名字。 */
  const legacyLine = (seq: number, type: string, data: unknown): string => JSON.stringify({
    // 时刻取「刚刚」：判例读的是滚动窗口，一条 2023 年的旧行本来就不该进近 90 天。
    v: 1, sv: 1, seq, time: Date.now() - 60_000 + seq, type, data,
    actor: { kind: 'operator', openId: 'op-1' },
  })

  it('折叠版本必须跟着形状走 —— 否则跑了一阵子的部署读的还是旧形状', () => {
    /*
      这一条是**实例上验到的**：读时升级住在折叠里，而落盘的快照是折叠的**结果**。
      不 bump 这个数字，已经跑起来的部署会一直读着旧形状折出来的状态，新代码在那些
      状态上只找得到「（这一段没有留下快照）」——账没丢，可屏幕上说它丢了。
    */
    expect(PLEDGER_FOLD_VERSION).toBeGreaterThanOrEqual(2)
  })

  it('纯函数：认得出的折成照片，认不出的原样不动', () => {
    const upgraded = asRecord(upgradeLegacy({
      calibrationId: 'cal-old',
      verdictRef: { kind: 'commitment', id: 'c-old', label: '竞品对比表', graphSeq: 12 },
      factRef: { source: 'noted', factId: 'fct-1' },
      factText: '被追问定价',
      evidence: ['人工补登：这条事实由你说出'],
      thenText: '预期「评审能过」',
    } as never, 1_700_000_000_000))

    expect(asRecord(upgraded?.verdict)).toMatchObject({ text: '竞品对比表' })
    expect(asRecord(asRecord(upgraded?.verdict)?.anchor)).toMatchObject({ kind: 'commitment', id: 'c-old', graphSeq: 12 })
    expect(asRecord(upgraded?.fact)).toMatchObject({ text: '被追问定价' })
    expect(asRecord(upgraded?.factSource)).toMatchObject({ kind: 'noted', factId: 'fct-1' })
    expect(asRecord((upgraded?.evidence as never[])[0])).toMatchObject({ text: '人工补登：这条事实由你说出' })

    // 已经是照片的**一个字都不动**——升级器最要紧的性质是不认识的东西不要碰。
    const photo = { text: '原样', at: 'x' }
    const kept = asRecord(upgradeLegacy({ calibrationId: 'c', verdict: photo } as never, 1))
    expect(kept?.verdict).toEqual(photo)
  })

  it('一本 v1.x 的账整本读回来：金库、回执正文、判例册全部有字', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzj-pledger-v1-'))
    const dir = join(root, 'op-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'pledger.jsonl'), [
      legacyLine(1, 'expectation/opened', {
        expectationId: 'exp-old',
        text: '这版评审能过，最多返一轮',
        checkpoint: { text: '下一次这件事在图上有动静时' },
        verdictRef: { kind: 'commitment', id: 'c-old', label: '私账层闭环探针 A' },
        evidenceRefs: [{ kind: 'goal', id: 'https://yzj.example/g', label: 'https://yzj.example/g' }],
        inviteId: 'inv-old',
        family: FAMILY_DELIVERY_ACCEPTANCE,
        status: 'testing',
      }),
      legacyLine(2, 'calibration/opened', {
        calibrationId: 'cal-old',
        verdictRef: { kind: 'commitment', id: 'c-old', label: '私账层闭环探针 A' },
        factRef: { source: 'noted', factId: 'fct-old' },
        expectationId: 'exp-old',
        evidence: ['人工补登：这条事实由你在私语通道说出，系统没有猜过图外'],
        thenText: '预期「这版评审能过，最多返一轮」',
        factText: '线下评审过了，但定价策略那一段被追问了两轮。',
        family: FAMILY_DELIVERY_ACCEPTANCE,
        status: 'open',
        idemKey: 'calibration:c-old|noted:fct-old',
      }),
      legacyLine(3, 'calibration/answered', { calibrationId: 'cal-old', attribution: 'q3', status: 'answered' }),
      legacyLine(4, 'expectation/settled', {
        expectationId: 'exp-old', calibrationRef: 'cal-old', status: 'settled',
      }),
      '',
    ].join('\n'))

    const bare = new Context()
    const old = new YzjPledger(bare, { root })
    await old.open('op-1')
    const oldBus = new PledgerCards(bare)
    oldBus.register(inviteCard)
    oldBus.register(calibrationCard)
    const oldDesk = createDesk(bare, oldBus)

    const one = oldDesk.vault()?.settled[0]
    expect(one?.verdict.text).toBe('私账层闭环探针 A')
    expect(one?.fact.text).toBe('线下评审过了，但定价策略那一段被追问了两轮。')
    expect(one?.attributionLabel).toBe('错了 · 因判断')

    const body = oldBus.renderText({ kind: 'calibration', id: 'cal-old' })?.body
    expect(body).toContain('线下评审过了')
    expect(body).not.toContain('没有留下快照')

    const casebook = casebookOf(old)
    expect(casebook).toContain('私账层闭环探针 A')
    expect(casebook).not.toContain('没有留下快照')

    /*
      **升级发生在读上，不在盘上**：这本账的日志一行没变。

      改写历史在这本账上是明拒的——一本会自己改写过去的判断记录，正是它存在的
      理由的反面。
    */
    const after = (await readFile(join(dir, 'pledger.jsonl'), 'utf8')).split('\n').filter(line => line !== '')
    expect(after).toHaveLength(4)
    expect(after[1]).toContain('verdictRef')
  })
})
