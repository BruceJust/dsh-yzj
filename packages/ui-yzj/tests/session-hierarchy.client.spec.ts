import { describe, expect, it } from 'vitest'
import type { SessionSummary, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import {
  projectYzjSessionHierarchy,
  type WorkspaceSessionHierarchyInput,
} from '../src/client/session-hierarchy.ts'

const workspace = {
  workspaceId: 'ws-yzj', path: '/Users/test/.dsh/yzj-agent/workspace',
  title: '云之家 Agent', sessionIds: [],
  createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
} as unknown as WorkspaceView

function input(overrides: Partial<SessionSummary> = {}): WorkspaceSessionHierarchyInput {
  return {
    workspace,
    session: {
      id: 'session-yzj-topic-1', title: '群 · 研发群 · 发布计划',
      displayTitle: '群 · 研发群 · 发布计划', blank: false, running: false,
      completed: false, updatedAt: 1,
      projectionValues: {
        yzjSessionIdentity: {
          version: 1, accountKey: 'a1', accountOrgId: 'org', accountOpenId: 'me',
          conversationKind: 'group', groupId: 'g1', groupName: '研发群',
          channelKey: 'channel-1', topicRootId: 'root-1', topicKey: 'topic-1',
          topicLabel: '发布计划', managedTitle: '群 · 研发群 · 发布计划',
        },
      },
      ...overrides,
    } as SessionSummary,
  }
}

describe('projectYzjSessionHierarchy', () => {
  it('groups topic Sessions by stable channel identity', () => {
    expect(projectYzjSessionHierarchy(input())).toEqual({
      path: [{ id: 'channel-1', label: '研发群', kind: 'group' }],
      leafLabel: '发布计划',
      aliases: ['群 · 研发群 · 发布计划', '研发群', '发布计划'],
    })
  })

  it('places direct conversations in one compact private-chat branch', () => {
    const base = input()
    const identity = base.session.projectionValues?.yzjSessionIdentity
    const claim = projectYzjSessionHierarchy(input({
      title: '私聊 · 李明', displayTitle: '私聊 · 李明',
      projectionValues: {
        yzjSessionIdentity: identity === null || identity === undefined ? null : {
          ...identity, conversationKind: 'direct', groupName: '李明',
          managedTitle: '私聊 · 李明',
        },
      },
    }))
    expect(claim?.path).toEqual([{ id: 'direct:a1', label: '私聊', kind: 'direct' }])
    expect(claim?.leafLabel).toBe('李明')
  })

  it('preserves an explicit Web rename as the leaf label', () => {
    expect(projectYzjSessionHierarchy(input({ title: '登顶计划跟进' }))?.leafLabel)
      .toBe('登顶计划跟进')
  })

  it('contains unprojected Gateway logs under legacy history', () => {
    expect(projectYzjSessionHierarchy(input({ projectionValues: {} }))).toEqual({
      path: [{ id: 'yzj:legacy', label: '历史会话', kind: 'legacy' }],
      leafLabel: '群 · 研发群 · 发布计划',
      aliases: ['群 · 研发群 · 发布计划'],
    })
  })

  it('does not claim ordinary Sessions or similarly titled foreign Workspaces', () => {
    expect(projectYzjSessionHierarchy(input({ id: 'session-normal', projectionValues: {} })))
      .toBeUndefined()
    expect(projectYzjSessionHierarchy({
      ...input({ projectionValues: {} }),
      workspace: { ...workspace, path: '/Users/test/project' },
    })).toBeUndefined()
  })
})
