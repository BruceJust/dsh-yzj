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
    expect((await inject.people('张')).error).toBe('socket 断了')
  })

  it('压根没有连接时也一样', async () => {
    expect((await createSurfaceInject(undefined).people('张')).error).toBe('通道未就绪')
  })
})
