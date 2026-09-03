/**
 * The inbound triage pipeline (§5.1, ordering as fixed by v2.5).
 *
 * The ORDER is the design, and it has already been got wrong once:
 *
 * ① echo suppression → ② command → ③ object addressing → ④ trigger → ⑤ noise
 *
 * Commands come BEFORE object addressing because a command is a BYPASS. If
 * object addressing ran first, replying `/cancel` to a blocked approval card
 * would be read as steering, queued behind the very turn it is trying to
 * unblock, and deadlock — v2.4 shipped exactly that regression and v2.5
 * reverted it. Do not reorder these two.
 *
 * Kept as a pure function so every branch is testable with no transport.
 */

import type { CardProjection, CardRef } from '@yzj-next/cards'
import type { OutboundSignature } from '@yzj-next/objects'
import {
  hasLeadingAlias, isAgentTrigger, stripTriggerAliases,
  type YzjGroup, type YzjMessage,
} from './protocol.ts'
import { classifyPeerOutbound, looksLikeInstanceOutbound, type PeerSignal } from './presence.ts'

export type TriageOutcome =
  /** ① Our own outbound message read back. */
  | { readonly kind: 'echo-suppressed' }
  /**
   * ①′ **同侪回声** (决策 #63 v3.23r)：另一个实例的出站，署名识别。
   *
   * 永不进入受话判定——否则 Bruce 的代发登记话语会被张三的在岗实例判为「叫的是我」，
   * 二次登记 + 二次 ack = 幽灵承诺的多实例双胞胎。它只作镜像源与观测（在岗声明、
   * 同侪 ack、让位帖）。
   */
  | {
    readonly kind: 'peer-echo'
    readonly operatorOpenId: string
    readonly operatorName: string
    readonly signal: PeerSignal
  }
  /** ② A slash command. Runs on the bypass channel, never in the topic queue. */
  | { readonly kind: 'command'; readonly name: string; readonly argument: string }
  /** ③a A reply to a projected card whose text matched one of its keywords. */
  | {
    readonly kind: 'card-action'
    readonly projection: CardProjection
    readonly actionId: string
    readonly input?: string
  }
  /**
   * ④ The agent is among the addressees — by alias/@, or by being the one
   * whose message this replies to.
   */
  | { readonly kind: 'trigger' }
  /** ⑤ Everything else. */
  | { readonly kind: 'noise'; readonly reason: string }

export interface TriageInput {
  readonly group: YzjGroup
  readonly message: YzjMessage
  /** True when this message is one we sent (msgId or fingerprint match). */
  readonly isOwnOutbound: boolean
  /**
   * 这条消息的落款，当它带着一个（决策 #63 署名协议）。
   *
   * 落款 + 发送者 = 本操作者 → 也是我们自己的出站（模型直连 CLI 的那条路不经出站
   * 登记）；落款 + 别的发送者 → 同侪出站。两种都不是受话。
   */
  readonly signature?: OutboundSignature
  /** True for the operator's own chat with themselves. */
  readonly isSelfChat: boolean
  readonly aliases: readonly string[]
  readonly acceptAccountMentions: boolean
  /** openId of the operator this instance runs as. */
  readonly operatorOpenId: string
  /**
   * True when the message this one replies to was sent by the agent.
   *
   * Read from the outbound registry, not from the sender's openId: the agent
   * posts under the operator's account, so identity cannot tell them apart —
   * only the record of what we sent can.
   */
  repliesToAgent(message: YzjMessage): boolean
  cardForAnchor(anchor: string): CardProjection | undefined
  resolveKeyword(cardRef: CardRef, text: string): { actionId: string; input?: string } | undefined
}

/** Split `/name rest` into its parts. Returns undefined when it is not one. */
export function parseCommand(content: string, aliases: readonly string[]): {
  name: string
  argument: string
} | undefined {
  // A group command reads `@agent /cancel`; the alias is addressing, not part
  // of the command.
  let text = content.trim()
  for (const alias of aliases) {
    if (text.toLowerCase().startsWith(alias.toLowerCase())) {
      text = text.slice(alias.length).trim()
      break
    }
  }
  if (!text.startsWith('/')) return undefined
  const match = /^\/([a-z][\w-]*)\s*([\s\S]*)$/iu.exec(text)
  if (match === null) return undefined
  return { name: (match[1] ?? '').toLowerCase(), argument: (match[2] ?? '').trim() }
}

export function triage(input: TriageInput): TriageOutcome {
  const { message } = input

  // ① Echo suppression. In self-chat the agent's own card and the operator's
  // own answer carry the SAME openId, so "drop my own messages" would drop the
  // answer too — identity cannot decide this, only the outbound registry can.
  if (input.isOwnOutbound) return { kind: 'echo-suppressed' }
  /*
    ①′ 同侪回声：一切实例出站恒带署名，署名的就不是人在说话。

    自己账号发出的署名消息也在这里收口：`yzj_im_message_send` 直连 CLI，不过出站
    登记，它回来的时候只有落款能证明它是我们说的。
  */
  if (input.signature !== undefined) {
    if (message.fromOpenId === input.operatorOpenId) return { kind: 'echo-suppressed' }
    return {
      kind: 'peer-echo',
      operatorOpenId: message.fromOpenId,
      operatorName: input.signature.operator,
      signal: classifyPeerOutbound(message.content),
    }
  }
  /*
    署名之前的实例（过渡期）：机器形状即实例出站。名字不知道（没有落款），openId 知道。
    见 `looksLikeInstanceOutbound` 上那段实测——两个实例对打，就是从这里进来的。
  */
  if (looksLikeInstanceOutbound(message.content)) {
    if (message.fromOpenId === input.operatorOpenId) return { kind: 'echo-suppressed' }
    return {
      kind: 'peer-echo',
      operatorOpenId: message.fromOpenId,
      operatorName: '',
      signal: classifyPeerOutbound(message.content),
    }
  }

  // ② Command — the bypass channel.
  const command = parseCommand(message.content, input.aliases)
  if (command !== undefined) return { kind: 'command', ...command }

  // ③ Object addressing. Any registered fragment of a projection anchors it.
  const anchors = [message.param.replyMsgId, message.param.replyRootMsgId]
    .filter((anchor): anchor is string => anchor !== undefined)
  for (const anchor of anchors) {
    const projection = input.cardForAnchor(anchor)
    if (projection === undefined) continue
    const text = stripTriggerAliases(message.content, input.aliases) || message.content.trim()
    const matched = input.resolveKeyword(projection.cardRef, text)
    if (matched !== undefined) {
      return {
        kind: 'card-action',
        projection,
        actionId: matched.actionId,
        ...(matched.input === undefined ? {} : { input: matched.input }),
      }
    }
    // Not a keyword — so it is a sentence, and rule ④ decides it like any
    // other sentence. A card IS an agent message, so replying to one addresses
    // the agent; there is no separate "card steering" case any more.
    break
  }

  /**
   * ④ 受话判定 (v4.7) — is the agent among the addressees?
   *
   * The reply route is checked FIRST, and before the self-chat rule, because
   * it is explicit addressing: replying to somebody's message addresses them,
   * which is what lets an ack say 「回复本条可继续」 and mean it. The self-chat
   * rule exists to keep BARE notes-to-self from triggering — a deliberate
   * reply to the agent's own card was never one of those.
   */
  if (input.repliesToAgent(message)) return { kind: 'trigger' }

  // Self-chat never free-triggers: only a LEADING alias counts, so ordinary
  // notes to self stay ordinary notes to self (§5.2).
  if (input.isSelfChat) {
    return hasLeadingAlias(message.content, input.aliases)
      ? { kind: 'trigger' }
      : { kind: 'noise', reason: 'self-chat message outside the triage whitelist' }
  }
  /**
   * The other route into the same rule: an alias or an @ of the account.
   *
   * Both routes carry the same authority. That is what retires v2.5 F13's
   * "only the operator may steer" — a colleague replying to the agent is not
   * exercising a privilege, they are talking to it, exactly as if they had
   * typed @, and the admission whitelist is what gates both.
   */
  if (isAgentTrigger(message, input.aliases, input.acceptAccountMentions)) return { kind: 'trigger' }

  // ⑤ Noise.
  return { kind: 'noise', reason: 'the agent is not among the addressees' }
}

/**
 * 出站分诊 —— **桌面发出去的这句话，是不是在答一张卡** (v3.15 裁决③).
 *
 * 入站分诊③ 早就有这条规则：回复锚命中一张已投影的卡、文本命中它的动词 → 那是一次
 * **应答**，不是一次触发。桌面这一侧此前完全没有它，而两条桌面发送路径各自坏在不同
 * 的地方：
 *
 * - **群视图那条**（`sendFromDesktop`）绕过整个分诊直接 `runTrigger`——于是对着一张卡
 *   回一句「确认」，落成的是 `task/opened`：开了一个没人要的任务，而那张卡还在等人答；
 * - **会话列那条**（`sendToPlace`）只发消息，等轮询把它读回来再分诊——可它自己发的
 *   消息会被规则① 的**回声抑制**掉（每一次 `client.send` 都登记出站指纹，agent 与桌面
 *   一视同仁）。于是那句「确认」**一声不响地消失**，卡永远等下去。
 *
 * 所以出站必须**在发送这一侧**判定：回程那条路是故意不认自己的话的。
 *
 * 判据与入站共用同两个函数（`cardForAnchor` / `resolveKeyword`），也共用同一条收尾
 * 规则——**不是关键词就当普通话语**：一张卡也是 agent 说的话，对着它说一句别的，本来
 * 就该是一次触发。两份判断迟早会在「哪些词算确认」上分道扬镳。
 */
export function triageOutbound(input: {
  readonly text: string
  /** 落点：回复的是哪一条。没有落点就不可能是在答某一张卡。 */
  readonly replyTo?: string
  readonly aliases: readonly string[]
  cardForAnchor(anchor: string): CardProjection | undefined
  resolveKeyword(
    cardRef: CardRef, text: string,
  ): { readonly actionId: string; readonly input?: string } | undefined
}): { readonly projection: CardProjection; readonly actionId: string; readonly input?: string }
  | undefined {
  if (input.replyTo === undefined) return undefined
  const projection = input.cardForAnchor(input.replyTo)
  if (projection === undefined) return undefined
  const text = stripTriggerAliases(input.text, input.aliases) || input.text.trim()
  const matched = input.resolveKeyword(projection.cardRef, text)
  if (matched === undefined) return undefined
  return {
    projection,
    actionId: matched.actionId,
    ...(matched.input === undefined ? {} : { input: matched.input }),
  }
}
