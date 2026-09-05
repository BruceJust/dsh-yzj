/**
 * 裁决卡（发现）与交付推断提议卡 —— 提案族的第三、第四种模式 (主册 §5.2 裁决卡 / v3.12 行为回执).
 *
 * 人签发铁律不变：agent 只提出发现 / 只提议「这像交付」，成立与否、是不是交付，都由人逐条说。
 * 每一票都是有种类的裁决（finding-confirm / finding-reject / delivery-confirm / not-delivery），
 * 逐条裁决的裁决键带条目，私账那边第二条才不会被第一条吸收。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { createCommitmentCard } from '../src/commitment/card.ts'
import { commitmentFamily, processFamily } from '../src/commitment/family.ts'
import { createProposalCard } from '../src/goal/proposal-card.ts'
import { assessmentFamily, goalContextFamily, proposalFamily, proposalSettled, type ProposalState } from '../src/goal/family.ts'
import { applyGoalTools } from '../src/goal/tools.ts'
import { applyDeliveryInference, candidatesFor, deliveryProposalIdFor, inferDelivery, looksLikeDelivery } from '../src/delivery/inference.ts'
import type { TurnBinding } from '../src/turns.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const PLACE = 'yzj-group-g1'
const BINDING: TurnBinding = {
  viewer: { kind: 'place', placeKey: PLACE }, decider: 'op-1', accountKey: 'acct-1', accountOpenId: 'op-1', accountOrgId: 'org-1',
  topicKey: 'yzj-topic-1', placeKey: PLACE, audience: [PLACE], messageId: 'msg-1',
}
interface CapturedTool { name: string; execute: (args: Record<string, unknown>, exec: unknown) => Promise<{ content: string; proposalId?: string }> }
const EXEC = { agent: { session: { id: 'session-1' } } }

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let tools: Map<string, CapturedTool>
let delivered: { kind: string; id: string; placeKey: string }[]
let verdicts: { kind: string; actionId: string; verdictKey?: string }[]
let said: { placeKey: string; text: string }[]

const proposal = (id: string): ProposalState => graph.rawObject('proposal', id)?.state as unknown as ProposalState
const state = (kind: string, id: string): Record<string, unknown> | undefined => asRecord(graph.rawObject(kind, id)?.state)

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-finding-')) })
  for (const family of [commitmentFamily, processFamily, proposalFamily, assessmentFamily, goalContextFamily]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  cards.register(createProposalCard(ctx))
  cards.setDesktopActor(OPERATOR)
  ctx.provide('yzjTurns', { bindingFor: () => BINDING, defaultBinding: () => BINDING })
  delivered = []
  verdicts = []
  said = []
  const answer = async (ref: { kind: string; id: string }, placeKey: string): Promise<unknown> => {
    delivered.push({ ...ref, placeKey })
    const projection = { cardRef: ref, surface: 'yzj-text', msgAnchors: [`m-${String(delivered.length)}`], placeKey }
    await cards.project(projection)
    return projection
  }
  ctx.provide('yzjCardChannel', {
    deliverToOperator: (ref: { kind: string; id: string }) => answer(ref, 'operator'),
    deliverToPlace: (ref: { kind: string; id: string }, placeKey: string) => answer(ref, placeKey),
    echo: () => Promise.resolve(),
  })
  ctx.provide('yzjTopics', { sendInPlace: async (placeKey: string, text: string) => { said.push({ placeKey, text }); return { msgId: 'm-said' } } })
  const captured: CapturedTool[] = []
  ctx.provide('tools', { register: (definition: CapturedTool) => { captured.push(definition); return () => undefined } })
  applyGoalTools(ctx)
  applyDeliveryInference(ctx)
  tools = new Map(captured.map(tool => [tool.name, tool]))
  ctx.on('yzj-cards/verdict-settled', (payload) => {
    verdicts.push({ kind: payload.kind, actionId: payload.actionId, ...(payload.verdictKey === undefined ? {} : { verdictKey: payload.verdictKey }) })
  })
})

describe('裁决卡：agent 发现的事，逐条 确认 / 驳回 / 挂起 / 转办', () => {
  const report = async (): Promise<string> => {
    const result = await tools.get('findings_report')!.execute({
      title: '7 月对账 · 306 行 · 2 处差异',
      items: [
        { what: '第 12 行应收 1,200 与 ERP 1,020 不符', evidence: '对账单 L12 · ERP 单据 A-77' },
        { what: '宏迈发票号缺失', evidence: '对账单 L88' },
      ],
    }, EXEC)
    return result.proposalId ?? ''
  }

  it('工具递卡：kind=finding、依据上卡、投回问的那个群；没依据的条目不算发现', async () => {
    const id = await report()
    const card = proposal(id)
    expect(card.kind).toBe('finding')
    expect(card.items.map(item => item.evidence)).toEqual(['对账单 L12 · ERP 单据 A-77', '对账单 L88'])
    expect(delivered).toEqual([{ kind: 'proposal', id, placeKey: PLACE }])
    const text = cards.renderText({ kind: 'proposal', id })?.body ?? ''
    expect(text).toContain('【裁决卡·发现】')
    expect(text).toContain('依据：对账单 L12')
    expect(text).toContain('转办 <编号> <姓名>')
    const empty = await tools.get('findings_report')!.execute({ title: 'x', items: [{ what: '没依据', evidence: '' }] }, EXEC)
    expect(empty.content).toContain('每条发现都要说清读自哪里')
  })

  it('确认 / 驳回是有种类的逐条裁决，裁决键带条目；挂起不是裁决；不铸承诺', async () => {
    const id = await report()
    await cards.act({ kind: 'proposal', id }, 'confirmed', OPERATOR, 'desktop', '1')
    await cards.act({ kind: 'proposal', id }, 'rejected', OPERATOR, 'desktop', '2')
    expect(verdicts).toEqual([
      { kind: 'finding-confirm', actionId: 'confirmed', verdictKey: 'confirmed:0' },
      { kind: 'finding-reject', actionId: 'rejected', verdictKey: 'rejected:1' },
    ])
    expect(proposal(id).decisions).toEqual({ '0': 'confirmed', '1': 'rejected' })
    expect(graph.query({ kind: 'operator', openId: 'op-1' }, { kind: 'commitment' })).toHaveLength(0)
    const echo = cards.renderText({ kind: 'proposal', id })?.body ?? ''
    expect(echo).toContain('✓ 已确认')
    expect(echo).toContain('✗ 已驳回')
  })

  it('转办 <编号> <姓名>：给那个人立一条 executor=人 的承诺，证据与血缘一起带过去；不是裁决', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: { commitmentId: 'cmt-known', what: '先前的活', executor: { kind: 'human', openId: 'op-lisi', name: '李四' }, sourceAnchor: 'yzj:m-0', idemKey: 'cmt:known' },
      actor: OPERATOR,
    })
    const id = await report()
    await cards.act({ kind: 'proposal', id }, 'transferred', OPERATOR, 'desktop', '2 李四')
    expect(verdicts).toEqual([])
    const card = proposal(id)
    expect(card.decisions).toEqual({ '1': 'transferred' })
    const minted = card.minted?.['1']
    expect(minted).toBeDefined()
    const born = state('commitment', minted ?? '')
    expect(asString(born?.what)).toBe('处理发现：宏迈发票号缺失')
    expect(asRecord(born?.executor)).toEqual({ kind: 'human', openId: 'op-lisi', name: '李四' })
    expect(asString(born?.criteria)).toBe('依据：对账单 L88')
    expect(asString(born?.sourceAnchor)).toBe(`yzj:msg-1#proposal:${id}:1`)
    expect(asString(born?.delegatedBy)).toBe('op-1')
    // 名录里没有的人：照名字立，openId 标未解析——宁可刺眼，不可静默。
    await cards.act({ kind: 'proposal', id }, 'transferred', OPERATOR, 'desktop', '1 王五')
    const other = state('commitment', proposal(id).minted?.['0'] ?? '')
    expect(asRecord(other?.executor)).toEqual({ kind: 'human', openId: 'unresolved:王五', name: '王五' })
  })
})

describe('交付推断：操作者自己甩的文件 → 提议卡 → 确认即回执 + 交付主张', () => {
  const owed = async (id: string, what: string): Promise<void> => {
    await graph.append({
      type: 'commitment/opened',
      data: { commitmentId: id, what, executor: { kind: 'human', openId: 'op-1', name: '我' }, sourceAnchor: `yzj:m-${id}`, audience: [PLACE], notifyPlaceKey: PLACE, idemKey: `cmt:${id}` },
      actor: OPERATOR,
    })
  }
  const file = (name: string, msgId = 'm-file-1') => ({ placeKey: PLACE, msgId, fromOpenId: 'op-1', fileId: 'f-1', name, time: Date.now() })

  it('像不像只认原样子串：≥3 个汉字或 ≥4 位字母数字；泛词不算', () => {
    expect(looksLikeDelivery('8月费用明细-final.xlsx', '给财务出 8 月费用明细')).toBe(true)
    expect(looksLikeDelivery('Q3_recon_report.xlsx', '整理 q3_recon 对账底稿')).toBe(true)
    expect(looksLikeDelivery('报表.xlsx', '给财务出 8 月费用明细')).toBe(false)
    expect(looksLikeDelivery('会议纪要.docx', '给财务出 8 月费用明细')).toBe(false)
  })

  it('只在本人名下、未交付的承诺里找；别人欠的与已交付的不算', async () => {
    await owed('cmt-1', '给财务出 8 月费用明细')
    await graph.append({
      type: 'commitment/opened',
      data: { commitmentId: 'cmt-other', what: '给财务出 8 月费用明细（张三版）', executor: { kind: 'human', openId: 'op-zhang', name: '张三' }, sourceAnchor: 'yzj:m-x', audience: [PLACE], idemKey: 'cmt:other' },
      actor: OPERATOR,
    })
    expect(candidatesFor(ctx, file('8月费用明细.xlsx')).map(one => one.commitmentId)).toEqual(['cmt-1'])
    await graph.append({ type: 'commitment/delivered', data: { commitmentId: 'cmt-1', delivery: { claim: '交了', at: Date.now() } }, actor: OPERATOR })
    expect(candidatesFor(ctx, file('8月费用明细.xlsx'))).toEqual([])
  })

  it('递卡一次：同一个文件不再问；卡投给操作者本人；不像就什么都不做', async () => {
    await owed('cmt-1', '给财务出 8 月费用明细')
    expect(await inferDelivery(ctx, file('会议纪要.docx'))).toBeUndefined()
    const id = await inferDelivery(ctx, file('8月费用明细.xlsx'))
    expect(id).toBe(deliveryProposalIdFor('m-file-1'))
    expect(await inferDelivery(ctx, file('8月费用明细.xlsx'))).toBeUndefined()
    expect(delivered).toEqual([{ kind: 'proposal', id: id ?? '', placeKey: 'operator' }])
    const card = proposal(id ?? '')
    expect(card.kind).toBe('delivery')
    expect(card.artifact).toEqual({ msgId: 'm-file-1', fileId: 'f-1', name: '8月费用明细.xlsx', placeKey: PLACE })
    expect(cards.renderText({ kind: 'proposal', id: id ?? '' })?.body).toContain('【交付推断】')
  })

  it('确认 = 回执 + 交付主张（承诺仍 open、进入待验收）+ 以执行者名义回流登记场所；裁决种类 delivery-confirm', async () => {
    await owed('cmt-1', '给财务出 8 月费用明细')
    const id = (await inferDelivery(ctx, file('8月费用明细.xlsx'))) ?? ''
    await cards.act({ kind: 'proposal', id }, 'confirmed', OPERATOR, 'desktop')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(verdicts).toEqual([{ kind: 'delivery-confirm', actionId: 'confirmed', verdictKey: 'confirmed:0' }])
    const commitment = state('commitment', 'cmt-1')
    expect(asString(commitment?.status)).toBe('open')
    expect(asString(asRecord(commitment?.delivery)?.claim)).toBe('交付：8月费用明细.xlsx')
    expect(graph.rawEvents(['receipt/recorded']).map(event => asString(asRecord(asRecord(event.data)?.objectRef)?.id))).toEqual(['cmt-1'])
    expect(said).toEqual([{ placeKey: PLACE, text: '已交付：给财务出 8 月费用明细（8月费用明细.xlsx）' }])
    expect(proposalSettled(proposal(id))).toBe(true)
  })

  it('不是交付 = 偏离裁决 not-delivery，配对入吸收态：同一文件不再问', async () => {
    await owed('cmt-1', '给财务出 8 月费用明细')
    const id = (await inferDelivery(ctx, file('8月费用明细.xlsx'))) ?? ''
    await cards.act({ kind: 'proposal', id }, 'rejected', OPERATOR, 'desktop')
    expect(verdicts).toEqual([{ kind: 'not-delivery', actionId: 'rejected', verdictKey: 'rejected:0' }])
    expect(asRecord(state('commitment', 'cmt-1')?.delivery)).toBeUndefined()
    expect(said).toEqual([])
    expect(await inferDelivery(ctx, file('8月费用明细.xlsx'))).toBeUndefined()
  })

  it('同一文件像多条承诺：合并一卡供选，确认 <编号> 只认那一条，其余落为不是', async () => {
    await owed('cmt-1', '给财务出 8 月费用明细')
    await owed('cmt-2', '8 月费用明细复核')
    const id = (await inferDelivery(ctx, file('8月费用明细.xlsx'))) ?? ''
    expect(proposal(id).items).toHaveLength(2)
    await cards.act({ kind: 'proposal', id }, 'confirmed', OPERATOR, 'desktop', '2')
    expect(proposal(id).decisions).toEqual({ '0': 'rejected', '1': 'confirmed' })
    expect(asRecord(state('commitment', 'cmt-2')?.delivery)).toBeDefined()
    expect(asRecord(state('commitment', 'cmt-1')?.delivery)).toBeUndefined()
  })
})

describe('执行者侧回执的结构性来源（设计册 v1.3：交付推断族的一档候选）', () => {
  const mirror = async (id: string, what: string, executorName: string): Promise<void> => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: id, what, executor: { kind: 'human', openId: `unresolved:${executorName}`, name: executorName },
        sourceAnchor: 'yzj:m-peer-1', delegatedBy: 'op-zhang', audience: ['yzj-group-peer'],
        origin: { kind: 'foreign', operatorOpenId: 'op-zhang', handle: `[card#commitment:${id}]`, msgAnchor: 'm-peer-1' },
        idemKey: `mirror:op-zhang:[card#commitment:${id}]`,
      },
      actor: { kind: 'system' },
    })
  }
  const file = (name: string, msgId = 'm-file-9') => ({ placeKey: PLACE, msgId, fromOpenId: 'op-1', fileId: 'f-9', name, time: Date.now() })

  it('同事的实例转给我的事（镜像行，执行者只有我的名字）按名录解析成候选；名字不是我的不算', async () => {
    cards.setDesktopActor(OPERATOR, '代少兵')
    await mirror('mir-1', '给张三出 9 月对账差异表', '代少兵')
    await mirror('mir-2', '给张三出 9 月对账差异表（李四版）', '李四')
    expect(candidatesFor(ctx, file('9月对账差异表.xlsx')).map(one => one.commitmentId)).toEqual(['mir-1'])
  })

  it('确认镜像行的交付：不本地改写镜像（无 delivered），只留自己的回执，并把「已交付」回流到对面的登记场所', async () => {
    cards.setDesktopActor(OPERATOR, '代少兵')
    await mirror('mir-1', '给张三出 9 月对账差异表', '代少兵')
    const id = (await inferDelivery(ctx, file('9月对账差异表.xlsx'))) ?? ''
    await cards.act({ kind: 'proposal', id }, 'confirmed', OPERATOR, 'desktop')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(verdicts).toEqual([{ kind: 'delivery-confirm', actionId: 'confirmed', verdictKey: 'confirmed:0' }])
    expect(asRecord(state('commitment', 'mir-1')?.delivery)).toBeUndefined()
    expect(graph.rawEvents(['receipt/recorded']).map(event => asString(asRecord(asRecord(event.data)?.objectRef)?.id))).toEqual(['mir-1'])
    expect(said).toEqual([{ placeKey: 'yzj-group-peer', text: '已交付：给张三出 9 月对账差异表（9月对账差异表.xlsx）' }])
  })

  it('承诺卡的打回带句柄回声：同侪实例的镜像行靠它前进', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: { commitmentId: 'cmt-own', what: '给财务出费用明细', executor: { kind: 'human', openId: 'op-lisi', name: '李四' }, sourceAnchor: 'yzj:m-own', delegatedBy: 'op-1', idemKey: 'cmt:own' },
      actor: OPERATOR,
    })
    await graph.append({ type: 'commitment/delivered', data: { commitmentId: 'cmt-own', delivery: { claim: '交了', at: Date.now() } }, actor: { kind: 'agent' } })
    const result = await cards.act({ kind: 'commitment', id: 'cmt-own' }, 'reject', OPERATOR, 'desktop', '少了差旅')
    expect(result.receipt).toBe('【承诺·打回】给财务出费用明细（少了差旅）· 第 1 轮\n[card#commitment:cmt-own]')
  })
})
