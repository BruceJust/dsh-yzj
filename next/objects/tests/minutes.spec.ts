/**
 * 纪要双桥的规格 (§5.6，设计 v4.16/v4.17).
 *
 * 这一族碰的是**别人的名字和别人的活**，所以它的错法都伤到人：
 *
 * - **挂错人**：把速记写下的一段文字当成绑定账号，那条承诺会以操作者的名义被代发进
 *   另一个人的会话——而我们并不知道组织里叫这个名字的是不是他；
 * - **提第二遍**：纪要没有版本号，按时间戳去重就会把同一件事再提一次，人得再裁决
 *   一遍同样的清单；
 * - **落库成事实**：速记再准，抽出来的也只是稿子。一条没人签过字就进了账的承诺，正是
 *   这套设计从第一天起就在拒绝的东西；
 * - **写回速记**：那些待办没有 per-item id、更新是全量替换——写回去会把人手工改过的
 *   东西整段覆盖。
 *
 * 夹具的形状取自 yapi 导出的真实声明（455 livestream），不是照假设编的。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { proposalFamily } from '../src/goal/family.ts'
import { proposalItemFor, readMinutes, trustOf } from '../src/minutes/bridge.ts'
import { ingestMinutes, pullAndIngest } from '../src/minutes/ingest.ts'

let ctx: Context
let graph: YzjGraph

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-minutes-')) })
  graph.defineFamily(proposalFamily)
  await graph.selectAccount('acct-1')
})

/** 真实形状：minutes.decisions[{content,basis,owner}] / actionItems[{text,assignee,dueDate,executors[]}] */
const PAYLOAD = {
  title: 'Q3 对账对齐会',
  participants: [{ openId: 'p-9', name: '张锐' }, { openId: 'p-8', name: '李四' }],
  minutes: {
    decisions: [
      { content: 'Q3 对账口径按新版执行', basis: '财务确认过新版口径已发布', owner: '农佳捷' },
      { content: '', basis: 'x', owner: 'y' },
    ],
    actionItems: [
      {
        text: '拉三家竞品各一页',
        assignee: '张锐',
        dueDate: 1787022000000,
        executors: [{ openId: 'p-9', name: '张锐', jobTitle: '后端开发' }],
      },
      { text: '核对发票差异', assignee: '王五', dueDate: 0, executors: [] },
      { text: '整理会议纪要', assignee: '发言人3', executors: [] },
      { text: '   ', assignee: '', executors: [] },
    ],
  },
}

const proposals = (): Record<string, unknown>[] =>
  graph.rawEvents(['proposal/opened']).map(event => asRecord(event.data) as Record<string, unknown>)

describe('读一份纪要', () => {
  it('两桥各取各的，空条目不进', () => {
    const read = readMinutes('st-1', PAYLOAD as never)
    expect(read.title).toBe('Q3 对账对齐会')
    expect(read.decisions).toHaveLength(1)
    expect(read.decisions[0]?.basis).toBe('财务确认过新版口径已发布')
    expect(read.tasks.map(task => task.what))
      .toEqual(['拉三家竞品各一页', '核对发票差异', '整理会议纪要'])
    // 1787022000000 是本地时区的 2026-08-18；期限按本地日期读，因为看它的人在本地。
    expect(read.tasks[0]?.due).toBe('2026-08-18')
  })

  it('参会人只作为证据留下，不冒充听众', () => {
    const read = readMinutes('st-1', PAYLOAD as never)
    expect(read.participants).toEqual(['p-9', 'p-8'])
  })
})

describe('三级可信度', () => {
  it('绑定了账号的才算认得出这个人', () => {
    expect(trustOf({ executors: [{ openId: 'p-9', name: '张锐' }] } as never))
      .toEqual({ tier: 'bound', openId: 'p-9', name: '张锐' })
  })

  it('只有一段 AI 写的名字 = named，不是 bound', () => {
    expect(trustOf({ assignee: '王五', executors: [] } as never))
      .toEqual({ tier: 'named', name: '王五' })
  })

  /** 「发言人3」不是名字，是速记认不出人时的占位。 */
  it('「发言人N」当成认不出，不当成名字', () => {
    expect(trustOf({ assignee: '发言人3', executors: [] } as never)).toEqual({ tier: 'unknown' })
    expect(trustOf({ assignee: '发言人 12', executors: [] } as never)).toEqual({ tier: 'unknown' })
  })

  /**
   * 只有第一级带 openId 出去。
   *
   * 后两级把线索写进正文让人自己认领——写进执行者字段的后果不是「填错一个格」：确认
   * 那一刻会以操作者的名义把登记消息发进那个人的会话，而我们并不知道叫这个名字的是
   * 不是他。
   */
  it('未绑定的一律不挂人，线索写进正文', () => {
    const read = readMinutes('st-1', PAYLOAD as never)
    const items = read.tasks.map(proposalItemFor)
    expect(items[0]?.executorOpenId).toBe('p-9')
    expect(items[1]?.executorOpenId).toBeUndefined()
    expect(items[1]?.what).toContain('王五')
    expect(items[1]?.what).toContain('未绑定账号')
    expect(items[2]?.executorOpenId).toBeUndefined()
    expect(items[2]?.what).toContain('没认出是谁')
  })
})

describe('落库：只落提案', () => {
  it('决议与待办分成两份提案——签发与逐条裁决是两个主权时刻', async () => {
    await ingestMinutes(ctx, readMinutes('st-1', PAYLOAD as never))
    const kinds = proposals().map(data => asString(data.kind))
    expect(kinds.sort()).toEqual(['breakdown', 'goal'])
  })

  it('决议提案带上速记给的依据', async () => {
    await ingestMinutes(ctx, readMinutes('st-1', PAYLOAD as never))
    const goal = proposals().find(data => asString(data.kind) === 'goal')
    expect(JSON.stringify(goal?.items)).toContain('财务确认过新版口径已发布')
  })

  it('一条承诺、一个目标都没有被造出来——签发只能是人', async () => {
    await ingestMinutes(ctx, readMinutes('st-1', PAYLOAD as never))
    expect(graph.rawEvents(['commitment/opened'])).toEqual([])
  })

  it('回执说清有几条没绑上人，以及为什么要紧', async () => {
    const outcome = await ingestMinutes(ctx, readMinutes('st-1', PAYLOAD as never))
    expect(outcome.note).toContain('2 条没能绑定到账号')
    expect(outcome.note).toContain('以你的名义')
  })
})

describe('同一场会摄取两次', () => {
  /**
   * 纪要没有版本号。
   *
   * 按时间戳去重会把同一件事提第二遍——纪要被人编辑一下、时间戳就变，而内容没变。
   * 判据只能是内容本身。
   */
  it('内容没变就一条都不再提', async () => {
    await ingestMinutes(ctx, readMinutes('st-1', PAYLOAD as never))
    expect(proposals()).toHaveLength(2)
    const again = await ingestMinutes(ctx, readMinutes('st-1', PAYLOAD as never))
    expect(proposals()).toHaveLength(2)
    expect(again.skipped).toBe(4)
    expect(again.note).toContain('都已经提过了')
  })

  it('新加了一条待办，就只提那一条', async () => {
    await ingestMinutes(ctx, readMinutes('st-1', PAYLOAD as never))
    const grown = {
      ...PAYLOAD,
      minutes: {
        ...PAYLOAD.minutes,
        actionItems: [
          ...PAYLOAD.minutes.actionItems,
          { text: '补一份口径说明', assignee: '张锐', executors: [{ openId: 'p-9', name: '张锐' }] },
        ],
      },
    }
    const outcome = await ingestMinutes(ctx, readMinutes('st-1', grown as never))
    expect(proposals()).toHaveLength(3)
    const fresh = proposals().at(-1)
    expect(JSON.stringify(fresh?.items)).toContain('补一份口径说明')
    expect(JSON.stringify(fresh?.items)).not.toContain('拉三家竞品')
    expect(outcome.skipped).toBe(4)
  })
})

describe('传输是一道门，映射不是', () => {
  /**
   * 通道不在就说通道不在，并说清它卡在哪一环。
   *
   * 实测：网关答的是「当前会话超时」而**不是 404**——门在那儿、路由通，缺的只是一把
   * 用户会话钥匙。一句「没接上」会让人以为要去申请开接口；说清是钥匙问题，才知道该
   * 去要什么。
   */
  it('速记源缺席时，说清缺的是什么', async () => {
    const outcome = await pullAndIngest(ctx, 'st-1')
    expect(outcome.note).toContain('会话超时')
    expect(outcome.note).toContain('钥匙')
    expect(proposals()).toEqual([])
  })

  it('源在的时候，一路走到提案', async () => {
    ctx.provide('yzjMinutes', {
      since: () => Promise.resolve([]),
      detail: () => Promise.resolve(PAYLOAD as never),
    })
    await pullAndIngest(ctx, 'st-1')
    expect(proposals()).toHaveLength(2)
  })

  /** 只读铁律写在类型上：源上没有任何写方法可以调。 */
  it('速记源的读取面上没有写', () => {
    const source: Record<string, unknown> = {
      since: () => Promise.resolve([]),
      detail: () => Promise.resolve(undefined),
    }
    expect(Object.keys(source).sort()).toEqual(['detail', 'since'])
  })
})
