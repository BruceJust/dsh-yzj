/**
 * 浏览器这一侧的**三值纪律** —— 看不了 ≠ 没有。
 *
 * 这一组盯的是一条很容易被 `?? []` 抹平的边界：宿主拒绝或通道断掉时，读回来的是「空」
 * 还是「读不了」。抹平的代价不是少一句提示——
 *
 * 通讯录读不动时（CLI 挂了、token 过期，这个项目里都真实发生过），选人框会斩钉截铁地
 * 说「通讯录里没有叫这个名字的人」，而紧接着的默认是「没选中人 = 这个目标算我的」。
 * 于是一次故障被渲染成一次查无此人，再被渲染成一次归属选择——**三层，每一层都更像
 * 真的**。
 */

import { describe, expect, it } from 'vitest'
import { createSurfaceInject } from '../src/client/rpc.ts'
import { keepLastMessages } from '../src/client/poll.ts'

type Call = (path: string, endpoint: string, payload: unknown) => Promise<unknown>

const injectWith = (call: Call): ReturnType<typeof createSurfaceInject> =>
  createSurfaceInject({ rpc: { call } } as never)

describe('通讯录：搜到了 / 一个也没有 / 读不了', () => {
  it('搜到了就是搜到了', async () => {
    const inject = injectWith(async () => ({ ok: true, value: { people: [{ openId: 'u-1', name: '张锐' }] } }))
    expect(await inject.people('张')).toEqual({ people: [{ openId: 'u-1', name: '张锐' }] })
  })

  it('一个也没有：空名单，且**不报错**——「查无此人」是一个真实答案', async () => {
    const inject = injectWith(async () => ({ ok: true, value: { people: [] } }))
    expect(await inject.people('张')).toEqual({ people: [] })
  })

  /*
    宿主明确拒绝（通道没就绪、CLI 报错）。此前这一支被 `?? []` 抹成「一个也没有」——
    而这两句话在界面上的后果完全不同：一句让人换个名字再搜，另一句让人以为这个同事
    不存在。
  */
  it('宿主拒绝：带回它的原话，名单是空的但那不是答案', async () => {
    const inject = injectWith(async () => ({ ok: false, error: { message: '云之家通道未就绪' } }))
    const result = await inject.people('张')
    expect(result.people).toEqual([])
    expect(result.error).toBe('云之家通道未就绪')
  })

  it('通道抛异常：同样是「读不了」，不是「没有」', async () => {
    const inject = injectWith(async () => { throw new Error('socket 断了') })
    expect((await inject.people('张')).error).toBe('工作台这边没响应，再试一次。')
  })

  it('压根没有连接时也一样', async () => {
    expect((await createSurfaceInject(undefined).people('张')).error).toBe('工作台还没连上，稍等一下再试。')
  })
})

/*
  读不到 ≠ 没有，换到账的几屏上 (§5.8)。

  承诺页、目标页、来龙去脉此前把「通道断了」和「宿主说没有」都收成 undefined，再由
  界面落成空态：「还没有承诺」「这个目标已经不在了」「这一条已经不在板上了」。一次断线，
  三句像真的假话。
*/
describe('账的几屏：拿到了 / 宿主答没有 / 根本没读到', () => {
  it('承诺页：没读到是 undefined，不是一块空板', async () => {
    const inject = injectWith(async () => { throw new Error('socket 断了') })
    expect(await inject.board()).toBeUndefined()
    expect(await createSurfaceInject(undefined).board()).toBeUndefined()
  })

  it('目标页：宿主答「没有」带回它的原话；通道断了是另一种结果', async () => {
    const gone = injectWith(async () => ({ ok: false, error: { message: '板上没有这个目标——它可能已经被移出视野。' } }))
    expect(await gone.goalPage('g')).toEqual({ refused: '板上没有这个目标——它可能已经被移出视野。' })
    const broken = injectWith(async () => { throw new Error('socket 断了') })
    expect(await broken.goalPage('g')).toEqual({ unread: true })
    const fine = injectWith(async () => ({ ok: true, value: { goal: {} } }))
    expect(await fine.goalPage('g')).toEqual({ value: { goal: {} } })
  })

  it('来龙去脉：同样三种', async () => {
    const gone = injectWith(async () => ({ ok: false, error: { message: '这一条已经不在板上了' } }))
    expect(await gone.commitmentStory('c')).toEqual({ refused: '这一条已经不在板上了' })
    expect(await createSurfaceInject(undefined).commitmentStory('c')).toEqual({ unread: true })
  })

  it('右栏与「自己办了的」：没读到是 undefined，不是空列表', async () => {
    const broken = injectWith(async () => { throw new Error('socket 断了') })
    expect(await broken.objects('s')).toBeUndefined()
    expect(await broken.autoHandled(0)).toBeUndefined()
  })
})

describe('一次没读成的窗不抹掉上次读到的话', () => {
  const said = { messages: ['上周五说的那句'] }

  it('同一处这次没读成：留着上次的话，并标明是上次的', () => {
    expect(keepLastMessages(said, { messages: [], staleReason: '429' }))
      .toEqual({ messages: ['上周五说的那句'], staleReason: '429', kept: true })
  })

  it('读成了就用新的；从没读到过也没什么可留', () => {
    expect(keepLastMessages(said, { messages: ['新的'] })).toEqual({ messages: ['新的'] })
    expect(keepLastMessages(undefined, { messages: [], staleReason: '429' })).toEqual({ messages: [], staleReason: '429' })
  })

  it('有意不取的（演示中的自聊）不留——留着就是把要藏的摆回去', () => {
    expect(keepLastMessages(said, { messages: [], staleReason: '正在演示', withheld: true }).messages).toEqual([])
  })
})
