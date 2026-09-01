/**
 * 组织侧六接缝的规格 —— 私账层允许触碰组织侧代码的**全部**位置.
 *
 * 六点之外的组织侧改动 = 分支越权。这一份看的是那六点各自真的做到了它声称的事，
 * 而且**未启用时全部回落成「什么都没有」**——每一条都是那种改坏了不会报错、只会
 * 安静地多一块或少一块的规矩。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor, type GraphViewer } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { commitmentFamily, createCommitmentCard } from '@yzj-next/objects'
import {
  FAMILY_DELIVERY_ACCEPTANCE, PledgerCards, YzjPledger, calibrationCard, createDesk, inviteCard,
} from '@yzj-next/pledger'
import { applySurfaceRpc, cardsFor, inboxView, objectPreviewOf } from '../src/rpc.ts'

const OPERATOR: GraphActor = { kind: 'operator', openId: 'op-1' }
const VIEWER: GraphViewer = { kind: 'operator', openId: 'op-1' }
const TOPIC = 'yzj-topic-1'
const GOAL = 'https://yzj.example/doc/goal-1'
const NOW = new Date(1_700_000_000_000).toISOString()

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let pledger: YzjPledger

async function boot(withPledger: boolean): Promise<void> {
  const graphRoot = await mkdtemp(join(tmpdir(), 'yzj-seam-graph-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: graphRoot })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.setDesktopActor(OPERATOR, '我')
  cards.register(createCommitmentCard(ctx))
  if (!withPledger) return
  const vaultRoot = await mkdtemp(join(tmpdir(), 'yzj-seam-vault-'))
  pledger = new YzjPledger(ctx, { root: vaultRoot })
  await pledger.open('op-1')
  const bus = new PledgerCards(ctx)
  bus.register(inviteCard)
  bus.register(calibrationCard)
  ctx.provide('yzjPledgerDesk', createDesk(ctx, bus))
}

async function openCommitment(id: string): Promise<void> {
  await graph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: id,
      what: '竞品对比表',
      executor: { kind: 'human', openId: 'zr-1', name: '张锐', topicKey: TOPIC },
      sourceAnchor: `session:${TOPIC}`,
      topicKey: TOPIC,
      parentGoalRef: GOAL,
      delegatedBy: 'op-1',
    },
    actor: OPERATOR,
  })
  await graph.append({
    type: 'commitment/delivered',
    data: { commitmentId: id, delivery: { claim: '做完了', at: Date.now() } },
    actor: { kind: 'person', openId: 'zr-1' },
  })
}

const topic = {
  topicKey: TOPIC,
  sessionId: 'sess-1',
  placeKey: 'yzj-group-g1',
  groupId: 'g1',
  groupName: '产品讨论群',
  topicRootId: 'm-1',
  label: '竞品对比表',
  generation: 1,
  conversationKind: 'group' as const,
}

beforeEach(() => { /* each case boots its own context */ })

describe('接缝⑤④：两样各在各的时刻', () => {
  it('后视镜长在还没答的卡上，条尾两读长在答完的卡上', async () => {
    await boot(true)
    await openCommitment('c-1')

    // 先制造一条判例并开镜——否则后视镜条本来就该是空的。
    await pledger.append({
      type: 'calibration/opened',
      data: {
        calibrationId: 'cal-1',
        // 立此存照律：每一段都是照片（文本必填、锚可空）。
        verdict: { text: '竞品对比表', at: NOW, anchor: { kind: 'commitment', id: 'c-0' } },
        fact: { text: '被追问定价', at: NOW, anchor: { kind: 'commitment', id: 'c-0' } },
        factSource: { kind: 'org', why: 'reopened' },
        evidence: [],
        thenText: '预期「评审能过」',
        family: FAMILY_DELIVERY_ACCEPTANCE,
        idemKey: 'calibration:c-0',
      },
      actor: OPERATOR,
    })
    await pledger.append({
      type: 'calibration/answered',
      data: { calibrationId: 'cal-1', attribution: 'q3' },
      actor: OPERATOR,
    })
    await pledger.append({
      type: 'calibration/opened',
      data: {
        calibrationId: 'cal-2',
        verdict: { text: '价格页 v2', at: NOW, anchor: { kind: 'commitment', id: 'c-00' } },
        fact: { text: '返了两轮', at: NOW, anchor: { kind: 'commitment', id: 'c-00' } },
        factSource: { kind: 'org', why: 'reopened' },
        evidence: [],
        thenText: '预期「一轮过」',
        family: FAMILY_DELIVERY_ACCEPTANCE,
        idemKey: 'calibration:c-00',
      },
      actor: OPERATOR,
    })
    await pledger.append({
      type: 'calibration/answered',
      data: { calibrationId: 'cal-2', attribution: 'q3' },
      actor: OPERATOR,
    })
    await pledger.append({
      type: 'mirror/toggled',
      data: {
        family: FAMILY_DELIVERY_ACCEPTANCE,
        patternKey: `${FAMILY_DELIVERY_ACCEPTANCE}:q3`,
        on: true,
        entry: 'vault',
        mirrorId: `${FAMILY_DELIVERY_ACCEPTANCE}:${FAMILY_DELIVERY_ACCEPTANCE}:q3`,
      },
      actor: OPERATOR,
    })

    const pending = cardsFor(ctx, topic).find(card => card.id === 'c-1')
    /*
      **还没答**：镜子在，两读不在。

      一条挂在已经答完的卡旁边的判例只剩下「你看你又错了」——说教剧场；而在你正要
      判断的那一刻推销一个把判断关掉的开关，是同一枚硬币的另一面。
    */
    expect(pending?.strip?.cases.length).toBeGreaterThan(0)
    expect(pending?.twoRead).toBeUndefined()

    await cards.act({ kind: 'commitment', id: 'c-1' }, 'accept', OPERATOR, 'desktop')
    const settled = cardsFor(ctx, topic).find(card => card.id === 'c-1')
    // **答完**：镜子不在了。两读还没到该问的时候（见下一条）。
    expect(settled?.resolved).toBe(true)
    expect(settled?.strip).toBeUndefined()
  })

  it('条尾两读要等这一族攒够裁决才问 —— 条长即治理信号', async () => {
    await boot(true)
    for (let index = 0; index < 4; index += 1) {
      await openCommitment(`c-warm-${String(index)}`)
      await cards.act({ kind: 'commitment', id: `c-warm-${String(index)}` }, 'accept', OPERATOR, 'desktop')
    }
    // 四次：还不到该问的时候。「你是不是被问烦了」这一问，本身不能问得太勤。
    expect(cardsFor(ctx, topic).some(card => card.twoRead !== undefined)).toBe(false)

    await openCommitment('c-warm-4')
    await cards.act({ kind: 'commitment', id: 'c-warm-4' }, 'accept', OPERATOR, 'desktop')
    const withTwoRead = cardsFor(ctx, topic).filter(card => card.twoRead !== undefined)
    /*
      **一族只挂一张，而且是最新的那张。**

      五张答完的卡各挂一块「这类确认还需要你吗」，就是用重复五遍的方式问「你被问烦了
      没有」——那本身就是答案。零新入口的意思也在这儿：既有的条尾租约入口从来只有
      一个位置。
    */
    expect(withTwoRead).toHaveLength(1)
    expect(withTwoRead[0]?.id).toBe('c-warm-4')
    expect(withTwoRead[0]?.twoRead?.label).toBe('交付验收')
  })

  it('未启用私账：三样一个都不发，卡一个字节不变', async () => {
    await boot(false)
    await openCommitment('c-2')
    const card = cardsFor(ctx, topic).find(one => one.id === 'c-2')
    expect(card).toBeDefined()
    expect(card?.strip).toBeUndefined()
    expect(card?.twoRead).toBeUndefined()
    expect(card?.gearEffect).toBeUndefined()
  })

  it('默认档不发 gearEffect —— 默认档下界面一个字都不该变', async () => {
    await boot(true)
    await openCommitment('c-3')
    const card = cardsFor(ctx, topic).find(one => one.id === 'c-3')
    expect(card?.gearEffect).toBeUndefined()

    await pledger.append({
      type: 'gear/shifted',
      data: { family: FAMILY_DELIVERY_ACCEPTANCE, gear: 'weight', entry: 'vault', evidenceSnapshot: [] },
      actor: OPERATOR,
    })
    const weighted = cardsFor(ctx, topic).find(one => one.id === 'c-3')
    expect(weighted?.gearEffect).toMatchObject({
      gear: 'weight', preselect: false, quickAccept: false, spreadEvidence: true,
    })
  })
})

describe('接缝⑥：金库入口永无徽标', () => {
  it('inbox 只发一个布尔，没有任何计数', async () => {
    await boot(true)
    await openCommitment('c-4')
    const view = inboxView(ctx)
    expect(view.pledger).toEqual({ enabled: true })
    // 三枚 chip 与承诺板的数字**一个都不因私账变化**——三不入在这一列上的样子。
    expect(Object.keys(view.pledger ?? {})).toEqual(['enabled'])
  })

  it('未启用时 enabled=false，左栏那一行因此整个不画', async () => {
    await boot(false)
    expect(inboxView(ctx).pledger).toEqual({ enabled: false })
  })
})

describe('接缝①：通用裁决事件，组织侧不知道有谁在听', () => {
  it('如实广播全部人签发裁决终态，判据留给听的人（v2.0 扩触发面）', async () => {
    await boot(false)
    const seen: { actionId: string; kind: string }[] = []
    ctx.on('yzj-cards/verdict-settled', (payload) => {
      seen.push({ actionId: payload.actionId, kind: payload.kind })
    })

    await openCommitment('c-5')
    /*
      打回**也**是一次人签发的裁决终态 —— 这一版如实说出来。

      「种类而不是布尔」买到的正是这个：组织侧不必判断「这一次值不值得下游关心」
      （那是把下游的判据搬进组织侧），它只用自己的话说清这是哪一种。
    */
    await cards.act({ kind: 'commitment', id: 'c-5' }, 'reject', OPERATOR, 'desktop', '再改改')
    expect(seen).toEqual([{ actionId: 'reject', kind: 'rework' }])

    await graph.append({
      type: 'commitment/delivered',
      data: { commitmentId: 'c-5', delivery: { claim: '改好了', at: Date.now() } },
      actor: { kind: 'person', openId: 'zr-1' },
    })
    await cards.act({ kind: 'commitment', id: 'c-5' }, 'accept', OPERATOR, 'desktop')
    expect(seen.at(-1)).toEqual({ actionId: 'accept', kind: 'acceptance' })
  })

  it('组织侧的发射点不含任何立约判据分支——判据是 pledger 侧的纯函数（断言⑲）', async () => {
    const { isPledgeable } = await import('@yzj-next/pledger')
    // 谱：一个字符串进、一个布尔出。没有 ctx、没有 pgraph、没有 IO。
    expect(isPledgeable.length).toBe(1)
    expect(isPledgeable('acceptance')).toBe(true)
    expect(isPledgeable('rework')).toBe(true)
    expect(isPledgeable('assessment')).toBe(true)
    expect(isPledgeable('delegation')).toBe(true)
    expect(isPledgeable('lease-grant')).toBe(true)
    // 信息量否决位：高频低信息的那一种，判据①②③ 全过也一律否决。
    expect(isPledgeable('write-confirm')).toBe(false)
    // 押证据门的两种：明标为 gated，不是遗漏。
    expect(isPledgeable('goal-issuance')).toBe(false)
    expect(isPledgeable('disposal')).toBe(false)
  })

  it('事件只携裁决锚，不携任何查询能力', async () => {
    await boot(false)
    const payloads: Record<string, unknown>[] = []
    ctx.on('yzj-cards/verdict-settled', (payload) => { payloads.push({ ...payload }) })
    await openCommitment('c-6')
    await cards.act({ kind: 'commitment', id: 'c-6' }, 'accept', OPERATOR, 'desktop')
    /*
      payload = 锚 + 种类 + 标题原文。**没有查询能力**，也没有任何订阅者专属字段。

      `titleText` 是立此存照律的原料——组织侧是唯一知道标题的人；它不随事件走，
      下游就只能回头解析锚，而那正是「判例是空壳」的成因。
    */
    expect(Object.keys(payloads[0] ?? {}).sort())
      .toEqual(['actionId', 'actor', 'at', 'cardRef', 'kind', 'titleText'])
  })
})

describe('三不入：组织图的可应答查询里永远没有私账 kind', () => {
  it('pendingAnswerables 与 demands 都只认组织图上的家族', async () => {
    await boot(true)
    await openCommitment('c-7')
    const kinds = new Set([
      ...graph.pendingAnswerables(VIEWER).map(object => object.kind),
      ...cards.demands(VIEWER).map(one => one.ref.kind),
    ])
    for (const kind of ['invite', 'calibration', 'expectation', 'fact', 'gear', 'mirror']) {
      expect(kinds.has(kind)).toBe(false)
    }
  })
})

/*
  **这一组不是第八条接缝** —— 名字要说准，否则封闭集就开始漂。

  接缝 = 分支被允许触碰的**组织侧**代码。`objectPreviewOf` 住在 surface，读的是
  surface 一直在读的组织图（board / objects / inbox 都这么读），组织侧包一行没动、
  也照旧不知道 pledger 存在。**七接缝仍然是七条。**
*/
describe('证据面的预览分层（surface 内，不新增接缝）：快照仍是真身', () => {
  it('预览是 surface 对组织侧的独立调用：**私账层不在这条路上**', async () => {
    // 连 desk 都没有 provide 过，预览照样出得来——它读的是组织图，不是私账。
    await boot(false)
    expect(ctx.get('yzjPledgerDesk')).toBeUndefined()
    await openCommitment('c-preview')

    const preview = objectPreviewOf(ctx, 'commitment', 'c-preview')
    expect(preview.alive).toBe(true)
    expect(preview.title).toBe('竞品对比表')
    expect(preview.lines).toContain('负责：张锐')
    expect(preview.lines).toContain('交付：做完了')
    /*
      **挂在哪个目标下是语境，不是落点。**

      一颗写着「回真身」的按钮把人送到它的**父目标**去，标签说的和门后面的就不是
      同一样东西——那是幽灵信号，宁可这一行没有门。所以父目标出现在正文里，而
      `goalRef` 只在这个对象**自己就是一个目标**时才有值。
    */
    expect(preview.lines).toContain(`挂在目标：${GOAL}`)
    expect(preview.goalRef).toBeUndefined()
  })

  it('目标锚认得出来 —— 它没有自己的对象族，但它就在一跳之外', async () => {
    await boot(false)
    /*
      目标是**一条 `state.goalRef` 等于这个 URI 的承诺**，没有 `kind: 'goal'` 的族。

      不认这一层，证据面里那行「当时在档：这次裁决挂在目标 X 下」就永远预览不出来、
      永远跳不过去——而一个「读不到」如果其实是「没去找」，它就不是诚实，是 bug
      穿着诚实的衣服。
    */
    await graph.append({
      type: 'commitment/opened',
      data: {
        commitmentId: 'c-goal',
        what: '把宏图续约签回来',
        executor: { kind: 'human', openId: 'op-1', name: '我', topicKey: TOPIC },
        sourceAnchor: `session:${TOPIC}`,
        topicKey: TOPIC,
        goalRef: GOAL,
        criteria: '合同签回、款项确认',
      },
      actor: OPERATOR,
    })
    const preview = objectPreviewOf(ctx, 'goal', GOAL)
    expect(preview.alive).toBe(true)
    expect(preview.title).toBe('把宏图续约签回来')
    expect(preview.lines).toContain('标准：合同签回、款项确认')
    // 落点是**它自己那一页**。
    expect(preview.goalRef).toBe(GOAL)
  })

  it('锚死：预览整块消失，而它从不猜一个标题', async () => {
    await boot(false)
    /*
      **读不到就说读不到**。

      猜出来的标题会把「真身已亡」渲染成「真身还在」——而证据面正靠这一层区别，
      在组织侧对象亡故之后仍然让对表成立（快照在上面那一行，一个字都没少）。
    */
    const preview = objectPreviewOf(ctx, 'commitment', '从来没有过这一条')
    expect(preview).toEqual({ alive: false })
    expect(preview.title).toBeUndefined()
  })

  it('私账层那一侧仍然拿不到内容 —— 渲染函数入参里没有组织图 service', async () => {
    const { evidenceRowsOf } = await import('@yzj-next/pledger')
    // 两个参数：一串照片，和一个只回状态不回内容的探针。分层在签名上就看得见。
    expect(evidenceRowsOf.length).toBe(2)
    // 而 surface 这一条要三个：ctx（组织图）、kind、id——**两条路，两个签名**。
    expect(objectPreviewOf.length).toBe(3)
  })
})

describe('㉚ D10 演示隐身：私账层整层不存在，而不是逐处判断', () => {
  /*
    隐身档是**泄漏面条款的运行时开关**：投屏是残留面的高危场景，这一档把「仅你可见
    层」在物理上兑现成「此刻谁都不可见」。

    兑现的形态是**让 desk 在这一层看起来根本没有**——走的是 `pledger.enabled: false`
    那条已经有断言盯着的退化路径（断言⑩）。若改成每个渲染点各自 `if (!stealth)`，
    那就是十几个可以忘记的地方，而**投屏那一刻忘掉一个，就是把某人的判例投在墙上**。
  */
  afterEach(() => {
    // 这一档是进程级显示配置，跑完把它关回去，别影响同文件后面的用例。
    applySurfaceRpc(new Context(), 20, false)
  })

  it('隐身档下：后视镜条 / 档位生效面 / 金库入口全部不在 —— 而关着的时候它们在', async () => {
    await boot(true)
    await openCommitment('c-stealth')
    /*
      **先把它造出来**：两条同族判例 + 开镜，后视镜条才会挂上。

      初稿这一条是空转的——fixture 里根本没有后视镜条，于是「隐身档下没有它」
      与「它从来没有过」在断言上无法区分。**一条能被空数据满足的断言不是断言。**
    */
    for (const [id, what] of [['cal-s1', '竞品对比表'], ['cal-s2', '价格页 v2']] as const) {
      await pledger.append({
        type: 'calibration/opened',
        data: {
          calibrationId: id,
          verdict: { text: what, at: NOW, anchor: { kind: 'commitment', id: 'c-stealth' } },
          fact: { text: '被打回了', at: NOW, anchor: { kind: 'commitment', id: 'c-stealth' } },
          factSource: { kind: 'org', why: 'reopened' },
          evidence: [],
          thenText: `预期「${what} 一轮过」`,
          family: FAMILY_DELIVERY_ACCEPTANCE,
          idemKey: `calibration:${id}`,
        },
        actor: OPERATOR,
      })
      await pledger.append({
        type: 'calibration/answered',
        data: { calibrationId: id, attribution: 'q3' },
        actor: OPERATOR,
      })
    }
    await pledger.append({
      type: 'mirror/toggled',
      data: {
        family: FAMILY_DELIVERY_ACCEPTANCE,
        patternKey: `${FAMILY_DELIVERY_ACCEPTANCE}:q3`,
        on: true,
        entry: 'vault',
        mirrorId: `${FAMILY_DELIVERY_ACCEPTANCE}:${FAMILY_DELIVERY_ACCEPTANCE}:q3`,
      },
      actor: OPERATOR,
    })
    // 换到负重档 —— **默认档不发生效面**（默认档下界面一个字都不该变），所以要换过去
    // 才有第二样东西可以证明它消失了。
    await pledger.append({
      type: 'gear/shifted',
      data: {
        family: FAMILY_DELIVERY_ACCEPTANCE, gear: 'weight', entry: 'vault', evidenceSnapshot: [],
      },
      actor: OPERATOR,
    })

    // ① 关着的时候：镜子在、档位生效面在、入口在。
    applySurfaceRpc(new Context(), 20, false)
    const lit = cardsFor(ctx, topic).find(card => card.id === 'c-stealth')
    expect(lit?.strip?.cases.length).toBeGreaterThan(0)
    expect(lit?.gearEffect).toBeDefined()
    expect(inboxView(ctx).pledger?.enabled).toBe(true)

    // ② 开着的时候：同一张卡、同一份数据，**一样都不在**。
    applySurfaceRpc(new Context(), 20, true)
    const dark = cardsFor(ctx, topic).find(card => card.id === 'c-stealth')
    expect(dark).toBeDefined()
    expect(dark?.strip).toBeUndefined()
    expect(dark?.twoRead).toBeUndefined()
    expect(dark?.gearEffect).toBeUndefined()
    /*
      金库入口读的就是这个布尔（未启用时那一行**不存在**，不是灰的）——于是隐身档
      一开，入口、私语未读豁免、以及一切读 desk 的接缝一起消失。
    */
    expect(inboxView(ctx).pledger?.enabled).toBe(false)
    // 全屏 canary：投影里一个私账字样都不许剩。
    expect(JSON.stringify(cardsFor(ctx, topic))).not.toContain('仅你可见')
    expect(JSON.stringify(cardsFor(ctx, topic))).not.toContain('判断仍由你下')
  })

  it('关掉即恢复，且隐身态本身不落任何一条私账事件', async () => {
    await boot(true)
    await openCommitment('c-stealth-2')
    await cards.act({ kind: 'commitment', id: 'c-stealth-2' }, 'accept', OPERATOR, 'desktop')
    await pledger.flush()
    const before = pledger.events(['gear/shifted', 'mirror/toggled', 'invite/opened']).length

    applySurfaceRpc(new Context(), 20, true)
    expect(inboxView(ctx).pledger?.enabled).toBe(false)
    applySurfaceRpc(new Context(), 20, false)
    // 关掉即恢复：它是显示层状态，不是账目。
    expect(inboxView(ctx).pledger?.enabled).toBe(true)
    expect(pledger.events(['gear/shifted', 'mirror/toggled', 'invite/opened']).length).toBe(before)
  })
})
