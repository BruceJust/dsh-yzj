/**
 * 显示名与头像 —— **查询失败 ≠ 查无此人**（三值纪律的又一处）。
 *
 * 用户报的症状是「群消息里的头像变成数字了」。那是末端：
 *
 * 1. 通讯录那一趟没问成（token 抖一下、传输解码失败——这个部署的日志里两样都有）；
 * 2. 兜底把 openId 当成名字写进缓存；
 * 3. 缓存**是进程级的、只写一次**（下一轮把已在缓存里的人全过滤掉），所以这一批人在
 *    进程余生里都叫那串十六进制；
 * 4. 头像取名字首字符 → 屏幕上是一个数字。
 *
 * 四步里每一步单独看都「合理」，合起来是：**一次网络抖动，永久性地把同事变成一串 id**。
 *
 * 所以这一组钉的是第 2 步与第 3 步：没问成就什么都别记，下一次渲染自然会再问一次。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { YzjTopicReader } from '../src/topics.ts'

const MESSAGE = {
  msgId: 'm-1',
  content: '在弄了',
  fromOpenId: '5d294a33e4b064934e3cdbe9',
  msgType: 'text',
  sendTime: '2026-09-01 10:00:00.000',
  param: {},
}

/**
 * 一个只回一条消息的通道。`directory` 决定通讯录那一趟怎么答——用例各自换掉它，因为
 * 「答了」和「没答成」正是这一组要分开的两件事。
 */
async function readerWith(
  directory: () => Promise<{ openId: string; name: string; photoUrl?: string }[]>,
): Promise<{ topics: YzjTopicReader; calls: () => number }> {
  let calls = 0
  const client = {
    messages: async () => [MESSAGE],
    olderPage: async () => ({ messages: [], more: false }),
    usersByOpenId: async () => {
      calls += 1
      return directory()
    },
  }
  const state = {
    topicForMessage: () => undefined,
    isOwnOutbound: () => false,
  }
  const topics = new YzjTopicReader(
    {} as never, client as never, state as never, 'op', 'org',
    async () => '', async () => ({ ignited: false }), async () => ({ ignited: false }),
    () => true, [], async () => ({ served: true }) as never,
    await mkdtemp(join(tmpdir(), 'yzj-names-')),
    { of: () => ({ self: 'off', peers: [] }) as never, peers: () => [] },
  )
  return { topics, calls: () => calls }
}

describe('通讯录答得出来', () => {
  it('显示名用真名，头像用真人头像', async () => {
    const { topics } = await readerWith(async () => [
      { openId: MESSAGE.fromOpenId, name: '许康', photoUrl: 'https://static.example/photo/1' },
    ])
    const [message] = await topics.messagesInPlace('yzj-group-g1')
    expect(message?.fromName).toBe('许康')
    expect(message?.fromAvatar).toBe('https://static.example/photo/1')
  })

  /*
    平台不一定给得出头像（有人没设过）。那时**没有这一格**，界面退回名字缩写——
    拿不到头像不等于这个人没有头像，所以这是降级显示，不是一句关于他的断言。
  */
  it('没有头像就不带这一格，名字照样是真名', async () => {
    const { topics } = await readerWith(async () => [
      { openId: MESSAGE.fromOpenId, name: '许康' },
    ])
    const [message] = await topics.messagesInPlace('yzj-group-g1')
    expect(message?.fromName).toBe('许康')
    expect(message?.fromAvatar).toBeUndefined()
  })

  /*
    问成了、而通讯录确实不认识这个人：**记下来，不再问**。这是这条缓存本来的用意——
    一个名录不会因为被多问几次就学会一个它不认识的人。
  */
  it('确实查无此人：记住，第二次不再问', async () => {
    const { topics, calls } = await readerWith(async () => [])
    await topics.messagesInPlace('yzj-group-g1')
    await topics.messagesInPlace('yzj-group-g1')
    expect(calls()).toBe(1)
  })
})

/**
 * **这一组就是那个 bug 的复现。**
 */
describe('通讯录没问成', () => {
  it('不把 openId 当成名字记进缓存 —— 下一次渲染还会再问', async () => {
    let failing = true
    const { topics, calls } = await readerWith(async () => {
      if (failing) throw new Error('transport error: error decoding response body')
      return [{ openId: MESSAGE.fromOpenId, name: '许康', photoUrl: 'https://static.example/p' }]
    })

    // 第一趟：通道挂了。名字只能退回 openId——那是如实，此刻我们确实不知道他叫什么。
    const [first] = await topics.messagesInPlace('yzj-group-g1')
    expect(first?.fromName).toBe(MESSAGE.fromOpenId)
    expect(calls()).toBe(1)

    /*
      第二趟：通道好了。**关键就在这里**——旧实现把 openId 写进了缓存，于是这一批人
      被永久判定为「已知」，再也不会被问第二次；名字与头像在进程余生里都是那串十六进制。
    */
    failing = false
    const [second] = await topics.messagesInPlace('yzj-group-g1')
    expect(calls()).toBe(2)
    expect(second?.fromName).toBe('许康')
    expect(second?.fromAvatar).toBe('https://static.example/p')
  })
})
