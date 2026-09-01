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
import { expectationIdemKeyFor, familyOfCardKind, inviteIdemKeyFor } from './families.ts'
import { inviteFor, isFamilyQuiet } from './invite.ts'
import {
  calibrationBirth, evidenceFor, structuralFactFor, thenTextFor, watchedVerdicts,
  type MatchedFact,
} from './reflow.ts'
import type { FactRef, OrgAnchor } from './types.ts'
import { anchorFor, goalRefOf, isVerdictAction, type SeenVerdict } from './verdicts.ts'

/** How often the ledger's own timer wheel looks at its checkpoints. */
const TICK_MS = 5 * 60_000

/**
 * 出处 —— **只能引用组织侧事实** (#61 收紧⑤).
 *
 * 整个函数的输入面就是这条规则的兑现：一个组织图锚，一个组织图服务。没有 pledger
 * 句柄，所以「读金库来决定要不要问你」在这里**做不到**，而不是被禁止 (PTD-9)。
 */
export function sourceOf(ctx: Context, verdict: OrgAnchor, now = Date.now()): {
  sourceLine: string
  checkpointText: string
  /**
   * 检验点的**投影那一层**，只在图上确实知道那个时刻时才有 (两层规则).
   *
   * 它和 `checkpointText` 是并列的两样，不是从它解析出来的：图上挂着的那场会有一个
   * 精确的开始时刻，而人读的那句话该是「明早的《管理层评审》之后」。把时刻从话语里
   * 反解出来，等于逼着话语写成一个 ISO 串——**两层规则的意思正是不必如此**。
   */
  checkpointTs?: number
  evidence: readonly OrgAnchor[]
} {
  const graph = ctx.get('yzjGraph')
  const state = asRecord(graph?.rawObject(verdict.kind, verdict.id)?.state)
  const what = verdict.label ?? asString(state?.what) ?? `${verdict.kind}:${verdict.id}`
  const goal = goalRefOf(ctx, verdict.kind, verdict.id)
  const evidence: OrgAnchor[] = []
  if (goal !== undefined) {
    /*
      目标的那条承诺是这次裁决的**上文**：它说清了这份东西要用在哪儿。
      引用的是组织图上的对象，一跳可回——出处必须是能核对的，不能是一句形容。
    */
    evidence.push({ kind: 'goal', id: goal, label: goal })
  }

  /*
    **检验点必须在未来**，而这一条不是排版讲究，是一个真的 bug 的修法。

    第一版拿承诺的 `due` 当检验点。可 `due` 是**交付期限**，而验收发生在交付之后
    ——到你下这个判断的时候，那个日子多半已经过去了。于是「立完约当场就被问『后来
    怎么样了』」：一次性邀约刚变成一个赌注，时间轮立刻把它当成过期的来追。

    正确的出处在图上本来就有：**这份交付要用在哪儿**——它挂着的那场会（事件枢纽的
    服务边，§5.6 既有）。这也正是设计里那句「出处：这份交付的使用场合就是明早的
    评审」。找不到会就退回未来的 `due`；两者都没有，就**不给戳**——无戳的预期不参与
    时间轮，等结构性事实或你自己回来对表。宁可不问，不可乱问。
  */
  const meeting = upcomingMeetingFor(ctx, verdict, now)
  const due = asString(state?.due)
  const dueTs = due === undefined ? Number.NaN : Date.parse(due)
  const futureDue = due !== undefined && Number.isFinite(dueTs) && dueTs > now
    ? { text: due, ts: dueTs }
    : undefined
  if (meeting !== undefined) evidence.push(meeting.anchor)
  const checkpoint = meeting ?? futureDue

  return {
    sourceLine: meeting === undefined
      ? goal === undefined
        ? `你刚刚验收了「${what}」`
        : `你刚刚验收了「${what}」，它挂在目标 ${goal} 下`
      : `你刚刚验收了「${what}」——这份交付的使用场合就是${meeting.label}`,
    checkpointText: checkpoint?.text ?? '下一次这件事在图上有动静时',
    ...(checkpoint === undefined ? {} : { checkpointTs: checkpoint.ts }),
    evidence,
  }
}

/**
 * 这次裁决的对象要用在哪一场**还没开**的会上 (§5.6 事件枢纽的服务边).
 *
 * 纯组织图读：`event` 对象的 `prepares` 里挂着这条承诺，而 `startAt` 还在未来。
 * 一场已经开完的会不是检验点，它是历史。
 */
function upcomingMeetingFor(
  ctx: Context, verdict: OrgAnchor, now: number,
): { text: string; ts: number; label: string; anchor: OrgAnchor } | undefined {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined || verdict.kind !== 'commitment') return undefined
  let best: { text: string; ts: number; label: string; anchor: OrgAnchor } | undefined
  for (const object of graph.query({ kind: 'operator', openId: '' }, { kind: 'event' })) {
    const state = asRecord(object.state)
    const prepares = state?.prepares
    if (!Array.isArray(prepares) || !prepares.includes(verdict.id)) continue
    const startAt = state?.startAt
    if (typeof startAt !== 'number' || startAt <= now) continue
    // 最近的那一场：检验点是**下一个**见分晓的时刻，不是最远的那个。
    if (best !== undefined && best.ts <= startAt) continue
    const title = asString(state?.title) ?? '那场会'
    const when = new Date(startAt).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    best = {
      ts: startAt,
      // 话语层是**人读的那句话**；时刻在 `ts` 里，不必从这句话里反解出来。
      text: `${when}「${title}」之后`,
      label: `「${title}」`,
      anchor: { kind: 'event', id: object.id, label: title },
    }
  }
  return best
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
    ...(source.checkpointTs === undefined ? {} : { checkpointTs: source.checkpointTs }),
  })
  // 幂等锚：同一裁决至多一张邀约。重放、重启、第二个订阅者都收不出第二张。
  if (pledger.findByIdemKey(inviteIdemKeyFor(verdict)) !== undefined) return undefined
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
  let best: { verdict: SeenVerdict; matched: MatchedFact } | undefined
  for (const verdict of watchedVerdicts(ctx)) {
    // 事实必须**后于**裁决。一条早于裁决的边不是「后来」，是「当时」。
    if (event.seq <= verdict.seq) continue
    const matched = structuralFactFor(ctx, verdict, event)
    if (matched === undefined) continue
    // 最近的那一次裁决：见下。
    if (best === undefined || best.verdict.seq < verdict.seq) best = { verdict, matched }
  }
  if (best === undefined) return
  /*
    **一份事实至多出一张执** —— 而这一条是修一个真的会伤人的行为。

    第一版对每一个匹配上的裁决各出一张。看起来「更完整」，可想一想它在什么时候发生：
    一个目标下你验收过十条活，某天一份差距简报落地——十张回执同时出现，十条 DM 同时
    到手机上。其中至少九张，你打开就知道该按「配对错了」。

    **第五出口存在是因为配对可能错，不是因为我们该批量制造错配。** 宁空勿错在这里的
    形态就是这一句：拿不准是哪一次裁决的后来，就只配**最近的那一次**（`seq` 最大者，
    时间上离这条事实最近、因果上最可能是它的后来）；剩下那些不是丢了——它们躺在金库
    的「待对表」里，人可以在那一行上**补登事实**自己配对（环3 的人工那一支）。

    少说一句可以补，批量说错话收不回来。
  */
  await openCalibration(ctx, {
    verdict: best.verdict.anchor,
    family: best.verdict.family,
    fact: best.matched.fact,
    factText: best.matched.factText,
  })
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
  const expectation = pledger.findByIdemKey(expectationIdemKeyFor(input.verdict))
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
  /*
    **已经有回执在等你了，就不该再问一遍** (§4「检验点到达**且图内无匹配事实**」).

    第一版漏了后半句：结构性事实回流出了一张回执之后，预期仍然是 `testing`（它要等
    你归因才归档），于是时间轮照样发一条「后来怎么样了」——而答案就摆在同一条私语流
    里，是这条 agent 自己刚放上去的。一次问已经答过的问题，比不问更伤信任。
  */
  const hasReceipt = new Set<string>()
  for (const object of pledger.query('calibration')) {
    const verdict = asRecord(asRecord(object.state)?.verdictRef)
    const kind = asString(verdict?.kind)
    const id = asString(verdict?.id)
    if (kind !== undefined && id !== undefined) hasReceipt.add(`${kind}:${id}`)
  }
  for (const object of pledger.query('expectation')) {
    const state = asRecord(object.state)
    if (state === undefined) continue
    if (asString(state.status) !== 'testing' || state.asked === true) continue
    const verdict = asRecord(state.verdictRef)
    const verdictKey = `${asString(verdict?.kind) ?? ''}:${asString(verdict?.id) ?? ''}`
    if (hasReceipt.has(verdictKey)) continue
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
