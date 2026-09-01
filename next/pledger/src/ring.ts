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
 * **v2.0 的核心重构：出生三段式（谱／门／笔），三权分立** (#62-B4 / PTD-19).
 *
 * | 段 | 名 | 读 pgraph | 职责 |
 * |---|---|---|---|
 * | ① | 谱 {@link isPledgeable} | **否**（纯函数，在 `verdicts.ts`） | 这**种**裁决值不值得开口 |
 * | ② | 门 {@link inviteGate} | **是** | 幂等 · 族级降频 · 全局日配额 · 时窗 |
 * | ③ | 笔 {@link inviteRender} | **否**（签名不含 pgraph 能力） | 出卡文案，出处限组织侧事实 |
 *
 * **门与笔分立是本轮最重要的接口纪律**：疲劳治理**必须**读私账（否则治不了），而
 * 「镜子等人来照」要求生成器**看不见**镜子。v1.x 把两件事都叫「编排层」，实现者
 * 会顺手把 gate 的 pgraph 句柄传进 generator，那条戒律当场破功。断言⑥ 只约束笔。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphEvent } from '@yzj-next/graph'
import { expectationIdemKeyFor, familyOfCardKind, inviteIdemKeyFor } from './families.ts'
import { inviteFor, isFamilyQuiet } from './invite.ts'
import {
  calibrationBirth, evidenceFor, renderWhen, structuralFactFor, verdictSnapshot, watchedVerdicts,
  type MatchedFact,
} from './reflow.ts'
import { snapshot, type AnchoredText, type FactSource, type OrgAnchor } from './types.ts'
import { anchorFor, goalRefOf, isPledgeable, verdictKindOf, type SeenVerdict } from './verdicts.ts'

/** How often the ledger's own timer wheel looks at its checkpoints. */
const TICK_MS = 5 * 60_000

/**
 * 全局日配额 —— **扩触发面必同扩治理面** (v2.0 / #62-4 / PTD-20).
 *
 * 触发面从两点扩到五类的**同一次提交**里加这一条。五个入口各自克制、合起来仍然
 * 是骚扰；而扩员与疲劳是同一个动作的两面——**分两次做，中间就会有一个版本在烦人**。
 *
 * 族级降频治的是「这一类你不想聊」，日配额治的是「今天已经够了」。两层各管一件事：
 * 少了族级，你得为每一类各拒三次；少了全局，五个族各问两次就是十次。
 */
export const DEFAULT_DAILY_QUOTA = 2
/** 金库换挡台上可调的值域。0 = 全关邀约（那也是一个合法的答案）。 */
export const QUOTA_RANGE = { min: 0, max: 3 } as const

/**
 * 出处 —— **只能引用组织侧事实** (#61 收紧⑤).
 *
 * 这是**笔**（③）的输入面：一个组织图锚、一个组织图服务、一个标题原文。没有
 * pledger 句柄，所以「读金库来决定说什么」在这里**做不到**，而不是被禁止 (PTD-9)。
 */
export function inviteRender(ctx: Context, verdict: SeenVerdict): {
  sourceLine: string
  checkpointText: string
  checkpointTs?: number
  evidence: readonly AnchoredText[]
} {
  const anchor = verdict.anchor
  const now = verdict.at
  const graph = ctx.get('yzjGraph')
  const state = asRecord(graph?.rawObject(anchor.kind, anchor.id)?.state)
  const what = verdict.titleText ?? asString(state?.what) ?? `${anchor.kind}:${anchor.id}`
  const goal = goalRefOf(ctx, anchor.kind, anchor.id)
  const evidence: AnchoredText[] = []
  if (goal !== undefined) {
    // 出处必须是能核对的，不能是一句形容 —— 而且它同样立此存照。
    evidence.push(snapshot(`挂在目标 ${goal} 下`, { kind: 'goal', id: goal }, now))
  }

  /*
    **检验点必须在未来。**

    第一版拿承诺的 `due` 当检验点。可 `due` 是交付期限，而验收发生在交付之后——到
    你下这个判断的时候那个日子多半已经过去了，于是「立完约当场被追问」。正确的出处
    在图上本来就有：**这份交付要用在哪儿**——它挂着的那场会（事件枢纽的服务边）。
    找不到会就退回未来的 `due`；两者都没有就**不给戳**——无戳的预期不参与时间轮。
  */
  const meeting = upcomingMeetingFor(ctx, anchor, now)
  const due = asString(state?.due)
  const dueTs = due === undefined ? Number.NaN : Date.parse(due)
  const futureDue = due !== undefined && Number.isFinite(dueTs) && dueTs > now
    ? { text: due, ts: dueTs }
    : undefined
  if (meeting !== undefined) evidence.push(meeting.evidence)
  const checkpoint = meeting ?? futureDue

  return {
    sourceLine: meeting === undefined
      ? goal === undefined
        ? `${VERDICT_VERB[verdict.kind] ?? '你刚刚裁决了'}「${what}」`
        : `${VERDICT_VERB[verdict.kind] ?? '你刚刚裁决了'}「${what}」，它挂在目标 ${goal} 下`
      : `${VERDICT_VERB[verdict.kind] ?? '你刚刚裁决了'}「${what}」——这份交付的使用场合就是${meeting.label}`,
    checkpointText: checkpoint?.text ?? '下一次这件事在图上有动静时',
    ...(checkpoint === undefined ? {} : { checkpointTs: checkpoint.ts }),
    evidence,
  }
}

/** 出处那一句话的开头，按裁决种类说人话。谱里有的都要有一句。 */
const VERDICT_VERB: Readonly<Record<string, string>> = {
  acceptance: '你刚刚验收了',
  rework: '你刚刚打回了',
  assessment: '你刚刚验收了差距简报',
  delegation: '你刚刚把这件事交出去了',
  'lease-grant': '你刚刚签发了一份授权租约',
}

/**
 * 这次裁决的对象要用在哪一场**还没开**的会上 (§5.6 事件枢纽的服务边).
 *
 * 纯组织图读：`event` 对象的 `prepares` 里挂着这条承诺，而 `startAt` 还在未来。
 * 一场已经开完的会不是检验点，它是历史。
 */
function upcomingMeetingFor(
  ctx: Context, verdict: OrgAnchor, now: number,
): { text: string; ts: number; label: string; evidence: AnchoredText } | undefined {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined || verdict.kind !== 'commitment') return undefined
  let best: { text: string; ts: number; label: string; evidence: AnchoredText } | undefined
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
      evidence: snapshot(`这份交付要用在 ${when} 的「${title}」上`, { kind: 'event', id: object.id }, now),
    }
  }
  return best
}

/** 门的三种拒因。说得清是哪一种，人才知道下一步做什么。 */
export type GateRefusal = 'not-pledgeable' | 'duplicate' | 'family-quiet' | 'quota-spent'

/**
 * 门（②）—— **读账**，而且只读账.
 *
 * 幂等、族级降频、全局日配额，三道各管一件事。它读私账是**必须的**（疲劳治理不读账
 * 就治不了），而这正是它必须和笔分开的理由：笔那一侧一个 pgraph 句柄都不该有。
 */
export function inviteGate(
  ctx: Context, verdict: SeenVerdict, now = Date.now(),
): GateRefusal | undefined {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return 'not-pledgeable'
  // 幂等锚：同一裁决至多一张邀约。重放、重启、第二个订阅者都收不出第二张。
  if (pledger.findByIdemKey(inviteIdemKeyFor(verdict.anchor)) !== undefined) return 'duplicate'
  const events = pledger.events(['invite/declined', 'invite/reopened', 'expectation/opened'])
  if (isFamilyQuiet(events, verdict.family)) return 'family-quiet'
  if (invitesToday(ctx, now) >= quotaOf(ctx)) return 'quota-spent'
  return undefined
}

/** 今天已经开过几次口。日切按本地日历日——人过的是本地的一天。 */
export function invitesToday(ctx: Context, now = Date.now()): number {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) return 0
  const today = new Date(now).toDateString()
  return pledger.events(['invite/opened'])
    .filter(event => new Date(event.time).toDateString() === today).length
}

/**
 * 当前日配额。人在金库换挡台上调过就用他调的，没调过用 P1 的 2。
 *
 * 纯派生：数最后一条 `invite/quota-set`。**能派生就不落状态**——和模式滚动律同源。
 */
export function quotaOf(ctx: Context): number {
  const events = ctx.get('yzjPledger')?.events(['invite/quota-set']) ?? []
  const last = events.at(-1)
  const value = asRecord(last?.data)?.quota
  return typeof value === 'number' ? value : DEFAULT_DAILY_QUOTA
}

/**
 * 环1 —— 裁决落地那一刻，可能开一次口。
 *
 * 三段依次过：**谱**（这种裁决值不值得）→ **门**（今天/这一族还该不该问）→
 * **笔**（说什么）。三者的输入面各自封闭，所以「组织侧不含判据」「生成器看不见
 * 镜子」都是签名的推论，不是纪律。
 */
export async function inviteOnVerdict(
  ctx: Context,
  payload: {
    readonly cardRef: { kind: string; id: string }
    readonly actionId: string
    readonly kind?: string
    readonly at?: number
    readonly titleText?: string
  },
): Promise<string | undefined> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return undefined
  const kind = payload.kind ?? verdictKindOf(ctx, payload.cardRef.kind, payload.actionId)
  // ① 谱 —— 纯函数，一个字符串进、一个布尔出。
  if (kind === undefined || !isPledgeable(kind)) return undefined
  const spec = familyOfCardKind(payload.cardRef.kind)
  if (spec === undefined) return undefined
  const at = payload.at ?? Date.now()
  const verdict: SeenVerdict = {
    anchor: anchorFor(ctx, payload.cardRef.kind, payload.cardRef.id),
    kind,
    actionId: payload.actionId,
    family: spec.family,
    at,
    seq: 0,
    ...(payload.titleText === undefined ? {} : { titleText: payload.titleText }),
  }
  // ② 门 —— 读账。
  if (inviteGate(ctx, verdict, at) !== undefined) return undefined
  // ③ 笔 —— 不读账。
  const pen = inviteRender(ctx, verdict)
  const birth = inviteFor({
    verdict: verdictSnapshot(ctx, verdict),
    verdictAnchor: verdict.anchor,
    family: spec.family,
    evidence: pen.evidence,
    sourceLine: pen.sourceLine,
    checkpointText: pen.checkpointText,
    ...(pen.checkpointTs === undefined ? {} : { checkpointTs: pen.checkpointTs }),
  })
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
    if (best === undefined || best.verdict.seq < verdict.seq) best = { verdict, matched }
  }
  if (best === undefined) return
  /*
    **一份事实至多出一张执。**

    一个目标下你验收过十条活，某天一份差距简报落地——十张回执同时出现，十条 DM
    同时到手机上，其中至少九张你打开就知道该按「配对错了」。**第五出口存在是因为
    配对可能错，不是因为我们该批量制造错配。** 配最近的那一次（`seq` 最大者）；
    剩下那些不是丢了——它们在金库待对表区，人可以自己补登事实来配对。
  */
  await openCalibration(ctx, {
    verdict: best.verdict,
    fact: best.matched.fact,
    source: best.matched.source,
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
  const fact = asRecord(data?.fact)
  const text = asString(fact?.text)
  const about = asRecord(data?.about)
  if (factId === undefined || text === undefined || about === undefined) return

  let verdict: SeenVerdict | undefined
  let expectationId: string | undefined
  if (asString(about.kind) === 'expectation') {
    expectationId = asString(about.expectationId)
    if (expectationId === undefined) return
    const state = asRecord(pledger.object('expectation', expectationId)?.state)
    const shot = asRecord(state?.verdict)
    const anchor = asRecord(shot?.anchor)
    const kind = asString(anchor?.kind)
    const id = asString(anchor?.id)
    const family = asString(state?.family)
    if (kind === undefined || id === undefined || family === undefined) return
    verdict = {
      anchor: { kind, id },
      kind: 'acceptance',
      actionId: '',
      family,
      at: event.time,
      seq: 0,
      ...(asString(shot?.text) === undefined ? {} : { titleText: asString(shot?.text) as string }),
    }
  } else {
    const shot = asRecord(about.verdict)
    const anchor = asRecord(shot?.anchor)
    const kind = asString(anchor?.kind)
    const id = asString(anchor?.id)
    if (kind === undefined || id === undefined) return
    const family = familyOfCardKind(kind)?.family
    if (family === undefined) return
    verdict = {
      anchor: { kind, id },
      kind: 'acceptance',
      actionId: '',
      family,
      at: event.time,
      seq: 0,
      ...(asString(shot?.text) === undefined ? {} : { titleText: asString(shot?.text) as string }),
    }
  }
  await openCalibration(ctx, {
    verdict,
    // 人的原话，照片一张 —— 图外事实没有锚。
    fact: snapshot(text, undefined, event.time),
    source: { kind: 'noted', factId },
  })
}

/**
 * 出一张校准回执 —— 幂等锚 =（裁决边, 事实边）.
 *
 * 正文三段**全部是照片**：当时（裁决快照）× 后来（事实快照）× 证据行。断了组织图
 * 之后这张执一个字都不会少（断言⑯ 集成半）。
 */
export async function openCalibration(
  ctx: Context,
  input: {
    readonly verdict: SeenVerdict
    readonly fact: AnchoredText
    readonly source: FactSource
  },
): Promise<string | undefined> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return undefined
  const anchor = input.verdict.anchor
  const expectation = pledger.findByIdemKey(expectationIdemKeyFor(anchor))
  const expectationState = asRecord(expectation?.state)
  const expectationStatus = asString(expectationState?.status)
  /*
    撤回过的预期不再对表。

    撤回是**诚实退出**：前提没了，那个赌注就不再是一个赌注。为它出一张回执，等于
    要人为一件他已经明说不算数的事再打一次分。隐式预期那条路仍然走得通。
  */
  const expectationId = expectationStatus === 'testing' || expectationStatus === 'settled'
    ? expectation?.id
    : undefined
  const expectationText = expectationId === undefined
    ? undefined
    : asString(expectationState?.text)
  const verdictShot = verdictSnapshot(ctx, input.verdict)
  const birth = calibrationBirth({
    verdict: verdictShot,
    verdictAnchor: anchor,
    fact: input.fact,
    source: input.source,
    family: input.verdict.family,
    evidence: evidenceFor(ctx, anchor, input.source, input.verdict.at),
    ...(expectationId === undefined ? {} : { expectationId }),
  })
  /*
    「当时」栏 —— **两输入联合类型，第三种不可构造** (#62-C7).

    有显式预期就直出人的原话；没有就只陈列裁决事实本身。上一版在这里写
    「隐式预期即『它已经够好』」——那是替人写好了他当时在想什么。
  */
  birth.data.thenText = renderWhen(
    expectationText === undefined ? { verdictSnapshot: verdictShot } : { expectationText },
  )
  const idemKey = asString(birth.data.idemKey as never)
  if (idemKey !== undefined && pledger.findByIdemKey(idemKey) !== undefined) return undefined
  await pledger.append({ type: birth.type, data: birth.data as never, actor: { kind: 'agent' } })
  return birth.calibrationId
}

/**
 * 时间轮的一次滴答 —— 检验点到了，问**一次**结果.
 *
 * 「问结果合法，索要预期非法」。人的答复经 `fact/noted` 落账——**系统不猜图外**。
 * 问过就记账（`expectation/asked`），因为 host 内存不是真身。
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

    一次问已经答过的问题，比不问更伤信任——而答案就摆在同一条私语流里，是这条
    agent 自己刚放上去的。
  */
  const hasReceipt = new Set<string>()
  for (const object of pledger.query('calibration')) {
    const anchor = asRecord(asRecord(object.state)?.verdict)
    const inner = asRecord(anchor?.anchor)
    const kind = asString(inner?.kind)
    const id = asString(inner?.id)
    if (kind !== undefined && id !== undefined) hasReceipt.add(`${kind}:${id}`)
  }
  for (const object of pledger.query('expectation')) {
    const state = asRecord(object.state)
    if (state === undefined) continue
    if (asString(state.status) !== 'testing' || state.asked === true) continue
    const shot = asRecord(state.verdict)
    const anchor = asRecord(shot?.anchor)
    const key = `${asString(anchor?.kind) ?? ''}:${asString(anchor?.id) ?? ''}`
    if (hasReceipt.has(key)) continue
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
