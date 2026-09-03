/**
 * 镜像行 (决策 #63 §7.4, 段 4q P1.5)：同侪实例登记的承诺 → 本图上一行滞后镜像。
 * 幂等锚 (operatorOpenId, handle)；只从回声往前走、禁止错序；永不本地改写。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { commitmentFamily, signOutbound } from '@yzj-next/objects'
import { applyMirror, mirrorIdFor, mirrorIdemKey, readMirror } from '../src/mirror.ts'

const ZHANG = 'op-zhang'
const PLACE = 'yzj-group-g1'
const CARD = [
  '【承诺·进行中】把 7 月对账单差异列出来',
  '执行者：李四 · 期限 周五前',
  '[card#commitment:cmt-abc]',
].join('\n')

let ctx: Context
let graph: YzjGraph

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: join(await mkdtemp(join(tmpdir(), 'yzj-next-mirror-')), 'graph') })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
})

const stateOf = (id: string): Record<string, unknown> | undefined => asRecord(graph.rawObject('commitment', id)?.state)

describe('readMirror：只认承诺卡的投影形状', () => {
  it('带句柄的登记投影：状态、原话、执行者、期限、句柄都读得出', () => {
    expect(readMirror(signOutbound(CARD, '张三'))).toEqual({
      commitmentId: 'cmt-abc', status: 'open', what: '把 7 月对账单差异列出来', executor: '李四', due: '周五前',
    })
  })
  it('终态回声没有句柄：读出状态与原因，靠回复锚找镜像', () => {
    expect(readMirror('【承诺·已作废】把 7 月对账单差异列出来（对方已自己做完）')).toEqual({
      status: 'voided', what: '把 7 月对账单差异列出来', cause: '对方已自己做完',
    })
  })
  it('ack、在岗声明、普通话都不是镜像源', () => {
    expect(readMirror('【Agent】已接收，正在处理。[card#task:tsk-1]')).toBeUndefined()
    expect(readMirror('云小助（张三）在岗')).toBeUndefined()
    expect(readMirror('@next 帮我拉一份报表')).toBeUndefined()
  })
})

describe('applyMirror：物化、幂等、只往前走', () => {
  const source = (msgId: string, replyMsgId?: string) => ({
    operatorOpenId: ZHANG, msgId, placeKey: PLACE, time: 1_000, ...(replyMsgId === undefined ? {} : { replyMsgId }),
  })

  it('第一次看到带句柄的登记 → 一行 origin:foreign 的镜像；同句柄再来不重复', async () => {
    const sighting = readMirror(CARD)!
    expect(await applyMirror(graph, sighting, source('m-1'))).toBe('opened')
    expect(await applyMirror(graph, sighting, source('m-1-again'))).toBe('ignored')
    const id = mirrorIdFor(ZHANG, '[card#commitment:cmt-abc]')
    const state = stateOf(id)
    expect(asString(state?.what)).toBe('把 7 月对账单差异列出来')
    expect(asString(state?.status)).toBe('open')
    expect(asRecord(state?.origin)).toEqual({ kind: 'foreign', operatorOpenId: ZHANG, handle: '[card#commitment:cmt-abc]', msgAnchor: 'm-1' })
    expect(graph.findByIdemKey(mirrorIdemKey(ZHANG, '[card#commitment:cmt-abc]'))?.id).toBe(id)
    expect(graph.query({ kind: 'operator', openId: '' }, { kind: 'commitment' })).toHaveLength(1)
    // 本地 id 永不与本机登记撞名。
    expect(id.startsWith('mir-')).toBe(true)
  })

  it('终态回声按回复锚找到镜像并推进；再来的回声不再改写（禁止错序）', async () => {
    await applyMirror(graph, readMirror(CARD)!, source('m-1'))
    const id = mirrorIdFor(ZHANG, '[card#commitment:cmt-abc]')
    const done = readMirror('【承诺·已完成】把 7 月对账单差异列出来')!
    expect(await applyMirror(graph, done, source('m-2', 'm-1'))).toBe('advanced')
    expect(asString(stateOf(id)?.status)).toBe('closed')
    const voided = readMirror('【承诺·已作废】把 7 月对账单差异列出来（乱序到达）')!
    expect(await applyMirror(graph, voided, source('m-3', 'm-1'))).toBe('ignored')
    expect(asString(stateOf(id)?.status)).toBe('closed')
  })

  it('带句柄的终态投影也能推进；第一次见到的就是终态则不物化一行死镜像', async () => {
    const dead = readMirror('【承诺·已移交】把 7 月对账单差异列出来\n[card#commitment:cmt-dead]')!
    expect(await applyMirror(graph, dead, source('m-9'))).toBe('ignored')
    expect(graph.query({ kind: 'operator', openId: '' }, { kind: 'commitment' })).toHaveLength(0)
    await applyMirror(graph, readMirror(CARD)!, source('m-1'))
    const moved = readMirror('【承诺·已移交】把 7 月对账单差异列出来\n[card#commitment:cmt-abc]')!
    expect(await applyMirror(graph, moved, source('m-10'))).toBe('advanced')
    const state = stateOf(mirrorIdFor(ZHANG, '[card#commitment:cmt-abc]'))
    expect(asString(state?.status)).toBe('voided')
    expect(asString(state?.cause)).toContain('真身已移交')
  })

  it('没有回复锚的裸回声找不到镜像：什么都不做', async () => {
    await applyMirror(graph, readMirror(CARD)!, source('m-1'))
    expect(await applyMirror(graph, readMirror('【承诺·已完成】把 7 月对账单差异列出来')!, source('m-2'))).toBe('ignored')
  })
})
