import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { YzjSessionIdentityProjection } from '@dsh-yzj/bridge'

export interface YzjMessageParam {
  readonly notifyDesc?: string
  readonly notifyType?: number
  readonly notifyToAll?: boolean
  readonly replyMsgId?: string
  readonly replyOpenId?: string
  readonly replyPersonName?: string
  readonly replyRootMsgId?: string
  readonly replySummary?: string
}

export interface YzjMessage {
  readonly content: string
  readonly fromOpenId: string
  readonly msgId: string
  readonly msgType: string
  readonly sendTime: string
  readonly param: YzjMessageParam
}

export interface YzjGroup {
  readonly groupId: string
  readonly groupName: string
  readonly groupType?: number
  readonly lastMsgId: string
  readonly lastMsgSendTime: string
  readonly lastMsg?: YzjMessage
}

export interface YzjIdentity {
  readonly orgId: string
  readonly openId: string
  readonly name: string
}

export interface YzjTopicRoute {
  readonly accountKey: string
  readonly accountOrgId: string
  readonly accountOpenId: string
  readonly conversationKind: 'group' | 'direct'
  readonly groupId: string
  readonly groupName: string
  readonly channelKey: string
  readonly topicRootId: string
  readonly topicKey: string
  readonly topicLabel: string
  readonly sessionId: string
  readonly title: string
}

export interface YzjTrigger {
  readonly group: YzjGroup
  readonly message: YzjMessage
  readonly context: readonly YzjMessage[]
  readonly prompt: string
  readonly route?: YzjTopicRoute
}

export interface AgentTurnOutcome {
  readonly text: string
  readonly reason?: TurnEndReason
}

export interface GatewayAccountStateData {
  identity: YzjIdentity
  cursors: Record<string, string>
  processed: { msgId: string; time: number }[]
  pending: YzjTrigger[]
  messageTopics: Record<string, string>
  managedTitles: Record<string, string>
  /** Task message ids whose Agent authority was revoked (timeout/shutdown). */
  revoked: string[]
}

export interface GatewayStateData {
  version: 2
  accounts: Record<string, GatewayAccountStateData>
}

export interface YzjAgentMessageSource {
  readonly kind: 'yzj-agent'
  readonly groupId: string
  readonly messageId: string
  readonly senderOpenId: string
  readonly accountKey: string
  readonly accountOrgId: string
  readonly accountOpenId: string
  readonly conversationKind: 'group' | 'direct'
  readonly groupName?: string
  readonly channelKey?: string
  readonly topicRootId: string
  readonly topicKey: string
  readonly topicLabel?: string
  readonly managedTitle?: string
  readonly writeMode: 'standard'
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    // The gateway no longer appends this event: persistence cold reads assert a
    // KNOWN_SESSION_EVENT_TYPES whitelist and an unknown type makes the whole
    // log unreadable. The projection still folds it from historical logs.
    'yzj/session-identity': YzjSessionIdentityProjection
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    yzjSessionIdentity: YzjSessionIdentityProjection | null
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'yzj-agent': YzjAgentMessageSource
  }
}
