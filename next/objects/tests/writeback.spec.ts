/**
 * 状态回写真身的规格 (v4.9「同一条边两个听众」，v3.10 4h①).
 *
 * 这一族写的是**一份全组在读的文档**，所以它的错法都比平常贵一档：
 *
 * - **重贴**：重启扫一遍把同一条子承诺再写一行——别人打开文档看到两条一样的活；
 * - **无限重试**：失败不落痕，每次重启都再试一次，试到文档里全是它；
 * - **静默失败**：板上说「已回写」而文档里什么都没有——幽灵承诺换了个通道复活；
 * - **变成日志流**：每次进度都推回去，那份文档就短不下来，而它的价值恰恰是短到有人
 *   愿意读；
 * - **只报死不报生**：一条在上线前就结束的承诺，文档里会冒出一行「已完成」，而组里
 *   从来没见过它被登记。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString, type GraphActor } from '@yzj-next/graph'
import { commitmentFamily, goalCommitmentIdFor } from '../src/index.ts'
import { isFence } from '../src/fence.ts'
import { waitingFamily } from '../src/task/waiting.ts'
import { applyGoalWriteback, lineFor, writebackIdFor } from '../src/goal/writeback.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const DOC = '6a7a87ece7eece43b1e36d8e'
const GOAL = `https://www.yunzhijia.com/knowledge/lingee/#/store/doc/${DOC}`

let ctx: Context
let graph: YzjGraph
/** 服务端此刻会怎么答。测试改它来模拟通道好与坏。 */
let insertOk: boolean
/**
 * `doc block list` 通不通。
 *
 * 和 `insertOk` **分开**摆：栅栏那一层的关键场景恰恰是「读失败、写成功」——超时最
 * 常见的样子。两个开关合成一个，这个场景就永远造不出来。
 */
let listOk: boolean
/** 每一次真的打出去的 CLI 命令——「写了几次」是这个文件最要紧的断言。 */
let inserts: string[][]
/**
 * 服务端上那份文档此刻的正文。
 *
 * 夹具**建模这份文档**，而不是每次都答一句空。差别在于：答空的夹具让「写之前先看
 * 一眼它现在什么样」这件事永远看到同一片空白，于是栅栏该不该重立、有人把线删了会
 * 怎样，一条都测不出来——测试会全绿，而绿得没有内容。
 */
let docLines: string[]

/** 把 `docLines` 渲染成 `doc block list` 的**真实形状**（见 truth.spec.ts 的同款夹具）。 */
const blockList = (): unknown => ({
  data: {
    version: docLines.length,
    blocks: [{
      id: 'blk-1',
      type: 'doc',
      content: docLines.map(line => ({
        type: 'paragraph',
        attrs: { align: 1 },
        content: [{ type: 'text', content: line }],
        childNodes: null,
        textContent: null,
      })),
    }],
  },
})

/** 从一次 insert 的 `--element` 里读回它写了哪几行。 */
const linesOf = (command: string[]): string[] => {
  const at = command.indexOf('--element')
  const parsed = JSON.parse(command[at + 1] ?? '[]') as { content?: { content?: string }[] }[]
  return parsed.map(node => node.content?.[0]?.content ?? '')
}

/** 已经落库的回写记录。`settle` 用它判断「还有没有动静」。 */
const written = (): unknown[] => [...graph.rawEvents(['goal/written-back'])]

/**
 * 等到**不再有动静**为止，而不是睡固定的几拍。
 *
 * 监听器里那串是 fire-and-forget，而 `graph.append` 落盘是真的磁盘 I/O，排在宏任务
 * 里。第一版睡 8 拍：单跑十二次全绿，套件满载时每十次红一次——CLI 那次调用看得见、
 * 写下的事件还没落，于是断言读到 `undefined`。
 *
 * 固定睡眠是一个**关于时序的假设**，而它在负载下一定会错。这一整天我都在说「靠运气
 * 绿比红更糟」，然后自己在夹具里写了一个靠运气绿的等待。改成**轮询到静止**：连续两次
 * 采样看到同样的计数才算完，上限兜底。
 *
 * 而「静止」本身还留着一个瞎点，见 {@link landed}：给得出 `until` 的用例都该给。
 */
const settle = async (until?: () => boolean): Promise<void> => {
  const sample = (): string => `${String(inserts.length)}/${String(written().length)}`
  let last = ''
  for (let round = 0; round < 400; round += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 2) })
    if (until?.() === false) continue
    const now = sample()
    if (round > 2 && now === last) return
    last = now
  }
}

/**
 * 等到**某件确定的事发生**为止。
 *
 * 「轮询到静止」这一招有个瞎点：流水线还没启动的 `0/0` 和跑完了的 `0/0` 长得一模
 * 一样。单跑没事，全量满载时它在开头就判定静止、然后断言读到 `undefined`——800 条里
 * 红一条，正是这么红的。
 *
 * 所以凡是**知道自己在等什么**的用例，就把那件事说出来，别去猜一段没动静。剩下那些
 * 断言「什么都没发生」的，才轮到静止判据——它们等的本来就是一段空白。
 */
const landed = (...ids: string[]) => (): boolean => ids.every(id => stateOf(id) !== undefined)

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-wb-')) })
  graph.defineFamily(commitmentFamily)
  // 回写写不进去会开一条**等待**，这个家族不注册的话那条事件落不进来，
  // 而落不进来和「没开」在断言里长得一模一样。
  graph.defineFamily(waitingFamily)
  await graph.selectAccount('acct-1')
  insertOk = true
  listOk = true
  inserts = []
  docLines = []
  ctx.provide('yzjBridge', {
    /*
      每次调用都**真的让出一拍**。

      第一版同步 resolve，于是「读一眼文档」和「写下去」之间的缝是零——而真 bridge
      是一次进程启动，那道缝是这个文件里所有竞态的住处。缝为零的替身让并发用例**永远
      绿**：我把串行那层整个拆掉重跑，21 条一条没红。一个拦不住的断言不是保护，是
      一张假收据。
    */
    run: async (command: string[]) => {
      const issued = command[1] === 'block' && command[2] === 'insert'
      if (issued) inserts.push(command)
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      if (issued) {
        // 照真 bridge 的形状：失败带的是 `stderr`，不是 `error`。
        if (!insertOk) return { ok: false, stderr: 'error: 没有写权限', exitCode: 1 }
        docLines.push(...linesOf(command))
        return { ok: true, json: {} }
      }
      if (command[1] === 'block' && command[2] === 'list') {
        return listOk
          ? { ok: true, json: blockList() }
          : { ok: false, stderr: 'error: 请求超时', timedOut: true }
      }
      return { ok: true, json: {} }
    },
  })
})

async function goal(): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: goalCommitmentIdFor(GOAL),
      what: 'Q3 对账',
      goalRef: GOAL,
      executor: { kind: 'human', openId: 'op-1', name: '我' },
      sourceAnchor: 'desktop:board',
    },
    actor: OPERATOR,
  })
}

async function child(id = 'c1', extra: Record<string, unknown> = {}): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id,
      what: '拉三家竞品',
      parentGoalRef: GOAL,
      executor: { kind: 'human', openId: 'p-9', name: '张锐' },
      sourceAnchor: 'yzj:m-1',
      ...extra,
    },
    actor: OPERATOR,
  })
}

const stateOf = (id: string): Record<string, unknown> | undefined =>
  asRecord(graph.rawObject('goal-writeback', id)?.state)

describe('生与死，两笔', () => {
  it('子承诺出生就往真身里写一行', async () => {
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    expect(inserts).toHaveLength(1)
    expect(JSON.stringify(inserts[0])).toContain('张锐')
    expect(stateOf(writebackIdFor(GOAL, 'c1', 'born'))?.status).toBe('written')
  })

  it('终态再写一行，两笔分开记', async () => {
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle()
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'accepted' }, actor: OPERATOR,
    })
    await settle(landed(writebackIdFor(GOAL, 'c1', 'settled')))
    expect(inserts).toHaveLength(2)
    expect(written()).toHaveLength(2)
    expect(stateOf(writebackIdFor(GOAL, 'c1', 'settled'))?.status).toBe('written')
  })

  /**
   * 中间的每一次动静都**不写**。
   *
   * 那份文档是全组共读的，它的价值恰恰在于短到有人愿意读。把每次改期、每条回执都推
   * 回去，它就变成一条日志流——而日志流没有人读。
   */
  it('中间的改动一律不写——回写只在生与死', async () => {
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle()
    for (const data of [
      { commitmentId: 'c1', due: '周五' },
      { commitmentId: 'c1', lastReceipt: '在做了' },
      { commitmentId: 'c1', executor: { kind: 'human', openId: 'p-8', name: '李四' } },
    ]) {
      await graph.append({ type: 'commitment/updated', data, actor: OPERATOR })
      await settle()
    }
    expect(inserts).toHaveLength(1)
  })

  /** 目标自己那条不回写：往自己身上贴一行「我出生了」没有意义。 */
  it('目标自己那条不写回自己', async () => {
    applyGoalWriteback(ctx)
    await goal()
    await settle()
    expect(inserts).toEqual([])
  })

  it('没挂目标的承诺不写——它没有真身可写', async () => {
    applyGoalWriteback(ctx)
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'free', what: '随手一件事', sourceAnchor: 'yzj:m-2',
        executor: { kind: 'agent', topicKey: 'tk-1' },
      },
      actor: OPERATOR,
    })
    await settle()
    expect(inserts).toEqual([])
  })
})

describe('那份文档是全组在读的', () => {
  it('写过的不再写——重启扫一遍不重贴', async () => {
    await goal()
    const off = applyGoalWriteback(ctx)
    await child()
    /*
      等**那条记录真的落库**再重启，不是等一段没动静。

      等静止的话，重启常常发生在「CLI 已经写出去、记录还没落」这道缝里，于是新实例
      扫到「没写过」又贴一行——测试红了，红的却不是这条用例要考的东西。这条考的是
      「写完了的那一笔不再写」。

      那道缝在生产里是真的（进程在这两步之间崩掉，重启会重贴一行）。不去堵它是**选
      定的一边**：堵法只有先落一条「打算写」再改成「写成了」，而那样一来，崩在中间
      就变成「记着写过、文档里什么都没有」——这个文件开头把它叫做幽灵承诺换了个通道
      复活。多贴一行看得见、改得掉；少写一行没人知道。
    */
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    expect(inserts).toHaveLength(1)
    off()
    // 重启：同一份日志重新挂上监听，补账扫一遍。
    applyGoalWriteback(ctx)
    await settle()
    expect(inserts, '重启把同一条子承诺又贴了一行').toHaveLength(1)
  })

  /**
   * 失败也落一条。
   *
   * 不落的话每次重启都会再试一次，试到文档里全是它；而板上说「已回写」、文档里什么都
   * 没有，是幽灵承诺换了个通道复活。
   */
  it('写不进去就记下写不进去，并且不无限重试', async () => {
    await goal()
    insertOk = false
    const off = applyGoalWriteback(ctx)
    await child()
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    expect(inserts).toHaveLength(1)
    const record = stateOf(writebackIdFor(GOAL, 'c1', 'born'))
    expect(record?.status).toBe('failed')
    expect(asString(record?.detail)).toContain('没有写权限')
    off()
    applyGoalWriteback(ctx)
    await settle()
    expect(inserts, '失败之后重启又试了一次').toHaveLength(1)
  })

  /**
   * 死了要补生 —— 但只在**水位之后**。
   *
   * 这一条原来考的是「上线前就结束的承诺也补两笔」。水位规则出来之后，那个场景归了
   * 历史：一条在我们上线前就活完死掉的承诺，今天往共读文档里补两行不是修复，是噪音。
   *
   * 真正要守的是水位**之后**那一段：出生和终态挨在一起发生（一次快速的登记+完成，
   * 或者出生那一笔写失败后紧接着被关掉），`born` 那一笔不能因此丢掉——只写 `settled`
   * 的话，文档里会冒出一行「已完成」而组里从没见过它被登记。
   */
  it('出生与终态挨在一起时，两笔都写且出生在前', async () => {
    await goal()
    applyGoalWriteback(ctx)
    await settle()
    // 中间不 settle：两个事件连着来，补生的那一支必须自己把顺序摆对。
    await child('c-fast')
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c-fast', cause: 'done' }, actor: OPERATOR,
    })
    await settle()
    expect(inserts).toHaveLength(2)
    expect(JSON.stringify(inserts[0])).not.toContain('已完成')
    expect(JSON.stringify(inserts[1])).toContain('已完成')
  })

  it('目标真身不是知识库文档时，说清写不进去而不是假装写了', async () => {
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: goalCommitmentIdFor('https://example.com/plan'),
        what: '外链目标', goalRef: 'https://example.com/plan',
        executor: { kind: 'human', openId: 'op-1' }, sourceAnchor: 'a',
      },
      actor: OPERATOR,
    })
    applyGoalWriteback(ctx)
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-x', what: '一件事', parentGoalRef: 'https://example.com/plan',
        executor: { kind: 'human', openId: 'p-9' }, sourceAnchor: 'b',
      },
      actor: OPERATOR,
    })
    await settle(landed(writebackIdFor('https://example.com/plan', 'c-x', 'born')))
    expect(inserts).toEqual([])
    const record = stateOf(writebackIdFor('https://example.com/plan', 'c-x', 'born'))
    expect(record?.status).toBe('failed')
    expect(asString(record?.detail)).toContain('写不进去')
  })
})

/**
 * 台账写在栅栏以下 (见 `../src/fence.ts`).
 *
 * 这一段拦的是一个**组合缺陷**：这个文件（往文档尾部贴台账）和差距简报（改读真身
 * 正文当判据）各自都对，合起来变成**系统拿自己的记账证明自己达标**。两个都绿的东西
 * 合起来撒谎，所以只能在这一层锁住。
 */
describe('台账写在栅栏以下', () => {
  /** 文档此刻的正文，按行。 */
  const doc = (): string[] => docLines

  it('第一笔先立一条栅栏，账写在线以下', async () => {
    docLines = ['成功标准一：三家竞品各出一页']
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    // 栅栏和它下面第一行**一次调用**写下去：分两次的话，中间那道缝里另一笔会插进来，
    // 插在栅栏上面，于是它永远被当成一条成功标准。
    expect(inserts).toHaveLength(1)
    expect(linesOf(inserts[0] ?? [])).toHaveLength(2)
    expect(doc()[0]).toBe('成功标准一：三家竞品各出一页')
    expect(isFence(doc()[1] ?? '')).toBe(true)
    expect(doc()[2]).toContain('张锐')
  })

  it('第二笔不再立线', async () => {
    docLines = ['成功标准一']
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'accepted' }, actor: OPERATOR,
    })
    await settle(landed(writebackIdFor(GOAL, 'c1', 'settled')))
    expect(doc().filter(line => isFence(line)), '同一份文档里立了两条栅栏').toHaveLength(1)
  })

  /**
   * 两条子承诺**同时**出生，只立一条线。
   *
   * `inFlight` 挡的是同一笔被写两遍；挡不住不同的两笔撞同一份文档——两边都读到「还没有
   * 栅栏」，然后各贴一条。栅栏是一次性的东西，而判断它在不在必然是一次「读完再写」，
   * 这中间的缝只能靠排队补。
   */
  it('两条子承诺同时出生，只立一条线', async () => {
    docLines = ['成功标准一']
    await goal()
    applyGoalWriteback(ctx)
    // 中间不 settle：两条连着来，回写那边必须自己把它们排成队。
    await child('c-a')
    await child('c-b', { executor: { kind: 'human', openId: 'p-8', name: '李四' } })
    await settle(landed(writebackIdFor(GOAL, 'c-a', 'born'), writebackIdFor(GOAL, 'c-b', 'born')))
    expect(inserts).toHaveLength(2)
    expect(doc().filter(line => isFence(line))).toHaveLength(1)
    // 两条账都在线以下——有一条落在线上面，它就成了一条「成功标准」。
    const at = doc().findIndex(line => isFence(line))
    expect(doc().slice(at).join('\n')).toContain('张锐')
    expect(doc().slice(at).join('\n')).toContain('李四')
  })

  it('有人把线删了，下一笔重新立 —— 读是权威，图不是', async () => {
    docLines = ['成功标准一']
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    // 有人在云之家把那条线删了（台账那行留着）。图里仍然记着「写过」。
    docLines = docLines.filter(line => !isFence(line))
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'accepted' }, actor: OPERATOR,
    })
    await settle(landed(writebackIdFor(GOAL, 'c1', 'settled')))
    expect(doc().filter(line => isFence(line)), '线被删了却没补回来').toHaveLength(1)
  })

  /**
   * 读超时 + 写成功 —— 超时最常见的样子。
   *
   * 「没看着」当成「没有线」，这一下就往一份全组在读的文档里再贴一条栅栏。所以看不着
   * 的时候退回去问图：**这个目标我们成功写进去过账没有**。
   */
  it('读不着文档但以前写成功过，就不再立线', async () => {
    docLines = ['成功标准一']
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    const before = doc().length
    listOk = false
    await graph.append({
      type: 'commitment/closed', data: { commitmentId: 'c1', cause: 'accepted' }, actor: OPERATOR,
    })
    await settle(landed(writebackIdFor(GOAL, 'c1', 'settled')))
    expect(doc()).toHaveLength(before + 1)
    expect(doc().filter(line => isFence(line))).toHaveLength(1)
  })

  it('读不着又从没写成功过，宁可多立一条线', async () => {
    /*
      两边都答不上来时偏哪边，是这里唯一的选择题。

      多一条线：`splitAtFence` 认第一条，多出来的那条落在台账里——难看，但判断不变。
      少一条线：一行「· 拉三家竞品 — 张锐 · 已完成」裸贴在成功标准后面，被当成一条
      标准判 met，证据引它自己。两种难看不是一个量级。
    */
    docLines = ['成功标准一']
    listOk = false
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle(landed(writebackIdFor(GOAL, 'c1', 'born')))
    expect(linesOf(inserts[0] ?? [])).toHaveLength(2)
    expect(isFence(linesOf(inserts[0] ?? [])[0] ?? '')).toBe(true)
  })
})

/**
 * 写不进去要**有人知道** —— 那条失败记录得有读者。
 *
 * 装这一段之前，`goal/written-back` 这个家族一个读者都没有：失败照实落库，然后没有
 * 任何代码、任何面、任何人再看它一眼。今天下午的后果是实打实的——yzj-cli 升级改了一个
 * 参数名，从那一刻起线上每一笔回写都在失败，而系统一声不吭，是手敲一条 CLI 才发现的。
 */
describe('写不进去要有人知道', () => {
  const openWaitings = (): Record<string, unknown>[] => [...graph.rawEvents(['waiting/opened'])]
    .map(e => asRecord(e.data) ?? {})
  const closedIds = (): string[] => [...graph.rawEvents(['waiting/closed'])]
    .map(e => asString(asRecord(e.data)?.waitingId) ?? '')

  it('写不进去就开一条等待，话里说清组里看不到什么', async () => {
    await goal()
    insertOk = false
    applyGoalWriteback(ctx)
    await child()
    await settle(() => openWaitings().length === 1)
    expect(openWaitings()).toHaveLength(1)
    const what = asString(openWaitings()[0]?.what) ?? ''
    // 说的是**组里看不到了**，不是「一次 API 调用失败」——后者没人能据此做任何事。
    expect(what).toContain('Q3 对账')
    expect(what).toContain('组里')
    expect(what).toContain('没有写权限')
    expect(openWaitings()[0]?.kind).toBe('system')
  })

  it('同一次故障只开一条 —— 「等了多久」不能每失败一笔就重置', async () => {
    await goal()
    insertOk = false
    applyGoalWriteback(ctx)
    await child('c-a')
    await child('c-b', { executor: { kind: 'human', openId: 'p-8', name: '李四' } })
    await settle(() => openWaitings().length >= 1
      && landed(writebackIdFor(GOAL, 'c-a', 'born'), writebackIdFor(GOAL, 'c-b', 'born'))())
    expect(openWaitings()).toHaveLength(1)
  })

  it('写成了就关掉 —— 只有写成功能证明那份文档又通了', async () => {
    await goal()
    insertOk = false
    applyGoalWriteback(ctx)
    await child('c-a')
    await settle(() => openWaitings().length === 1)
    expect(closedIds()).toEqual([])
    insertOk = true
    await child('c-b', { executor: { kind: 'human', openId: 'p-8', name: '李四' } })
    await settle(() => closedIds().length === 1)
    expect(closedIds()).toEqual([asString(openWaitings()[0]?.waitingId)])
  })

  /**
   * 好了之后再坏一次，还得开得出来。
   *
   * 等待是**吸收态**：关掉的那条不能复活。所以 id 里必须带一个会变的代次，否则第二次
   * 故障会撞上一条已经关掉的对象，`append` 落在墓碑上，而系统再一次一声不吭——比第一次
   * 更坏，因为这次我们以为自己装了警报。
   */
  it('好了之后再坏一次，仍然开得出新的一条', async () => {
    await goal()
    applyGoalWriteback(ctx)
    await child('c-a')
    await settle(landed(writebackIdFor(GOAL, 'c-a', 'born')))
    insertOk = false
    await child('c-b', { executor: { kind: 'human', openId: 'p-8', name: '李四' } })
    await settle(() => openWaitings().length === 1)
    expect(openWaitings()).toHaveLength(1)
    insertOk = true
    await child('c-c', { executor: { kind: 'human', openId: 'p-7', name: '王五' } })
    await settle(() => closedIds().length === 1)
    expect(closedIds()).toHaveLength(1)
    insertOk = false
    await child('c-d', { executor: { kind: 'human', openId: 'p-6', name: '赵六' } })
    await settle(() => openWaitings().length === 2)
    expect(openWaitings(), '第二次故障没开出新的等待——撞在墓碑上了').toHaveLength(2)
    expect(openWaitings()[0]?.waitingId).not.toBe(openWaitings()[1]?.waitingId)
  })
})

describe('写进去的那一行', () => {
  it('出生那行说清是谁的活、什么时候交', () => {
    const line = lineFor('born', {
      what: '拉三家竞品', executor: { kind: 'human', name: '张锐' }, due: '周五',
    })
    expect(line).toBe('· 拉三家竞品 — 张锐 · 周五')
  })

  it('agent 干的活就说 agent——写「未知」等于在文档里留一个谜', () => {
    expect(lineFor('born', { what: '跑一遍', executor: { kind: 'agent', topicKey: 'tk' } }))
      .toContain('agent')
  })

  it('终态那行说清是怎么结束的——作废带上原因', () => {
    expect(lineFor('settled', {
      what: '拉三家竞品', executor: { kind: 'human', name: '张锐' },
      status: 'voided', cause: '这个季度不做了',
    })).toContain('已作废（这个季度不做了）')
  })
})

/**
 * 补账的水位 —— 两个方向相反的错，正好互相抵消，所以一次都没被发现（自审）。
 *
 * - 补账在插件挂载那一刻就扫，而账号分区是**通道拿到身份之后**才打开的：扫的时候库
 *   还是空的。生产日志里 11 条带 `parentGoalRef` 的承诺，`goal/written-back` **零条**
 *   ——「live 验过」的那次是在一个自己开好库的夹具里跑的，真装配里它一次没跑过。
 * - 而假如它真跑起来了，会更糟：把**全部历史**挨个补写进真实的目标文档，而那些文档
 *   是同事在读的。一条三个月前关掉的承诺今天补一行「已完成」进去不是修复，是噪音。
 *
 * 所以回写只对**上线之后**发生的事负责。水位之前的不是「漏了」，是不归它管。
 */
describe('补账只补上线之后的', () => {
  it('上线前就存在的子承诺，一条都不补写', async () => {
    await goal()
    await child('c-old')
    // 上线：此刻之前的一切都归历史。
    applyGoalWriteback(ctx)
    await settle()
    expect(inserts, '把历史倒进了真实文档').toEqual([])
    expect(graph.rawEvents(['goal/writeback-began'])).toHaveLength(1)
  })

  it('水位之后出生的照常写', async () => {
    await goal()
    await child('c-old')
    applyGoalWriteback(ctx)
    await settle()
    await child('c-new')
    await settle(landed(writebackIdFor(GOAL, 'c-new', 'born')))
    expect(inserts).toHaveLength(1)
    expect(JSON.stringify(inserts[0])).toContain('拉三家竞品')
  })

  /** 水位只落一次：重启读回同一个数，否则每次重启都会把上一段历史当成新的。 */
  it('重启读回同一道水位，不重新划线', async () => {
    await goal()
    const off = applyGoalWriteback(ctx)
    await settle()
    await child('c-1')
    await settle(landed(writebackIdFor(GOAL, 'c-1', 'born')))
    expect(inserts).toHaveLength(1)
    off()
    applyGoalWriteback(ctx)
    await settle()
    expect(graph.rawEvents(['goal/writeback-began'])).toHaveLength(1)
    expect(inserts).toHaveLength(1)
  })
})
