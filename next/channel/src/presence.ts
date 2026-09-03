/**
 * 多实例受话唯一律的**纯协议** (决策 #63 = 设计 v4.27, 技术方案 §6.2④′ / §6.4 / §8 B5).
 *
 * > 一个场所，一次受话，唯一接单者。到达单数过人的手或过总序，永不过运气。
 *
 * 寄生期「同一个 agent」在部署上是 N 个操作者的 N 个实例——名字唯一而实体多。群里的
 * 一句 `@next` 到达 N 个 agent，两个都干就是 #58 禁止的自动拆分。这个文件是判断的
 * 全部：四级解析（谁该接）、认领裁决（谁赢了）、以及实例之间靠署名互认的那几句话。
 * 它**不碰传输、不碰状态**，所以每一条分支都能不起通道就测——判断是会被改错的那
 * 一部分，而这里改错的代价是双写。
 *
 * 四级（v3.23r）：
 *
 * - **级 0 对象归属**：话语指向的对象在谁的图谁处理——真身唯一律的分诊形态，跨实例
 *   永不竞赛；
 * - **级 1 发言者实例**：有助理的人由自己的助理接单（真身跟说话的人——委派归因、账号、
 *   合同三重自然）；他人实例延迟一个轮询周期再看；
 * - **级 2 对群在岗**：发言者没有助理，本场所对群在岗（scope:'all'）的实例接单；
 * - **级 3 认领竞赛**：≥2 个对群在岗重叠，按群消息流的服务端总序先答先赢——但
 *   **梯队高于时序**：低梯队先 ack 也须向窗口内到达的高梯队 ack 显式让位。
 *
 * 共同验收句：**宁可无人接单，不可两人动手。** 每一处不确定都倒向「不接」。
 */

import { SIGNATURE_AGENT, readSignature, stripSignature } from '@yzj-next/objects'
import type { YzjMessage } from './protocol.ts'

// ---------------------------------------------------------------------------
// 实例之间的话 —— 人看得见的同一条通道，也是机器互认的协议。
// ---------------------------------------------------------------------------

/** 在岗声明帖：接单 = 人签发 → 向群公告。群即审计面。 */
export function presenceDeclaration(operatorName: string): string {
  return `${SIGNATURE_AGENT}（${operatorName}）在本群在岗 · 接受全群委派。@ 它或回复它的消息都会由它接单。`
}

/** 退岗帖。在岗移交 = 退岗帖 + 接岗者的在岗帖，两帖各自由各自的人签发。 */
export function presenceWithdrawal(operatorName: string): string {
  return `${SIGNATURE_AGENT}（${operatorName}）已退岗，不再接受本群委派。`
}

/** 显式让位帖：一条不撤的 ack 就是一条幽灵承诺，所以输了必须开口。 */
export function yieldNotice(peerName: string): string {
  return `↪ 已由 ${SIGNATURE_AGENT}（${peerName}）接单，本条不再处理。`
}

/** 认领 = 既有 ack（ack-before-work 是既有时序）。携句柄：卡片三定律②成为跨实例协议。 */
export const ACK_PREFIX = '【Agent】已接收'

export function ackText(taskId: string): string {
  return `${ACK_PREFIX}，正在处理。[card#task:${taskId}]`
}

/**
 * 请对方退岗的拟稿 —— **拟稿亲发，不代发**（社交摩擦不碰；B4 禁借身）。
 *
 * 两个对群在岗重叠押门（分工需要名字，名字需要专号），所以第二个想接的人只有两条路：
 * 请对方退岗，或改为仅本人。这句话由人自己发，措辞归他。
 */
export function withdrawRequestDraft(peerName: string, groupName: string): string {
  return `${peerName}，我想把我的 ${SIGNATURE_AGENT} 接进「${groupName}」接受全群委派——`
    + `一个群只能有一个在岗实例，方便的话请你先把你的退岗（合同面板 → 移出服务），我这边再接。`
}

/** 一条同侪出站是哪一种信号。 */
export type PeerSignal = 'presence-declared' | 'presence-withdrawn' | 'yield' | 'ack' | 'other'

/**
 * **机器形状即实例出站** —— 署名协议之前的实例认得出来 (过渡期规则).
 *
 * 实测（2026-09-03，群 6a8400d4…）：同事的实例跑的是署名之前的构建，它的 ack
 * 「【Agent】已接收，正在处理。」不带落款。它回复我们的消息 → 我们判「回复 agent 消息 =
 * 受话」→ 开回合 → 我们的 ack 回复它的消息 → 它也判受话 → ……两个实例对打，群里全是
 * 「已接收 / 本回合没有产生回复」。**这正是 #63 要消灭的幽灵双胞胎，活的。**
 *
 * 落款是协议，形状是协议之前的凭据：`【Agent…】` 开头、`[card#…]` 句柄、`【云之家确认】`
 * 卡——没有人这么说话。认它们为实例出站，失效方向安全（认错了 = 少接一句机器话）。
 * 等所有实例都升到署名构建，这条规则可以退役；在那之前它是止血带。
 */
export function looksLikeInstanceOutbound(content: string): boolean {
  const body = content.trim()
  if (body.startsWith('【Agent')) return true
  if (body.startsWith('【云之家确认】')) return true
  if (body.startsWith('↪ 已由')) return true
  if (/\[card#[a-z-]+:[^\]]+\]/u.test(body)) return true
  return false
}

/**
 * 认同侪出站说的是什么。只认本文件自己写出去的形状——别的实例也是这份代码。
 *
 * 认不出的一律 `other`（镜像源、普通回帖），**永不进入受话判定**：同侪出站不是受话，
 * 这是分诊①的扩展，不是这里的判断。
 */
export function classifyPeerOutbound(content: string): PeerSignal {
  const body = stripSignature(content).trim()
  if (body.startsWith(ACK_PREFIX)) return 'ack'
  if (body.startsWith('↪ 已由')) return 'yield'
  if (body.startsWith(`${SIGNATURE_AGENT}（`)) {
    if (body.includes('在本群在岗')) return 'presence-declared'
    if (body.includes('已退岗')) return 'presence-withdrawn'
  }
  return 'other'
}

// ---------------------------------------------------------------------------
// 四级解析 —— 受话成立后、入队前。
// ---------------------------------------------------------------------------

/**
 * 触发者范围（接单开关的第一个参数）：`all` 对群在岗（声明、算在岗）；`self` 仅本人（不声明、
 * 不算在岗）；`standby` 备岗（不声明、不算在岗——无人应答时按备岗序等 k 个轮询周期再接，v3.23r 押门项）。
 */
export type ServeScope = 'all' | 'self' | 'standby'

export type ClaimTier = 'speaker' | 'presence' | 'standby'
export type YieldReason = 'object-owner' | 'speaker-instance' | 'presence' | 'ack-order'

/** 一个观察到的同侪实例——由它的操作者标识。名字来自署名，只给人读。 */
export interface Contender {
  readonly openId: string
  readonly name: string
}

export interface ResolveInput {
  readonly speakerOpenId: string
  readonly selfOpenId: string
  /**
   * 话语指向的对象在谁的图上：回复的那条 agent 消息、命令引用的任务、卡片动作的锚。
   * `unknown` = 不指向任何已知对象（主楼的一句 `@next …`）。
   */
  readonly objectOwner: 'self' | 'peer' | 'unknown'
  readonly objectOwnerOpenId?: string
  /** 发言者是不是有实例的操作者（署名/在岗史可知）。缺席 = 不知道他有助理。 */
  readonly speakerInstance?: Contender
  /** 已经为发言者实例让过一个轮询周期了。 */
  readonly waited: boolean
  /** 延迟之后看到发言者实例对本触发的 ack 了。 */
  readonly speakerAcked: boolean
  /** 本实例在此场所的触发者范围。`off` 不该走到这里——分诊之前就被服务名单挡了。 */
  readonly selfScope: ServeScope | 'off'
  /** 观察到的、此刻对群在岗的同侪实例。 */
  readonly peersOnDuty: readonly Contender[]
  /**
   * 备岗序（仅 `standby` 用）：`rank` = 本实例在本群备岗席位里的序号（openId 字典序，0 起），
   * 等 `1 + rank` 个轮询周期；`waitedCycles` = 这条触发已经等过的周期数。
   */
  readonly standby?: { readonly rank: number; readonly waitedCycles: number }
  /** 等待期间任何同侪对本触发的 ack（备岗只在无人应答时接）。 */
  readonly peerAcked?: { readonly openId: string }
}

export type Resolution =
  /** 本实例接。`contenders` 非空 = 级 3 竞赛，认领协议决定最终归属。 */
  | {
    readonly kind: 'mine'
    readonly tier: ClaimTier
    readonly tiebreak: 'sole' | 'msgId'
    readonly contenders: readonly string[]
  }
  /** 让高梯队先：发言者实例（1 周期）或备岗序（1 + rank 周期）。到点再看一次。 */
  | { readonly kind: 'wait'; readonly cycles: number }
  /** 不是叫我。静默让位——没开口，无需撤，但要有账。 */
  | { readonly kind: 'yield'; readonly reason: YieldReason; readonly to?: string }
  /** 仅本人合同：他人的受话没人接。如实记账，不假装接了。 */
  | { readonly kind: 'unserved' }

export function resolveAddressee(input: ResolveInput): Resolution {
  if (input.selfScope === 'off') return { kind: 'unserved' }

  // 级 0：对象归属。同侪图上的对象 → 不是叫我，跨实例永不竞赛。
  if (input.objectOwner === 'peer') {
    return {
      kind: 'yield',
      reason: 'object-owner',
      ...(input.objectOwnerOpenId === undefined ? {} : { to: input.objectOwnerOpenId }),
    }
  }

  // 级 1：发言者实例。真身跟说话的人。
  if (input.speakerOpenId === input.selfOpenId) {
    return { kind: 'mine', tier: 'speaker', tiebreak: 'sole', contenders: [] }
  }
  if (input.speakerInstance !== undefined) {
    if (!input.waited) return { kind: 'wait', cycles: 1 }
    if (input.speakerAcked) return { kind: 'yield', reason: 'speaker-instance', to: input.speakerInstance.openId }
    // 他的实例没接（未 served 本场所、离线……）→ 视同无实例，往下走。
  }

  // 级 2′：备岗。不声明、不算在岗；只在无人应答时接——先按备岗序等 1 + rank 个周期，
  // 期间任何同侪 ack 都让本实例静默让位；等完仍无人应答，才以 standby 梯队认领（复核仍走
  // 认领协议：迟到的在岗 ack 梯队更高，本实例照样输并发让位帖）。
  if (input.selfScope === 'standby') {
    const need = 1 + (input.standby?.rank ?? 0)
    const waited = input.standby?.waitedCycles ?? 0
    if (waited < need) return { kind: 'wait', cycles: need - waited }
    if (input.peerAcked !== undefined) return { kind: 'yield', reason: 'ack-order', to: input.peerAcked.openId }
    return { kind: 'mine', tier: 'standby', tiebreak: 'msgId', contenders: input.peersOnDuty.map(peer => peer.openId) }
  }

  // 级 2：对群在岗。仅本人合同只服务自己的操作者。
  if (input.selfScope === 'self') {
    const peer = input.peersOnDuty[0]
    return peer === undefined
      ? { kind: 'unserved' }
      : { kind: 'yield', reason: 'presence', to: peer.openId }
  }
  if (input.peersOnDuty.length === 0) {
    return { kind: 'mine', tier: 'presence', tiebreak: 'sole', contenders: [] }
  }

  // 级 3：认领竞赛。这里只说「我参赛」，赢不赢由 ack 之后的复核裁决。
  return {
    kind: 'mine',
    tier: 'presence',
    tiebreak: 'msgId',
    contenders: input.peersOnDuty.map(peer => peer.openId),
  }
}

/**
 * **裸命令**（没有回复锚的 `/status` `/cancel` …）归谁答。
 *
 * 命令走旁路，不排队、不 ack，所以没有认领竞赛可裁——两个对群在岗的实例都答一句
 * `/status` 是噪音不是双写，可 `/cancel` 各取消各的话题就未必是人要的。于是按同一
 * 把刀切，但**不等**：发言者是本人 → 我答；发言者有实例 → 他的实例答，我不插嘴；
 * 仅本人 → 他人的命令不由我答；对群在岗 → 我答。
 */
export function resolveCommand(input: {
  readonly speakerOpenId: string
  readonly selfOpenId: string
  readonly speakerInstance?: Contender
  readonly selfScope: ServeScope | 'off'
  readonly peersOnDuty: readonly Contender[]
}): { readonly kind: 'mine' } | { readonly kind: 'yield'; readonly reason: YieldReason; readonly to?: string } | { readonly kind: 'unserved' } {
  if (input.selfScope === 'off') return { kind: 'unserved' }
  if (input.speakerOpenId === input.selfOpenId) return { kind: 'mine' }
  if (input.speakerInstance !== undefined) {
    return { kind: 'yield', reason: 'speaker-instance', to: input.speakerInstance.openId }
  }
  // 仅本人与备岗都不答他人的裸命令：命令不排队、不等，备岗序在这里没有周期可等。
  if (input.selfScope === 'self' || input.selfScope === 'standby') {
    const peer = input.peersOnDuty[0]
    return peer === undefined ? { kind: 'unserved' } : { kind: 'yield', reason: 'presence', to: peer.openId }
  }
  return { kind: 'mine' }
}

// ---------------------------------------------------------------------------
// 认领裁决 —— 复核段的判断。
// ---------------------------------------------------------------------------

const TIER_RANK: Record<ClaimTier, number> = { speaker: 0, presence: 1, standby: 2 }

/** 一条对同一触发的 ack，本实例的或同侪的。 */
export interface AckObservation {
  readonly openId: string
  readonly tier: ClaimTier
  /**
   * 在群消息流里的位置——**服务端总序**，双方观察同一顺序（实测⑩前提）。
   * 缺席 = 这条 ack 不在读回的窗口里，退化为 openId 字典序，仍然确定性。
   */
  readonly index?: number
}

export type ClaimVerdict =
  | { readonly win: true }
  | { readonly win: false; readonly to: string; readonly reason: 'speaker-instance' | 'ack-order' }

/**
 * 谁赢了。**梯队高于时序**：高梯队的 ack 在窗口内到达，本实例输，哪怕我先 ack。
 * 同梯队按总序更早者赢；两边都不在窗口里就按 openId 字典序——确定性比公平重要，
 * 因为不确定的那一头是双写。
 */
export function claimVerdict(input: {
  readonly self: AckObservation
  readonly peers: readonly AckObservation[]
}): ClaimVerdict {
  const mine = TIER_RANK[input.self.tier]
  let loss: ClaimVerdict | undefined
  for (const peer of input.peers) {
    if (peer.openId === input.self.openId) continue
    const theirs = TIER_RANK[peer.tier]
    if (theirs < mine) {
      // 高梯队到了：无论时序，让。发言者实例是唯一比在岗高的梯队。
      return { win: false, to: peer.openId, reason: 'speaker-instance' }
    }
    if (theirs > mine) continue
    const earlier = peer.index !== undefined && input.self.index !== undefined
      ? peer.index < input.self.index
      : peer.openId < input.self.openId
    if (earlier && loss === undefined) loss = { win: false, to: peer.openId, reason: 'ack-order' }
  }
  return loss ?? { win: true }
}

/** 观察到的同侪 ack 属于哪一梯队：发言者自己的实例是发言者梯队，其余都是在岗梯队。 */
export function tierOfPeer(peerOpenId: string, speakerOpenId: string): ClaimTier {
  return peerOpenId === speakerOpenId ? 'speaker' : 'presence'
}

// ---------------------------------------------------------------------------
// 看一眼 / 复核 —— 对一段群消息流的纯判断。orchestrator 只负责把流读回来。
// ---------------------------------------------------------------------------

/** 一段流里，同侪对这条触发的 ack（署名识别，回复锚 = 触发）。`index` = 在流里的位置 = 服务端总序。 */
export function acksIn(
  after: readonly YzjMessage[], trigger: YzjMessage, selfOpenId: string,
): readonly (AckObservation & { readonly name: string })[] {
  const acks: (AckObservation & { name: string })[] = []
  after.forEach((message, index) => {
    if (message.fromOpenId === selfOpenId) return
    const signature = readSignature(message.content)
    // 过渡期：没落款的机器形状 ack（旧构建）一样算同侪认领——它真的会开工。
    if (signature === undefined && !looksLikeInstanceOutbound(message.content)) return
    if (classifyPeerOutbound(message.content) !== 'ack') return
    if (message.param.replyMsgId !== trigger.msgId) return
    acks.push({
      openId: message.fromOpenId,
      name: signature?.operator ?? message.fromOpenId,
      tier: tierOfPeer(message.fromOpenId, trigger.fromOpenId),
      index,
    })
  })
  return acks
}

/**
 * 复核：本 ack 落地之后重读的那段流里，谁赢了。
 *
 * `ackId` 缺席（发送回包没给 id）= 本 ack 不在窗口里，退化为 openId 字典序——仍然确定性。
 */
export function reviewClaim(input: {
  readonly after: readonly YzjMessage[]
  readonly trigger: YzjMessage
  readonly selfOpenId: string
  readonly selfTier: ClaimTier
  readonly ackId?: string
}): { readonly acks: readonly (AckObservation & { readonly name: string })[]; readonly verdict: ClaimVerdict } {
  const acks = acksIn(input.after, input.trigger, input.selfOpenId)
  const ownIndex = input.ackId === undefined
    ? -1
    : input.after.findIndex(message => message.msgId === input.ackId)
  const verdict = claimVerdict({
    self: { openId: input.selfOpenId, tier: input.selfTier, ...(ownIndex < 0 ? {} : { index: ownIndex }) },
    peers: acks,
  })
  return { acks, verdict }
}
