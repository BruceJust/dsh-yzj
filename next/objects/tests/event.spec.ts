/**
 * 事件枢纽的规格 (§5.6 日程五边模型).
 *
 * 这一族最容易长歪的地方，是**把它做成日程的第二份存储**。所以这里锁的都是「它不做
 * 什么」：
 *
 * - **材料就绪度不是字段**：没有人去更新它，它永远是当下承诺状态的一次推导。存成
 *   字段第一天就会撒谎——有人干完了忘了来点一下，会前那一眼看到的还是「没准备好」；
 * - **挂接是累加的**：一场会挂三件事，第二次挂接不能把第一次顶掉；
 * - **看不见的不进计数**：一条只在别处可见的承诺，不该因为挂到会上就对所有人显形——
 *   「还有 2 件没办完」这句话本身就泄露了那两件事的存在；
 * - **没产出就别往日程描述里写**：一份写着「待办、待办」的清单是第二块看板，不是简报；
 * - **出生边只有图记得**：`workData` 平台写得进读不回，实测确认。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor, type GraphViewer } from '@yzj-next/graph'
import { commitmentFamily, eventFamily } from '../src/index.ts'
import { eventHub, materialsFor, readinessLine } from '../src/event/hub.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const ANYONE: GraphViewer = { kind: 'operator', openId: 'op-1' }
const PLACE: GraphViewer = { kind: 'place', placeKey: 'yzj-group-g1' }
const EVENT = '6a684003b8aeeb0c98a9a0cd'

let ctx: Context
let graph: YzjGraph

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-event-')) })
  graph.defineFamily(commitmentFamily)
  graph.defineFamily(eventFamily)
  await graph.selectAccount('acct-1')
})

async function observed(extra: Record<string, unknown> = {}): Promise<void> {
  await graph.append({
    type: 'event/observed',
    data: { eventId: EVENT, title: '830 攀登计划', startAt: 1787018400000, ...extra },
    actor: { kind: 'agent' },
  })
}

async function prep(
  id: string, what: string, extra: Record<string, unknown> = {},
): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id, what, sourceAnchor: `yzj:${id}`, topicKey: `tk-${id}`,
      executor: { kind: 'human', openId: 'p-9', name: '张锐' },
      audience: ['yzj-group-g1'],
      ...extra,
    },
    actor: OPERATOR,
  })
  await graph.append({
    type: 'event/linked', data: { eventId: EVENT, commitmentId: id }, actor: OPERATOR,
  })
}

const close = async (id: string): Promise<void> => {
  await graph.append({
    type: 'commitment/closed', data: { commitmentId: id, cause: 'done' }, actor: OPERATOR,
  })
}

async function produced(topicKey: string, uri: string, title: string): Promise<void> {
  await graph.append({
    type: 'lineage/produced',
    data: {
      topicKey, action: '产出',
      artifact: { uri, title, kind: 'doc', placeKey: 'yzj-kb-1' },
    },
    actor: { kind: 'agent' },
  })
}

describe('材料就绪度是推导，不是字段', () => {
  it('什么都没挂就说什么都没挂', async () => {
    await observed()
    const hub = eventHub(ctx, ANYONE, EVENT)
    expect(hub?.readiness).toBe('none')
    expect(readinessLine(hub as never)).toContain('还没挂')
  })

  it('挂了但一件没动 = none，动了一部分 = partial，全办完 = ready', async () => {
    await observed()
    await prep('c1', '拉数据')
    await prep('c2', '核差异')
    expect(eventHub(ctx, ANYONE, EVENT)?.readiness).toBe('none')
    await close('c1')
    expect(eventHub(ctx, ANYONE, EVENT)?.readiness).toBe('partial')
    await close('c2')
    expect(eventHub(ctx, ANYONE, EVENT)?.readiness).toBe('ready')
  })

  /**
   * 没有人去更新它。
   *
   * 这一条是整族存在的方式：承诺状态一变，会前那一眼跟着变，中间不经过任何一次
   * 「记得来点一下」。存成字段的话，第一个忘了点的人就让它开始撒谎。
   */
  it('承诺一变，会前那一眼跟着变——中间没有任何一次人工更新', async () => {
    await observed()
    await prep('c1', '拉数据')
    expect(readinessLine(eventHub(ctx, ANYONE, EVENT) as never)).toContain('一件都还没动')
    await close('c1')
    // 没有任何一个 event/* 事件被追加，就绪度已经变了。
    expect(graph.rawEvents(['event/linked'])).toHaveLength(1)
    expect(readinessLine(eventHub(ctx, ANYONE, EVENT) as never)).toContain('都办完了')
  })
})

describe('挂接', () => {
  it('挂三件就是三件——第二次挂接不顶掉第一次', async () => {
    await observed()
    await prep('c1', '拉数据')
    await prep('c2', '核差异')
    await prep('c3', '写结论')
    expect(eventHub(ctx, ANYONE, EVENT)?.prepares.map(item => item.commitmentId))
      .toEqual(['c1', 'c2', 'c3'])
  })

  it('解开一件，其余不动', async () => {
    await observed()
    await prep('c1', '拉数据')
    await prep('c2', '核差异')
    await graph.append({
      type: 'event/unlinked', data: { eventId: EVENT, commitmentId: 'c1' }, actor: OPERATOR,
    })
    expect(eventHub(ctx, ANYONE, EVENT)?.prepares.map(item => item.commitmentId)).toEqual(['c2'])
  })

  it('解开目标写空串留痕，而枢纽把空串读成「没挂」', async () => {
    await observed()
    await graph.append({
      type: 'event/linked', data: { eventId: EVENT, goalRef: 'https://y/doc/1' }, actor: OPERATOR,
    })
    expect(eventHub(ctx, ANYONE, EVENT)?.goalRef).toBe('https://y/doc/1')
    await graph.append({
      type: 'event/unlinked', data: { eventId: EVENT, goalRef: 'https://y/doc/1' }, actor: OPERATOR,
    })
    expect(eventHub(ctx, ANYONE, EVENT)?.goalRef).toBeUndefined()
    // 痕迹还在日志里——更正即追加，不是删除。
    expect(graph.rawEvents(['event/unlinked'])).toHaveLength(1)
  })
})

describe('可见域', () => {
  /**
   * 看不见的连计数都不进。
   *
   * 「还有 2 件没办完」这句话本身就泄露了那两件事的存在。一条只在别处可见的承诺，
   * 不该因为被挂到一场会上就对所有人显形（§1.6）。
   */
  it('别的场所才看得见的承诺，不出现在这个场所的会前简报里', async () => {
    await observed({ audience: ['yzj-group-g1'] })
    await prep('c-here', '本群的活')
    await prep('c-far', '别处的活', { audience: ['yzj-group-far'] })
    const mine = eventHub(ctx, PLACE, EVENT)
    expect(mine?.prepares.map(item => item.commitmentId)).toEqual(['c-here'])
    // 操作者看得见全部——同一场会，两个人两种渲染。
    expect(eventHub(ctx, ANYONE, EVENT)?.prepares).toHaveLength(2)
  })

  it('这个场所看不见这场会，就什么都读不到', async () => {
    await observed({ audience: ['yzj-group-far'] })
    expect(eventHub(ctx, PLACE, EVENT)).toBeUndefined()
  })
})

describe('写进日程描述的那份清单', () => {
  it('只列真的有产出的——一串待办不是简报，是第二块看板', async () => {
    await observed()
    await prep('c1', '拉数据')
    await prep('c2', '核差异')
    expect(materialsFor(eventHub(ctx, ANYONE, EVENT) as never)).toBeUndefined()
    await produced('tk-c1', 'https://y/doc/9', '竞品对比')
    const materials = materialsFor(eventHub(ctx, ANYONE, EVENT) as never)
    expect(materials).toContain('竞品对比')
    expect(materials).toContain('https://y/doc/9')
    // 没产出的那件不出现在清单上。
    expect(materials).not.toContain('核差异')
  })

  it('产出按承诺归位，不会串到隔壁那件事名下', async () => {
    await observed()
    await prep('c1', '拉数据')
    await prep('c2', '核差异')
    await produced('tk-c1', 'https://y/doc/9', '竞品对比')
    const hub = eventHub(ctx, ANYONE, EVENT)
    expect(hub?.prepares.find(i => i.commitmentId === 'c1')?.artifacts).toHaveLength(1)
    expect(hub?.prepares.find(i => i.commitmentId === 'c2')?.artifacts).toEqual([])
  })
})

/**
 * 写过就不再写 —— 这一段是实跑撞出来的。
 *
 * 事件里字段名写成 `materials`，而枢纽读的是 `postedMaterials`：**永远读到
 * undefined**。后果不是少一句话，是那道闸永远不闭合——每调用一次就往一份全参会人看的
 * 日程描述里重写一遍，而会前简报永远在催「快去写」。单元测试当时根本没覆盖这条路，
 * 是在真日程上跑了一次才现形的。
 */
/**
 * 共用会话 —— 承诺板刚为这件事换过判据，这里不能又踩回去 (4h⑤ 同一课).
 *
 * 第一版用 `Map<topicKey, commitmentId>`：同一个会话里挂了两件事，后写的顶掉先写的，
 * 那个会话产出的东西**全部记在第二件名下、第一件一件不剩**，而没有任何地方会报错。
 */
describe('一个会话里挂了两件事', () => {
  it('产出算在共用它的每一件名下，而不是凭空归给其中一件', async () => {
    await observed()
    await prep('c1', '拉数据', { topicKey: 'tk-shared' })
    await prep('c2', '核差异', { topicKey: 'tk-shared' })
    await produced('tk-shared', 'https://y/doc/9', '共用产出')
    const hub = eventHub(ctx, ANYONE, EVENT)
    expect(hub?.prepares.find(i => i.commitmentId === 'c1')?.artifacts).toHaveLength(1)
    expect(hub?.prepares.find(i => i.commitmentId === 'c2')?.artifacts).toHaveLength(1)
  })

  it('说得清出处的那条只算在它自己名下', async () => {
    await observed()
    await prep('c1', '拉数据', { topicKey: 'tk-shared' })
    await prep('c2', '核差异', { topicKey: 'tk-shared' })
    await graph.append({
      type: 'lineage/produced',
      data: {
        topicKey: 'tk-shared', action: '产出', taskId: 'c1',
        artifact: { uri: 'https://y/doc/9', title: 'c1 的活留下的', kind: 'doc', placeKey: 'kb' },
      },
      actor: { kind: 'agent' },
    })
    const hub = eventHub(ctx, ANYONE, EVENT)
    expect(hub?.prepares.find(i => i.commitmentId === 'c1')?.artifacts).toHaveLength(1)
    expect(hub?.prepares.find(i => i.commitmentId === 'c2')?.artifacts).toEqual([])
  })

  /** 清单是给人看的：同一个链接印两遍，人会以为有两份东西。 */
  it('清单按 URI 去重，共用的那份只印一行', async () => {
    await observed()
    await prep('c1', '拉数据', { topicKey: 'tk-shared' })
    await prep('c2', '核差异', { topicKey: 'tk-shared' })
    await produced('tk-shared', 'https://y/doc/9', '共用产出')
    const materials = materialsFor(eventHub(ctx, ANYONE, EVENT) as never) as string
    expect(materials.split('https://y/doc/9')).toHaveLength(2)
  })
})

describe('写过的那一版', () => {
  it('落库之后枢纽读得到——两侧同名不是巧合，是这道闸的全部依据', async () => {
    await observed()
    await prep('c1', '拉数据')
    await produced('tk-c1', 'https://y/doc/9', '竞品对比')
    const materials = materialsFor(eventHub(ctx, ANYONE, EVENT) as never) as string
    await graph.append({
      type: 'event/materials-posted',
      data: { eventId: EVENT, postedMaterials: materials, postedStatus: 'written' },
      actor: { kind: 'agent' },
    })
    expect(eventHub(ctx, ANYONE, EVENT)?.postedMaterials).toBe(materials)
  })

  it('产出变了，清单也变——这时才该再写一次', async () => {
    await observed()
    await prep('c1', '拉数据')
    await produced('tk-c1', 'https://y/doc/9', '竞品对比')
    const first = materialsFor(eventHub(ctx, ANYONE, EVENT) as never) as string
    await graph.append({
      type: 'event/materials-posted',
      data: { eventId: EVENT, postedMaterials: first, postedStatus: 'written' },
      actor: { kind: 'agent' },
    })
    await produced('tk-c1', 'https://y/doc/10', '定价拆解')
    const second = materialsFor(eventHub(ctx, ANYONE, EVENT) as never)
    expect(second).not.toBe(first)
    expect(eventHub(ctx, ANYONE, EVENT)?.postedMaterials).toBe(first)
  })

  /** 写没写成不是**这场会**的状态——图的查询层按 `status` 过滤对象。 */
  it('不往事件的 status 上写「写成没写成」', async () => {
    await observed()
    await graph.append({
      type: 'event/materials-posted',
      data: { eventId: EVENT, postedMaterials: 'x', postedStatus: 'failed', postedDetail: '没权限' },
      actor: { kind: 'agent' },
    })
    const state = graph.rawObject('event', EVENT)?.state as Record<string, unknown>
    expect(state.status).toBeUndefined()
    expect(state.postedStatus).toBe('failed')
  })
})

describe('出生边只有图记得', () => {
  /**
   * `workData{msgId,groupId}` 是平台给的官方字段，但实测（v3.10）：它只声明在
   * `create`/`modify` 上，`detail` **不返回**——写得进，读不回。所以「这场会从哪句
   * 话里长出来」不在图上记就没有第二处。
   */
  it('记下它是从哪条消息长出来的', async () => {
    await observed({ bornFrom: 'yzj:m-77' })
    expect(eventHub(ctx, ANYONE, EVENT)?.bornFrom).toBe('yzj:m-77')
  })
})
