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
import {
  hasLeadingAlias, isAgentTrigger, stripTriggerAliases,
  type YzjGroup, type YzjMessage,
} from './protocol.ts'

export type TriageOutcome =
  /** ① Our own outbound message read back. */
  | { readonly kind: 'echo-suppressed' }
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
