import { describe, expect, it } from 'vitest'
import { mergeGroupWindow } from '../src/client/im-cache.ts'

describe('mergeGroupWindow', () => {
  it('refreshes unread counts while preserving already loaded tail pages', () => {
    const current = [
      { groupId: 'g1', groupName: '产品群', unreadCount: 0, localOnly: 'kept' },
      { groupId: 'g2', groupName: '后续页群', unreadCount: 1 },
    ]
    const incoming = [
      { groupId: 'g1', groupName: '产品讨论群', unreadCount: 4 },
      { groupId: 'g3', groupName: '新会话', unreadCount: 2 },
    ]

    expect(mergeGroupWindow(current, incoming)).toEqual([
      { groupId: 'g1', groupName: '产品讨论群', unreadCount: 4, localOnly: 'kept' },
      { groupId: 'g3', groupName: '新会话', unreadCount: 2 },
      { groupId: 'g2', groupName: '后续页群', unreadCount: 1 },
    ])
  })

  it('uses the incoming order for a previously empty list', () => {
    const incoming = [
      { groupId: 'g2', unreadCount: 3 },
      { groupId: 'g1', unreadCount: 1 },
    ]

    expect(mergeGroupWindow([], incoming)).toEqual(incoming)
  })
})
