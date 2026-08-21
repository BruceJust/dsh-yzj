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
import { applyGoalWriteback, lineFor, writebackIdFor } from '../src/goal/writeback.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const DOC = '6a7a87ece7eece43b1e36d8e'
const GOAL = `https://www.yunzhijia.com/knowledge/lingee/#/store/doc/${DOC}`

let ctx: Context
let graph: YzjGraph
/** 服务端此刻会怎么答。测试改它来模拟通道好与坏。 */
let insertOk: boolean
/** 每一次真的打出去的 CLI 命令——「写了几次」是这个文件最要紧的断言。 */
let inserts: string[][]

/**
 * 让监听器里那串 fire-and-forget 跑完。
 *
 * 微任务不够：`graph.append` 落盘是真的磁盘 I/O，排在宏任务里。只 `await
 * Promise.resolve()` 的话，CLI 那次调用看得见、写下的事件看不见——一个只在测试里
 * 出现的半截状态，会让人以为是生产代码漏了 append。
 */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 8; round += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }
}

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-wb-')) })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  insertOk = true
  inserts = []
  ctx.provide('yzjBridge', {
    run: (command: string[]) => {
      if (command[1] === 'block' && command[2] === 'insert') {
        inserts.push(command)
        // 照真 bridge 的形状：失败带的是 `stderr`，不是 `error`。
        return Promise.resolve(insertOk
          ? { ok: true, json: {} }
          : { ok: false, stderr: 'error: 没有写权限', exitCode: 1 })
      }
      return Promise.resolve({ ok: true, json: {} })
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

const written = (): unknown[] => [...graph.rawEvents(['goal/written-back'])]
const stateOf = (id: string): Record<string, unknown> | undefined =>
  asRecord(graph.rawObject('goal-writeback', id)?.state)

describe('生与死，两笔', () => {
  it('子承诺出生就往真身里写一行', async () => {
    await goal()
    applyGoalWriteback(ctx)
    await child()
    await settle()
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
    await settle()
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
    await settle()
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
    await settle()
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
    await settle()
    expect(inserts).toEqual([])
    const record = stateOf(writebackIdFor('https://example.com/plan', 'c-x', 'born'))
    expect(record?.status).toBe('failed')
    expect(asString(record?.detail)).toContain('写不进去')
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
    await settle()
    expect(inserts).toHaveLength(1)
    expect(JSON.stringify(inserts[0])).toContain('拉三家竞品')
  })

  /** 水位只落一次：重启读回同一个数，否则每次重启都会把上一段历史当成新的。 */
  it('重启读回同一道水位，不重新划线', async () => {
    await goal()
    const off = applyGoalWriteback(ctx)
    await settle()
    await child('c-1')
    await settle()
    expect(inserts).toHaveLength(1)
    off()
    applyGoalWriteback(ctx)
    await settle()
    expect(graph.rawEvents(['goal/writeback-began'])).toHaveLength(1)
    expect(inserts).toHaveLength(1)
  })
})
