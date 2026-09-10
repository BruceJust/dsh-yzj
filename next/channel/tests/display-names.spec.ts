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
import { YzjChannelClient } from '../src/client.ts'
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
  directory: (ids: readonly string[]) => Promise<{ openId: string; name: string; photoUrl?: string }[]>,
  messages: readonly typeof MESSAGE[] = [MESSAGE],
): Promise<{ topics: YzjTopicReader; calls: () => number }> {
  let calls = 0
  const client = {
    messages: async () => messages,
    olderPage: async () => ({ messages: [], more: false }),
    usersByOpenId: async (ids: readonly string[]) => {
      calls += 1
      return directory(ids)
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
 * **一颗坏果子不能毁掉整筐** —— 用户真正撞到的那一条。
 *
 * 平台对无效 openId 的回应是**整批报错**（`errorCode=1001001, Invalid openIds`），不是
 * 「这一个没有」。实测：`代少兵` 单独问得出来，和自聊群号里那个非自然人的 id 一起问就
 * 整批失败。而代码是**整窗一起问**的——于是一窗里混进一个公众号 / 离职销号 / 自聊群号，
 * 整屏的人就一起变成十六进制，头像一起变成一个点。
 */
describe('批量里混进一个无效 id', () => {
  const BAD = '67f334ade4b0b97fa155f48f'

  /** 平台的真实行为：批量里只要有坏 id 就整批报错；单问好的那个照样答得出来。 */
  const platform = (good: Record<string, string>) => async (ids: readonly string[]) => {
    if (ids.some(id => !(id in good))) throw new Error('API error: errorCode=1001001, Invalid openIds')
    return ids.map(id => ({ openId: id, name: good[id] as string }))
  }

  it('好的那些照样解析得出来，不被那颗坏的拖下水', async () => {
    const good = { [MESSAGE.fromOpenId]: '许康' }
    const { topics } = await readerWith(platform(good), [
      MESSAGE, { ...MESSAGE, msgId: 'm-2', fromOpenId: BAD },
    ])
    const messages = await topics.messagesInPlace('yzj-group-g1')
    expect(messages.find(one => one.msgId === 'm-1')?.fromName).toBe('许康')
    // 坏的那个如实退回 openId——我们确实不知道它是谁。
    expect(messages.find(one => one.msgId === 'm-2')?.fromName).toBe(BAD)
  })

  /*
    **自愈**：坏 id 被记成否定之后，下一轮的批量里没有它，整筐恢复正常——不必每次渲染
    都走一遍逐个补问。
  */
  it('第二轮批量恢复正常：坏 id 不再进查询', async () => {
    const good = { [MESSAGE.fromOpenId]: '许康' }
    const asked: number[] = []
    const { topics } = await readerWith(async (ids) => {
      asked.push(ids.length)
      return platform(good)(ids)
    }, [MESSAGE, { ...MESSAGE, msgId: 'm-2', fromOpenId: BAD }])
    await topics.messagesInPlace('yzj-group-g1')
    const afterFirst = asked.length
    await topics.messagesInPlace('yzj-group-g1')
    // 第二轮一次都不用问：两个人都已经有结论了。
    expect(asked.length).toBe(afterFirst)
  })

  /*
    通道整个不通时**一个都不记**：那是通道的事，不是这些人的事。判据是「这一轮有没有
    任何一个问成」——逐条看分不出无效与不通，整轮看得出来。
  */
  it('通道全不通：什么都不记，下一轮还会再问', async () => {
    let down = true
    const { topics, calls } = await readerWith(async (ids) => {
      if (down) throw new Error('transport error')
      return ids.map(id => ({ openId: id, name: '许康' }))
    })
    await topics.messagesInPlace('yzj-group-g1')
    const first = calls()
    down = false
    const [message] = await topics.messagesInPlace('yzj-group-g1')
    expect(calls()).toBeGreaterThan(first)
    expect(message?.fromName).toBe('许康')
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

    /*
      第一趟：通道挂了。名字只能退回 openId——那是如实，此刻我们确实不知道他叫什么。

      问了两次：一次批量、一次逐个补问（批量失败之后的兜底，见「一颗坏果子」那一组）。
      两次都没成，所以**什么都不记**。
    */
    const [first] = await topics.messagesInPlace('yzj-group-g1')
    expect(first?.fromName).toBe(MESSAGE.fromOpenId)
    expect(calls()).toBe(2)

    /*
      第二趟：通道好了。**关键就在这里**——旧实现把 openId 写进了缓存，于是这一批人
      被永久判定为「已知」，再也不会被问第二次；名字与头像在进程余生里都是那串十六进制。
    */
    failing = false
    const [second] = await topics.messagesInPlace('yzj-group-g1')
    expect(calls()).toBe(3)
    expect(second?.fromName).toBe('许康')
    expect(second?.fromAvatar).toBe('https://static.example/p')
  })
})

/**
 * **回包形状** —— 这一次真正的根因，而它此前一条用例都没有。
 *
 * `yzj-cli` 0.1.4 的 `contact user get` 回裸数组；**0.1.6 回 `{ count, list }`**（信封由桥接
 * 层剥掉，剩下的就是这个对象）。3090 钉的是 0.1.6，而 `usersByOpenId` 只认数组——于是整窗
 * 的人一起解析不出来：名字退回 openId、头像退回一个点。
 *
 * **它不报错，只是恰好为空**。这就是为什么前面几轮修的都是别处：症状一模一样，而每一层
 * 都「看起来正常工作」。
 *
 * 断言打在 `YzjChannelClient` 上而不是话题读取器上——形状是**它**读的，上面那些用例把这个
 * 方法整个替掉了，所以它们再多也盖不到这一层（第一版就是这么写错的）。
 */
describe('回包形状：裸数组与 { count, list } 都要认', () => {
  const ROW = {
    department: '灵基Chat',
    name: '许康',
    openId: '5d294a33e4b064934e3cdbe9',
    photoUrl: 'https://static.example/p',
  }

  const clientWith = (json: unknown): YzjChannelClient => new YzjChannelClient(
    { yzjBridge: { run: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '', json, truncated: false, timedOut: false, durationMs: 1 }) } } as never,
    {} as never,
    1_000,
  )

  it('0.1.4 的裸数组认得出来', async () => {
    const users = await clientWith([ROW]).usersByOpenId([ROW.openId])
    expect(users).toEqual([{ openId: ROW.openId, name: '许康', photoUrl: 'https://static.example/p' }])
  })

  /*
    **这一条就是线上那个 bug**：只认数组时这里回空，于是整屏头像变成一个点。
  */
  it('0.1.6 的 { count, list } 也认得出来', async () => {
    const users = await clientWith({ count: 1, list: [ROW] }).usersByOpenId([ROW.openId])
    expect(users).toHaveLength(1)
    expect(users[0]?.name).toBe('许康')
    expect(users[0]?.photoUrl).toBe('https://static.example/p')
  })

  /*
    形状完全认不出来时回空，而**空不等于「查无此人」**：调用方那一层据此不记否定缓存
    （见上一组），所以下一轮还会再问。这里只钉「不崩、不编」。
  */
  it('认不出来的形状：回空，不抛也不编', async () => {
    expect(await clientWith({ unexpected: 'shape' }).usersByOpenId([ROW.openId])).toEqual([])
    expect(await clientWith(undefined).usersByOpenId([ROW.openId])).toEqual([])
  })

  it('没有头像的行不凭空补一个', async () => {
    const users = await clientWith({ count: 1, list: [{ openId: ROW.openId, name: '许康' }] })
      .usersByOpenId([ROW.openId])
    expect(users[0]?.photoUrl).toBeUndefined()
  })
})
