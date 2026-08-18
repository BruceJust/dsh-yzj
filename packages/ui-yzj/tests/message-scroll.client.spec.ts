import { describe, expect, it } from 'vitest'
import {
  firstUnreadMessageId, latestServerMessageId, mergeMessageWindow, scrollTopAfterPrepend,
} from '../src/client/panel.tsx'

describe('scrollTopAfterPrepend', () => {
  it('keeps the previously visible message anchored after rows are prepended', () => {
    expect(scrollTopAfterPrepend(120, 800, 1200)).toBe(520)
  })

  it('does not move backward when content height is unchanged or smaller', () => {
    expect(scrollTopAfterPrepend(80, 800, 800)).toBe(80)
    expect(scrollTopAfterPrepend(80, 800, 700)).toBe(80)
  })

  it('never returns a negative scroll offset', () => {
    expect(scrollTopAfterPrepend(-20, 300, 300)).toBe(0)
  })
})

describe('message window synchronization', () => {
  it('anchors after the latest server row when an optimistic row is last', () => {
    expect(latestServerMessageId([
      { msgId: 'server-1' }, { msgId: 'local-123' },
    ])).toBe('server-1')
  })

  it('updates duplicate ids and appends genuinely new messages', () => {
    expect(mergeMessageWindow(
      [{ msgId: 'm1', content: 'old' }, { msgId: 'm2', content: 'same' }],
      [{ msgId: 'm2', content: 'updated' }, { msgId: 'm3', content: 'new' }],
    )).toEqual([
      { msgId: 'm1', content: 'old' },
      { msgId: 'm2', content: 'updated' },
      { msgId: 'm3', content: 'new' },
    ])
  })

  it('places the unread boundary before the last unread window', () => {
    const messages = [{ msgId: 'm1' }, { msgId: 'm2' }, { msgId: 'm3' }]
    expect(firstUnreadMessageId(messages, 1)).toBe('m3')
    expect(firstUnreadMessageId(messages, 2)).toBe('m2')
    expect(firstUnreadMessageId(messages, 20)).toBe('m1')
    expect(firstUnreadMessageId(messages, 0)).toBe('')
  })
})
