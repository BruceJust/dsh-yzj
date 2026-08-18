import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { yzjSessionIdentityProjection } from '../src/projection.ts'

function event(type: string, data: unknown): SessionEvent {
  return { seq: 0, time: 1, type, data } as SessionEvent
}

describe('yzjSessionIdentityProjection', () => {
  it('projects the latest whole-value identity event', () => {
    const identity = {
      version: 1 as const,
      accountKey: 'a1', accountOrgId: 'org', accountOpenId: 'me',
      conversationKind: 'group' as const,
      groupId: 'g1', groupName: '研发群', channelKey: 'channel-1',
      topicRootId: 'root-1', topicKey: 'topic-1', topicLabel: '发布计划',
      managedTitle: '群 · 研发群 · 发布计划',
    }
    const next = yzjSessionIdentityProjection.apply(
      null,
      event('yzj/session-identity', identity),
    )
    expect(next).toEqual(identity)
    expect(yzjSessionIdentityProjection.view(next)).toBe(next)
  })

  it('recovers structural identity from legacy Yunzhijia message sources', () => {
    const next = yzjSessionIdentityProjection.apply(null, event('user/message', {
      source: {
        kind: 'yzj-agent', groupId: 'g1', messageId: 'm1', senderOpenId: 'u1',
        accountKey: 'a1', accountOrgId: 'org', accountOpenId: 'me',
        conversationKind: 'group', topicRootId: 'root-1', topicKey: 'topic-1',
        writeMode: 'standard',
      },
    }))
    expect(next).toMatchObject({
      version: 1, groupId: 'g1', groupName: '', topicKey: 'topic-1', topicLabel: '',
    })
    expect(next?.channelKey).toContain('a1:g1')
  })

  it('ignores unrelated and malformed message sources', () => {
    const initial = yzjSessionIdentityProjection.init()
    expect(yzjSessionIdentityProjection.apply(initial, event('user/message', {
      source: { kind: 'user-rpc' },
    }))).toBe(initial)
    expect(yzjSessionIdentityProjection.apply(initial, event('user/message', {
      source: { kind: 'yzj-agent', accountKey: '' },
    }))).toBe(initial)
  })
})
