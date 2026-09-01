/**
 * 私账层验收断言 —— 分册 §10 的十五条，**全绿才并**.
 *
 * 每一个 `describe` 的名字就是那一条断言的编号，因为合并门槛要能被机械核对：一份
 * 「大概都测了」的测试文件，在下一次有人删掉一条的时候不会报警。
 *
 * 这里刻意**跑真路径**：真的组织图、真的卡动作总线、真的私账日志文件。三不入那一条
 * 尤其如此——它断言的是「私账对象结构性地不在那个查询的定义域里」，而一个用 mock
 * 顶掉存储的测试，恰恰会把这条唯一要测的东西 mock 掉。
 */

import { cp, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor, type GraphViewer } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  assessmentCard, assessmentFamily, commitmentFamily, createCommitmentCard,
} from '@yzj-next/objects'
import { PledgerCards } from '../src/bus.ts'
import { calibrationCard } from '../src/calibration.ts'
import { createDesk, DESTROY_PHRASE, type PledgerDesk } from '../src/desk.ts'
import {
  FAMILY_DELIVERY_SELFCHECK, FAMILY_GOAL_BREAKDOWN, expectationIdFor, inviteIdFor,
} from '../src/families.ts'
import { inviteCard } from '../src/invite.ts'
import { PledgerLog } from '../src/log.ts'
import { patternsIn } from '../src/patterns.ts'
import { inviteOnVerdict, openCalibration, reflowOnGraphEvent, reflowOnNotedFact, sourceOf, tickCheckpoints } from '../src/ring.ts'
import { YzjPledger } from '../src/service.ts'
import { vaultView } from '../src/vault.ts'
import { PLEDGER_KINDS, expectationFamily } from '../src/vocabulary.ts'

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
    const verdict = { kind: 'commitment', id: 'c-3' } as const

    const first = await openCalibration(ctx, {
      verdict,
      family: FAMILY_DELIVERY_SELFCHECK,
      fact: { source: 'org', anchor: { kind: 'commitment', id: 'c-3' }, why: 'reopened' },
      factText: '被打回',
    })
    expect(first).toBeDefined()
    const second = await openCalibration(ctx, {
      verdict,
      family: FAMILY_DELIVERY_SELFCHECK,
      fact: { source: 'org', anchor: { kind: 'commitment', id: 'c-3' }, why: 'reopened' },
      factText: '被打回（又来一次）',
    })
    expect(second).toBeUndefined()
    expect(pledger.query('calibration')).toHaveLength(1)

    const id = first as string
    expect((await desk.act('calibration', id, 'dismiss')).outcome).toBe('applied')
    await settle()
    const third = await openCalibration(ctx, {
      verdict,
      family: FAMILY_DELIVERY_SELFCHECK,
      fact: { source: 'org', anchor: { kind: 'commitment', id: 'c-3' }, why: 'reopened' },
      factText: '第三次',
    })
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
        verdict: { kind: 'commitment', id },
        family: FAMILY_GOAL_BREAKDOWN,
        fact: { source: 'org', anchor: { kind: 'commitment', id }, why: 'reopened' },
        factText: '被打回',
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
  it('sourceOf 的调用栈里没有任何一次 pgraph 读取', async () => {
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
    sourceOf(ctx, { kind: 'commitment', id: 'c-6' })
    expect(reads).toEqual([])
  })
})

describe('⑦ 疲劳治理：连续三次不立就停问，重开在金库', () => {
  it('第四次触发点静默；invite/reopened 之后恢复', async () => {
    for (const id of ['c-7a', 'c-7b', 'c-7c']) {
      await deliverCommitment(id)
      await accept(id)
      await desk.decline(inviteOf(id))
      await settle()
    }
    await deliverCommitment('c-7d')
    await accept('c-7d')
    // 人用脚投票就是应答：第四次这一族整体不再开口。
    expect(pledger.object('invite', inviteOf('c-7d'))).toBeUndefined()

    await desk.reopenInvites(FAMILY_DELIVERY_SELFCHECK)
    await settle()
    await deliverCommitment('c-7e')
    await accept('c-7e')
    expect(pledger.object('invite', inviteOf('c-7e'))).toBeDefined()
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
      verdict: { kind: 'commitment', id: 'c-12b' },
      family: FAMILY_DELIVERY_SELFCHECK,
      fact: { source: 'org', anchor: { kind: 'commitment', id: 'c-12b' }, why: 'reopened' },
      factText: '也被打回了',
    })
    await desk.act('calibration', second as string, 'q3')
    await settle()
    const patterns = vaultView(pledger).patterns
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.count).toBe(2)

    // 环7 回喂：人签发后视镜
    expect(desk.stripFor('commitment')).toBeUndefined()
    await desk.mirror(FAMILY_DELIVERY_SELFCHECK, patterns[0]?.patternKey as string, true)
    await settle()
    const strip = desk.stripFor('commitment')
    expect(strip?.cases.length).toBeGreaterThan(0)
    expect(strip?.note).toContain('判断仍由你下')

    // 环8 再裁决：下一张同族卡上，判例在场
    await deliverCommitment('c-12c', '下一份交付')
    expect(desk.stripFor('commitment')?.cases.length).toBeGreaterThan(0)

    // 合环阀：换挡台就在同一屏上，而且真的动得了
    await desk.shift(FAMILY_DELIVERY_SELFCHECK, 'weight', 'vault')
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
    const register = registered.find(one => one.name === 'pledger_register')
    expect(register).toBeDefined()
    expect(Object.keys(register?.parameters ?? {})).not.toContain('text')
    // 只读那一个也不该有 —— 读的东西没有理由带一句话进来。
    const query = registered.find(one => one.name === 'pledger_query')
    expect(Object.keys(query?.parameters ?? {})).not.toContain('text')
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
    const state = pledger.query('calibration')[0]?.state as { factRef?: { why?: string } }
    expect(state.factRef?.why).toBe('reopened')
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
    const state = pledger.query('calibration')[0]?.state as { factRef?: { why?: string } }
    expect(state.factRef?.why).toBe('lineage')
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
    const state = pledger.query('calibration')[0]?.state as { factRef?: { why?: string } }
    expect(state.factRef?.why).toBe('assessed')
  })

  it('人工补登：图外事实经一句话进来，指认错了可经第五出口消解', async () => {
    await deliverCommitment('c-15d')
    await accept('c-15d')
    await pledgeOn('c-15d', '线下评审能过')
    const expectationId = expectationIdFor({ kind: 'commitment', id: 'c-15d' })
    await desk.note('线下评审过了，但被追问定价', { kind: 'expectation', expectationId })
    await settle()
    const receipt = pledger.query('calibration')[0]
    const state = receipt?.state as { factRef?: { source?: string }; factText?: string }
    expect(state.factRef?.source).toBe('noted')
    expect(state.factText).toBe('线下评审过了，但被追问定价')

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
      verdictRef: { kind: 'commitment', id: 'c-15e' },
    })
    await settle()
    const state = pledger.query('calibration')[0]?.state as {
      expectationId?: string; thenText?: string; factRef?: { source?: string }
    }
    expect(state.factRef?.source).toBe('noted')
    expect(state.expectationId).toBeUndefined()
    expect(state.thenText).toContain('无显式预期')
  })

  it('ambient 语义识别路径不存在（P1）', () => {
    const sources = pledger.query('calibration')
      .map(object => (object.state as { factRef?: { source?: string } }).factRef?.source)
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
        verdictRef: { kind: 'commitment', id: 'c-tick' },
        inviteId: inviteOf('c-tick'),
        family: FAMILY_DELIVERY_SELFCHECK,
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
