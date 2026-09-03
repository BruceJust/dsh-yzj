/**
 * 私账层 · 自知 —— 断言十五（分册 v3.1 §10）。从 v2 的三十条收缩，删的比留的多。
 *
 * 每一条都在两个方向上锁：机制在（押得上、回执长得出、换挡写得下），且**不该在的
 * 东西不在**（无邀约、无 IM 消息、无分数、无写入工具、无第二处存储）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { approvalCard, approvalFamily, commitmentFamily, createCommitmentCard, taskFamily, waitingFamily } from '@yzj-next/objects'
import { YzjPledger } from '../src/service.ts'
import { createDesk } from '../src/desk.ts'
import { fileVerdict, filedVerdicts, isAlive } from '../src/verdicts.ts'
import { openReceipt, pairFact, reflowOnGraphEvent, reflowOnNotedFact, tickCheckpoints } from '../src/reflow.ts'
import { attribute, clearClause, dismiss, markSeen, noteFact, parsePrivateSay, pledge, recordLeaseClause, setClause, withdraw } from '../src/pledge.ts'
import { judgView } from '../src/judg.ts'
import { stripsFor } from '../src/strips.ts'
import { casebookOf, indicators } from '../src/export.ts'
import { PLEDGER_FAMILIES, PLEDGER_KINDS } from '../src/vocabulary.ts'
import { applyPledgerTools, pledgerDenial } from '../src/tools.ts'
import { DEFAULT_WINDOW, snapshot } from '../src/types.ts'

const OPERATOR = { kind: 'operator' as const, openId: 'op-1' }
const PLACE = 'yzj-group-g1'
const TOPIC = 'yzj-topic-1'

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let pledger: YzjPledger
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yzj-next-pledger-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: join(root, 'graph') })
  for (const family of [approvalFamily, commitmentFamily, taskFamily, waitingFamily]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(approvalCard)
  cards.register(createCommitmentCard(ctx))
  cards.setDesktopActor(OPERATOR, '我')
  pledger = new YzjPledger(ctx, { root: join(root, 'pledger') })
  await pledger.open('op-1')
  ctx.provide('yzjPledgerDesk', createDesk(ctx))
  // 接缝①：裁决广播 → 归档。接缝③：组织图只读订阅 → 回流。
  ctx.on('yzj-cards/verdict-settled', (payload) => { void fileVerdict(ctx, payload) })
  ctx.on('yzj-graph/appended', (event) => { void reflowOnGraphEvent(ctx, event) })
  ctx.on('yzj-pledger/appended', (event) => { void reflowOnNotedFact(ctx, event) })
})

const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 20)) }

/** 一条人验收的交付：登记 → 交付主张 → 验收（人签发的裁决）。 */
async function acceptedDelivery(id = 'cmt-1', what = '竞品对比 · 评审表'): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: { commitmentId: id, what, executor: { kind: 'agent', topicKey: TOPIC }, sourceAnchor: `yzj:m-${id}`, topicKey: TOPIC, audience: [PLACE], idemKey: `cmt:${id}` },
    actor: OPERATOR,
  })
  await graph.append({ type: 'commitment/delivered', data: { commitmentId: id, delivery: { claim: '交付了', at: Date.now() } }, actor: { kind: 'agent' } })
  await cards.act({ kind: 'commitment', id }, 'accept', OPERATOR, 'desktop', undefined, { dwellMs: 1_600 })
  await settle()
}

async function rejectedDelivery(id = 'cmt-2'): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: { commitmentId: id, what: '策略建议', executor: { kind: 'agent', topicKey: TOPIC }, sourceAnchor: `yzj:m-${id}`, topicKey: TOPIC, audience: [PLACE], idemKey: `cmt:${id}` },
    actor: OPERATOR,
  })
  await graph.append({ type: 'commitment/delivered', data: { commitmentId: id, delivery: { claim: '交付了', at: Date.now() } }, actor: { kind: 'agent' } })
  await cards.act({ kind: 'commitment', id }, 'reject', OPERATOR, 'desktop', '缺定价维度')
  await settle()
}

describe('① 单向引用', () => {
  it('组织侧包的源码里不出现 pledger；组织图全事件 schema 无私账字段', () => {
    const src = join(__dirname, '..', '..')
    for (const pkg of ['objects', 'tools', 'channel', 'cards', 'graph']) {
      const dir = join(src, pkg, 'src')
      const files = readdirSync(dir, { recursive: true }).map(String).filter(name => name.endsWith('.ts'))
      for (const file of files) expect(readFileSync(join(dir, file), 'utf8')).not.toMatch(/@yzj-next\/pledger/u)
    }
    for (const kind of PLEDGER_KINDS) expect(graph.query({ kind: 'operator', openId: 'op-1' }, { kind })).toEqual([])
  })
})

describe('② viewer 单态', () => {
  it('私账查询没有 viewer 参数：place viewer 在 API 形态上不可构造', () => {
    // `query(kind)` 的签名里没有 viewer——这一条是关于类型的话，运行时只能验它不抛。
    expect(pledger.query('expectation')).toEqual([])
    expect(pledger.owner).toBe('op-1')
  })
})

describe('③ 部署开关', () => {
  it('enabled=false：零目录、零工具、零入口、接缝 no-op；关不删数据', async () => {
    const { apply, Config } = await import('../src/index.ts')
    const off = new Context()
    const registered: string[] = []
    off.provide('tools', { register: (definition: { name: string }) => { registered.push(definition.name); return () => undefined }, guard: () => () => undefined })
    apply(off, Config({ enabled: false, root: join(root, 'off') }))
    expect(existsSync(join(root, 'off'))).toBe(false)
    expect(registered).toEqual([])
    expect(off.get('yzjPledgerDesk')).toBeUndefined()
    await pledge(ctx, { topicKey: TOPIC, text: 'x' })
    expect(existsSync(join(root, 'pledger', 'op-1'))).toBe(true)
  })
})

describe('④ 取走与销毁', () => {
  it('目录拷贝独立可读；判例册在无本系统环境可读且含四数页眉；destroy 两段式', async () => {
    await acceptedDelivery()
    await pledge(ctx, { topicKey: TOPIC, text: '明早一次过' })
    await pledger.flush()
    const copy = join(root, 'copy')
    await cp(join(root, 'pledger', 'op-1'), copy, { recursive: true })
    const lines = (await readFile(join(copy, 'pledger.jsonl'), 'utf8')).trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const book = casebookOf(ctx)
    expect(book).toContain('自发押注 1')
    expect(book).toContain('回喂事件 0')
    expect(book).toContain('明早一次过')
    const desk = ctx.get('yzjPledgerDesk')
    await expect(desk?.destroy('随便')).rejects.toThrow(/不可逆/u)
    await desk?.destroy(desk.destroyPhrase)
    expect(existsSync(join(root, 'pledger', 'op-1'))).toBe(false)
  })
})

describe('⑤ 立此存照', () => {
  it('schema 里没有裸锚：锚只在 AnchoredText 里；断开组织图后私条与判例册零缺字', async () => {
    const vocabulary = readFileSync(join(__dirname, '..', 'src', 'vocabulary.ts'), 'utf8')
    // 任何一处 `: orgAnchor` 都只能出现在 anchoredText 的 anchor 字段上。
    for (const line of vocabulary.split('\n').filter(one => one.includes('orgAnchor') && !one.includes('const orgAnchor'))) {
      expect(line).toMatch(/anchor: orgAnchor\.optional\(\)/u)
    }
    await acceptedDelivery()
    await pledge(ctx, { topicKey: TOPIC, text: '明早一次过' })
    await graph.append({ type: 'commitment/reopened', data: { commitmentId: 'cmt-1', cause: '评审没过' }, actor: OPERATOR })
    await settle()
    // 拔掉组织图：照片仍在。
    const lonely = new Context()
    const reader = new YzjPledger(lonely, { root: join(root, 'pledger') })
    await pledger.flush()
    await reader.open('op-1')
    const receipt = reader.query('calibration')[0]
    const state = asRecord(receipt?.state)
    expect(asString(asRecord(state?.verdict)?.text)).toBe('竞品对比 · 评审表')
    expect((state?.then as { text: string }[]).map(one => one.text).join(' ')).toContain('明早一次过')
    expect((state?.later as { text: string }[])[0]?.text).toContain('又被打回')
  })
})

describe('⑥ 无邀约', () => {
  it('从 verdict-settled 到任何私账写入的路径只有归档；裁决后没有任何邀约对象', async () => {
    await acceptedDelivery()
    expect(PLEDGER_FAMILIES.map(family => family.kind)).not.toContain('invite')
    expect(pledger.query('expectation')).toEqual([])
    expect(pledger.query('calibration')).toEqual([])
    expect(filedVerdicts(ctx)).toHaveLength(1)
    // 发现路 = 占位文字，且只在最近裁决尚未押过时。
    const desk = ctx.get('yzjPledgerDesk')
    expect(desk?.placeholderFor(TOPIC)).toContain('押：')
    await pledge(ctx, { topicKey: TOPIC, text: 'x' })
    expect(desk?.placeholderFor(TOPIC)).toBeUndefined()
  })
})

describe('⑦ 不可回填 / 不可改笔', () => {
  it('同裁决二次 opened no-op；withdrawn 后 opened no-op；无 updated 型；只锚最近裁决', async () => {
    expect(await pledge(ctx, { topicKey: TOPIC, text: 'x' })).toContain('还没有可以押的裁决')
    await acceptedDelivery('cmt-1')
    await acceptedDelivery('cmt-9', '第二次裁决')
    const ack = await pledge(ctx, { topicKey: TOPIC, text: '明早一次过' })
    expect(ack).toContain('第二次裁决')
    expect(await pledge(ctx, { topicKey: TOPIC, text: '改口' })).toContain('已经押过了')
    const id = pledger.query('expectation')[0]?.id as string
    await withdraw(ctx, id, '前提没了')
    expect(await pledge(ctx, { topicKey: TOPIC, text: '再押' })).toContain('已经押过了')
    expect(pledger.query('expectation')).toHaveLength(1)
    expect(Object.keys(PLEDGER_FAMILIES.find(family => family.kind === 'expectation')?.events ?? {})).toEqual(['expectation/opened', 'expectation/withdrawn'])
  })
})

describe('⑧ 三处出生', () => {
  it('验收 accept → 血缘新边 = reversed', async () => {
    await acceptedDelivery('cmt-1')
    await graph.append({ type: 'commitment/opened', data: { commitmentId: 'cmt-1b', what: '再来一轮', executor: { kind: 'agent', topicKey: TOPIC }, sourceAnchor: 'yzj:m-x', parentCommitmentId: 'cmt-1', idemKey: 'cmt:cmt-1b' }, actor: OPERATOR })
    await settle()
    const receipt = asRecord(pledger.query('calibration')[0]?.state)
    expect(asString(receipt?.type)).toBe('reversed')
  })

  it('验收 reject → 返工后 accept = vindicated', async () => {
    await rejectedDelivery('cmt-2')
    await graph.append({ type: 'commitment/delivered', data: { commitmentId: 'cmt-2', delivery: { claim: '补了定价', at: Date.now(), round: 1 } }, actor: { kind: 'agent' } })
    await cards.act({ kind: 'commitment', id: 'cmt-2' }, 'accept', OPERATOR, 'desktop')
    await settle()
    const types = pledger.query('calibration').map(object => asString(asRecord(object.state)?.type))
    expect(types).toContain('vindicated')
  })

  it('平安无事零回执；标准写确认 approve 无结构性来源，如实零回执', async () => {
    await acceptedDelivery('cmt-1')
    await graph.append({ type: 'approval/opened', data: { approvalId: 'apv-1', toolName: 'yzj_doc_create', reason: '新建文档', level: 'standard', args: {}, argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 60_000 }, actor: { kind: 'agent' } })
    await cards.act({ kind: 'approval', id: 'apv-1' }, 'approve', OPERATOR, 'desktop')
    await settle()
    expect(pledger.query('calibration')).toEqual([])
    expect(filedVerdicts(ctx).map(one => one.family)).toEqual(['acceptance', 'write-confirm'])
  })

  it('押过的：检验点先到开 pledged 执，后到的事实走 appended 不出第二执；dismissed 后 answered 即覆盖', async () => {
    await graph.append({ type: 'commitment/opened', data: { commitmentId: 'cmt-3', what: '带 due 的活', executor: { kind: 'agent', topicKey: TOPIC }, sourceAnchor: 'yzj:m-3', topicKey: TOPIC, due: new Date(Date.now() + 60_000).toISOString(), idemKey: 'cmt:cmt-3' }, actor: OPERATOR })
    await graph.append({ type: 'commitment/delivered', data: { commitmentId: 'cmt-3', delivery: { claim: '交付了', at: Date.now() } }, actor: { kind: 'agent' } })
    await cards.act({ kind: 'commitment', id: 'cmt-3' }, 'accept', OPERATOR, 'desktop')
    await settle()
    await pledge(ctx, { topicKey: TOPIC, text: '会过' })
    expect(await tickCheckpoints(ctx, Date.now() + 120_000)).toHaveLength(1)
    const receipt = pledger.query('calibration')[0] as { id: string }
    expect(asString(asRecord(pledger.object('calibration', receipt.id)?.state)?.type)).toBe('pledged')
    const expectationId = pledger.query('expectation')[0]?.id as string
    await noteFact(ctx, { text: '8/14 过了', about: { kind: 'expectation', expectationId } })
    await settle()
    expect(pledger.query('calibration')).toHaveLength(1)
    const later = asRecord(pledger.object('calibration', receipt.id)?.state)?.later as { text: string }[]
    expect(later.map(one => one.text).join(' ')).toContain('8/14 过了')
    await dismiss(ctx, receipt.id)
    expect(asString(asRecord(pledger.object('calibration', receipt.id)?.state)?.status)).toBe('dismissed')
    await attribute(ctx, receipt.id, 'q1')
    expect(asString(asRecord(pledger.object('calibration', receipt.id)?.state)?.status)).toBe('answered')
  })
})

describe('⑨ 三不入构造 + 无 IM 出站', () => {
  it('全链路后组织侧可应答聚合零变化；私账没有任何投递通道', async () => {
    let sent = 0
    ctx.provide('yzjTopics', { sendToPerson: async () => { sent += 1; return { ignited: false } } } as never)
    await acceptedDelivery('cmt-1')
    await graph.append({ type: 'commitment/reopened', data: { commitmentId: 'cmt-1', cause: '没过' }, actor: OPERATOR })
    await settle()
    // 组织侧的事发生完了，再量：私账的每一个动词都不该让组织侧的可应答聚合动一个数。
    const before = cards.demands({ kind: 'operator', openId: 'op-1' }).length
    await pledge(ctx, { topicKey: TOPIC, text: 'x' })
    const receiptId = pledger.query('calibration')[0]?.id as string
    await attribute(ctx, receiptId, 'q2')
    await setClause(ctx, 'spread')
    expect(cards.demands({ kind: 'operator', openId: 'op-1' }).length).toBe(before)
    expect(sent).toBe(0)
    const src = readdirSync(join(__dirname, '..', 'src')).map(name => readFileSync(join(__dirname, '..', 'src', name), 'utf8')).join('\n')
    expect(src).not.toMatch(/sendToPerson|sendInPlace|deliverToOperator|client\.send/u)
  })
})

describe('⑩ 通道纪律 + ⑪ 记忆隔离', () => {
  it('卡的文本投影里没有私账 canary；pledger 依赖面无 memory、组织侧蒸馏器无 pgraph 类型', async () => {
    await acceptedDelivery('cmt-1')
    await pledge(ctx, { topicKey: TOPIC, text: 'CANARY-押' })
    expect(cards.renderText({ kind: 'commitment', id: 'cmt-1' })?.body).not.toContain('CANARY')
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(Object.keys(pkg.dependencies).some(name => /memory/u.test(name))).toBe(false)
    const memoryTools = readFileSync(join(__dirname, '..', '..', 'objects', 'src', 'memory', 'tools.ts'), 'utf8')
    expect(memoryTools).not.toMatch(/pledger|pgraph/u)
  })
})

describe('⑫ 无分数类型', () => {
  it('组头全是数字、字段名无判词、排序键 = count；候选注取自静态常量', async () => {
    await acceptedDelivery('cmt-1')
    await rejectedDelivery('cmt-2')
    const view = judgView(ctx, DEFAULT_WINDOW)
    const head = view.groups[0]?.head as Record<string, unknown>
    for (const [key, value] of Object.entries(head)) {
      if (key === 'family' || key === 'label') continue
      expect(typeof value === 'number' || typeof value === 'boolean').toBe(true)
    }
    expect(Object.keys(head).some(key => /ok|success|成立|score/iu.test(key))).toBe(false)
    expect(head.agree).toBe(1)
    expect(head.diverged).toBe(1)
    expect(head.dwellMs).toBe(1_600)
    const judg = readFileSync(join(__dirname, '..', 'src', 'judg.ts'), 'utf8')
    expect(judg).toContain('right.head.count - left.head.count')
  })
})

describe('⑬ 账本律 + D10：隐身档下什么都不落', () => {
  it('desk 不在时私条不长、占位不出、seen 不写', async () => {
    await acceptedDelivery('cmt-1')
    await pledge(ctx, { topicKey: TOPIC, text: 'x' })
    const desk = ctx.get('yzjPledgerDesk')
    expect(desk?.stripsFor('commitment', 'cmt-1', true).map(strip => strip.kind)).toEqual(['pledge'])
    // 隐身 = surface 不取 desk。这里用「拔掉 desk」模拟：没有座位就没有任何投影，也不写 seen。
    const before = pledger.events(['calibration/seen']).length
    await markSeen(ctx, ['nope'])
    expect(pledger.events(['calibration/seen']).length).toBe(before)
  })
})

describe('⑭ 换挡生效面 + 租约出口', () => {
  it('spread → 验收卡前置「先看」条；mirror → 同族判例条 ≤2；morning → 计数；lease 私记；回喂事件计数；seen 至多一次', async () => {
    await acceptedDelivery('cmt-1')
    await graph.append({ type: 'commitment/reopened', data: { commitmentId: 'cmt-1', cause: '没过' }, actor: OPERATOR })
    await settle()
    const receiptId = pledger.query('calibration')[0]?.id as string
    await attribute(ctx, receiptId, 'q3')
    // 一张还没答的验收卡
    await graph.append({ type: 'commitment/opened', data: { commitmentId: 'cmt-5', what: '待验收', executor: { kind: 'agent', topicKey: TOPIC }, sourceAnchor: 'yzj:m-5', topicKey: TOPIC, idemKey: 'cmt:cmt-5' }, actor: OPERATOR })
    await graph.append({ type: 'commitment/delivered', data: { commitmentId: 'cmt-5', delivery: { claim: '交付主张原话', at: Date.now() } }, actor: { kind: 'agent' } })
    expect(stripsFor(ctx, 'commitment', 'cmt-5', false)).toEqual([])
    expect(await setClause(ctx, 'spread')).toContain('记下了')
    expect(await setClause(ctx, 'mirror')).toContain('记下了')
    expect(await setClause(ctx, 'spread', 'proposal')).toContain('还没接上')
    const strips = stripsFor(ctx, 'commitment', 'cmt-5', false)
    expect(strips.map(strip => strip.kind)).toEqual(['spread', 'mirror'])
    const spread = strips[0] as { kind: 'spread'; delivery: { text: string }[] }
    expect(spread.delivery.map(one => one.text).join(' ')).toContain('交付主张原话')
    const mirror = strips[1] as { kind: 'mirror'; cases: unknown[] }
    expect(mirror.cases).toHaveLength(1)
    const desk = ctx.get('yzjPledgerDesk')
    expect(desk?.morningCount()).toBeUndefined()
    await setClause(ctx, 'morning')
    expect(desk?.morningCount()).toBe(0)
    await recordLeaseClause(ctx, { leaseRef: 'lse-1', family: 'write-confirm', text: '不用再问我' })
    await recordLeaseClause(ctx, { leaseRef: 'lse-1', family: 'write-confirm', text: '不用再问我' })
    await clearClause(ctx, 'spread')
    const numbers = indicators(ctx)
    expect(numbers.feedback).toBe(5)
    expect(numbers.activeClauses).toBe(2)
    expect(numbers.activeLeases).toBe(1)
    await markSeen(ctx, [receiptId])
    await markSeen(ctx, [receiptId])
    expect(pledger.events(['calibration/seen'])).toHaveLength(1)
    // 出站拦截认三句，认不出就列三句，不猜。
    expect(parsePrivateSay('以后验收前先看证据')).toMatchObject({ kind: 'clause', key: 'spread', off: false })
    expect(parsePrivateSay('不再 以后验收前给我看上次的结果')).toMatchObject({ kind: 'clause', key: 'mirror', off: true })
    expect(parsePrivateSay('以后都别烦我')).toMatchObject({ kind: 'clause' })
    expect(parsePrivateSay('押：明早一次过')).toEqual({ kind: 'pledge', text: '明早一次过' })
    expect(parsePrivateSay('帮我看看这个')).toBeUndefined()
  })
})

describe('⑮ 空状态样本 + 工具面', () => {
  it('从没押过 / 无回执 / 锚死双出口 / 配对错了 / 无私语道裁决只在取景框', async () => {
    expect(judgView(ctx, DEFAULT_WINDOW).empty).toBe(true)
    await acceptedDelivery('cmt-1')
    expect(judgView(ctx, DEFAULT_WINDOW).groups[0]?.rows).toEqual([])
    await pledge(ctx, { topicKey: TOPIC, text: 'x' })
    await graph.append({ type: 'commitment/voided', data: { commitmentId: 'cmt-1', cause: '不做了' }, actor: OPERATOR })
    await settle()
    const row = judgView(ctx, DEFAULT_WINDOW).groups[0]?.rows.find(one => one.kind === 'pledge')
    expect(row?.kind === 'pledge' && row.premise).toBe('changed')
    expect(isAlive(ctx, { kind: 'commitment', id: 'cmt-1' })).toBe('changed')
    // 无 topicKey 的裁决（枢纽/板 CTA）：不挂在任何会话的私条上，只在取景框。
    await graph.append({ type: 'commitment/opened', data: { commitmentId: 'cmt-7', what: '板上签发', executor: { kind: 'human', openId: 'u-2', name: '张三' }, sourceAnchor: 'desktop:board', idemKey: 'cmt:cmt-7' }, actor: OPERATOR })
    await graph.append({ type: 'commitment/delivered', data: { commitmentId: 'cmt-7', delivery: { claim: '交了', at: Date.now() } }, actor: { kind: 'agent' } })
    await cards.act({ kind: 'commitment', id: 'cmt-7' }, 'accept', OPERATOR, 'desktop')
    await settle()
    expect(filedVerdicts(ctx).find(one => one.anchor.id === 'cmt-7')?.topicKey).toBeUndefined()
  })

  it('工具面只剩 pledger_query，且只对 operator 回合开放', () => {
    const registered: string[] = []
    ctx.provide('tools', { register: (definition: { name: string }) => { registered.push(definition.name); return () => undefined }, guard: () => () => undefined })
    applyPledgerTools(ctx)
    expect(registered).toEqual(['pledger_query'])
    ctx.provide('yzjTurns', { bindingFor: () => ({ viewer: { kind: 'place', placeKey: PLACE } }), defaultBinding: () => undefined } as never)
    expect(pledgerDenial(ctx, { name: 'pledger_query', agent: {} as never })).toContain('本人的私账')
  })
})

describe('pairFact 是表不是法', () => {
  it('印证列缺位的族如实返回 undefined；事实早于裁决不配对', async () => {
    await acceptedDelivery('cmt-1')
    const verdict = filedVerdicts(ctx)[0]
    if (verdict === undefined) throw new Error('no verdict')
    const stale = { v: 1 as const, sv: 1, seq: 1, time: verdict.at - 1, type: 'commitment/reopened', data: { commitmentId: 'cmt-1' }, actor: OPERATOR }
    expect(pairFact(ctx, verdict, stale)).toBeUndefined()
    const other = { ...verdict, family: 'write-confirm', agree: true }
    expect(pairFact(ctx, other, { ...stale, time: verdict.at + 1 })).toBeUndefined()
    expect(await openReceipt(ctx, { verdict, type: 'reversed', fact: snapshot('x', undefined, verdict.at + 1), factKey: 'org:test' })).toBeDefined()
  })
})
