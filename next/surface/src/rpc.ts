/**
 * The surface's RPC channel.
 *
 * Read-mostly by design. The one write it exposes — `send-to-place` — is the
 * 对群 half of the dual voice, and it is a plain IM send rather than anything
 * the agent does on the operator's behalf: the operator is speaking, in their
 * own name, into the place they are already looking at.
 *
 * Loopback authority only, exactly like the card channel: this endpoint can
 * put words in a group, so it is as privileged as the desktop itself.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asNumber, asRecord, asString, type GraphViewer, type JsonValue } from '@yzj-next/graph'
import type { AnswerableDemand, AnswerableMode } from '@yzj-next/cards'
import { placeKeyFor, type TopicDescriptor, type TopicMessage } from '@yzj-next/channel'
import { GATEWAY_ESCAPE_TOOLS, WRITE_SPECS } from '@yzj-next/tools'
import {
  eventHub, failureOf, goalCommitmentIdFor, ownsCommitment, readinessLine,
} from '@yzj-next/objects'
import type {} from '@yzj-next/channel'

/** The head chip: what this topic is in service of. */
export interface TopicChip {
  readonly kind: 'commitment'
  readonly id: string
  readonly what: string
  readonly status: string
  readonly due?: string
  readonly parentGoalRef?: string
  /** True when the goal link was inferred and is still awaiting correction. */
  readonly inferred: boolean
}

/** One answerable object rendered inline in the stream. */
export interface StreamCard {
  readonly kind: string
  readonly id: string
  readonly state: unknown
  readonly resolved: boolean
  /**
   * When the object came into being, off the graph rather than off its state.
   *
   * Most families never put a timestamp in their own state, so reading one
   * from there sorted every card to epoch zero — which piled the whole topic's
   * cards above the conversation that produced them. A confirmation belongs
   * where it was asked for; that is the entire argument for rendering cards
   * inline instead of in a side panel.
   */
  readonly at: number
  /**
   * 出生序 —— 条按它排。
   *
   * 时间戳会撞：同一次裁决落库的几条卡毫秒数一模一样，按它排等于按查询顺序排，
   * 而查询顺序是「新的在前」。于是「等得久的先说」在最需要它的那一刻恰好失效。
   */
  readonly seq: number
  /**
   * 它此刻在等什么 —— 会话决断条读的就是这一个字段 (v4.15)。
   *
   * 决断条与流内卡因此**结构性同源**:它们是同一个数组的两次渲染,不是两次查询
   * 碰巧一致。「同源条款」于是不必靠纪律维持——想让它们说不同的话都做不到。
   */
  readonly demand?: AnswerableDemand
  readonly actions: readonly {
    readonly id: string
    readonly label: string
    readonly style?: string
    readonly needsInput: boolean
    readonly available: boolean
  }[]
}

/**
 * One thing this topic produced, rendered where it was produced.
 *
 * An artifact is the only row in the stream whose body lives outside the
 * system entirely — the graph holds an edge, Yunzhijia holds the document. So
 * the card is a door, not a copy: it carries the URI and nothing that could
 * drift away from what the document actually says.
 */
export interface StreamArtifact {
  readonly uri: string
  readonly title: string
  readonly action: string
  readonly kind?: string
  readonly toolName?: string
  readonly time: number
  /** True when it was written into a place other than the one we are in. */
  readonly foreign: boolean
}

/** Everything the fused window needs for one session. */
export interface FusedWindow {
  readonly topic?: TopicDescriptor
  readonly messages: readonly TopicMessage[]
  readonly chips: readonly TopicChip[]
  /** Answerable objects of this topic, rendered inline where they belong. */
  readonly cards: readonly StreamCard[]
  /** What the topic produced, on the same time axis as everything else. */
  readonly artifacts: readonly StreamArtifact[]
  /** The words that address the agent, from the channel's config. */
  readonly aliases: readonly string[]
  /**
   * The goal this conversation is working toward (v4.9 语境继承).
   *
   * Read from the graph rather than remembered by the view: the chip has to be
   * true after a reload and after navigating away and back, or it becomes a
   * decoration that disagrees with what the next registration will actually
   * inherit. A chip that lies about attachment is worse than no chip.
   */
  readonly goalContext?: { readonly goalRef: string; readonly goalName?: string }
  /**
   * Present when the messages could not be read. A projection is allowed to
   * lag; it is NOT allowed to look complete while lagging (数据律 1), so the
   * reason travels to the view instead of an empty list.
   */
  readonly staleReason?: string
}


/**
 * The wire result shape the connection channel expects — mirrored locally for
 * the same reason the card channel mirrors it: a browser-facing contract must
 * not drag a host package into this module's type graph.
 */
type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } }

const failure = (message: string): RpcResult => ({
  ok: false,
  error: { code: 'internal', message, details: {} },
})

/**
 * 主权在执行层的那一半 —— **不渲染只是不造按钮，不是把门关上** (v4.22 裁决②).
 *
 * 设计把这条写成了工程要求：「渲染过滤与执行校验**共用同一主权谓词、单一事实源**——
 * 防 UI 不渲染而文本通道绕过执行」。只在界面上不画、端点照收，等于把主权做成一层
 * 皮肤：绕过它只需要一次直接调用，而这条通道本来就对模型开着。
 *
 * 拒绝的话要说清**是谁的**，并且指出那条仍然走得通的路：不禁言——你可以在会话里
 * 直接跟他说。
 */
function refuseUnlessSteward(
  ctx: Context, commitmentId: string, verb: string,
): RpcResult | undefined {
  const state = asRecord(ctx.yzjGraph.rawObject('commitment', commitmentId)?.state)
  const delegatedBy = asString(state?.delegatedBy)
  const me = asString((ctx.yzjCards.desktopActor() as { openId?: string }).openId)
  // 不知道我是谁 ≠ 不是我的（三值纪律）——身份未知的部署里不该把人锁在自己的账本外。
  if (me === undefined) return undefined
  if (ownsCommitment(me, delegatedBy === undefined ? {} : { delegatedBy })) return undefined
  const owner = asString(asRecord(state?.executor)?.name)
  return failure(
    `这条承诺不是你登记的，${verb}归登记它的人${owner === undefined ? '' : `（执行者是 ${owner}）`}——`
    + '你仍然可以在那个会话里直接说一句。',
  )
}

function stringField(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The commitments this topic is serving. */
export function chipsFor(ctx: Context, topic: TopicDescriptor | undefined): TopicChip[] {
  if (topic === undefined) return []
  const viewer: GraphViewer = topic.conversationKind === 'group'
    ? { kind: 'place', placeKey: topic.placeKey }
    : { kind: 'operator', openId: topic.groupId }
  const out: TopicChip[] = []
  for (const object of ctx.yzjGraph.query(viewer, { kind: 'commitment', status: ['open'] })) {
    const state = asRecord(object.state)
    if (asString(asRecord(state?.executor)?.topicKey) !== topic.topicKey) continue
    const due = asString(state?.due)
    const goal = asString(state?.parentGoalRef)
    out.push({
      kind: 'commitment',
      id: object.id,
      what: asString(state?.what) ?? '',
      status: asString(state?.status) ?? 'open',
      inferred: asString(state?.attachedVia) === 'inferred',
      ...(due === undefined ? {} : { due }),
      ...(goal === undefined ? {} : { parentGoalRef: goal }),
    })
  }
  return out
}

/** What this topic produced, oldest first — the stream sorts it into place. */
export function artifactsFor(
  ctx: Context,
  topic: TopicDescriptor | undefined,
): readonly StreamArtifact[] {
  if (topic === undefined) return []
  const out: StreamArtifact[] = []
  for (const event of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    const data = asRecord(event.data)
    if (asString(data?.topicKey) !== topic.topicKey) continue
    const artifact = asRecord(data?.artifact)
    const uri = asString(artifact?.uri)
    if (uri === undefined) continue
    const kind = asString(artifact?.kind)
    const toolName = asString(data?.toolName)
    out.push({
      uri,
      title: asString(artifact?.title) ?? uri,
      action: asString(data?.action) ?? '产出',
      time: event.time,
      // A document written into another place is the crossing the audit trail
      // exists for, so it is marked here rather than silently blending in.
      foreign: asString(artifact?.placeKey) !== topic.placeKey,
      ...(kind === undefined ? {} : { kind }),
      ...(toolName === undefined ? {} : { toolName }),
    })
  }
  return out
}

/**
 * 场所合同 (§8) — what this agent may do in this place, and where that comes
 * from.
 *
 * Assembled entirely from things that already decide behaviour: the contract
 * the guard reads, the write table it gates on, the escape list it enforces,
 * and the live revocations. Nothing here is a second copy of a policy — if a
 * row in this panel and the guard ever disagreed, the panel would be the one
 * lying, so it is built from the guard's own inputs.
 *
 * The lease section is deliberately ABSENT rather than empty. `yzjLeases`
 * exposes `covers()` and nothing that grants one (段 6, 疼痛门: 审批疲劳真实
 * 发生). An empty "授权租约" box would read as a feature nobody has used, which
 * is precisely the signal the evidence gate needs to stay clean.
 */
export interface ContractView {
  readonly placeKey: string
  readonly groupName: string
  /** The agent answers here. Everything below is conditional on it. */
  readonly onDuty: boolean
  readonly version: number
  readonly memoryPolicy: 'normal' | 'facts-only' | 'never'
  readonly processSummary: boolean
  readonly oaRequiredCategories: readonly string[]
  /** Irreversible operations. These always ask, and a lease can never cover them. */
  readonly strongTools: readonly { readonly name: string; readonly reason: string }[]
  /** Reversible writes: covered by the admitting message inside its own turn. */
  readonly standardCount: number
  /** Tools a Yunzhijia-admitted turn may never call at all. */
  readonly bannedTools: readonly string[]
  /** Authorities withdrawn in this deployment, newest first. */
  readonly revocations: readonly { readonly messageId: string; readonly reason: string; readonly time: number }[]
  /** False while no lease can be granted — stated, not implied by an empty list. */
  readonly leasesAvailable: boolean
}

export function contractView(ctx: Context, placeKey: string): ContractView {
  const contract = ctx.yzjGraph.contractFor(placeKey)
  const topics = ctx.get('yzjTopics')
  const entry = topics?.tree().find(candidate => candidate.place.placeKey === placeKey)
  /*
    接单 —— whether the agent answers here at all.
    It is the FIRST thing the rest of this panel is conditional on: every row
    below describes what the agent may do, and in a place it does not serve
    the answer is "nothing, because it is not here". Like the model chip, the
    switch itself is not offered — it is the deployment's blast radius — so
    the panel states the fact and where it is set.
  */
  const onDuty = topics?.conversations().find(row => row.placeKey === placeKey)?.onDuty
    ?? entry !== undefined
  const strongTools: { name: string; reason: string }[] = []
  let standardCount = 0
  for (const [name, spec] of Object.entries(WRITE_SPECS)) {
    if (spec.level === 'strong') strongTools.push({ name, reason: spec.reason })
    else standardCount += 1
  }
  const revocations = ctx.yzjGraph.rawEvents(['authority/revoked'])
    .map(event => ({
      messageId: asString(asRecord(event.data)?.messageId) ?? '',
      reason: asString(asRecord(event.data)?.reason) ?? '未说明',
      time: event.time,
    }))
    .reverse()
    .slice(0, 20)
  return {
    placeKey,
    onDuty,
    groupName: entry?.place.groupName ?? placeKey,
    version: contract.version,
    memoryPolicy: contract.memoryPolicy,
    processSummary: contract.processSummary,
    oaRequiredCategories: contract.oaRequiredCategories,
    strongTools,
    standardCount,
    bannedTools: [...GATEWAY_ESCAPE_TOOLS],
    revocations,
    leasesAvailable: false,
  }
}

/** One topic, as the place view renders it inline. */
export interface PlaceTopicCard {
  readonly sessionId: string
  readonly topicKey: string
  readonly topicRootId: string
  readonly label: string
  /** Where it sits in the main thread: the message that started it. */
  readonly badge: string
  /** Hot = something is running or waiting on somebody; cold = an index entry. */
  readonly hot: boolean
  /** 有一件事在里面等你答时，它自己那句话。徽标只装得下四个字。 */
  readonly owes?: string
}

/**
 * 群视图 (§7.3) — the place seen whole.
 *
 * The main thread with the topics that were born in it rendered INLINE at the
 * message that started each one. That placement is the whole idea: a topic is
 * not a folder somebody filed a conversation into, it is a branch that grew at
 * a particular sentence, and the group view is where you can still see the
 * sentence it grew from.
 */
export interface PlaceView {
  readonly placeKey: string
  readonly groupName: string
  readonly messages: readonly TopicMessage[]
  readonly topics: readonly PlaceTopicCard[]
  /**
   * The agent answers here. False = people talking, and addressing the agent
   * will be refused rather than posted (v4.8) — the composer has to know
   * before the send key is pressed.
   */
  readonly onDuty: boolean
  /**
   * What kind of conversation this is.
   *
   * An assistant or system feed is a SUBSCRIPTION, not a conversation: triage
   * refuses those types outright and nobody is on the other end to read a
   * reply. The composer is closed there rather than left open over a hole.
   */
  readonly kind: 'group' | 'direct' | 'assistant'
  /** The words that address the agent, from the channel's config. */
  readonly aliases: readonly string[]
  readonly staleReason?: string
}

/** Assemble the place view: recent messages plus the topics born in them. */
export async function placeView(
  ctx: Context,
  placeKey: string,
  windowSize: number,
): Promise<PlaceView> {
  const topics = ctx.get('yzjTopics')
  const entry = topics?.tree().find(candidate => candidate.place.placeKey === placeKey)
  /*
    A conversation the agent has never worked in is still a room the operator
    can walk into (v4.8: 人看人发不受 allow-list 限制). Its name comes from the
    roster rather than from the topic tree, which only knows places where work
    happened — without this, every conversation outside the allow-list opened
    as a view titled `yzj-group-<hash>` with no messages in it.
  */
  const listed = topics?.conversations().find(row => row.placeKey === placeKey)
  const groupName = entry?.place.groupName ?? listed?.name ?? placeKey
  const onDuty = listed?.onDuty ?? entry !== undefined
  const kind = listed?.kind ?? (placeKey.startsWith('yzj-dm-') ? 'direct' as const : 'group' as const)
  const viewer: GraphViewer = { kind: 'place', placeKey }
  /**
   * topicKey → 这个话题还在办。
   *
   * 只问**留意层**这两族：任务没走到终态、还在等着谁。等人答的那几种（确认、冲突、
   * 验收、裁决）走下面那个抽象查询，因为它们同时还要在卡上说出等的是什么。
   *
   * **承诺不算。** 它比话题活得久——一条人家欠着的活可以挂三个星期，而它所在的那段
   * 对话早就办完归档了。把承诺算进来，收件箱（那里承诺根本不定音调）会说这个话题
   * 空闲、群视图会说它进行中，同一件事两个屏幕两种说法。
   */
  const hot = new Set<string>()
  for (const kind of ['task', 'waiting']) {
    for (const object of ctx.yzjGraph.query(viewer, { kind })) {
      const state = asRecord(object.state)
      const status = asString(state?.status)
      if (status === undefined || SETTLED.has(status)) continue
      const topicKey = asString(state?.topicKey)
      if (topicKey !== undefined) hot.add(topicKey)
    }
  }
  /*
    话题卡徽标 = 逐级兑付链的中间一跳 (v4.14)。

    「进行中」对一个进来找验收项的人毫无用处:它说这里还没完,不说等的是谁。徽标
    要么说出等你的那件事(点进去决断条接着指到对象),要么就只是「进行中」。**每
    一跳都得是门**,而门上得写着门后是什么。

    上卷三宗罪的另一半在这里兑现:话题里的待答**只**改这张卡的徽标,不往主楼顶上
    堆一条——群顶变第二收件箱正是这么长出来的。
  */
  const owed = new Map<string, AnswerableDemand>()
  for (const pending of ctx.yzjCards.demands(viewer)) {
    if (pending.demand.layer !== 'blocking' || pending.topicKey === undefined) continue
    if (!owed.has(pending.topicKey)) owed.set(pending.topicKey, pending.demand)
  }
  const cards: PlaceTopicCard[] = (entry?.topics ?? []).map((topic) => {
    const demand = owed.get(topic.topicKey)
    // 等着人答，本身就是「还在办」——冷卡是归档索引，而这件事还没完。
    const live = hot.has(topic.topicKey) || demand !== undefined
    return {
      sessionId: topic.sessionId,
      topicKey: topic.topicKey,
      topicRootId: topic.topicRootId,
      label: topic.label,
      badge: demand?.badge ?? (live ? '进行中' : '已归档'),
      hot: live,
      /** 有人在等你的时候，卡自己说清等的是什么——徽标只有四个字。 */
      ...(demand === undefined ? {} : { owes: demand.label }),
    }
  })
  const aliases = topics?.aliases() ?? []
  if (topics === undefined) {
    return { placeKey, groupName, messages: [], topics: cards, onDuty, kind, aliases }
  }
  try {
    const messages = await topics.messagesInPlace(placeKey, windowSize)
    // Marked read only AFTER the read succeeded. Clearing the badge on a read
    // that failed destroys the unread signal and puts nothing in its place —
    // the one pairing worse than either failure alone.
    topics.markRead(placeKey)
    return { placeKey, groupName, topics: cards, onDuty, kind, aliases, messages }
  } catch (error) {
    return {
      placeKey,
      groupName,
      topics: cards,
      onDuty,
      kind,
      aliases,
      messages: [],
      staleReason: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Statuses that mean nobody is waiting on this any more. */
const SETTLED = new Set([
  'accepted', 'voided', 'closed', 'resolved', 'approved', 'rejected',
  'expired', 'superseded', 'merged',
])

/**
 * What one topic is doing, in the order attention should reach it.
 *
 * The order IS the design: a pending confirmation blocks real work, a finished
 * task is asking for a verdict, a contradiction has paused something, work in
 * flight is merely informative, and waiting on somebody else is the quietest
 * state that still counts as open.
 */
export type TopicTone = 'confirm' | 'review' | 'running' | 'waiting' | 'idle'

const TONE_RANK: Record<TopicTone, number> = {
  confirm: 0, review: 1, running: 2, waiting: 3, idle: 4,
}

const TONE_BADGE: Record<TopicTone, string> = {
  confirm: '待确认', review: '待验收',
  running: '运行中', waiting: '等待中', idle: '',
}

/**
 * 六种交互模式各自该以多急的口气到达 —— **不是六种类型** (v4.15 家族即接口)。
 *
 * 一个新家族声明自己是哪一种,这里就已经知道该把它排在哪、徽标写什么。此前这段
 * 是一族一段 `query()`,新增一员必须记得回来改三处;漏掉一处的后果不是报错,是
 * 那件事**安静地不出现**——差距简报就这样在收件箱里缺席过。
 *
 * 只有两档:要么在等你**放行/裁决/签发**(确认),要么在等你**判它行不行**
 * (验收)。再细分下去,排序本身就开始需要维护了。
 */
const MODE_TONE: Readonly<Record<AnswerableMode, TopicTone>> = {
  'single-confirm': 'confirm',
  'per-item-verdict': 'confirm',
  issuance: 'confirm',
  'open-question': 'confirm',
  'two-verb-acceptance': 'review',
  'multi-exit-assessment': 'review',
}

/** 一件等你答的事该排多前。认不出的模式按「需要我」处理——宁可吵，不可静默。 */
function toneOf(mode: AnswerableMode): TopicTone {
  return MODE_TONE[mode] ?? 'confirm'
}

/** One row in the attention-sorted inbox. */
export interface InboxItem {
  /** Work is in flight right now, whatever louder demand the badge shows. */
  readonly live?: boolean
  readonly sessionId: string
  readonly placeKey: string
  readonly title: string
  readonly placeName: string
  /**
   * The second line: what this topic is doing right now, in its own words.
   *
   * Read off the most urgent object rather than composed from a template. A
   * row that only repeats its own title in smaller grey text is a row that
   * costs a line and answers nothing.
   */
  readonly preview: string
  readonly tone: TopicTone
  readonly badge: string
  /**
   * 这一行此刻在等的那件事 —— 有它才叫「需要你」(v4.15)。
   *
   * 目标页的决断层过滤读的就是它:`decisions = 收件箱行.filter(有 demand)`。
   * 此前那里写的是「音调 ∈ {confirm, review, conflict}」——一个按枚举维护的
   * 集合,家族增员时不会有人想起来回这里加一个词。
   */
  readonly demand?: AnswerableDemand
}

/**
 * The unified inbox (§7.2) — ONE list, not two.
 *
 * An earlier version had a triage list AND a place tree, which meant an active
 * topic appeared twice and a settled one appeared once, in a different place,
 * looking the same. The design's shape is a single tree grouped by place, with
 * the three counters above it as jumps rather than as a second list.
 *
 * **注意力租约** is the rule that keeps it readable: inside a real place, a
 * topic occupies a row only while it is doing something. When it settles, the
 * row is released — the topic is not deleted, it moves to the place's own view
 * where the archive lives. Size stays O(active work), not O(history), which is
 * why the column survives the hundredth topic. Direct chats and local sessions
 * keep their rows, because they have no group view to be archived into.
 */
export interface InboxPlace {
  readonly placeKey: string
  readonly groupName: string
  readonly conversationKind: 'group' | 'direct'
  /** The most urgent thing under this header, shown on the header itself. */
  readonly tone: TopicTone
  readonly badge: string
  /** How many topics the attention lease is currently holding back. */
  readonly archived: number
  readonly topics: readonly InboxItem[]
}

/**
 * One row of the conversation base — 「谁在找我」.
 *
 * Rides the inbox payload rather than getting an endpoint of its own: the
 * sidebar already polls the inbox every five seconds, and two payloads for one
 * column is two chances for the column to disagree with itself.
 */
export interface InboxConversation {
  readonly placeKey: string
  readonly name: string
  readonly kind: 'group' | 'direct' | 'assistant'
  readonly lastMsgTime: number
  readonly preview: string
  readonly unread: number
  readonly avatarUrl?: string
  /** On duty = drawn as a place row with its topics; off = a plain row. */
  readonly onDuty: boolean
  readonly selfChat: boolean
}

export interface InboxView {
  /** Counters for the three chips. Jumps, not a second list. */
  readonly counts: { readonly confirm: number; readonly review: number; readonly running: number }
  /** The first topic of each tone, so a chip can go somewhere. */
  readonly firstOf: Readonly<Partial<Record<TopicTone, string>>>
  readonly places: readonly InboxPlace[]
  /**
   * Every conversation this account has, newest activity first (v4.8).
   *
   * The task dimension above and the message dimension here are two
   * orthogonal questions; the attention lease governs the first only. This
   * list is bounded by the operator's social graph, and it is what stops the
   * workbench from being an agent-shaped slice that sends people back to the
   * native client for everything else.
   */
  readonly conversations: readonly InboxConversation[]
  /** 演示隐身档 (D10): fold the base, zero the badges, hide the previews. */
  readonly stealth?: boolean
  /**
   * The words that address the agent, from the channel's own config.
   *
   * Served rather than hard-coded in the view: the ⚡ verb prefills one and the
   * anchor bar warns about them, and the deployment plans to change them.
   */
  readonly aliases: readonly string[]
  /**
   * EVERY session that is a topic, whether or not the lease is showing it.
   *
   * The desktop's "local sessions" list is defined by subtraction — anything
   * the graph does not know about — so it has to subtract the full set. Using
   * the visible rows instead put every settled topic back on screen under
   * 本地会话, which is both wrong and the exact opposite of what the lease is
   * for.
   */
  readonly topicSessionIds: readonly string[]
  readonly commitments: {
    readonly open: number
    readonly overdue: number
    /** Goals whose children have ALL settled — the moment to write a gap report. */
    readonly toAssess: number
  }
}

/**
 * A due string that is a real date in the past. Vague dues never count.
 *
 * `now` 由调用方传进来:一屏上「逾期」和「信号过时」若各读各的时钟,两句话
 * 就可能在同一次渲染里对不上——差几毫秒不改变结论,但那条「一次渲染读一个
 * 现在」的注释就不再是真的,而注释一旦开始说谎就没人再信它。
 */
/**
 * 把「何时」拆成**真身 + 投影**两层 (v4.21 时间透镜)。
 *
 * `text` 是当初说出口的那句话，原样保留；`ts` 只在**真解析得出来**的时候才有。
 * 「下周初」解析不出日期，那就没有 `ts`——而不是替他挑一个周一。把人说过的话改写成
 * 一个他没承诺过的日期，是拿我们的解析冒充他的承诺；这一条和 `isOverdue` 里
 * 「含糊的期限永远不算逾期」是同一条纪律的两面。
 *
 * 没有 `ts` 的行**沉底，但不消失**：看不出时间不等于这件事不存在。
 */
/**
 * 这一条和查看者的关系，以及谁验收它 (v4.21 方向轴 + 责任锚)。
 *
 * 三格互斥且**穷尽**：我欠的 / 欠我的 / 我旁观的。第三格不是兜底——板 = 查看者可见域
 * 的并集，**不是「公开承诺板」**，所以「看得见但既不欠也不被欠」是真实且常见的关系。
 * 少了它，那些行要么被硬塞进前两格（撒谎），要么消失（板不再是可见域的并集）。
 *
 * 验收人**恒为人**，与执行者正交：an agent cannot be held accountable。P1 里它就是
 * 签发者。**等于查看者本人就不发**——本人省略，那一格留给真正需要说清的情形。
 *
 * 查看者身份未知时（通道还没拿到身份）一律 `observed`：不知道我是谁，就不该替我
 * 断言哪些是我欠的。宁可少说，不可错说。
 */
export function directionOf(
  me: string | undefined,
  executorOpenId: string | undefined,
  registrar: string | undefined,
  names: ReadonlyMap<string, string>,
): { direction: 'mine' | 'owed-to-me' | 'observed'; acceptor?: string } {
  const direction = me === undefined
    ? 'observed' as const
    : executorOpenId === me
      ? 'mine' as const
      : registrar === me ? 'owed-to-me' as const : 'observed' as const
  if (registrar === undefined || registrar === me) return { direction }
  // 名字取自登记时抄下的那份名录；查不到就用 openId——**不猜**，宁可难看。
  return { direction, acceptor: names.get(registrar) ?? registrar }
}

/**
 * 组内**信号序** (v4.21)：异常浮起，正常安静。
 *
 * 板是**账本的对账面**，它的合法增量只有「对账排列 + 一跳指路 + 就近动词」——
 * 「3 分钟知道哪里不对劲」这件事，**由排列满足，不由聚合满足**（聚合是收件箱的职责，
 * 板上不设决断条）。所以这个比较器不是排版偏好，它就是板的主要功能本身。
 *
 * 方案给的序：待决 > 逾期 > 无信号/过时 > 运行 > 进行中 > 休眠 > 终态。这里落到能
 * **精确推导**的那几档：
 *
 * - **逾期**：有真日期且已过（含糊的期限永远不算——见 `isOverdue`）；
 * - **无信号**：登记之后再没有任何东西碰过它。「没消息」不等于「没问题」，一条人欠的
 *   事登记完就没有下文，和一条有回执有产物的事，在「进行中」三个字底下长得一模一样；
 * - **过时**：有过动静，但已经旧了；
 * - **有证据**：正常在跑——它就该安静地待在下面；
 * - **终态**：沉底。板要浮起的是**正在滑掉的东西**，不是做一份完整档案。
 *
 * **待决那一档实现了**，就在最前面：交付被主张的那一刻，「有人在等你答」这个事实就在
 * 这条承诺自己身上（`awaitingAcceptance`），不需要任何反查索引。（这一条是自审时改的：
 * 上一版这里写着「待决要一张可应答对象→承诺的反查索引所以没做」——验收链接通之后那句
 * 话就不成立了，而一条过期的理由留在注释里，比没有注释更能挡住下一个人。）
 *
 * 别的待决形态（提案、租约…）确实还要那张索引，它们仍然只在收件箱聚合——板不设决断条。
 *
 * 同档之内按**账龄**排（`lastSignalAt` 越旧越靠前）——账龄折进排序权重，不做独立结构。
 * 无戳的行不因此消失，它只是没有「今日到期」这一层可参与。
 */
export function bySignal(now: number): (left: BoardRow, right: BoardRow) => number {
  const tier = (row: BoardRow): number => {
    if (row.status !== 'open') return 6
    /*
      **待决排在最前** —— 而且它是可推导的。

      我先前写过「待决那一档没有实现，它要一张可应答对象→承诺的反查索引」。验收链接通
      之后那句话不再成立：交付被主张的那一刻，事实**就在这条承诺自己身上**（`delivery`
      在，人在等你验收或打回）。反查索引是别的待决形态才需要的东西，不是这一种。

      它压过逾期：一条等你答的事，比一条等别人动的事更该先被看见——逾期要的是催，
      而待决要的是**你现在就能做完的一个动作**。
    */
    if (row.awaitingAcceptance === true) return 0
    if (row.overdue) return 1
    if (row.signal === 'silent') return 2
    if (row.signal === 'stale') return 3
    // 今日到期：有戳才谈得上，无戳的落到普通「运行」档而不是被顶上来。
    if (row.due?.ts !== undefined && row.due.ts - now < DAY_MS && row.due.ts >= now) return 4
    return 5
  }
  return (left, right) => tier(left) - tier(right) || left.lastSignalAt - right.lastSignalAt
}

const DAY_MS = 24 * 60 * 60_000

function dueOf(due: string): { text: string; ts?: number } {
  const parsed = Date.parse(due)
  return Number.isFinite(parsed) ? { text: due, ts: parsed } : { text: due }
}

function isOverdue(due: string | undefined, now: number): boolean {
  if (due === undefined) return false
  const parsed = Date.parse(due)
  return Number.isFinite(parsed) && parsed < now
}

/**
 * 多久没动就算「过时」。
 *
 * 三天是**工作日的量级**,不是一个精确阈值:周五登记、周一还没动静,那是正常的
 * 周末;到周三还没有,那就值得问一句了。数字放在这里而不是散在判断里,因为
 * 页面上要把它说出来(「x 天无新轨迹」),说的和判的必须是同一个数。
 */
const STALE_MS = 3 * 24 * 60 * 60 * 1000

/** 天数,向下取整——「不到一天」说成 0 天比说成 1 天诚实。 */
function daysSince(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / (24 * 60 * 60 * 1000)))
}

/** One commitment on the board. */
export interface BoardRow {
  readonly id: string
  readonly what: string
  readonly executorKind: 'agent' | 'human'
  readonly who: string
  /**
   * 何时 —— **两层** (v4.21 时间透镜两层规则)。
   *
   * `text` 是**当初说出口的那句话**（「下周初」「本周内」），它是真身；`ts` 是我们把
   * 它解析成时间戳的**投影**，解析不出来就没有这个字段。合成一个字符串的后果是：要么
   * 把「下周初」硬解析成一个人没承诺过的日期（拿我们的解析冒充他的承诺），要么整条
   * 失去可排序性。宁空勿错——**无戳的行沉底，但不消失**。
   */
  readonly due?: { readonly text: string; readonly ts?: number }
  readonly overdue: boolean
  readonly status: string
  readonly goalRef?: string
  readonly sessionId?: string
  readonly placeName?: string
  /** True when the card can be re-delivered into the place that owns it. */
  readonly remindable: boolean
  /**
   * 三值状态 (v4.12): 有证据 / 无信号 / 信号过时。
   *
   * **观察型承诺不能画成确定性的。** 一条人欠的事登记完就没有下文,和一条有回执
   * 有产物的事,在「进行中」这三个字底下长得一模一样——而它们是两种截然不同的
   * 处境:一个在走,一个可能早就没人在做了。「没消息」不等于「没问题」。
   *
   * 全部推导,不落任何字段:只有出生那一下 = 无信号(图上这个对象只有一个事件);
   * 有过后续但很久没动 = 信号过时;其余 = 有证据。
   */
  /**
   * 这一条**和查看者的关系** (v4.21 方向轴三元)。
   *
   * `mine` 我欠的 / `owed-to-me` 欠我的 / `observed` 我旁观的。第三格不是凑数：板 =
   * 查看者可见域的并集，**不是「公开承诺板」**，所以「我看得见但既不欠也不被欠」是一种
   * 真实且常见的关系——组织透明是特性不是缺陷。把它藏起来，板就变成了一份只有两栏的
   * 私人待办。
   *
   * 在服务端算而不是发原始 id 让界面猜：方向是**相对查看者**的判断，判断该和数据一起
   * 出厂，否则每个消费方都要重新发明一次「我是谁」。
   */
  /**
   * 交付被主张了，**等人验收** (v4.21 第一档⑥「验收断链接通」)。
   *
   * 承诺仍然 `open`——在有人验收之前它确实还欠着——所以这一格必须单独说出来，否则板上
   * 那条行看起来和「在跑」一模一样，而它其实在等你。断头路修好了，路标也得竖起来。
   *
   * （这个字段一度**只被生产、从没被声明**：`rows.push({...spread})` 里的展开不触发
   * 多余属性检查，于是运行时有、类型上没有，`bySignal` 也就看不见它。教训写在这儿：
   * 每一次文本替换都要断言它真的换到了东西，一次静默的空替换比一次报错贵得多。）
   */
  readonly awaitingAcceptance?: boolean
  readonly direction: 'mine' | 'owed-to-me' | 'observed'
  /**
   * 谁验收 —— **恒为人** (v4.21 责任锚两槽位)。
   *
   * 与「谁执行」正交：an agent cannot be held accountable（Linear 的 assign/delegate
   * 同构）。P1 里它就是当初签发这条承诺的人（§5.2 `allowedActors = 委派者 ∪ 操作者`）。
   * **等于查看者本人时不发**——本人省略，那一格留给真正需要说清的情形。
   */
  readonly acceptor?: string
  /**
   * 这条归谁管 —— **动词主权 = 节点主权的派生** (v4.22 裁决②).
   *
   * 有值 = 它的 owner 不是查看者，于是修理动词族与催**不渲染**（非灰化：灰按钮是
   * 「你不配」的展示；不渲染不禁言——人人可以在会话里直接说，系统只是不替无主权者
   * 造按钮）。**等于本人时不发**，和责任锚第二槽同一条纪律。
   *
   * 与 `acceptor` 是同一个人（承诺的 owner 既验收也修理），但它们回答的是两个问题，
   * 各有各的省略规则：`acceptor` 是「最后谁点头」，这一格是「现在谁动得了它」。
   */
  readonly stewardedBy?: string
  readonly signal: 'evidence' | 'silent' | 'stale'
  /** 最后一次有动静是什么时候——「无信号」必须说出它从什么时候起没信号。 */
  readonly lastSignalAt: number
  /** True when the goal link was inferred and still needs correcting. */
  readonly inferredGoal: boolean
  /**
   * This commitment IS a goal, and this is its body's URI in Yunzhijia.
   *
   * 「立目标」不是新动词 (v4.8): a goal is a compound commitment, so it is the
   * same row shape with one extra fact — which is why the board can group by
   * goal without a second kind of object to keep in step.
   */
  readonly isGoal?: string
  /** How the parent reference got here — 语境继承 / 显式 / 推断 / 事后补挂. */
  readonly attachedVia?: string
  /**
   * 过程摘要 — one line, and only one.
   *
   * 一跳可达、绝不搬运 (v4.9): the row links to the conversation, and this says
   * just enough to decide whether to make that hop. A digest of the trajectory
   * here would be the second timeline §7.4 forbids, growing until the goal view
   * has quietly become a worse copy of the topic.
   */
  readonly progress?: string
  /**
   * 幽灵承诺禁令: whether the person who owes this was actually told.
   *
   * Only ever set on a commitment minted from a proposal, where announcing was
   * part of the act. `failed` is the one the board has to shout about.
   */
  readonly notified?: 'sent' | 'failed'
  /**
   * 父目标已经结束了,而这条还挂在上面 (v4.12 级联).
   *
   * **显形,但不自动作废。** 摩擦刀在这里裁的是:目标死了不等于底下每件事都该停
   * ——有的确实白做了,有的另有价值,有的已经答应了别人。替人一键清掉,省下的是
   * 几次点击,拿走的是一次判断;而那次判断正是主权摩擦,该保留。
   *
   * 所以系统只负责让它**没法悄悄存在**:哪儿看得见这条,哪儿就看得见这句话。
   */
  readonly parentRetired?: boolean
}

/**
 * The board's GOALS projection.
 *
 * Goals and their children are resolved BY URI rather than by an edge: the
 * goal's body lives in a Yunzhijia document nobody here owns, and a child says
 * which document it serves. That is the whole join, and it is why declaring a
 * goal needs no new node type.
 */
export interface BoardGoal {
  /** The goal artifact's URI — the join key, and the thing that has no node. */
  readonly goalRef: string
  /** The commitment that DECLARED this goal, when one exists in view. */
  readonly row?: BoardRow
  readonly children: readonly BoardRow[]
  /** 聚合是信号不是状态 — counts, never a derived completion. */
  readonly counts: { readonly open: number; readonly overdue: number; readonly settled: number }
  /**
   * 产出归集 — the second hop (goal → commitments → what their topics made).
   *
   * A derived JOIN, not a stored list: the goal owns no artifacts, the work
   * under it does. Anything stored here would be a copy somebody has to keep
   * true, and 「不需要有人去维护目标」 is the验收句 this whole view is measured
   * against.
   */
  readonly artifacts: readonly GoalArtifactRow[]
  /** 磨出来的成功标准, as signed. Absent when the goal was declared without any. */
  readonly criteria?: string
  /** The most recent gap report, when one has been written (v4.10). */
  readonly assessment?: BoardAssessment
  /**
   * 图内最后一次有动静 (v4.12 staleness).
   *
   * 事实驱动,不是填表驱动:目标不会因为没人来更新它而显得停滞,它显得停滞是
   * 因为**底下真的三周没有任何轨迹**。这一条和「进度 60%」的根本差别在于,
   * 后者要有人去维护才为真,前者不维护也为真。
   */
  readonly lastActivityAt?: number
  /**
   * 成功标准变过,而最近这份简报是照着旧版写的 (真身之变 §1.9-4).
   *
   * 结论会过期,而过期的结论比没有结论更危险——它看起来仍然成立。
   *
   * 两条来源,任一成立即为真:我们那份**副本**变过(经我们的动词改的),或者
   * **真身本身**变过(agent 在消费时刻看出来的,`truth/changed`)。后者才是
   * 主线——设计说改成功标准就是去改云之家那份文档。
   */
  readonly criteriaDrifted?: boolean
  /** agent 最近一次看出真身被改动了,它当时说了什么。 */
  readonly truthChanged?: { readonly at: number; readonly detail: string }
}

/** One artifact produced under a goal. */
export interface GoalArtifactRow {
  readonly uri: string
  readonly title: string
  readonly action: string
  readonly time: number
  /**
   * Produced in a conversation that serves MORE than one goal.
   *
   * The second hop is goal→commitment→**topic**→artifact, because artifacts are
   * produced by topics — there is no commitment→artifact edge to walk. When two
   * commitments serving different goals were registered in one conversation
   * (the ordinary case in a busy group topic), its output cannot be attributed
   * to either of them. Dropping it would lose real work; claiming it silently
   * is what the drawer's own copy 「这些工件是这个目标下的工作留下的」 makes
   * false. So it is shown, and marked.
   */
  readonly shared?: boolean
}

/**
 * The latest gap report on a goal, as the board shows it.
 *
 * It lives on the board and not only in the conversation because the exit that
 * matters — 差距项一键变委派 — is the teleport, and the teleport lives here.
 * 评估喂回执行 is a loop, and a loop needs both ends in one place.
 */
export interface BoardAssessment {
  readonly id: string
  readonly summary: string
  readonly status: string
  readonly at: number
  /** Birth order. The only ranking key that a later answer cannot move. */
  readonly seq: number
  /** 这份简报当时照着哪一版标准写的——「结论还算不算数」全靠它回答。 */
  readonly criteriaBasis?: string
  /** 它躺在哪个会话里——决断层要能一跳过去答它。 */
  readonly sessionId?: string
  readonly lines: readonly {
    readonly criterion: string
    readonly verdict: string
    readonly evidence: string
  }[]
}

export interface BoardView {
  readonly rows: readonly BoardRow[]
  readonly goals: readonly BoardGoal[]
  /**
   * 无归属 — commitments serving no goal.
   *
   * 未挂是合法状态，不是错误 (v4.8): not all work serves a goal, and forcing
   * alignment produces garbage alignment. What this group buys is that the
   * alignment DEBT stops being invisible — it can be pulled up and re-linked
   * in a batch instead of being discovered a quarter later.
   */
  readonly unattached: readonly BoardRow[]
}

/**
 * 今天的一场会，读作**会前那一眼** (§5.6 事件枢纽).
 *
 * 时间、标题从平台读（真身在那儿），挂着什么、准备好没有从图读——两边都不抄对方。
 */
export interface BoardEvent {
  readonly eventId: string
  readonly title: string
  readonly startAt: number
  readonly endAt?: number
  /** 三档：齐了 / 还差一些 / 还没动。推导出来的，没有人维护它。 */
  readonly readiness: 'ready' | 'partial' | 'none'
  readonly readinessLine: string
  /*
    下面三样全是平台那条 `event list` **本来就回**的字段，不额外发请求。

    它们只在**看进去**的时候才用得上（会前那一眼一行放不下地点和描述），但为它们
    再打一次 `event get` 是拿一次网络往返换三个已经在手里的字符串。空串按没有算：
    平台用空串表示「没填」，而「没填」和「读不到」在界面上是两句不同的话。
  */
  readonly location?: string
  readonly organizer?: string
  /** 日程描述——材料清单写进去的就是这里，全参会人看得见的那一版。 */
  readonly description?: string
  /** 挂在这场会上的活。空数组 = 还没挂过东西，不是「没准备」。 */
  readonly prepares: readonly {
    readonly commitmentId: string
    readonly what: string
    readonly who: string
    readonly status: string
    /** 一跳可达：会前发现还差一件，下一步永远是去看那一件到哪儿了。 */
    readonly sessionId?: string
    readonly artifacts: readonly { readonly uri: string; readonly title: string }[]
  }[]
  /** 材料清单已经写进日程描述、全参会人看得到的那一版。 */
  readonly postedMaterials?: string
  /** 图上还没见过它——挂东西之前得先请它进来。 */
  readonly known: boolean
}

/**
 * 今天还没开完的会。
 *
 * **只读今天，且只读还没结束的。** 事件枢纽不是第二个日历：它回答的是「会前我该看
 * 什么」，而昨天的会没有会前可言。把范围放大到一周，这一段就会长成一个日程列表，
 * 而工作台上已经有一个够用的日历了——在云之家里。
 */
export async function eventsToday(ctx: Context, now = Date.now()): Promise<readonly BoardEvent[]> {
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return []
  const day = new Date(now)
  const pad = (part: number): string => String(part).padStart(2, '0')
  const today = `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000)
  const next = `${String(tomorrow.getFullYear())}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  const result = await bridge.run(
    ['calendar', 'event', 'list', '--start', today, '--end', next],
    { timeoutMs: 20_000 },
  )
  if (!result.ok || !Array.isArray(result.json)) return []

  const viewer: GraphViewer = { kind: 'operator', openId: '' }
  /*
    话题键 → 会话 id，一次建表。

    挂在会上的活各住各的话题，而「一跳过去看看它到哪儿了」要的是会话 id。和差距简报
    那一处同一个做法：图上记的是 topicKey，能导航的是 sessionId，中间这张表只有通道
    知道。
  */
  const sessionOfTopic = new Map<string, string>()
  for (const entry of ctx.get('yzjTopics')?.tree() ?? []) {
    for (const topic of entry.topics) sessionOfTopic.set(topic.topicKey, topic.sessionId)
  }
  /** 平台用空串表示「没填」——空串不是内容，别把它当一行渲染出去。 */
  const filled = (value: string | undefined): string | undefined => (
    value === undefined || value.trim() === '' ? undefined : value
  )
  const out: BoardEvent[] = []
  for (const row of result.json) {
    const record = asRecord(row)
    const eventId = asString(record?.id)
    if (eventId === undefined) continue
    const endAt = asNumber(record?.endDate)
    // 开完了的会没有会前可言。
    if (endAt !== undefined && endAt < now) continue
    const hub = eventHub(ctx, viewer, eventId)
    const location = filled(asString(record?.meetingPlace))
    const organizer = filled(asString(record?.personName))
    const description = filled(asString(record?.content))
    out.push({
      eventId,
      title: asString(record?.title) ?? eventId,
      startAt: asNumber(record?.startDate) ?? 0,
      ...(endAt === undefined ? {} : { endAt }),
      ...(location === undefined ? {} : { location }),
      ...(organizer === undefined ? {} : { organizer }),
      ...(description === undefined ? {} : { description }),
      readiness: hub?.readiness ?? 'none',
      readinessLine: hub === undefined
        // 图上没见过它 = 还没挂过东西，和「挂了但没动」是两回事。
        ? '还没挂任何要准备的事'
        : readinessLine(hub),
      prepares: (hub?.prepares ?? []).map((prep) => {
        const sessionId = prep.topicKey === undefined
          ? undefined
          : sessionOfTopic.get(prep.topicKey)
        return { ...prep, ...(sessionId === undefined ? {} : { sessionId }) }
      }),
      ...(hub?.postedMaterials === undefined ? {} : { postedMaterials: hub.postedMaterials }),
      known: hub !== undefined,
    })
  }
  out.sort((left, right) => left.startAt - right.startAt)
  return out
}

/** One artifact this topic produced or consumed. */
export interface ObjectRow {
  readonly uri: string
  readonly title: string
  readonly action: string
  readonly placeKey: string
  readonly time: number
}

/** One thing this deployment has learned and still believes. */
export interface MemoryRow {
  readonly id: string
  readonly axis: 'place' | 'entity' | 'org'
  readonly summary: string
  readonly scope: string
  /** Where it was learned. A distillation with no traceable source is a rumour. */
  readonly sourceAnchors: readonly string[]
}

/** The right column: what the flow has deposited as things. */
export interface ObjectFace {
  readonly current: readonly ObjectRow[]
  readonly memory: readonly MemoryRow[]
  /**
   * Live memories filed under OTHER places.
   *
   * An empty 记忆 tab and a lost memory look identical, and the operator has
   * no way to tell them apart — which is how place scoping gets reported as
   * "the memory disappeared". Saying how many are elsewhere turns an absence
   * into a fact with a reason.
   */
  readonly memoryElsewhere: number
  readonly resources: readonly ObjectRow[]
  /**
   * Where the three radii are centred. A panel whose contents depend on where
   * you stand has to say where it thinks you are standing — otherwise two
   * conversations showing the same list is indistinguishable from a bug.
   */
  readonly scope: {
    readonly kind: 'place' | 'local'
    readonly placeName?: string
  }
}

/**
 * The commitment board (§7.4 / 检验标准④).
 *
 * Everything the viewer can see,人 and agent side by side. The frame is what
 * makes "the department's commitments in one view" true — and it is a QUERY,
 * not a new kind of object, which is why it costs nothing to keep honest.
 */
export function boardView(ctx: Context): readonly BoardRow[] {
  return boardFrame(ctx).rows
}

/** The board as the view consumes it: the flat list plus its goal grouping. */
export function boardFrame(ctx: Context): BoardView {
  const topics = ctx.get('yzjTopics')
  const byTopic = new Map<string, TopicDescriptor>()
  for (const entry of topics?.tree() ?? []) {
    for (const topic of entry.topics) byTopic.set(topic.topicKey, topic)
  }
  const rows: BoardRow[] = []
  /** 一次渲染读一个「现在」——同一屏上两行按不同的此刻判过时,是没法解释的。 */
  const now = Date.now()
  /*
    **谁签发的这条承诺** —— 从内核记下的 actor 里读，不新加字段。

    承诺族上没有「委派者」这个字段，而方向轴（欠我的／我欠的）与责任锚（谁验收）
    都要它。内核给每条事件都记着 actor，`commitment/opened` 的那个 actor 就是当初
    签发它的人——事实一直在，只是没人读过。**不改 schema、不动生产者**：加一个字段
    意味着历史上所有承诺永远没有它，而从事件里读，老数据一样答得出来。
  */
  const openedBy = new Map<string, string>()
  /** openId → 名字。承诺登记时抄下的执行者名字，是这里唯一现成的名录。 */
  const nameOf = new Map<string, string>()
  for (const event of ctx.yzjGraph.rawEvents(['commitment/opened'])) {
    const data = asRecord(event.data)
    const id = asString(data?.commitmentId)
    const who = (event.actor as { openId?: string }).openId
    if (id !== undefined && typeof who === 'string' && who !== '') openedBy.set(id, who)
    const executor = asRecord(data?.executor)
    const openId = asString(executor?.openId)
    const name = asString(executor?.name)
    if (openId !== undefined && name !== undefined) nameOf.set(openId, name)
  }
  /*
    查看者是谁。

    `boardFrame` 此前不需要知道——它只是把图铺开。方向轴要求它知道：一条承诺是不是
    「我欠的」，答案取决于「我」是谁。桌面 actor 就是操作者本人（通道拿到身份之后设的，
    身份未知时它是一个 fail-closed 的空壳）。
  */
  const me = asString((ctx.yzjCards.desktopActor() as { openId?: string }).openId)
  /** commitment id → the topic it was registered in, for the artifact hop. */
  const topicOfRow = new Map<string, string>()
  for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'commitment' })) {
    const state = asRecord(object.state)
    const status = asString(state?.status) ?? 'open'
    const executor = asRecord(state?.executor)
    const kind = asString(executor?.kind) === 'human' ? 'human' as const : 'agent' as const
    /*
      Where it was PROMISED, falling back to where an agent executor runs.

      Reading `executor.topicKey` alone found only agent-executed rows — so a
      commitment somebody else owes had no session to open, and 「过程一跳可达」
      was unreachable for exactly the commitments the board exists for.
    */
    const topicKey = asString(state?.topicKey) ?? asString(executor?.topicKey)
    if (topicKey !== undefined) topicOfRow.set(object.id, topicKey)
    const topic = byTopic.get(topicKey ?? '')
    const due = asString(state?.due)
    const notified = asString(state?.notified)
    const progress = asString(state?.lastReceipt)
    /*
      三值状态,全部推导。

      `updatedSeq === createdSeq` 意思是这个对象**只发生过出生那一件事**——登记
      之后再没有任何东西碰过它。这是「无信号」的精确定义,而不是一个要谁去
      维护的字段;`updatedAt` 则回答「最后一次有动静是什么时候」,两句话合起来
      才说得清一条人欠的事此刻的处境。
    */
    /*
      动词主权 —— **这条归谁管** (v4.22 裁决②).

      只在**不归查看者本人**时下发，和责任锚第二槽同一条纪律：绝大多数行都归你自己，
      全都印一遍只会把真正要说清的那几行淹掉。

      `me === undefined` 是「不知道我是谁」，不是「不是你的」——身份未知的部署里全盘
      不渲染动词，等于把板变成一块只能看的牌子。三值纪律：看不了 ≠ 没有。
    */
    const delegatedBy = asString(state?.delegatedBy)
    const steward = me === undefined
      || ownsCommitment(me, delegatedBy === undefined ? {} : { delegatedBy })
      ? undefined
      // 名字取自登记时抄下的那份名录；查不到就用 openId——不猜，宁可难看。
      : nameOf.get(delegatedBy ?? '') ?? delegatedBy
    const silent = object.updatedSeq === object.createdSeq
    const lastSignalAt = silent ? object.createdAt : object.updatedAt
    const signal = silent
      ? 'silent' as const
      : now - lastSignalAt > STALE_MS ? 'stale' as const : 'evidence' as const
    rows.push({
      signal,
      lastSignalAt,
      ...(progress === undefined || progress === '' ? {} : { progress }),
      ...(notified === 'sent' || notified === 'failed'
        ? { notified: notified as 'sent' | 'failed' }
        : {}),
      id: object.id,
      what: asString(state?.what) ?? '',
      executorKind: kind,
      who: kind === 'human'
        ? asString(executor?.name) ?? asString(executor?.openId) ?? '某人'
        : 'agent',
      status,
      ...(due === undefined || due.trim() === '' ? {} : { due: dueOf(due) }),
      ...directionOf(me, asString(executor?.openId), openedBy.get(object.id), nameOf),
      ...(steward === undefined ? {} : { stewardedBy: steward }),
      ...(asRecord(state?.delivery) === undefined ? {} : { awaitingAcceptance: true }),
      overdue: status === 'open' && isOverdue(due, now),
      remindable: status === 'open' && (object.audience?.length ?? 0) > 0,
      inferredGoal: asString(state?.attachedVia) === 'inferred',
      ...(asString(state?.attachedVia) === undefined
        ? {}
        : { attachedVia: asString(state?.attachedVia) as string }),
      ...(asString(state?.parentGoalRef) === undefined
        ? {}
        : { goalRef: asString(state?.parentGoalRef) as string }),
      ...(asString(state?.goalRef) === undefined
        ? {}
        : { isGoal: asString(state?.goalRef) as string }),
      ...(topic === undefined ? {} : { sessionId: topic.sessionId, placeName: topic.groupName }),
    })
  }
  const sorted = [...rows].sort(bySignal(now))

  /*
    Group by URI. A goal row and its children meet because they name the same
    document, not because anything drew an edge between them — and a URI that
    no declared goal owns still groups (真身外部原则: the goal may simply live
    somewhere we were only told about).
  */
  const declared = new Map<string, BoardRow>()
  for (const row of sorted) if (row.isGoal !== undefined) declared.set(row.isGoal, row)
  /*
    A retired goal with nothing left under it stops holding a group.

    The board surfaces what is outstanding rather than keeping a complete
    archive, and an empty group for a goal somebody voided is a row that can
    only ever say "nothing here". A retired goal that still has work under it
    KEEPS its group — that work did not stop existing, and hiding it would be
    the one thing worse than an empty row.
  */
  const byGoal = new Map<string, BoardRow[]>()
  const unattached: BoardRow[] = []
  for (const row of sorted) {
    if (row.isGoal !== undefined && row.goalRef === undefined) continue
    if (row.goalRef === undefined) {
      unattached.push(row)
      continue
    }
    /*
      级联显形:父目标结束了,底下这条自己带上这句话。

      挂在 ROW 上而不是只挂在目标块上,因为这条承诺不止出现在目标底下——它也在
      「全部」那一屏、在收件箱、在它自己那间屋子里。信号跟着对象走,才不会出现
      「在这儿看得见、换个地方就看不见」。
    */
    const parent = declared.get(row.goalRef)
    const marked = parent !== undefined && parent.status !== 'open' && row.status === 'open'
      ? { ...row, parentRetired: true }
      : row
    const bucket = byGoal.get(row.goalRef) ?? []
    bucket.push(marked)
    byGoal.set(row.goalRef, bucket)
  }
  for (const [goalRef, row] of declared) {
    if (!byGoal.has(goalRef) && row.status === 'open') byGoal.set(goalRef, [])
  }

  /*
    第二跳，一次扫完.

    Every artifact-producing event is read ONCE and bucketed by the topic that
    produced it; each goal then picks up the buckets its children sit in. Asking
    per goal would re-scan the whole lineage log for every row on screen, on a
    view that refreshes every six seconds.
  */
  const artifactsByTopic = new Map<string, GoalArtifactRow[]>()
  for (const event of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    const data = asRecord(event.data)
    const topicKey = asString(data?.topicKey)
    const artifact = asRecord(data?.artifact)
    const uri = asString(artifact?.uri)
    if (topicKey === undefined || uri === undefined) continue
    const bucket = artifactsByTopic.get(topicKey) ?? []
    bucket.push({
      uri,
      title: asString(artifact?.title) ?? uri,
      action: asString(data?.action) ?? '产出',
      time: event.time,
      /*
        精确归属是常态，话题级是兜底 (v3.10 4h⑤)。

        带着 `taskId` 的产出说得出自己是**哪一件活**留下的；不带的只能按话题归集,
        而一个会话可以同时服务好几个目标——那时这条工件同时算进每一个，谁也说不清
        哪一份是哪一份的。所以「共用」从此不再取决于「这个话题恰好挂了几个目标」
        （那是一个碰巧为真的条件），而取决于**这条边自己有没有说清出处**。
      */
      ...(asString(data?.taskId) === undefined ? { shared: true } : {}),
    })
    artifactsByTopic.set(topicKey, bucket)
  }
  const latestAssessments = assessmentsByGoal(ctx)
  /*
    真身之变,一次扫完。

    `truth/changed` 是 agent 在消费时刻写下的:它去看过那份文档,发现版本变了。
    这里只负责把最近一条读出来——**判断早已经做完了**,页面不再自己去猜。
  */
  const truthChanges = new Map<string, { at: number; detail: string }>()
  for (const event of ctx.yzjGraph.rawEvents(['truth/changed'])) {
    const data = asRecord(event.data)
    const uri = asString(asRecord(data?.ref)?.uri)
    if (uri === undefined) continue
    const previous = truthChanges.get(uri)
    if (previous !== undefined && previous.at >= event.time) continue
    truthChanges.set(uri, { at: event.time, detail: asString(data?.detail) ?? '真身被改动过' })
  }

  const goals: BoardGoal[] = [...byGoal.entries()].map(([goalRef, children]) => {
    const seen = new Set<string>()
    const artifacts: GoalArtifactRow[] = []
    for (const child of children) {
      for (const artifact of artifactsByTopic.get(topicOfRow.get(child.id) ?? '') ?? []) {
        if (seen.has(artifact.uri)) continue
        seen.add(artifact.uri)
        artifacts.push(artifact)
      }
    }
    artifacts.sort((left, right) => right.time - left.time)
    const row = declared.get(goalRef)
    const criteria = row === undefined
      ? undefined
      : asString(asRecord(ctx.yzjGraph.rawObject('commitment', row.id)?.state)?.criteria)
    const assessment = latestAssessments.get(goalRef)
    /*
      最后一次有动静 = 子承诺的信号与产出时间取最大。

      目标自己没有心跳——它的生死全在底下那些事里。所以 staleness 是**读出来
      的**,不是谁去打的卡。
    */
    const lastActivityAt = [
      ...children.map(child => child.lastSignalAt),
      ...artifacts.map(artifact => artifact.time),
      ...(row === undefined ? [] : [row.lastSignalAt]),
    ].reduce<number | undefined>(
      (latest, at) => (latest === undefined || at > latest ? at : latest), undefined,
    )
    /*
      标准改过,而结论是照着旧版下的。

      比对的是简报当时记下的那一版正文(`criteriaBasis`)与此刻的标准。没有记
      基准的老简报不参与比对——把「不知道」说成「变了」会制造假警报,而假警报
      的代价是下一次真的变了时没人再看这一行。
    */
    const basis = assessment?.criteriaBasis
    const copyDrifted = basis !== undefined && criteria !== undefined && basis !== criteria
    /*
      真身在最近这份简报之后被改过——那份结论是照着另一版正文下的。

      比时间而不是比版本号:简报记下了它当时看到的版本,但一次「改动」是一个
      发生在某个时刻的事件,而「这份结论还算不算数」问的正是**它是不是在结论
      之后发生的**。
    */
    const change = truthChanges.get(goalRef)
    const truthDrifted = change !== undefined
      && (assessment === undefined || change.at > assessment.at)
    const drifted = copyDrifted || truthDrifted
    return {
      goalRef,
      ...(row === undefined ? {} : { row }),
      children,
      artifacts,
      ...(criteria === undefined ? {} : { criteria }),
      ...(assessment === undefined ? {} : { assessment }),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      ...(drifted ? { criteriaDrifted: true } : {}),
      ...(change === undefined ? {} : { truthChanged: change }),
      // 聚合是信号不是状态: counts inform, they never decide. The parent's
      // terminal state is always a human acceptance (Asana's own finding).
      counts: {
        open: children.filter(child => child.status === 'open' && !child.overdue).length,
        overdue: children.filter(child => child.overdue).length,
        settled: children.filter(child => child.status !== 'open').length,
      },
    }
  }).sort((left, right) => (
    right.counts.overdue - left.counts.overdue || right.counts.open - left.counts.open
  ))

  return { rows: sorted, goals, unattached }
}

/**
 * 空态三义 (v4.12):合并这三种就是撒谎。
 *
 * 一个目标底下什么都没在动,可能是三件完全不同的事——**在跑**(有东西刚动过)、
 * **停摆**(有事挂着,但全都在等别人)、**空转**(压根没有子承诺)。第三种是
 * 「你还没开始分活」,第二种是「你该去催了」,第一种是「不用管」。用一句
 * 「暂无进展」把三件事说成一件,读的人只能自己去猜是哪一件。
 */
export type GoalPulse = 'running' | 'stalled' | 'idle'

/** 目标页:承诺板的第二缩放级别 (v4.12 §7.6)。 */
export interface GoalPageView {
  readonly goal: BoardGoal
  /**
   * 决断层 = 收件箱同源可应答对象的**过滤投影**。
   *
   * 不是复制一份列表:同一个可应答对象,在收件箱里答和在这里答是同一次应答
   * (先答先赢)。所以这里只做过滤——把收件箱里属于这个目标的那些挑出来。
   */
  readonly decisions: readonly InboxItem[]
  readonly pulse: GoalPulse
  /** 图内多少天没有新轨迹。`undefined` = 底下还什么都没有过。 */
  readonly staleDays?: number
  /** 这个目标已经被作废——子承诺的级联在页面上显形，但不自动作废。 */
  readonly retired: boolean
  /** 目标的作废/验收理由,如果记了。 */
  readonly closedNote?: string
}


/**
 * 一个目标的全部子图,读作一页 (§7.6)。
 *
 * **和承诺板是同一个查询**——`boardFrame` 算一次,这里只是挑出一个目标再补三样
 * 板上不需要的派生：决断层、脉搏、停滞天数。这不是省事,是设计条款:「分活去
 * 哪、看进度看哪」的割裂之所以从根上不存在,正因为两级缩放读的是同一份数据;
 * 一旦这里另起一个查询,两级迟早会各说各话。
 */
export function goalPageFrame(ctx: Context, goalRef: string): GoalPageView | undefined {
  const board = boardFrame(ctx)
  const goal = board.goals.find(entry => entry.goalRef === goalRef)
  if (goal === undefined) return undefined

  /*
    子图的范围不止子承诺。

    目标自己那条登记(磨稿会话)和它的差距简报都住在别的会话里,而它们各自都
    可能正等着人答——把范围划成「只有子承诺所在的话题」,一份写好的简报就会
    在决断层里消失,而设计明写它属于那里。
  */
  const sessions = new Set(
    [
      ...goal.children.map(child => child.sessionId),
      goal.row?.sessionId,
      goal.assessment?.sessionId,
    ].filter((id): id is string => id !== undefined),
  )
  /*
    「有 demand 的行」= 决断层,不再是一份音调白名单 (v4.15 家族即接口)。

    白名单的问题不在它今天对不对,在于它是**第二处需要维护的名册**:家族增员时
    没人会想起来回这里补一个词,而漏掉的后果是一件等着人答的事在目标页上消失。
  */
  const decisions = inboxView(ctx).places
    .flatMap(place => place.topics)
    .filter(item => sessions.has(item.sessionId) && item.demand !== undefined)

  const open = goal.children.filter(child => child.status === 'open')
  const pulse: GoalPulse = goal.children.length === 0
    ? 'idle'
    : open.some(child => child.signal === 'evidence') ? 'running' : 'stalled'

  const retired = goal.row !== undefined && goal.row.status !== 'open'
  return {
    goal,
    decisions,
    pulse,
    retired,
    ...(goal.lastActivityAt === undefined
      ? {}
      : { staleDays: daysSince(goal.lastActivityAt, Date.now()) }),
  }
}

/**
 * The newest gap report per goal.
 *
 * Newest wins rather than "newest open": a report that has been accepted is
 * still the last thing anybody read about that goal, and hiding it the moment
 * it is answered would leave the row looking un-assessed the second after
 * somebody assessed it.
 */
function assessmentsByGoal(ctx: Context): Map<string, BoardAssessment> {
  const out = new Map<string, BoardAssessment>()
  const sessionOfTopic = new Map<string, string>()
  for (const entry of ctx.get('yzjTopics')?.tree() ?? []) {
    for (const topic of entry.topics) sessionOfTopic.set(topic.topicKey, topic.sessionId)
  }
  for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'assessment' })) {
    const state = asRecord(object.state)
    const goalRef = asString(state?.goalRef)
    if (goalRef === undefined) continue
    const previous = out.get(goalRef)
    /*
      Newest by BIRTH, and ranked by SEQ.

      Two bugs in one line. `updatedAt` moves when a report is ANSWERED, so
      pressing 「继续」 on a January card made January the board's current
      reading again — stale summary, stale lines, and a live 「变委派 ↗」 on
      every gap that had been closed in February. And a wall-clock comparison
      ties when two reports land in the same millisecond, at which point the
      winner is decided by `query`'s iteration order — which is `updatedSeq`
      descending, i.e. by last touch again, through the back door.

      `createdSeq` is monotonic and never moves. It is the only key here that
      means what the comment says.
    */
    if (previous !== undefined && previous.seq >= object.createdSeq) continue
    const raw = state?.lines
    out.set(goalRef, {
      id: object.id,
      summary: asString(state?.summary) ?? '',
      status: asString(state?.status) ?? 'open',
      at: object.createdAt,
      seq: object.createdSeq,
      ...(asString(state?.criteriaBasis) === undefined
        ? {}
        : { criteriaBasis: asString(state?.criteriaBasis) as string }),
      ...(sessionOfTopic.get(asString(state?.topicKey) ?? '') === undefined
        ? {}
        : { sessionId: sessionOfTopic.get(asString(state?.topicKey) ?? '') as string }),
      lines: (Array.isArray(raw) ? raw : []).map((line) => {
        const entry = asRecord(line)
        return {
          criterion: asString(entry?.criterion) ?? '',
          verdict: asString(entry?.verdict) ?? 'missing',
          evidence: asString(entry?.evidence) ?? '',
        }
      }),
    })
  }
  return out
}

/**
 * The right column, in three radii around ONE point: where you are standing.
 *
 * The panel says 「跟会话走」, and for a while it did not: 资源 was every
 * artifact the account had ever produced and 记忆 was every memory it had ever
 * kept, so the column looked identical in every topic and in every local
 * session — which reads as a broken panel, and hides the thing it exists to
 * show.
 *
 * So the three tabs are the same question asked at growing radius:
 *
 * - **当前** — what THIS conversation produced;
 * - **资源** — what this PLACE produced (all its topics). A local session has
 *   no place, so its neighbours are the other local sessions: everything made
 *   at this desk outside any group;
 * - **记忆** — what holds HERE. The place axis is filtered to this place; the
 *   entity and org axes are the account's and always apply.
 *
 * The memory filter mirrors `scopeFor` on the write side exactly. They have to
 * agree: a lesson filed under a coordinate the reader never asks for is a
 * lesson that can be written and never read back.
 */
export function objectFace(
  ctx: Context,
  topic: TopicDescriptor | undefined,
  sessionId?: string,
): ObjectFace {
  /** How lineage names a conversation: the topic, or the desk session itself. */
  const ownKey = topic?.topicKey
    ?? (sessionId === undefined ? undefined : `session:${sessionId}`)
  const here = topic?.placeKey

  // topicKey → placeKey, so 资源 can be this place's pool rather than a dump of
  // everything the account ever made.
  const placeOfTopic = new Map<string, string>()
  for (const branch of ctx.get('yzjTopics')?.tree() ?? []) {
    for (const entry of branch.topics) placeOfTopic.set(entry.topicKey, entry.placeKey)
  }

  const nearby: ObjectRow[] = []
  const current: ObjectRow[] = []
  for (const event of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    const data = asRecord(event.data)
    const artifact = asRecord(data?.artifact)
    const uri = asString(artifact?.uri)
    const placeKey = asString(artifact?.placeKey)
    if (uri === undefined || placeKey === undefined) continue
    const producedIn = asString(data?.topicKey) ?? ''
    const mine = ownKey !== undefined && producedIn === ownKey
    // A desk session's neighbours are the other desk sessions — they share no
    // room, which is exactly what they have in common.
    const neighbour = here === undefined
      ? producedIn.startsWith('session:')
      : placeOfTopic.get(producedIn) === here
    if (!mine && !neighbour) continue
    const row: ObjectRow = {
      uri,
      title: asString(artifact?.title) ?? uri,
      action: asString(data?.action) ?? '产出',
      placeKey,
      time: event.time,
    }
    nearby.push(row)
    if (mine) current.push(row)
  }

  // Objects rather than raw events: a memory that was forgotten must actually
  // leave this panel, and reading the event stream would keep showing it.
  const memory: MemoryRow[] = []
  let elsewhere = 0
  for (const object of ctx.yzjGraph.query(
    { kind: 'operator', openId: '' }, { kind: 'memory', status: ['live'] },
  )) {
    const state = asRecord(object.state)
    const raw = asString(state?.axis)
    const axis = raw === 'entity' || raw === 'org' ? raw : 'place'
    const scope = asString(state?.scope) ?? ''
    // A convention learned in one group does not hold in another, and holds in
    // no local session at all — there is no place there for it to be about.
    if (axis === 'place' && scope !== here) {
      elsewhere += 1
      continue
    }
    const anchors = Array.isArray(state?.sourceAnchors) ? state.sourceAnchors : []
    memory.push({
      id: object.id,
      axis,
      summary: asString(state?.summary) ?? '',
      scope,
      sourceAnchors: anchors.filter((value): value is string => typeof value === 'string'),
    })
  }

  return {
    current,
    memory,
    memoryElsewhere: elsewhere,
    resources: nearby.slice(-60).reverse(),
    scope: {
      kind: here === undefined ? 'local' : 'place',
      ...(topic === undefined ? {} : { placeName: topic.groupName }),
    },
  }
}

/**
 * Assemble the inbox from the graph plus the channel's topic index.
 *
 * One pass over the answerable objects gives every topic its tone; the tree is
 * then grouped by place, sorted by urgency, and thinned by the attention lease.
 */
export function inboxView(ctx: Context): InboxView {
  const topics = ctx.get('yzjTopics')
  const tree = topics?.tree() ?? []
  const viewer: GraphViewer = { kind: 'operator', openId: '' }

  /**
   * topicKey → the loudest DEMAND, plus whether work is live right now.
   *
   * Loudest-wins is right for the badge: a pending confirmation must never be
   * hidden behind the fact that the same topic also has work running. But a
   * topic can be two things at once, and collapsing them to one lost the fact
   * the operator cares about most in the second after they press send.
   *
   * Caught in use: send `@next …` into a topic that already had an unaccepted
   * task, and the row answers 待验收 — with the OLD task's summary — which
   * reads as "your new request was finished instantly". Both facts are true;
   * the row now carries both, and the preview follows the live one, because
   * the newest thing is what somebody who just pressed send is looking for.
   */
  interface Loudest {
    tone: TopicTone
    preview: string
    live: boolean
    badge?: string
    demand?: AnswerableDemand
  }
  const state = new Map<string, Loudest>()
  const note = (
    topicKey: string | undefined,
    tone: TopicTone,
    preview: string,
    demand?: AnswerableDemand,
  ): void => {
    if (topicKey === undefined) return
    const current = state.get(topicKey)
    const live = (current?.live ?? false) || tone === 'running'
    if (current !== undefined && TONE_RANK[current.tone] <= TONE_RANK[tone]) {
      // Louder tone stands, but a live topic says so — and while work is in
      // flight the preview describes THAT, not a demand left over from before.
      state.set(topicKey, {
        ...current,
        preview: tone === 'running' ? preview : current.preview,
        live,
      })
      return
    }
    state.set(topicKey, {
      tone,
      preview,
      live,
      /*
        徽标跟着**模式**走，不跟着音调走——徽标由服务端算好带过来。

        音调只有两档（要不要你放行 / 要不要你判行不行），够排序用；徽标要说清那件事
        叫什么：待裁决、待签发、待答各是各的。让徽标退回音调，六种模式会被压成两个词，
        而分类学的全部用处正是让它们分得开。
      */
      ...(demand === undefined ? {} : { badge: demand.badge, demand }),
    })
  }

  /*
    决断层：**一个抽象查询，零类型枚举** (v4.15 家族即接口)。

    这里此前是六段 `query({kind, status})`,每段自己拼一句中文——一份名单,而
    名单的失败方式是安静的少一种。现在问的是「谁还在等人答」,由家族自己回答它
    在等什么、字面怎么写。定向询问过门、转办认领上线那天,这段一行不改。

    只收 `blocking`。**默认生效可纠**(挂接推断 ack、回执提议、蒸馏公示)与
    **信号**(逾期、老化、真身之变)都不进——把可纠升格成待答,人就得为每一个
    默认值签一次字,零维护当场阵亡。
  */
  for (const pending of ctx.yzjCards.demands(viewer)) {
    if (pending.demand.layer !== 'blocking') continue
    note(pending.topicKey, toneOf(pending.demand.mode), pending.demand.label, pending.demand)
  }
  /*
    留意层：进行中与等待中。

    这两档**不是**可应答对象,所以它们不在上面那个查询里,也不该在——决断面只
    收「等你答」的东西。它们要的是被看见,不是被裁决,所以各自单独问一次。
    (waiting 家族自己声明了 `layer: 'signal'`,说的就是这件事。)
  */
  for (const object of ctx.yzjGraph.query(viewer, { kind: 'task', status: ['open', 'rework'] })) {
    const data = asRecord(object.state)
    note(asString(data?.topicKey), 'running', `运行中：${asString(data?.what) ?? ''}`)
  }
  for (const object of ctx.yzjGraph.query(viewer, { kind: 'waiting', status: ['open', 'escalated'] })) {
    const data = asRecord(object.state)
    note(asString(data?.topicKey), 'waiting', `等待中：${asString(data?.what) ?? ''}`)
  }

  const counts = { confirm: 0, review: 0, running: 0 }
  const firstOf: Partial<Record<TopicTone, string>> = {}

  const places: InboxPlace[] = tree.map((entry) => {
    const kind = entry.topics[0]?.conversationKind ?? 'group'
    const rows: InboxItem[] = entry.topics.map((topic) => {
      const current = state.get(topic.topicKey)
      const tone = current?.tone ?? 'idle'
      return {
        sessionId: topic.sessionId,
        placeKey: topic.placeKey,
        title: topic.label || '（无标题）',
        placeName: topic.groupName,
        preview: clip(current?.preview ?? '已归档 · 在群视图里还找得到'),
        tone,
        // Two truths, not one: a topic can owe you an answer AND be working.
        live: current?.live ?? false,
        // 家族可以自己写徽标：模式相同而「等的是什么」不同时（冲突待裁 vs 待确认），
        // 这一个字段就是它们在一屏上分得开的全部理由。
        badge: current?.badge ?? TONE_BADGE[tone],
        ...(current?.demand === undefined ? {} : { demand: current.demand }),
      }
    })
    for (const row of rows) {
      if (row.tone === 'confirm') counts.confirm += 1
      if (row.tone === 'review') counts.review += 1
      if (row.tone === 'running') counts.running += 1
      if (firstOf[row.tone] === undefined) firstOf[row.tone] = row.sessionId
    }
    rows.sort((left, right) => TONE_RANK[left.tone] - TONE_RANK[right.tone])
    // 注意力租约: inside a real place a settled topic releases its row — it is
    // not gone, it is in the place's own view, where the archive belongs. A
    // direct chat has no group view to be archived into, so it keeps its rows.
    const visible = kind === 'group' ? rows.filter(row => row.tone !== 'idle') : rows
    const head = visible[0]
    return {
      placeKey: entry.place.placeKey,
      groupName: entry.place.groupName,
      conversationKind: kind,
      tone: head?.tone ?? 'idle',
      /*
        场所徽标说的必须**就是**它下面第一行说的那句 (v4.14 逐级兑付)。

        自己按音调再拼一次,徽标就会和它兑付到的那一行说两种话:头上写「待确认」,
        点进去第一件事是「冲突待裁」。信号即门的意思是每一跳落在哪儿都算数。
      */
      badge: head?.badge ?? TONE_BADGE.idle,
      archived: rows.length - visible.length,
      topics: visible,
    }
  })

  let open = 0
  let overdue = 0
  /*
    「全部子承诺终态」→ 该评估了 (v4.10 推的那一半).

    The design pairs a PULL trigger (say 「评估一下」 in the goal's context) with
    a PUSH one, and this is the push: a goal whose children have all reached a
    terminal state is asking to be looked at, and nobody should have to keep
    checking whether that moment has arrived. That is the difference between
    零维护 and 「记得去看一眼」.

    Deliberately a COUNT and not a list: 收件箱 is 注意力, and a fourth list
    would be a fourth place to keep in step. It says how many, and the board is
    one click away.
  */
  const childrenOf = new Map<string, { total: number; settled: number }>()
  const openGoals: string[] = []
  // 同一次读用同一个「现在」——见 `isOverdue`。
  const now = Date.now()
  for (const object of ctx.yzjGraph.query(viewer, { kind: 'commitment' })) {
    const state = asRecord(object.state)
    const status = asString(state?.status) ?? 'open'
    if (status === 'open') {
      open += 1
      if (isOverdue(asString(state?.due), now)) overdue += 1
    }
    const own = asString(state?.goalRef)
    if (own !== undefined && status === 'open') openGoals.push(own)
    const parent = asString(state?.parentGoalRef)
    if (parent === undefined || parent === '') continue
    const bucket = childrenOf.get(parent) ?? { total: 0, settled: 0 }
    bucket.total += 1
    if (status !== 'open') bucket.settled += 1
    childrenOf.set(parent, bucket)
  }
  // A goal with no children yet is not "done", it is unstarted — counting it
  // would put every freshly declared goal into the operator's attention.
  const toAssess = openGoals.filter((ref) => {
    const bucket = childrenOf.get(ref)
    return bucket !== undefined && bucket.total > 0 && bucket.total === bucket.settled
  }).length

  return {
    counts,
    firstOf,
    places,
    aliases: topics?.aliases() ?? [],
    conversations: (topics?.conversations() ?? []).map(row => ({
      placeKey: row.placeKey,
      name: row.name,
      kind: row.kind,
      lastMsgTime: row.lastMsgTime,
      preview: row.preview,
      unread: row.unread,
      ...(row.avatarUrl === undefined ? {} : { avatarUrl: row.avatarUrl }),
      onDuty: row.onDuty,
      selfChat: row.selfChat,
    })),
    topicSessionIds: tree.flatMap(entry => entry.topics.map(topic => topic.sessionId)),
    commitments: { open, overdue, toAssess },
  }
}

/** One line, or it stops being a preview and becomes a paragraph. */
function clip(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length <= 48 ? flat : `${flat.slice(0, 48)}…`
}

/**
 * The answerable objects belonging to one topic.
 *
 * They are rendered INSIDE the stream rather than in a side panel: a
 * confirmation is part of the conversation that produced it, and moving it
 * elsewhere is how "please confirm" ends up orphaned from its own context.
 */
export function cardsFor(ctx: Context, topic: TopicDescriptor | undefined): StreamCard[] {
  if (topic === undefined) return []
  const viewer: GraphViewer = { kind: 'operator', openId: topic.groupId }
  const out: StreamCard[] = []
  /*
    遍历**已注册的卡类型**，而不是一份手写的名单 (v4.15 家族即接口)。

    那份名单曾经漏掉过 assessment ——一份写好的差距简报因此在流里根本不出现,
    而它明明是决断层的一员。名单不会报错,只会安静地少一种。注册表会。
  */
  for (const kind of ctx.yzjCards.types()) {
    for (const object of ctx.yzjGraph.query(viewer, { kind })) {
      const state = asRecord(object.state)
      const owner = asString(state?.topicKey)
        ?? asString(asRecord(state?.executor)?.topicKey)
      if (owner !== topic.topicKey) continue
      const definition = ctx.yzjCards.definitionOf(kind)
      if (definition === undefined) continue
      const demand = ctx.yzjCards.demandOf(object)
      out.push({
        kind,
        id: object.id,
        state: object.state,
        at: object.createdAt,
        seq: object.createdSeq,
        resolved: definition.isResolved(object.state as never),
        ...(demand === undefined ? {} : { demand }),
        actions: definition.actions.map(action => ({
          id: action.id,
          label: action.label,
          ...(action.style === undefined ? {} : { style: action.style }),
          needsInput: action.needsInput === true,
          available: action.available === undefined
            ? true
            : action.available(object.state as never),
        })),
      })
    }
  }
  return out
}

/** Assemble one session's window. Exported so a spec can drive it directly. */
export async function fusedWindow(
  ctx: Context,
  sessionId: string,
  windowSize: number,
): Promise<FusedWindow> {
  const topics = ctx.get('yzjTopics')
  const topic = topics?.topicOf(sessionId)
  const chips = chipsFor(ctx, topic)
  const cards = cardsFor(ctx, topic)
  const artifacts = artifactsFor(ctx, topic)
  const aliases = topics?.aliases() ?? []
  if (topics === undefined || topic === undefined) {
    return { messages: [], chips, cards, artifacts, aliases }
  }
  const context = goalContextOf(ctx, topic.topicKey)
  try {
    return {
      topic, chips, cards, artifacts, aliases,
      ...(context === undefined ? {} : { goalContext: context }),
      messages: await topics.messagesFor(sessionId, windowSize),
    }
  } catch (error) {
    return {
      topic,
      chips,
      cards,
      aliases,
      artifacts,
      ...(context === undefined ? {} : { goalContext: context }),
      messages: [],
      staleReason: error instanceof Error ? error.message : String(error),
    }
  }
}

/** What this conversation is armed with, straight off the graph. */
function goalContextOf(
  ctx: Context,
  topicKey: string,
): { readonly goalRef: string; readonly goalName?: string } | undefined {
  const state = asRecord(ctx.yzjGraph.rawObject('goal-context', topicKey)?.state)
  const goalRef = asString(state?.goalRef)
  // Disarming appends an EMPTY ref rather than deleting the object (更正即追加),
  // so absence is not the only way to carry nothing.
  if (goalRef === undefined || goalRef === '') return undefined
  const goalName = asString(state?.goalName)
  return { goalRef, ...(goalName === undefined ? {} : { goalName }) }
}

export function applySurfaceRpc(ctx: Context, windowSize: number, stealth = false): void {
  // `yzjCards` alongside `connection`: the scoped context is what every
  // handler runs on, and a property read without its injection throws at
  // request time — for topics that have cards only, which is the worst
  // possible place to discover it.
  ctx.inject(['connection', 'yzjCards'], (scoped) => {
    scoped.connection.rpc.handle(
      '/yzj-next-surface',
      async (endpoint: string, payload: unknown): Promise<RpcResult> => {
        switch (endpoint) {
          case 'fused': {
            const sessionId = stringField(payload, 'sessionId')
            if (sessionId === undefined) return failure('fused requires sessionId')
            return { ok: true, value: await fusedWindow(scoped, sessionId, windowSize) }
          }
          case 'send-to-place': {
            const sessionId = stringField(payload, 'sessionId')
            const text = stringField(payload, 'text')
            if (sessionId === undefined || text === undefined) {
              return failure('send-to-place requires sessionId and text')
            }
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) return failure('云之家通道未就绪')
            try {
              // 回复 = 挂链 (v4.7): the landing point travels with the send.
              const replyTo = stringField(payload, 'replyTo')
              return { ok: true, value: await topics.sendToPlace(sessionId, text, replyTo) }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          case 'light-ask': {
            const sessionId = stringField(payload, 'sessionId')
            const text = stringField(payload, 'text')
            if (sessionId === undefined || text === undefined) {
              return failure('light-ask requires sessionId and text')
            }
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) return failure('云之家通道未就绪')
            try {
              return { ok: true, value: { answer: await topics.lightAsk(sessionId, text) } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          case 'card-act': {
            const kind = stringField(payload, 'kind')
            const id = stringField(payload, 'id')
            const actionId = stringField(payload, 'actionId')
            if (kind === undefined || id === undefined || actionId === undefined) {
              return failure('card-act requires kind, id and actionId')
            }
            const result = await scoped.yzjCards.act(
              { kind, id }, actionId, scoped.yzjCards.desktopActor(), 'desktop',
              stringField(payload, 'input'),
            )
            return { ok: true, value: { receipt: result.receipt, outcome: result.outcome } }
          }
          case 'memory-forget': {
            // The operator's half of `memory_forget`. Both halves exist for the
            // same reason the card verbs do: whoever notices the convention has
            // gone stale must be able to retire it where they noticed it.
            const memoryId = stringField(payload, 'memoryId')
            if (memoryId === undefined) return failure('memory-forget requires memoryId')
            const object = scoped.yzjGraph.rawObject('memory', memoryId)
            if (object === undefined) return failure(`找不到记忆 ${memoryId}`)
            await scoped.yzjGraph.append({
              type: 'memory/forgotten',
              data: {
                memoryId,
                reason: stringField(payload, 'reason') ?? '操作者在桌面移除',
              },
              actor: scoped.yzjCards.desktopActor(),
            })
            return { ok: true, value: { memoryId } }
          }
          /*
            `commitment-remind` **已废** (v4.21 第一档①「催办统一」).

            它做的事是：点一下，系统以操作者的名义把承诺卡重新投进登记它的那个群。
            省下的是打字，付出的是**「谁在说话」不再由说话的人决定**——群里的人看到
            的是你在催，而你只点了一颗按钮，甚至没看见催出去的是什么。B4 禁令挡的正是
            这个，而它在板上一直没有兑现。

            替代品不在这里，在板上：催 = **拟稿 + 传送门 + 你自己发**（`Board.tsx`
            的 `nudge`）。端点整个删掉而不是留着不调用——留着的路早晚会被再接上，而
            那时它看起来会像一次「复用」。
          */
          case 'board':
            return { ok: true, value: boardFrame(scoped) }
          /**
           * 立目标 —— the board form of the registration verb (v4.8).
           *
           * Not a new verb and not a new node: it appends the same
           * `commitment/opened` the conversation路径 appends, with the goal's
           * own URI on it. The iron law is 人签发 — this endpoint is reachable
           * only from the desktop, which IS the operator, and the agent has no
           * tool that can write one.
           */
          case 'declare-goal': {
            const what = stringField(payload, 'what')
            const goalRef = stringField(payload, 'goalRef')
            const owner = stringField(payload, 'owner')
            if (what === undefined || goalRef === undefined) {
              return failure('立目标需要目标名和真身链接')
            }
            const due = stringField(payload, 'due')
            /*
              磨点在「可验收」(v4.10).

              The criteria are the operator's own words at the moment they
              signed, kept here because the assessment has to compare against
              SOMETHING and the goal's real body is not readable from this
              process yet. The body of them belongs in the Yunzhijia document —
              this copy is a P1 降级形态, and the declare sheet says so where
              the operator can read it.
            */
            const criteria = stringField(payload, 'criteria')
            /*
              出生血缘指向磨稿会话 (v4.10).

              A goal ground out in a conversation and then declared from the
              board used to be anchored at 「desktop:board」 — which is true and
              useless. Carrying the session makes "where did this goal come
              from" answerable, and the drafting turn is exactly what somebody
              re-reads when the goal stops making sense in month three.
            */
            const from = stringField(payload, 'sessionId')
            const commitmentId = goalCommitmentIdFor(goalRef)
            /*
              One URI, one goal — and declaring the same one twice must not
              overwrite it.

              The id is derived from the URI, so a second declaration folds
              onto the SAME object: it would rewrite the name, the owner and
              the anchor of a goal that already has children hanging off it,
              and a voided goal would come back open because `opened` carries
              `status: 'open'`. Neither is recoverable through any surface.
            */
            const existing = scoped.yzjGraph.rawObject('commitment', commitmentId)
            if (existing !== undefined) {
              const status = asString(asRecord(existing.state)?.status) ?? 'open'
              const named = asString(asRecord(existing.state)?.what) ?? goalRef
              return failure(status === 'open'
                ? `这个真身已经立过目标了：「${named}」。改名字请在那条目标上改，不要重立。`
                : `这个真身上的目标已${status === 'voided' ? '作废' : '结束'}（「${named}」），不能用同一个链接重开。`)
            }
            try {
              await scoped.yzjGraph.append({
                type: 'commitment/opened',
                data: {
                  commitmentId,
                  what,
                  goalRef,
                  // The owner carries it. A goal with no owner is a wish.
                  executor: { kind: 'human', openId: owner ?? 'op-1', name: owner ?? '我' },
                  sourceAnchor: from === undefined ? 'desktop:board' : `session:${from}`,
                  attachedVia: 'explicit',
                  // 幂等锚: declaring the same goal twice is one goal.
                  idemKey: `goal:${goalRef}`,
                  ...(due === undefined ? {} : { due }),
                  ...(criteria === undefined ? {} : { criteria }),
                },
                actor: scoped.yzjCards.desktopActor(),
              })
              return { ok: true, value: { commitmentId } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 语境装载 —— 挂接引用是语境的属性 (v4.9 出生时刻).
           *
           * The portal's chip becomes a fact about the CONVERSATION at the
           * moment the operator speaks in it: from then on, every commitment
           * registered there inherits the goal without anybody naming it
           * again. That is what 「挂接零操作」 means mechanically — and it is
           * inheritance rather than inference precisely because a person put
           * it there.
           *
           * Armed on SEND, not on arrival. Teleporting into a conversation and
           * saying nothing must leave no trace; a chip somebody looked at and
           * closed is not a decision about what that room is working on.
           */
          case 'arm-topic-goal': {
            const sessionId = stringField(payload, 'sessionId')
            const goalRef = stringField(payload, 'goalRef')
            if (sessionId === undefined) return failure('装载语境需要 sessionId')
            const topic = scoped.get('yzjTopics')?.topicOf(sessionId)
            if (topic === undefined) return failure('这不是一个云之家话题，无法装载目标语境')
            try {
              await scoped.yzjGraph.append(goalRef === undefined
                ? {
                  type: 'goal-context/cleared',
                  data: { topicKey: topic.topicKey },
                  actor: scoped.yzjCards.desktopActor(),
                }
                : {
                  type: 'goal-context/armed',
                  data: {
                    topicKey: topic.topicKey,
                    goalRef,
                    ...(stringField(payload, 'goalName') === undefined
                      ? {}
                      : { goalName: stringField(payload, 'goalName') as string }),
                  },
                  actor: scoped.yzjCards.desktopActor(),
                })
              return { ok: true, value: { topicKey: topic.topicKey } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 移出目标 —— the way back out of a link.
           *
           * 环路完整性检验 (§5.5): every action needs an exit, and batch
           * attaching without a way to detach is a one-way door. 未挂是合法
           * 状态, so returning work to 无归属 is a legal transition rather than
           * an undo — which is why it is recorded as its own event.
           */
          case 'unlink-commitments': {
            const raw = (payload as { ids?: unknown }).ids
            const ids = Array.isArray(raw) ? raw.filter(id => typeof id === 'string') : []
            if (ids.length === 0) return failure('移出需要至少一条承诺')
            const unknown = ids.filter(id => scoped.yzjGraph.rawObject('commitment', id) === undefined)
            if (unknown.length > 0) return failure(`找不到承诺：${unknown.join('、')}`)
            /*
              摘除的主权 = **该承诺所挂目标的 owner 或承诺 owner** (v4.22)。

              这里只查后者：目标那一半要先读出承诺挂在哪、再读那个目标是谁签发的，
              而目标 owner 恰恰是我们已经在板上算过的东西——真要放宽，该在这个函数
              里显式加那一支，而不是让它默默地宽着。**先严后宽**：多说一句拒绝的话
              可以改，误删一条边的账改不回来。
            */
            for (const id of ids) {
              const refused = refuseUnlessSteward(scoped, id, '摘除')
              if (refused !== undefined) return refused
            }
            try {
              for (const commitmentId of ids) {
                await scoped.yzjGraph.append({
                  type: 'commitment/updated',
                  // Provenance goes with the reference. Leaving `linked`
                  // behind put 「事后补挂」 on a row sitting in 无归属.
                  data: { commitmentId, parentGoalRef: '', attachedVia: 'detached' },
                  actor: scoped.yzjCards.desktopActor(),
                })
              }
              return { ok: true, value: { unlinked: ids.length } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 作废一条承诺 —— including a goal declared here.
           *
           * A goal declared from the board has no card in any place's stream,
           * so the keyword route that retires every other commitment cannot
           * reach it. Without this the 立目标 button would be a door that only
           * opens one way.
           */
          case 'void-commitment': {
            const id = stringField(payload, 'id')
            if (id === undefined) return failure('作废需要承诺 id')
            const target = scoped.yzjGraph.rawObject('commitment', id)
            if (target === undefined) return failure(`找不到承诺：${id}`)
            // 作废 is for something still outstanding. Letting it run on a
            // settled commitment turned 已完成 into 已作废 with one press.
            const current = asString(asRecord(target.state)?.status) ?? 'open'
            if (current !== 'open') return failure(`这条承诺已经${current === 'closed' ? '完成' : '结束'}了，不能再作废。`)
            const refused = refuseUnlessSteward(scoped, id, '作废')
            if (refused !== undefined) return refused
            try {
              await scoped.yzjGraph.append({
                type: 'commitment/voided',
                data: { commitmentId: id, cause: stringField(payload, 'reason') ?? '操作者在承诺板作废' },
                actor: scoped.yzjCards.desktopActor(),
              })
              return { ok: true, value: { id } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 顺延期限 —— 承诺还在，日子改了 (v4.12 修理动词族).
           *
           * **顺延期限与顺延提醒是两个动词。** 改期限是公事:那是当初对着一屋子
           * 人说出口的日子,改它等于改一次公开承诺,所以它落在图上、进回执、
           * 别人看得见。改提醒是私事——「这条先别再烦我」——它只动操作者自己的
           * 计划,不该让承诺看起来被推迟了。把两者合成一个按钮,就是让一次私下
           * 的「我知道了」冒充一次公开的改期。
           *
           * 这里只做前者。后者要有 scheduler 才谈得上,而这套系统里还没有。
           */
          case 'postpone-commitment': {
            const id = stringField(payload, 'id')
            const due = stringField(payload, 'due')
            if (id === undefined || due === undefined) return failure('顺延需要承诺 id 与新的期限')
            const target = scoped.yzjGraph.rawObject('commitment', id)
            if (target === undefined) return failure(`找不到承诺：${id}`)
            const status = asString(asRecord(target.state)?.status) ?? 'open'
            if (status !== 'open') return failure('这条承诺已经结束了，改期限没有意义。')
            const refused = refuseUnlessSteward(scoped, id, '顺延')
            if (refused !== undefined) return refused
            try {
              await scoped.yzjGraph.append({
                type: 'commitment/updated',
                data: { commitmentId: id, due },
                actor: scoped.yzjCards.desktopActor(),
              })
              return { ok: true, value: { id, due } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 合并 —— 两个人在做同一件事 (v4.12).
           *
           * 「不自动合但必须能手动合」的兑现。相似度分数永远不该替人做这个判断:
           * 两条听上去一样的登记可能是同一件事,也可能是两个部门各自要一份;
           * 分辨它们靠的是场上的语境,不是字符串距离。所以合并是一个**人的动词**,
           * 而墓碑律保证被合掉的那条从此不再被任何动词唤醒。
           */
          case 'merge-commitment': {
            const id = stringField(payload, 'id')
            const into = stringField(payload, 'into')
            if (id === undefined || into === undefined) return failure('合并需要两条承诺的 id')
            if (id === into) return failure('不能把一条承诺合并到它自己。')
            const target = scoped.yzjGraph.rawObject('commitment', id)
            const keeper = scoped.yzjGraph.rawObject('commitment', into)
            if (target === undefined) return failure(`找不到承诺：${id}`)
            if (keeper === undefined) return failure(`找不到要合并进去的那一条：${into}`)
            const status = asString(asRecord(target.state)?.status) ?? 'open'
            if (status !== 'open') return failure('这条承诺已经结束了，不用再合并。')
            const refused = refuseUnlessSteward(scoped, id, '合并')
            if (refused !== undefined) return refused
            try {
              await scoped.yzjGraph.append({
                type: 'commitment/merged',
                data: { commitmentId: id, mergedInto: into },
                actor: scoped.yzjCards.desktopActor(),
              })
              return { ok: true, value: { id, into } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 移交 —— 换人，不换承诺 (v4.12 /handoff).
           *
           * 人会离职、会换岗,而事情还在。移交必须是**这一条**承诺换了执行者,
           * 不能是「作废旧的、新建一条」——后者把出生边、听众集合、已有的回执
           * 全留在一条没人再看的记录上,而这些恰恰是这条承诺可信的全部理由。
           *
           * 新执行者知不知道,是另一件事:这里只改图,通知仍然要靠人在场所里说
           * 出口(幽灵承诺禁令对移交同样成立)——所以回执里把这句话带出去。
           */
          case 'handoff-commitment': {
            const id = stringField(payload, 'id')
            const openId = stringField(payload, 'openId')
            const name = stringField(payload, 'name')
            if (id === undefined || openId === undefined) return failure('移交需要承诺 id 与新执行者')
            const target = scoped.yzjGraph.rawObject('commitment', id)
            if (target === undefined) return failure(`找不到承诺：${id}`)
            const status = asString(asRecord(target.state)?.status) ?? 'open'
            if (status !== 'open') return failure('这条承诺已经结束了，不能移交。')
            const refused = refuseUnlessSteward(scoped, id, '移交')
            if (refused !== undefined) return refused
            try {
              await scoped.yzjGraph.append({
                type: 'commitment/updated',
                data: {
                  commitmentId: id,
                  executor: { kind: 'human', openId, ...(name === undefined ? {} : { name }) },
                },
                actor: scoped.yzjCards.desktopActor(),
              })
              return { ok: true, value: { id, openId } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /** 目标页 = 承诺板的第二缩放级别，读的是同一个查询 (§7.6)。 */
          case 'goal-page': {
            const goalRef = stringField(payload, 'goalRef')
            if (goalRef === undefined) return failure('目标页需要 goalRef')
            const view = goalPageFrame(scoped, goalRef)
            return view === undefined
              ? failure('板上没有这个目标——它可能已经被移出视野。')
              : { ok: true, value: view }
          }
          /**
           * 事后时刻 —— batch re-linking from the 无归属 group.
           *
           * The weekly-meeting motion the design names: pull up what serves no
           * goal, select several, attach them at once. `attachedVia: 'linked'`
           * keeps the provenance — a link made after the fact is a different
           * fact from one inherited at birth, and the ack copy depends on it.
           */
          case 'link-commitments': {
            const goalRef = stringField(payload, 'goalRef')
            const raw = (payload as { ids?: unknown }).ids
            const ids = Array.isArray(raw) ? raw.filter(id => typeof id === 'string') : []
            if (goalRef === undefined || ids.length === 0) {
              return failure('补挂需要目标链接和至少一条承诺')
            }
            /*
              Every id must resolve first.

              `append` on an unknown id does not fail — it CREATES an object,
              and the board reads a stateless record as an open commitment with
              an empty name that no endpoint can ever remove. Checking the
              whole batch before writing any of it also makes the receipt true:
              a loop that throws halfway leaves half the work done and reports
              a failure.
            */
            const missing = ids.filter(id => scoped.yzjGraph.rawObject('commitment', id) === undefined)
            if (missing.length > 0) return failure(`找不到承诺：${missing.join('、')}`)
            try {
              for (const commitmentId of ids) {
                await scoped.yzjGraph.append({
                  type: 'commitment/updated',
                  data: { commitmentId, parentGoalRef: goalRef, attachedVia: 'linked' },
                  actor: scoped.yzjCards.desktopActor(),
                })
              }
              return { ok: true, value: { linked: ids.length } }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 接单 / 移出服务 —— the deployment's blast radius, changed on purpose.
           *
           * Deliberately reachable only from the place contract panel, never
           * from the conversation list: 46 rows with a one-click switch on each
           * is an invitation to widen what the agent can read and write by
           * accident. The panel is where the consequences are already written
           * down, so that is where the control belongs.
           */
          case 'set-served': {
            const placeKey = stringField(payload, 'placeKey')
            const on = (payload as { on?: unknown }).on === true
            if (placeKey === undefined) return failure('接单需要 placeKey')
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) return failure('云之家通道未就绪')
            try {
              return { ok: true, value: await topics.setServed(placeKey, on) }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /**
           * 附件的真身。
           *
           * 走宿主，而不是浏览器直连：这些字节**没有公开地址**——那个看起来
           * 像地址的 CDN 路径返回的是一枚通用图标（两张不同的图片拿回来的
           * 字节完全相同，实测）。于是过去每一张内联图片、每一个「下载」
           * 链接，给的都是占位图。
           */
          case 'attachment': {
            const fileId = stringField(payload, 'fileId')
            if (fileId === undefined) return failure('取附件需要 fileId')
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) return failure('云之家通道未就绪')
            try {
              return {
                ok: true,
                value: await topics.readAttachment(fileId, stringField(payload, 'name')),
              }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          /** 下载：宿主把它放进「下载」文件夹，并告诉你落在哪。 */
          case 'attachment-save': {
            const fileId = stringField(payload, 'fileId')
            if (fileId === undefined) return failure('下载需要 fileId')
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) return failure('云之家通道未就绪')
            try {
              return {
                ok: true,
                value: await topics.saveAttachment(fileId, stringField(payload, 'name')),
              }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          case 'objects': {
            const sessionId = stringField(payload, 'sessionId')
            const topic = sessionId === undefined
              ? undefined
              : scoped.get('yzjTopics')?.topicOf(sessionId)
            return {
              ok: true,
              value: objectFace(scoped, topic, sessionId),
            }
          }
          case 'model': {
            /**
             * Which model is actually in force.
             *
             * Replacing the `conversation` column took the composer's model
             * SELECT with it — that seat is declared by the host's composer
             * bar, so it cannot be re-declared from here, and inventing a
             * picker over `listProviders()` would offer routes without the
             * model ids that make them usable. What is recoverable is the
             * fact, so the fact is what this returns: the operator can see
             * what is running and change it in 设置.
             */
            const selection = scoped.get('agentDefaultModel')?.currentSelection()
            return selection === undefined
              ? { ok: true, value: {} }
              : { ok: true, value: { provider: selection.provider, model: selection.model } }
          }
          case 'send-in-place': {
            const placeKey = stringField(payload, 'placeKey')
            const text = stringField(payload, 'text')
            if (placeKey === undefined || text === undefined) {
              return failure('send-in-place requires placeKey and text')
            }
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) return failure('云之家通道未就绪')
            try {
              return {
                ok: true,
                value: await topics.sendInPlace(placeKey, text, stringField(payload, 'replyTo')),
              }
            } catch (error) {
              return failure(error instanceof Error ? error.message : String(error))
            }
          }
          case 'topic-tail': {
            /**
             * 就地展开 (D13③) — the last few lines of a topic, for a glance
             * that costs no navigation. Fetched ON DEMAND rather than shipped
             * with every place view: a place with a dozen topics would
             * otherwise pay a dozen message reads to render a screen nobody
             * asked to expand.
             */
            const sessionId = stringField(payload, 'sessionId')
            if (sessionId === undefined) return failure('topic-tail requires sessionId')
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) return { ok: true, value: { lines: [] } }
            try {
              const messages = await topics.messagesFor(sessionId, 4)
              return {
                ok: true,
                value: {
                  lines: messages.map(message => (
                    `${message.fromName}：${message.content.replace(/\s+/gu, ' ').slice(0, 90)}`
                  )),
                },
              }
            } catch {
              return { ok: true, value: { lines: [] } }
            }
          }
          case 'contract': {
            const placeKey = stringField(payload, 'placeKey')
            if (placeKey === undefined) return failure('contract requires placeKey')
            return { ok: true, value: contractView(scoped, placeKey) }
          }
          case 'place': {
            const placeKey = stringField(payload, 'placeKey')
            if (placeKey === undefined) return failure('place requires placeKey')
            return { ok: true, value: await placeView(scoped, placeKey, windowSize) }
          }
          case 'inbox':
            return { ok: true, value: { ...inboxView(scoped), stealth } }
          case 'tree':
            return { ok: true, value: { places: scoped.get('yzjTopics')?.tree() ?? [] } }
          case 'events':
            return { ok: true, value: { events: await eventsToday(scoped) } }
          /*
            @成员补全的数据源 (v3.10 4h④).

            翻案：「通讯录不能按名字搜」是误判——`contact user search --keyword` 一直
            都在。真正的缺口是**群成员列表无 API**（平台三墙之一），所以这里搜的是**全
            组织**，搜不出「这个人在不在这个群」。那一问由选场所的人自己知道，界面上
            如实说明，不假装校验过。
          */
          case 'people': {
            const keyword = stringField(payload, 'keyword')
            if (keyword === undefined || keyword.trim() === '') {
              return { ok: true, value: { people: [] } }
            }
            const bridge = scoped.get('yzjBridge')
            if (bridge === undefined) return failure('云之家通道未就绪')
            const result = await bridge.run(
              ['contact', 'user', 'search', '--keyword', keyword.trim()],
              { timeoutMs: 15_000 },
            )
            if (!result.ok) return failure(failureOf(result, '通讯录搜不动'))
            const rows = Array.isArray(result.json) ? result.json : []
            return {
              ok: true,
              value: {
                people: rows.flatMap((row) => {
                  const person = asRecord(row)
                  const openId = asString(person?.openId)
                  const name = asString(person?.name) ?? asString(person?.userName)
                  if (openId === undefined || name === undefined) return []
                  const department = asString(person?.department)
                  const jobTitle = asString(person?.jobTitle)
                  return [{
                    openId,
                    name,
                    ...(department === undefined ? {} : { department }),
                    ...(jobTitle === undefined ? {} : { jobTitle }),
                  }]
                }).slice(0, 12),
              },
            }
          }
          /*
            新建专项群 —— **创设、记出生、按勾选接入，一次主权时刻办完** (设计 v4.18).

            为什么落在桌面 RPC 而不是让 agent 去调那个工具：建群是**创造一个新的听众
            集合**，比在现成的听众集合里挑一个更须人批（「场所人选不推导」的上位延伸）。
            桌面上，操作者按下这个按钮**就是那次签发**——不需要再给他弹一张确认卡问同
            一件事（一次主权时刻一次确认）。agent 那条路仍然存在，且在 guard 里是强确认，
            因为那时候按下确认的人和提议的人不是同一个。

            三件事的顺序是想过的：

            1. **先建群**——它是唯一一件失败了就什么都不用做的事；
            2. **再记出生**（`contract/updated.birth`）——血缘要在接单之前落下，否则接单
               成功、出生记录失败时，图上会出现一个「在岗但不知从何而来」的场所；
            3. **最后接单**——它是运行态开关，改的是通道的 `allowedGroupIds`（单一事实源，
               图上不存第二份 `served`）。

            **结果未知不自动重试。** 超时或回包读不出 groupId 时，这条命令**可能已经成功
            了**；再发一次的代价是组织里凭空多一个群、多一批被拉进去的人。所以这里不重试，
            而是回一句让人去核对的话——核对走 `im group recent`（刚建的群排在最前），不走
            `im group search`：实测那个接口在本租户上对任何关键词都答「服务内部异常」。
          */
          case 'create-place': {
            const name = stringField(payload, 'name')
            const sourceAnchor = stringField(payload, 'sourceAnchor')
            const members = Array.isArray((payload as { members?: unknown }).members)
              /*
                去重：同一个人被选进来两次，`length` 凑够了 2 而平台看到的是 1 个人，
                于是这次调用**过了我们的闸、死在对面**——而人已经签过字了。
              */
              ? [...new Set(((payload as { members: JsonValue[] }).members).flatMap((row) => {
                const id = asString(row)
                return id === undefined || id.trim() === '' ? [] : [id.trim()]
              }))]
              : []
            const serve = (payload as { serve?: unknown }).serve === true
            const inheritedGoalRef = stringField(payload, 'goalRef')
            if (name === undefined || name.trim() === '') return failure('新群得有个名字')
            if (sourceAnchor === undefined) return failure('建群要记下它从哪句话里长出来')
            // 平台的边界：不含创建人，至少 2 人、最多 10 人。问过人再失败是最贵的失败。
            if (members.length < 2 || members.length > 10) {
              return failure(`初始成员要 2-10 人（不含你自己），现在选了 ${String(members.length)} 人`)
            }
            const bridge = scoped.get('yzjBridge')
            if (bridge === undefined) return failure('云之家通道未就绪')
            const created = await bridge.run(
              ['im', 'group', 'create', '--name', name.trim(), '--member-open-id', ...members],
              { timeoutMs: 30_000 },
            )
            /*
              **超时不等于没建成** —— 这一族的第一条纪律在建群上的同一次应用。

              超时恰恰是「结果未知」最常见的样子：命令发出去了，回包没等到，而群**很可能
              已经建好了、人已经被拉进去了**。这时候回一句「建群没成」，是拿一次失败的观察
              冒充一次成功的观察——而它的后果比别处更重：读的人会照着这句话再点一次，于是
              组织里凭空多一个群、多一批被拉进去的人。

              说不知道，并把核对的路指出来。核对走 `im group recent`（刚建的排最前），
              不走 `im group search`（实测本租户对任何关键词都答「服务内部异常」）。
            */
            if (created.timedOut === true) {
              return failure(
                `建群命令超时了，**这个群可能已经建好了**——超时只说明没等到回包，不说明没建成。`
                + `不会自动重试：请在会话列表里找一下「${name.trim()}」，确实没有再重来一次。`,
              )
            }
            if (!created.ok) return failure(failureOf(created, '建群没成'))
            /*
              回包的形状**没有实测过** —— 建一次群要把两位真同事拉进去，那不是我能自己
              决定的事。所以这里照本族既有的容错写法读（`im message send` 就是
              `msgId ?? id`），并且**读不出来时不猜、不重试**：往下那条路会如实说
              「可能已经建好了，去核对」。这是这个仓库今天反复交的学费——
              一个照着我的假设写的解析器，会在真回包面前安静地返回空。
            */
            const made = asRecord(created.json as JsonValue)
            const groupId = asString(made?.groupId)
              ?? asString(made?.id)
              ?? asString(asRecord(made?.data)?.groupId)
              ?? asString(asRecord(made?.data)?.id)
            if (groupId === undefined || groupId === '') {
              return failure(
                '建群命令回来了，但回包里读不出群 id——这个群**可能已经建好了**。'
                + '不会自动重试（重试的代价是凭空多一个群、多一批被拉进去的人）：'
                + '请在会话列表里找一下「' + name.trim() + '」，没有再重来一次。',
              )
            }
            // 不手拼：`placeKeyFor` 是这条规则的唯一出处，抄一份迟早和它分家。
            const placeKey = placeKeyFor('group', groupId)
            /*
              出生血缘落在合同上，合同**原样回写**，只多一条出生记录。

              `servedAtBirth` 记的是**签发卡上那一次勾选**。运行态「此刻在不在岗」的真相在
              通道的 `allowedGroupIds`，不在这里——在图上再存一份 `served` 就是两本账，而
              今天已经为这种分裂修过好几处了。这里记的是历史：它出生的那一刻，人有没有同时
              把 agent 接进来。

              `contractFor` 是「同 placeKey 最后一条赢」，所以随手填几个值写下去，等于把
              这个新场所的合同**钉死**在我填的那几个值上，从此不再跟随组织默认——我没打算
              改策略，却改了策略。这类「顺手写下一个我没想过的默认」正是这套设计一直在防的
              安静的错：它不报错，只是三个月后有人发现这个群的记忆策略和别处不一样。

              读回此刻的合同（这个 placeKey 还没有合同，读到的就是组织默认）再原样写回，
              这一笔就纯粹是**加一条出生记录**，一个字段的语义都不动。
            */
            const inherited = scoped.yzjGraph.contractFor(placeKey)
            try {
              await scoped.yzjGraph.append({
                type: 'contract/updated',
                data: {
                  placeKey,
                  /*
                    版本 +1，不是原样抄。

                    组织默认那份的 version 是 **0**（「这个场所还没有写过合同」），而
                    `contract/updated` 的 schema 要求 ≥1。原样抄下去这一笔会直接抛，
                    出生记录一个字都落不下——而群已经建出来了。这条是被单测当场逮住的。
                  */
                  version: inherited.version + 1,
                  oaRequiredCategories: [...inherited.oaRequiredCategories],
                  memoryPolicy: inherited.memoryPolicy,
                  processSummary: inherited.processSummary,
                  birth: {
                    sourceAnchor,
                    ...(inheritedGoalRef === undefined ? {} : { inheritedGoalRef }),
                    servedAtBirth: serve,
                  },
                },
                actor: scoped.yzjCards.desktopActor(),
              })
            } catch (error) {
              // 群已经建出来了，血缘没记上——说出来，别让它看起来一切正常。
              console.error('[yzj-next-surface] 建群成功但出生记录失败', error)
            }
            /*
              接单是**显式的**：合同默认最严，新场所 agent 不在岗、不接单。

              没勾的话这里什么都不做——而调用方会在代发之前警示「agent 听不见此群，登记卡
              的回执将无人接收」。出生要有呼吸，而呼吸包括**回执可达**。
            */
            let served = false
            const topics = scoped.get('yzjTopics')
            if (topics === undefined) {
              console.error('[yzj-next-surface] 建群后通道不在，接单开关没落下')
            } else {
              try {
                /*
                  **两个方向都要明说**，不勾的时候不是「什么都不做」。

                  合同默认最严这句话，此前押在「新群不在名单里所以不在岗」上——而名单空着
                  的部署里空集是「全部放行」，新群会**立刻在岗**，操作者明确不勾也没用。
                  「从没提过」和「明确说了不」压成一个状态，这句设计语就是空的。

                  所以两种选择都落成一次**明确的**记录：勾了写 true，没勾写 false。落库那
                  一层本来就三值，写下去，`onDutyIn` 那边的 denied 才拦得住。
                */
                await topics.setServed(placeKey, serve)
                served = serve
              } catch (error) {
                console.error('[yzj-next-surface] 建群后接单开关没落下', error)
              }
            }
            return { ok: true, value: { groupId, placeKey, served } }
          }
          default:
            return failure(`unknown endpoint ${endpoint}`)
        }
      },
      // Loopback only: this channel can put words into a real group, so it is
      // exactly as privileged as the operator's own desktop and no more.
      { authority: 'loopback' },
    )
  })
}
