/**
 * P′ 环行 —— the ring, wired.
 *
 * ```
 * 裁决 →（立约·可选）→ 事实回流 → 对表归因 → 判例入账 → 模式浮现（滚动）
 *      → 回喂（后视镜/换挡）→ 再裁决
 * ```
 *
 * 环1-2 与环3 住在这个文件里；环4-5 是卡上的动作（`calibration.ts`），环6 是派生
 * 查询（`patterns.ts`），环7 是人签发的规则（`verbs.ts` 的后视镜与换挡）。**缺一环
 * 即割裂债**——所以每一环在代码里都要指得出它在哪。
 *
 * 三条纪律具体落在这里：
 *
 * - **持镜人.** 这里的订阅只往一个方向读：组织图 → 私账。没有任何一条会因为你的
 *   误判史改变组织侧的行为——不加门、不挡裁决、不调提案策略 (§8).
 * - **自带时间轮** (PTD-14). 检验点到期是时间驱动的，而 `scheduler` 在 import 禁令
 *   名单里。定时器由这个插件自己的 effect 承担——依赖方向铁律对定时器同样成立。
 * - **一次性.** 检验点到了 agent 问**一次**结果（问结果合法，索要预期非法），
 *   问过就记在账上（`expectation/asked`），重启不会再问一遍。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphEvent } from '@yzj-next/graph'
import type { PledgerCards } from './bus.ts'
import { familyOfCardKind } from './families.ts'
import { inviteFor, isFamilyQuiet } from './invite.ts'
import { calibrationBirth, evidenceFor, structuralFactFor, thenTextFor, watchedVerdicts } from './reflow.ts'
import type { FactRef, OrgAnchor } from './types.ts'
import { anchorFor, goalRefOf, isVerdictAction } from './verdicts.ts'

/** How often the ledger's own timer wheel looks at its checkpoints. */
const TICK_MS = 5 * 60_000

/**
 * 出处 —— **只能引用组织侧事实** (#61 收紧⑤).
 *
 * 整个函数的输入面就是这条规则的兑现：一个组织图锚，一个组织图服务。没有 pledger
 * 句柄，所以「读金库来决定要不要问你」在这里**做不到**，而不是被禁止 (PTD-9)。
 */
export function sourceOf(ctx: Context, verdict: OrgAnchor): {
  sourceLine: string
  checkpointText: string
  evidence: readonly OrgAnchor[]
} {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(verdict.kind, verdict.id)?.state)
  const what = verdict.label ?? asString(state?.what) ?? `${verdict.kind}:${verdict.id}`
  const goal = goalRefOf(ctx, verdict.kind, verdict.id)
  const due = asString(state?.due)
  const evidence: OrgAnchor[] = []
  if (goal !== undefined) {
    /*
      目标的那条承诺是这次裁决的**上文**：它说清了这份东西要用在哪儿。
      引用的是组织图上的对象，一跳可回——出处必须是能核对的，不能是一句形容。
    */
    evidence.push({ kind: 'goal', id: goal, label: goal })
  }
  return {
    sourceLine: goal === undefined
      ? `你刚刚验收了「${what}」`
      : `你刚刚验收了「${what}」，它挂在目标 ${goal} 下`,
    /*
      检验点两层：**解析不出来就不给戳**。

      把「下周初」硬解析成一个人没承诺过的日期，是拿我们的解析冒充他的赌注。没有
      戳的预期不会因此消失——它只是不参与时间轮，等结构性事实或你自己回来对表。
    */
    checkpointText: due ?? '下一次这件事在图上有动静时',
    evidence,
  }
}

/**
 * 环1 —— 裁决落地那一刻，可能开一次口。
 *
 * **触发点 P1 收窄明标** (§9): 只有验收卡 accept 与差距简报验收这两个高信息裁决。
 * 确认卡不触发——高频低信息，邀约在那里会退化成 nag，而一个会 nag 的镜子没有人
 * 会再照第二次。收窄由 {@link familyOfCardKind} 与家族自己的 `verdict` 声明共同
 * 决定，两处都在组织侧，私账只是读它们。
 */
export async function inviteOnVerdict(
  ctx: Context,
  payload: { readonly cardRef: { kind: string; id: string }; readonly actionId: string },
): Promise<string | undefined> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return undefined
  if (!isVerdictAction(ctx, payload.cardRef.kind, payload.actionId)) return undefined
  const spec = familyOfCardKind(payload.cardRef.kind)
  if (spec === undefined) return undefined
  /*
    疲劳治理 —— 同族连续 3 次不立就停问 (§4).

    **人用脚投票就是应答.** 这道门读的是 declined 计数，那是私账自己的事实；它决定
    的也只是私账自己开不开口。组织侧不知道有这道门，也不会因为它改变任何行为。
  */
  if (isFamilyQuiet(pledger.events(['invite/declined', 'invite/reopened', 'expectation/opened']), spec.family)) {
    return undefined
  }
  const verdict = anchorFor(ctx, payload.cardRef.kind, payload.cardRef.id)
  const source = sourceOf(ctx, verdict)
  const birth = inviteFor({
    verdict,
    family: spec.family,
    evidence: source.evidence,
    sourceLine: source.sourceLine,
    checkpointText: source.checkpointText,
  })
  // 幂等锚：同一裁决至多一张邀约。重放、重启、第二个订阅者都收不出第二张。
  if (pledger.findByIdemKey(`invite:${verdict.kind}:${verdict.id}`) !== undefined) return undefined
  await pledger.append({ type: birth.type, data: birth.data as never, actor: { kind: 'agent' } })
  return birth.inviteId
}

/**
 * 环3 —— 事实回流，结构匹配那一支.
 *
 * 一条新的组织图事件进来，问的是：**它是不是某一次裁决的后来**。结构性判定先于
 * 语义判定，所以这里不读任何一句话的意思，只读边的形状。
 */
export async function reflowOnGraphEvent(ctx: Context, event: GraphEvent): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return
  for (const verdict of watchedVerdicts(ctx)) {
    // 事实必须**后于**裁决。一条早于裁决的边不是「后来」，是「当时」。
    if (event.seq <= verdict.seq) continue
    const matched = structuralFactFor(ctx, verdict, event)
    if (matched === undefined) continue
    await openCalibration(ctx, {
      verdict: verdict.anchor,
      family: verdict.family,
      fact: matched.fact,
      factText: matched.factText,
    })
  }
}

/**
 * 环3 —— 人工补登那一支 (PTD-11).
 *
 * `fact/noted` 的 `about` 是**显式指认，零推断**：人自己说了这条事实说的是哪一次
 * 裁决。指认错了也有出口——第五出口「配对错了」把它消解掉（断言⑮ 与④ 在这里连通）。
 */
export async function reflowOnNotedFact(ctx: Context, event: GraphEvent): Promise<void> {
  if (event.type !== 'fact/noted') return
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return
  const data = asRecord(event.data)
  const factId = asString(data?.factId)
  const text = asString(data?.text)
  const about = asRecord(data?.about)
  if (factId === undefined || text === undefined || about === undefined) return

  let verdict: OrgAnchor | undefined
  let family: string | undefined
  let expectationId: string | undefined
  if (asString(about.kind) === 'expectation') {
    expectationId = asString(about.expectationId)
    if (expectationId === undefined) return
    const state = asRecord(pledger.object('expectation', expectationId)?.state)
    const ref = asRecord(state?.verdictRef)
    const kind = asString(ref?.kind)
    const id = asString(ref?.id)
    if (kind === undefined || id === undefined) return
    verdict = anchorFor(ctx, kind, id)
    family = asString(state?.family)
  } else {
    const ref = asRecord(about.verdictRef)
    const kind = asString(ref?.kind)
    const id = asString(ref?.id)
    if (kind === undefined || id === undefined) return
    verdict = anchorFor(ctx, kind, id)
    family = familyOfCardKind(kind)?.family
  }
  if (verdict === undefined || family === undefined) return
  await openCalibration(ctx, {
    verdict,
    family,
    fact: { source: 'noted', factId },
    factText: text,
  })
}

/**
 * 出一张校准回执 —— 幂等锚 =（裁决边, 事实边）.
 *
 * `dismissed` 之后不再出执（吸收态）；同一事实多次回流不出第二张 (断言④)。两条
 * 都由同一个锚保证，而不是由两处各自的判断。
 */
export async function openCalibration(
  ctx: Context,
  input: {
    readonly verdict: OrgAnchor
    readonly family: string
    readonly fact: FactRef
    readonly factText: string
  },
): Promise<string | undefined> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return undefined
  const expectation = pledger.findByIdemKey(`expectation:${input.verdict.kind}:${input.verdict.id}`)
  const expectationState = asRecord(expectation?.state)
  const expectationStatus = asString(expectationState?.status)
  /*
    撤回过的预期不再对表.

    撤回是**诚实退出**：前提没了，那个赌注就不再是一个赌注。为它出一张回执，等于
    要人为一件他已经明说不算数的事再打一次分。隐式预期那条路仍然走得通——回执照样
    会来，只是「当时」那半边写的是裁决本身。
  */
  const expectationId = expectationStatus === 'testing' || expectationStatus === 'settled'
    ? expectation?.id
    : undefined
  const birth = calibrationBirth({
    verdict: input.verdict,
    fact: input.fact,
    factText: input.factText,
    family: input.family,
    thenText: thenTextFor(
      input.verdict,
      expectationId === undefined ? undefined : asString(expectationState?.text),
    ),
    evidence: evidenceFor(ctx, input.verdict, input.fact),
    ...(expectationId === undefined ? {} : { expectationId }),
  })
  const idemKey = asString(birth.data.idemKey as never)
  if (idemKey !== undefined && pledger.findByIdemKey(idemKey) !== undefined) return undefined
  await pledger.append({ type: birth.type, data: birth.data as never, actor: { kind: 'agent' } })
  return birth.calibrationId
}

/**
 * 时间轮的一次滴答 —— 检验点到了，问**一次**结果.
 *
 * 「问结果合法，索要预期非法」：到期的时候 agent 可以问「那件事后来怎么样了」，
 * 不可以问「你当初为什么不立个预期」。人的答复经 `fact/noted` 落账——**系统不猜
 * 图外**，这是环3 唯一的图外入口。
 *
 * 问过就记账（`expectation/asked`），因为 host 内存不是真身：不落库，重启之后这
 * 一问会再问一遍，而 P1 明标是**问一次不再追**。
 */
export async function tickCheckpoints(
  ctx: Context,
  deliver: (text: string) => Promise<void>,
  now = Date.now(),
): Promise<readonly string[]> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return []
  const asked: string[] = []
  for (const object of pledger.query('expectation')) {
    const state = asRecord(object.state)
    if (state === undefined) continue
    if (asString(state.status) !== 'testing' || state.asked === true) continue
    const checkpoint = asRecord(state.checkpoint)
    const ts = checkpoint?.ts
    if (typeof ts !== 'number' || ts > now) continue
    const text = asString(state.text) ?? ''
    await pledger.append({
      type: 'expectation/asked',
      data: { expectationId: object.id },
      actor: { kind: 'agent' },
    })
    asked.push(object.id)
    await deliver([
      '【检验点到了】你当时说：',
      `「${text}」`,
      `检验点：${asString(checkpoint?.text) ?? ''}`,
      '',
      /*
        「后来怎么样了」问得出口，「你当初为什么不立个预期」问不出口 —— 前者是问
        结果，后者是索要预期。这条界线在这一句话里。

        落点说在桌面而不是「在这里回一句」：P1 的自聊 DM 只出不进（§1），而一句
        指向不存在的路的邀请，比不邀请更糟。
      */
      '后来怎么样了？到桌面工作台的「🔒 我的判断」里，在这一行上补登一句——',
      '我不会去猜图外的事（线下评审、口头反馈、邮件结果，系统一概不猜）。',
      '（问一次，不再追。不想说也没关系，这本账的债主是你自己。）',
    ].join('\n'))
  }
  return asked
}

/** The private ledger's own timer wheel. Never mounted on `scheduler` (PTD-14). */
export function startClock(
  ctx: Context,
  deliver: (text: string) => Promise<void>,
): () => void {
  const timer = setInterval(() => {
    void tickCheckpoints(ctx, deliver).catch((error: unknown) => {
      console.error('[yzj-next-pledger] checkpoint tick failed', error)
    })
  }, TICK_MS)
  // 不拦住进程退出：这是一个后台节拍，不是一件必须跑完的活。
  timer.unref?.()
  return () => { clearInterval(timer) }
}

/** Unused import guard: the bus type travels with the ring's wiring in `index.ts`. */
export type RingBus = PledgerCards
