/**
 * 场景闭环谱 —— **一条承诺从生到死走完一遍，每一步都问「别处看见了什么」**。
 *
 * 这个文件补的是一个形状上的空白，而不是覆盖率上的空白。既有的测试有两种：
 *
 * - **单件**：一个函数、一个家族、一张卡，各自对不对；
 * - **矩阵**（`loop-matrix.spec.ts`）：每个家族有没有生产者、每个动词够不够得到、
 *   两面答是不是等价——那是**横向**的完备性。
 *
 * 两种都测不出**纵向**的那类错：一条命从登记走到验收再走到回写，中间每一步在别的层上
 * 该看见什么。而这一天里逮到的 bug 几乎全长在那条纵线上，无一例外都是**组合缺陷**——
 * 两个各自正确、各自有绿测的东西，合起来撒谎：
 *
 * - 回写往目标文档尾部贴台账（对的）+ 简报改读真身正文当判据（也对）= 系统拿自己的
 *   记账证明自己达标；
 * - 打回把交付主张删掉（对的，否则挂着假的待验收信号）+ 重交时从主张里读轮次（看起来
 *   也对）= 轮次活不过一轮打回；
 * - 方向轴只取舍不改事实（对的）+ 空状态说「还没有工作挂在这个目标下」（本来也对）
 *   = 筛选造成的空冒充真的空。
 *
 * 每一条都不可能被单件测试逮住，因为**每一件单独看都是对的**。所以这里的断言一律是
 * 「做了 A 之后，**B 面上**应该看见什么」——跨层，而不是就地。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  applyGoalWriteback, assessmentCard, assessmentFamily, createCommitmentCard, commitmentFamily,
  goalCommitmentIdFor, waitingFamily,
} from '@yzj-next/objects'
import { boardFrame } from '../src/rpc.ts'
import { nudgeDraft } from '../src/client/Board.tsx'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
/** 执行者：另一个人。这一点是全谱的前提——「他说做完了」和「我认了」才是两次判断。 */
const WORKER: GraphActor = { kind: 'person', openId: 'p-9' }
const OTHER_BOSS: GraphActor = { kind: 'operator', openId: 'op-2' }
const GOAL = 'https://www.yunzhijia.com/knowledge/lingee/#/store/doc/6a7a87ece7eece43b1e36d8e'

const TOPICS = [
  { topicKey: 'tk-1', sessionId: 'sess-1', label: '对账', groupName: '财务组', placeKey: 'yzj-group-g1', groupId: 'g1' },
]

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
/** 真身文档此刻的正文，按行。回写往里贴，简报从里读。 */
let docLines: string[]
let inserts: string[][]

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-scn-')) })
  graph.defineFamily(commitmentFamily)
  graph.defineFamily(assessmentFamily)
  graph.defineFamily(waitingFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  cards.register(assessmentCard)
  cards.setDesktopActor(OPERATOR)
  ctx.provide('yzjTopics', {
    tree: () => [{ place: { placeKey: 'yzj-group-g1', groupName: '财务组' }, topics: TOPICS }],
    topicOf: (sessionId: string) => TOPICS.find(topic => topic.sessionId === sessionId),
    aliases: () => ['@next'],
    conversations: () => [],
  })
  docLines = ['成功标准一：三家竞品各出一页']
  inserts = []
  /*
    假 bridge **真的让出一拍**，并且**建模那份文档**。

    同步 resolve 会让「读一眼再写」之间的缝为零，而那道缝是回写里所有竞态的住处；
    每次答一句空则会让「栅栏该不该重立」永远测不出来。这两条都是今天交过学费的。
  */
  ctx.provide('yzjBridge', {
    run: async (command: string[]) => {
      const insert = command[1] === 'block' && command[2] === 'insert'
      if (insert) inserts.push(command)
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      if (insert) {
        const at = command.indexOf('--element')
        const parsed = JSON.parse(command[at + 1] ?? '[]') as { content?: { content?: string }[] }[]
        docLines.push(...parsed.map(node => node.content?.[0]?.content ?? ''))
        return { ok: true, json: { data: { blockId: 'doc', version: docLines.length } } }
      }
      if (command[1] === 'block' && command[2] === 'list') {
        return {
          ok: true,
          json: {
            data: {
              version: docLines.length,
              blocks: [{
                id: 'blk', type: 'doc',
                content: docLines.map(line => ({
                  type: 'paragraph', attrs: {},
                  content: [{ type: 'text', content: line }],
                  childNodes: null, textContent: null,
                })),
              }],
            },
          },
        }
      }
      return { ok: true, json: {} }
    },
  })
})

const stateOf = (id: string): Record<string, unknown> =>
  asRecord(graph.rawObject('commitment', id)?.state) ?? {}

const rowOf = (id: string): Record<string, unknown> | undefined =>
  boardFrame(ctx).rows.find(row => row.id === id) as unknown as Record<string, unknown> | undefined

async function openGoal(): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: goalCommitmentIdFor(GOAL), what: 'Q3 对账', goalRef: GOAL,
      executor: { kind: 'human', openId: OPERATOR.openId, name: '我' },
      sourceAnchor: 'desktop:board', criteria: '三家竞品各出一页',
    },
    actor: OPERATOR,
  })
}

/** 由 `actor` 签发、交给 `executor` 的一条承诺。签发者 = 后来的验收人。 */
async function delegate(input: {
  id: string
  what: string
  due?: string
  goalRef?: string
  actor?: GraphActor
  executor?: GraphActor
}): Promise<string> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: input.id,
      what: input.what,
      sourceAnchor: `yzj:m-${input.id}`,
      topicKey: 'tk-1',
      audience: ['yzj-group-g1'],
      executor: {
        kind: 'human',
        openId: (input.executor ?? WORKER).openId,
        name: (input.executor ?? WORKER).openId === WORKER.openId ? '张锐' : '别人',
      },
      ...(input.due === undefined ? {} : { due: input.due }),
      ...(input.goalRef === undefined ? {} : { parentGoalRef: input.goalRef }),
    },
    actor: input.actor ?? OPERATOR,
  })
  return input.id
}

/** 等回写把该写的都写完——等**确定的事**，不等一段没动静。 */
async function settled(until: () => boolean): Promise<void> {
  for (let round = 0; round < 400; round += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 2) })
    if (until()) return
  }
}

// ---------------------------------------------------------------------------
// S1 — 一条人欠的活：登记 → 催 → 交付 → 待验收 → 验收 → 终态 → 回写死
// ---------------------------------------------------------------------------

describe('S1 一条人欠的活，从生走到死', () => {
  it('每一步在别的层上都留下了对得上的痕迹', async () => {
    await openGoal()
    const dispose = applyGoalWriteback(ctx)
    const id = await delegate({ id: 'c-1', what: '拉三家竞品各一页', due: '本周内', goalRef: GOAL })

    // ① 登记完，组里该看见这条活的出生 —— 回写「生」那一笔。
    await settled(() => graph.rawObject('goal-writeback', `${GOAL}#${id}#born`) !== undefined)
    expect(docLines.some(line => line.includes('拉三家竞品各一页'))).toBe(true)
    /*
      栅栏在成功标准**之下**：台账混进正文，差距简报会把「· …· 已完成」当成一条标准
      判 met、证据引它自己。这一条只有把回写和读正文放在一起走才看得出来。
    */
    const fence = docLines.findIndex(line => line.includes('以下由系统自动维护'))
    expect(fence).toBeGreaterThan(docLines.indexOf('成功标准一：三家竞品各出一页'))

    // ② 板上：欠我的、无信号（登记完还没有下文）、四要素齐。
    const born = rowOf(id) as Record<string, unknown>
    expect(born.direction).toBe('owed-to-me')
    expect(born.signal).toBe('silent')
    expect((born.due as { text: string }).text).toBe('本周内')

    // ③ 催 = 拟稿，带着当初那句原话（而不是一个 id、也不是解析出来的日期）。
    const draft = nudgeDraft(born as never)
    expect(draft).toContain('拉三家竞品各一页')
    expect(draft).toContain('本周内')

    // ④ 执行者说完成 —— 这是**主张**，不是终态：他和验收的人是两个人。
    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text', '发你了')
    expect(stateOf(id).status).toBe('open')

    // ⑤ 板上立刻改口：待验收，且排到最前（待决压过一切）。
    const claimed = rowOf(id) as Record<string, unknown>
    expect(claimed.awaitingAcceptance).toBe(true)
    expect(boardFrame(ctx).rows[0]?.id).toBe(id)

    /*
      ⑥ 组里**还不该**看见「已完成」。

      交付只是被主张了，没人认。此前回写的「死」时刻挂在 `closed` 上，而 `closed` 由
      执行者一句话直接产生——于是组里会先看到「已完成」，再等着被验收。
    */
    expect(docLines.some(line => line.includes('已验收') || line.includes('已完成'))).toBe(false)

    // ⑦ 签发者验收 —— 验收权是委派者∪操作者，而委派者由 reduce 从内核记的 actor 盖上。
    expect(stateOf(id).delegatedBy).toBe(OPERATOR.openId)
    const accepted = await cards.act({ kind: 'commitment', id }, 'accept', OPERATOR, 'desktop')
    expect(accepted.outcome).toBe('applied')
    expect(stateOf(id)).toMatchObject({ status: 'closed', cause: 'accepted' })

    // ⑧ 现在才轮到组里看见死 —— 回写「settled」那一笔。
    await settled(() => graph.rawObject('goal-writeback', `${GOAL}#${id}#settled`) !== undefined)
    expect(docLines.some(line => line.includes('已验收'))).toBe(true)

    // ⑨ 目标组的账对得上：一条已了、零条在跟。
    const group = boardFrame(ctx).goals.find(entry => entry.goalRef === GOAL)
    expect(group?.counts).toMatchObject({ settled: 1, open: 0 })
    dispose()
  })
})

// ---------------------------------------------------------------------------
// S2 — 打回一次再交付：轮次要活过那一轮
// ---------------------------------------------------------------------------

describe('S2 打回 → 返工 → 再验收，同一条上循环', () => {
  it('轮次活过了那一轮打回，而板上的假信号被撤掉了', async () => {
    const id = await delegate({ id: 'c-2', what: '出方案' })
    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text', '初稿发了')
    expect(rowOf(id)?.awaitingAcceptance).toBe(true)

    await cards.act({ kind: 'commitment', id }, 'reject', OPERATOR, 'desktop', '口径不对')
    /*
      打回之后板上**不能**还挂着「待验收」：那是一份假信号，会把一条球在对方脚下的活
      排到你要处理的最前面。
    */
    expect(rowOf(id)?.awaitingAcceptance).toBeUndefined()
    expect(stateOf(id).status).toBe('open')

    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text', '改完了')
    // 轮次必须还在 —— 验收的人要看得出这是重交的。
    expect(cards.renderText({ kind: 'commitment', id })?.body).toContain('已返工 1 轮')
    await cards.act({ kind: 'commitment', id }, 'accept', OPERATOR, 'desktop')
    expect(stateOf(id).status).toBe('closed')
  })

  it('打回不是作废 —— 承诺没死，死的是这一版交付', async () => {
    const id = await delegate({ id: 'c-3', what: '出方案' })
    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text')
    await cards.act({ kind: 'commitment', id }, 'reject', OPERATOR, 'desktop', '再改改')
    // 它还在板上、还在跟 —— 作废是「不做了」，打回是「还没做好」。
    expect(rowOf(id)?.status).toBe('open')
  })
})

// ---------------------------------------------------------------------------
// S3 — 验收权：不是谁都能替委派者点头
// ---------------------------------------------------------------------------

describe('S3 验收权跟着委派者走', () => {
  it('别人签发的活，我验收不了', async () => {
    const id = await delegate({ id: 'c-4', what: '别人的活', actor: OTHER_BOSS })
    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text')
    const refused = await cards.act({ kind: 'commitment', id }, 'accept', OPERATOR, 'desktop')
    expect(refused.outcome).not.toBe('applied')
    expect(stateOf(id).status).toBe('open')
    // 而签发的那个人可以。
    const ok = await cards.act({ kind: 'commitment', id }, 'accept', OTHER_BOSS, 'desktop')
    expect(ok.outcome).toBe('applied')
  })

  it('自己欠自己的活，说完成就结束 —— 一次主权时刻不收两次费', async () => {
    const id = await delegate({ id: 'c-5', what: '我自己的活', executor: OPERATOR })
    await cards.act({ kind: 'commitment', id }, 'done', OPERATOR, 'desktop')
    expect(stateOf(id).status).toBe('closed')
  })
})

// ---------------------------------------------------------------------------
// S4 — 方向轴三元：第三格是真实关系，不是凑数
// ---------------------------------------------------------------------------

describe('S4 方向轴在混合数据上的取舍', () => {
  it('三格互斥且穷尽，而且「我旁观的」真的有人住', async () => {
    await delegate({ id: 'd-mine', what: '我欠的', executor: OPERATOR })
    await delegate({ id: 'd-owed', what: '欠我的', actor: OPERATOR, executor: WORKER })
    await delegate({ id: 'd-watch', what: '我旁观的', actor: OTHER_BOSS, executor: WORKER })

    const rows = boardFrame(ctx).rows.filter(row => row.id.startsWith('d-'))
    const by = (direction: string): string[] =>
      rows.filter(row => row.direction === direction).map(row => row.id)
    expect(by('mine')).toEqual(['d-mine'])
    expect(by('owed-to-me')).toEqual(['d-owed'])
    /*
      板 = 查看者可见域的**并集**，不是「公开承诺板」也不是私人待办。少了这一格，
      这些行要么被硬塞进前两格（撒谎），要么消失（板不再是可见域的并集）。
    */
    expect(by('observed')).toEqual(['d-watch'])
    expect(rows).toHaveLength(3)
  })

  it('验收人本人省略，非本人才显示', async () => {
    await delegate({ id: 'a-mine', what: '我签发的', actor: OPERATOR })
    await delegate({ id: 'a-other', what: '别人签发的', actor: OTHER_BOSS })
    const rows = boardFrame(ctx).rows
    expect(rows.find(row => row.id === 'a-mine')?.acceptor).toBeUndefined()
    expect(rows.find(row => row.id === 'a-other')?.acceptor).toBe(OTHER_BOSS.openId)
  })
})

// ---------------------------------------------------------------------------
// S5 — 信号序：异常浮起，正常安静
// ---------------------------------------------------------------------------

describe('S5 一屏混合数据的排列', () => {
  it('待决 > 逾期 > 无信号 > 在跑 > 终态，在真的一屏上成立', async () => {
    await delegate({ id: 's-late', what: '逾期的', due: '2000-01-01' })
    await delegate({ id: 's-silent', what: '没信号的' })
    await delegate({ id: 's-await', what: '等验收的' })
    await cards.act({ kind: 'commitment', id: 's-await' }, 'done', WORKER, 'yzj-text')
    await delegate({ id: 's-done', what: '已经完了的' })
    await cards.act({ kind: 'commitment', id: 's-done' }, 'void', OPERATOR, 'desktop', '不做了')

    const order = boardFrame(ctx).rows.filter(row => row.id.startsWith('s-')).map(row => row.id)
    expect(order).toEqual(['s-await', 's-late', 's-silent', 's-done'])
  })
})

// ---------------------------------------------------------------------------
// S6 — 回写只在生与死：中间的动静一律不推回组里
// ---------------------------------------------------------------------------

describe('S6 组里那份文档不会变成日志流', () => {
  it('交付主张、打回、改期都不回写 —— 只有生与死写', async () => {
    await openGoal()
    const dispose = applyGoalWriteback(ctx)
    const id = await delegate({ id: 'w-1', what: '写结论', goalRef: GOAL })
    await settled(() => graph.rawObject('goal-writeback', `${GOAL}#${id}#born`) !== undefined)
    const afterBirth = inserts.length

    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text', '发了')
    await cards.act({ kind: 'commitment', id }, 'reject', OPERATOR, 'desktop', '再改')
    await graph.append({
      type: 'commitment/updated', data: { commitmentId: id, due: '下周' }, actor: OPERATOR,
    })
    await new Promise((resolve) => { setTimeout(resolve, 40) })
    /*
      那份文档是全组在读的，它的价值恰恰在于**短到有人愿意读**。把每一次交付主张、
      每一次打回、每一次改期都推回去，它就变成一条日志流——而日志流没有人读。
    */
    expect(inserts).toHaveLength(afterBirth)

    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text', '再发')
    await cards.act({ kind: 'commitment', id }, 'accept', OPERATOR, 'desktop')
    await settled(() => graph.rawObject('goal-writeback', `${GOAL}#${id}#settled`) !== undefined)
    expect(inserts.length).toBe(afterBirth + 1)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// S7 — 墓碑律：死了的东西不许被任何动词唤醒
// ---------------------------------------------------------------------------

describe('S7 作废之后没有任何一条路能把它弄回来', () => {
  it('迟到的「完成」、迟到的验收，都唤不醒一条作废的承诺', async () => {
    const id = await delegate({ id: 't-1', what: '不做了的活' })
    await cards.act({ kind: 'commitment', id }, 'void', OPERATOR, 'desktop', '需求撤了')
    expect(stateOf(id).status).toBe('voided')

    // 群里有人迟了一步回「完成」。
    await cards.act({ kind: 'commitment', id }, 'done', WORKER, 'yzj-text', '我做完了')
    expect(stateOf(id).status).toBe('voided')
    // 直接补一条 delivered 事件也不行 —— 墓碑律在 reduce 那一层。
    await graph.append({
      type: 'commitment/delivered',
      data: { commitmentId: id, delivery: { claim: '硬塞', at: Date.now() } },
      actor: WORKER,
    })
    expect(stateOf(id).status).toBe('voided')
    expect(stateOf(id).delivery).toBeUndefined()
    // 板上它也不会重新变成一条等你的行。
    expect(rowOf(id)?.awaitingAcceptance).toBeUndefined()
  })
})
