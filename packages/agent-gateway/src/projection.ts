import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { YzjSessionIdentityProjection } from '@dsh-yzj/bridge'
import { z } from 'zod'
import type { YzjAgentMessageSource } from './types.ts'

const identitySchema = z.object({
  version: z.literal(1),
  accountKey: z.string().min(1),
  accountOrgId: z.string().min(1),
  accountOpenId: z.string().min(1),
  conversationKind: z.enum(['group', 'direct']),
  groupId: z.string().min(1),
  groupName: z.string(),
  channelKey: z.string().min(1),
  topicRootId: z.string().min(1),
  topicKey: z.string().min(1),
  topicLabel: z.string(),
  managedTitle: z.string(),
}).nullable()

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function legacyIdentity(source: YzjAgentMessageSource): YzjSessionIdentityProjection | undefined {
  if (
    source.accountKey === '' || source.accountOrgId === '' || source.accountOpenId === ''
    || source.groupId === '' || source.topicRootId === '' || source.topicKey === ''
  ) return undefined
  return {
    version: 1,
    accountKey: source.accountKey,
    accountOrgId: source.accountOrgId,
    accountOpenId: source.accountOpenId,
    conversationKind: source.conversationKind,
    groupId: source.groupId,
    groupName: text(source.groupName),
    channelKey: text(source.channelKey) || `yzj-channel-legacy:${source.accountKey}:${source.groupId}`,
    topicRootId: source.topicRootId,
    topicKey: source.topicKey,
    topicLabel: text(source.topicLabel),
    managedTitle: text(source.managedTitle),
  }
}

/** Last-wins durable identity fold, with a conservative legacy source fallback. */
export const yzjSessionIdentityProjection: ProjectionDefinition<
  'yzjSessionIdentity', YzjSessionIdentityProjection | null
> = {
  key: 'yzjSessionIdentity',
  schema: identitySchema,
  stateVersion: 1,
  init: () => null,
  apply(state, event: SessionEvent) {
    if (event.type === 'yzj/session-identity') return event.data
    if (event.type !== 'user/message') return state
    const source = event.data.source as Partial<YzjAgentMessageSource>
    if (source.kind !== 'yzj-agent') return state
    return legacyIdentity(source as YzjAgentMessageSource) ?? state
  },
  view: state => state,
}
