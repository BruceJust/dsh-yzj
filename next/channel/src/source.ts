/**
 * The turn's message source — the durable record of WHERE a turn came from.
 *
 * This is not decoration. Three things read it back rather than trusting
 * in-memory state:
 *
 * - **viewer derivation** (§3.3): the read domain is a property of the turn's
 *   origin, and the orchestrator derives it here so the model never can;
 * - **terminal replay**: a restart must be able to ask "did this Yunzhijia
 *   message already get a turn?" without the process that ran it;
 * - **the guard's identity pin**: which account the turn was admitted under
 *   has to outlive the poller that admitted it.
 *
 * It rides `user/message.source`, an OFFICIAL extension point (`MessageSourceMap`
 * merge) — not a custom session event. Appending a custom durable event type
 * would make the whole log unreadable on cold read (F4); this is the sanctioned
 * way to put our own fact in the host's log.
 */

import type { YzjTopicRoute } from './protocol.ts'

/** Where a Yunzhijia-admitted turn came from. */
export interface YzjNextMessageSource {
  readonly kind: 'yzj-next'
  readonly groupId: string
  readonly messageId: string
  readonly senderOpenId: string
  readonly accountKey: string
  readonly accountOrgId: string
  readonly accountOpenId: string
  readonly conversationKind: 'group' | 'direct'
  readonly placeKey: string
  readonly topicKey: string
  readonly topicRootId: string
  readonly generation: number
  readonly groupName?: string
  readonly topicLabel?: string
  /**
   * Write authority the admitting message granted. `read-only` marks a 轻问 —
   * a projection nobody admitted, which is exactly why it may not write.
   */
  readonly writeMode: 'standard' | 'read-only'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'yzj-next': YzjNextMessageSource
  }
}

/** Build the source for one admitted trigger. */
export function sourceFor(
  route: YzjTopicRoute,
  messageId: string,
  senderOpenId: string,
): YzjNextMessageSource {
  return {
    kind: 'yzj-next',
    groupId: route.groupId,
    messageId,
    senderOpenId,
    accountKey: route.accountKey,
    accountOrgId: route.accountOrgId,
    accountOpenId: route.accountOpenId,
    conversationKind: route.conversationKind,
    placeKey: route.placeKey,
    topicKey: route.topicKey,
    topicRootId: route.topicRootId,
    generation: route.generation,
    groupName: route.groupName,
    topicLabel: route.topicLabel,
    writeMode: 'standard',
  }
}

/**
 * The source for a 轻问 turn.
 *
 * `messageId` is empty on purpose: no inbound message admitted this, so there
 * is nothing for the replay guard to match and nothing whose authority it
 * could inherit. The topic fields stay, because the read domain is still that
 * topic's — a projection reads the same place the conversation does.
 */
export function askSourceFor(route: YzjTopicRoute): YzjNextMessageSource {
  return { ...sourceFor(route, '', route.accountOpenId), writeMode: 'read-only' }
}

/** Read our source off one session event's data, when it is ours. */
export function yzjSourceOf(value: unknown): YzjNextMessageSource | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = (value as { source?: unknown }).source
  if (typeof source !== 'object' || source === null) return undefined
  return (source as { kind?: unknown }).kind === 'yzj-next'
    ? source as YzjNextMessageSource
    : undefined
}
