/**
 * 真身之变的规格 (§1.9-4).
 *
 * 这一族此前**只有定义没有生产者**——没有任何代码去看过那份文档，所以
 * `truth/changed` 永远不会被写下。于是整个系统对一个目标的判断，一直来自立目标
 * 那一刻抄下的一份成功标准副本；而设计说改成功标准就是去改云之家那份文档。
 *
 * 这里锁的四件事，每一件都是「静悄悄地错」的一种：
 *
 * - **看不了 ≠ 没变**：用一次失败的观察冒充一次成功的观察，是这套系统里最贵的
 *   谎——它让人以为对过账了；
 * - **只报一次**：记回基准，否则同一个改动每次消费都重报，而每次都在喊的警告
 *   等于没有警告；
 * - **第一次不算变**：第一次看到它只是建立基准，报「变了」是凭空制造一次警报；
 * - **不长得像 id 的引用不去问服务端**：`…/doc/q3` 取成 `q3` 拿去问，得到的
 *   失败和「文档没变」长得一模一样。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString, type GraphActor } from '@yzj-next/graph'
import { commitmentFamily } from '../src/commitment/family.ts'
import { fenceLine } from '../src/fence.ts'
import { goalCommitmentIdFor } from '../src/goal/family.ts'
import { checkGoalTruth, docIdOf, readGoalBody, truthLine } from '../src/goal/truth.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const DOC = '6a7a87ece7eece43b1e36d8e'
const GOAL = `https://www.yunzhijia.com/knowledge/lingee/#/store/doc/${DOC}`

let ctx: Context
let graph: YzjGraph
/*
  服务端此刻会答什么。测试通过改它们来模拟「有人去云之家动了这份文档」。

  两条路分开摆:正文版本(`doc block list`)与节点元数据(`doc get`)是**两个不同
  的东西**——实测过,往正文里插一段话,节点的 version 与 updateTime 纹丝不动。
  只摆一条,就测不出「取错了指纹」这个最贵的错。
*/
/*
  照**真 bridge 的形状**造，不照我想象的形状造。

  此前这两个替身带的是 `error`，而 `YzjRunResult` 只有 `stderr`——于是替身和生产代码
  在一个不存在的字段上达成了一致，线上每一条失败提示都退化成兜底那一句，而测试全绿。
*/
let body: { ok: boolean; json?: unknown; stderr?: string }
let node: { ok: boolean; json?: unknown; stderr?: string }
let calls: string[][]

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-truth-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  body = { ok: true, json: { data: { version: 4, blocks: [] } } }
  node = { ok: true, json: { id: DOC, title: 'Q3 对账', version: 1, updateTime: '2026-08-11T11:52:37.747' } }
  calls = []
  ctx.provide('yzjBridge', {
    run: (command: string[]) => {
      calls.push(command)
      return Promise.resolve(command[1] === 'block' ? body : node)
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
      criteria: '三家竞品各一页',
    },
    actor: OPERATOR,
  })
}

const truthEvents = (): unknown[] => [...graph.rawEvents(['truth/changed'])]
const knownMark = (): unknown =>
  asRecord(graph.rawObject('commitment', goalCommitmentIdFor(GOAL))?.state)?.truthFingerprint

describe('从引用里认出那份文档', () => {
  it('认得出真的 id', () => {
    expect(docIdOf(GOAL)).toBe(DOC)
    expect(docIdOf(`https://www.yunzhijia.com/knowledge/#/store/doc/${DOC}`)).toBe(DOC)
    expect(docIdOf(`https://x/#/store/sheet/${DOC}?tab=1`)).toBe(DOC)
  })

  it('不长得像 id 的就不去问——否则会拿回一个和「没变」长得一样的失败', () => {
    expect(docIdOf('https://yzj.example.com/doc/q3')).toBeUndefined()
    expect(docIdOf('随便一句话')).toBeUndefined()
    expect(docIdOf('https://www.yunzhijia.com/knowledge/#/store/doc/短了点')).toBeUndefined()
  })
})

describe('消费时刻看一眼', () => {
  it('第一次只建立基准，不报「变了」', async () => {
    await goal()
    const verdict = await checkGoalTruth(ctx, GOAL)
    expect(verdict.kind).toBe('first-look')
    expect(truthEvents()).toHaveLength(0)
    expect(knownMark()).toBe('blocks:4')
  })

  it('版本没动就是没动', async () => {
    await goal()
    await checkGoalTruth(ctx, GOAL)
    const verdict = await checkGoalTruth(ctx, GOAL)
    expect(verdict.kind).toBe('unchanged')
    expect(truthEvents()).toHaveLength(0)
  })

  /** 这条是整个文件存在的理由：有人在云之家改了正文，系统终于能知道。 */
  it('有人改了正文——写下 truth/changed，并说清从几版到几版', async () => {
    await goal()
    await checkGoalTruth(ctx, GOAL)
    body = { ok: true, json: { data: { version: 5, blocks: [] } } }
    const verdict = await checkGoalTruth(ctx, GOAL)
    expect(verdict.kind).toBe('changed')
    const events = truthEvents()
    expect(events).toHaveLength(1)
    const data = asRecord(asRecord(events[0])?.data)
    expect(asString(asRecord(data?.ref)?.uri)).toBe(GOAL)
    expect(asString(data?.kind)).toBe('changed')
    expect(asString(data?.detail)).toContain('4')
    expect(asString(data?.detail)).toContain('5')
  })

  it('同一个改动只报一次——每次都在喊的警告等于没有警告', async () => {
    await goal()
    await checkGoalTruth(ctx, GOAL)
    body = { ok: true, json: { data: { version: 5, blocks: [] } } }
    await checkGoalTruth(ctx, GOAL)
    await checkGoalTruth(ctx, GOAL)
    await checkGoalTruth(ctx, GOAL)
    expect(truthEvents()).toHaveLength(1)
    expect(knownMark()).toBe('blocks:5')
  })

  it('再改一次就再报一次——基准跟着走', async () => {
    await goal()
    await checkGoalTruth(ctx, GOAL)
    body = { ok: true, json: { data: { version: 5, blocks: [] } } }
    await checkGoalTruth(ctx, GOAL)
    body = { ok: true, json: { data: { version: 6, blocks: [] } } }
    const verdict = await checkGoalTruth(ctx, GOAL)
    expect(verdict.kind).toBe('changed')
    expect(truthEvents()).toHaveLength(2)
  })
})

describe('看不了 ≠ 没变', () => {
  it('通道不在就说通道不在，而不是「没有改动」', async () => {
    await goal()
    const bare = new Context()
    const graph2 = new YzjGraph(bare, { root: await mkdtemp(join(tmpdir(), 'yzj-truth-bare-')) })
    graph2.defineFamily(commitmentFamily)
    await graph2.selectAccount('acct-1')
    const verdict = await checkGoalTruth(bare, GOAL)
    expect(verdict.kind).toBe('unknown')
    expect(truthLine(verdict)).toContain('答不了')
  })

  it('文档被删了也是「答不了」，不是「没变」', async () => {
    await goal()
    body = { ok: false, stderr: 'DOC_DELETED' }
    node = { ok: false, stderr: 'DOC_DELETED' }
    const verdict = await checkGoalTruth(ctx, GOAL)
    expect(verdict.kind).toBe('unknown')
    expect(truthEvents()).toHaveLength(0)
  })

  it('引用不是知识库链接时，连问都不问服务端', async () => {
    await goal()
    const verdict = await checkGoalTruth(ctx, 'https://yzj.example.com/doc/q3')
    expect(verdict.kind).toBe('unknown')
    expect(calls).toHaveLength(0)
  })

  it('服务端没给版本号就承认比不出来', async () => {
    await goal()
    body = { ok: false, stderr: '不是在线文档' }
    node = { ok: true, json: { id: DOC, title: 'Q3 对账' } }
    expect((await checkGoalTruth(ctx, GOAL)).kind).toBe('unknown')
  })

  it('图上没有这个目标就不凭空造一条出来', async () => {
    const verdict = await checkGoalTruth(ctx, GOAL)
    expect(verdict.kind).toBe('unknown')
    expect(graph.rawObject('commitment', goalCommitmentIdFor(GOAL))).toBeUndefined()
  })
})

describe('说给 agent 听的那一句', () => {
  it('三种结果各说各的，没有一种会被误读成「一切正常」', () => {
    expect(truthLine({ kind: 'unchanged', note: '正文版本 4' })).toContain('没有改动')
    expect(truthLine({ kind: 'first-look', note: '正文版本 4' })).toContain('第一次')
    const changed = truthLine({ kind: 'changed', note: 'blocks:4 → blocks:5' })
    expect(changed).toContain('已被改动')
    // 最要紧的一句：告诉 agent 它手上那份标准可能已经过时。
    expect(changed).toContain('可能已经过时')
    /*
      读到了此刻的正文，那句「下面是副本」就成了假话 (v3.10 4h②)。

      过时的不再是手里的标准，是**按旧标准下过的那些结论**——两种情况说同一句话，
      会在明明拿着最新正文的时候仍然叫人去重读一遍正文。
    */
    /*
      读不到时，**别再叫它自己去读一遍**。

      走到这一支只有三种可能：通道断了、这份东西不是在线文档、或者线以上一条标准都
      没有。读一遍一种都救不了；而最后那种更糟——它会把 agent 送进栅栏以下的台账里，
      把一行「· …· 已完成」当成一条成功标准，正是栅栏要防的事从这句话上开了后门。
    */
    expect(changed).not.toContain('yzj_doc_block_list')
    expect(changed).toContain('照副本判')

    const live = truthLine({ kind: 'changed', note: 'blocks:4 → blocks:5' }, true)
    expect(live).toContain('此刻的正文')
    expect(live).not.toContain('副本')
    expect(live).toContain('未必还成立')
    expect(truthLine({ kind: 'unknown', why: '通道没就绪' })).toContain('答不了')
  })
})

/**
 * 判据是此刻的正文，不是签发时抄下的副本 (v3.10 4h②)。
 *
 * 副本只证明**签发那一刻人签的是什么**（环境快照律的用处）；而「做到没做到」只能对着
 * 此刻的标准判——两者不一致时，拿副本判出来的「已达成」是照着一份没人还认的标准得出的
 * 结论。这一条此前被判为「押文档 API」，是把 IM 通道的方法面误当成了 CLI 的能力面：
 * `doc block list` 一直都在。
 */
describe('读真身正文', () => {
  /**
   * 夹具是**从真实返回里抄下来的**，不是照我的假设编的。
   *
   * 第一版按 `text` 取文字，单元测试照着同一个假设写夹具、顺利通过——而对着真文档
   * 跑出来的是一片空白：文字挂在 `content` 上。**测试和代码在一个谁都没验过的形状上
   * 达成了一致**，那种一致什么都不证明。这个仓库里已经有一条注释在讲同一件事。
   *
   * 下面这一段的形状取自 `yzj-cli doc block list` 打在一份真文档上的输出：一个
   * `type: 'doc'` 的块，`content` 是节点数组，叶子的文字在 `content` 这个键下的
   * 字符串里，`childNodes` 是同一份内容的第二个副本。
   */
  const REAL_SHAPE = [{
    id: 'blk-1',
    type: 'doc',
    content: [
      { type: 'title', attrs: { align: 1 }, content: null, childNodes: null, textContent: null },
      {
        type: 'heading',
        attrs: { align: 1, level: 2 },
        content: [{ type: 'text', content: '三家竞品各一页' }],
        childNodes: [{ type: 'text', content: '三家竞品各一页' }],
        textContent: null,
      },
      {
        type: 'paragraph',
        attrs: { align: 1 },
        content: [
          { type: 'text', content: '每页含定价' },
          { type: 'text', content: '与差异' },
        ],
        childNodes: [
          { type: 'text', content: '每页含定价' },
          { type: 'text', content: '与差异' },
        ],
        textContent: null,
      },
    ],
  }]

  it('按真实形状把正文拼成可判断的文本', async () => {
    body = { ok: true, json: { data: { version: 4, blocks: REAL_SHAPE } } }
    const read = await readGoalBody(ctx, GOAL)
    expect(read.ok).toBe(true)
    // 每个顶层节点一行；空节点不占行；同一段里的多个 text 片段拼回一句。
    expect(read.ok && read.text).toBe('三家竞品各一页\n每页含定价与差异')
  })

  /** `childNodes` 是 `content` 的副本，两个都走会把每段文字读成两遍。 */
  it('不把同一段文字读两遍', async () => {
    body = { ok: true, json: { data: { version: 4, blocks: REAL_SHAPE } } }
    const read = await readGoalBody(ctx, GOAL)
    expect(read.ok && read.text.split('三家竞品各一页')).toHaveLength(2)
  })

  it('读不到就说读不到——不退回副本假装判得了', async () => {
    body = { ok: false, stderr: 'error: API error: 没有权限\n  提示: 换个账号试试' }
    const read = await readGoalBody(ctx, GOAL)
    expect(read.ok).toBe(false)
    // 只取 stderr 的第一行：CLI 的报错后面常跟着一段 usage，那是它在教你怎么用。
    expect(read.ok === false && read.why).toContain('没有权限')
    expect(read.ok === false && read.why).not.toContain('提示')
  })

  it('上传的文件没有正文块，如实说，而不是给一段空文本', async () => {
    body = { ok: true, json: { data: { version: 1 } } }
    const read = await readGoalBody(ctx, GOAL)
    expect(read.ok).toBe(false)
    expect(read.ok === false && read.why).toContain('不是在线文档')
  })

  it('不长得像知识库链接的，连问都不问', async () => {
    const read = await readGoalBody(ctx, 'https://yzj.example.com/doc/q3')
    expect(read.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  /** 一份**已经被回写过**的文档：标准在上，系统的台账在栅栏以下。 */
  const withLedgerShape = (lines: string[]): unknown[] => [{
    id: 'blk-1',
    type: 'doc',
    content: [
      ...(REAL_SHAPE[0]?.content ?? []),
      ...lines.map(line => ({
        type: 'paragraph',
        attrs: { align: 1 },
        content: [{ type: 'text', content: line }],
        childNodes: [{ type: 'text', content: line }],
        textContent: null,
      })),
    ],
  }]

  it('判据截到栅栏为止 —— 系统自己的账不能当成一条成功标准', async () => {
    /*
      这是整个栅栏存在的理由。

      `goal_report` 的参数上写着 `criterion: quoted from the goal`。台账混在正文里，
      agent 完全有理由把「· 拉三家竞品各一页 — 代少兵 · 已完成」当成一条标准、判 met、
      证据引它自己——**用系统的记账证明系统达标**，比引一个感觉更坏。
    */
    body = {
      ok: true,
      json: {
        data: {
          version: 5,
          blocks: withLedgerShape([
            fenceLine('成功标准'),
            '· 拉三家竞品各一页 — 代少兵',
            '· 拉三家竞品各一页 — 代少兵 · 已完成',
          ]),
        },
      },
    }
    const read = await readGoalBody(ctx, GOAL)
    expect(read.ok).toBe(true)
    expect(read.ok && read.text).toBe('三家竞品各一页\n每页含定价与差异')
    expect(read.ok && read.text).not.toContain('已完成')
    // 台账本身还得拿得到：回写靠它判断「这份文档立过栅栏没有」。
    expect(read.ledger).toContain('· 拉三家竞品各一页 — 代少兵 · 已完成')
  })

  it('还没立过栅栏时，台账是 undefined 而不是空串', async () => {
    body = { ok: true, json: { data: { version: 4, blocks: REAL_SHAPE } } }
    const read = await readGoalBody(ctx, GOAL)
    // 回写读的就是这一个字段。分不清「没立过」和「立过、底下还空着」，
    // 重启一次就往一份全组在读的文档里多贴一条栅栏。
    expect(read.ledger).toBeUndefined()
  })

  it('线以上一条标准都没有，说的是「没人写过尺子」，不是「文档是空的」', async () => {
    // 一份只有栅栏和台账、线以上一个字都没有的文档。
    const only = {
      id: 'blk-1',
      type: 'doc',
      content: [fenceLine('成功标准'), '· 一条账'].map(line => ({
        type: 'paragraph',
        attrs: { align: 1 },
        content: [{ type: 'text', content: line }],
        childNodes: null,
        textContent: null,
      })),
    }
    body = { ok: true, json: { data: { version: 6, blocks: [only] } } }
    const read = await readGoalBody(ctx, GOAL)
    expect(read.ok).toBe(false)
    // 「没人写过判它的尺子」是一句人能当场去补的话；「文档是空的」是个死胡同。
    expect(read.ok === false && read.why).toContain('没人写过判它的尺子')
    expect(read.ok === false && read.why).not.toContain('正文是空的')
    // 退回副本了，但栅栏还是得报出来——不然回写会再立一条。
    expect(read.ledger).toBe('· 一条账')
  })
})

describe('doc block 回包的两层形状', () => {
  it('0.1.4 的 { data: { version, blocks } } 与剥壳后同形，顶层平铺也认', async () => {
    const { bodyPayload } = await import('../src/goal/truth.ts')
    expect(bodyPayload({ data: { version: 4, blocks: [] } })).toEqual({ version: 4, blocks: [] })
    expect(bodyPayload({ version: 4, blocks: [] })).toEqual({ version: 4, blocks: [] })
    // 既不带 blocks 也不带 version 的 data 不算业务体（那可能是别的命令的回包）。
    expect(bodyPayload({ data: { id: 'x' } })).toEqual({ data: { id: 'x' } })
    expect(bodyPayload(undefined)).toEqual({})
  })
})
