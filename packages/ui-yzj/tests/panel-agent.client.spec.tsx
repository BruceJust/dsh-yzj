// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { YzjPanel, withAgentAlias, type YzjPanelProps } from '../src/client/panel.tsx'
import type { YzjPanelInject } from '../src/client/rpc.ts'
import type { YzjPanelState } from '../src/client/stores.ts'

describe('withAgentAlias', () => {
  it('creates a ready-to-type Agent draft', () => {
    expect(withAgentAlias('')).toBe('@agent ')
    expect(withAgentAlias('   ')).toBe('@agent ')
  })

  it('preserves existing Agent prefixes', () => {
    expect(withAgentAlias('@agent 请总结')).toBe('@agent 请总结')
    expect(withAgentAlias('  @智能体 请总结')).toBe('  @智能体 请总结')
  })

  it('moves the command alias to the required leading position', () => {
    expect(withAgentAlias('他说的啥')).toBe('@agent 他说的啥')
    expect(withAgentAlias('先看看 @agent 是否在线')).toBe('@agent 先看看 @agent 是否在线')
  })
})

const ok = async (value: unknown = {}): Promise<{ ok: true; value: unknown }> => ({ ok: true, value })

function panelProps(): YzjPanelProps {
  const state: YzjPanelState = {
    open: true, tab: 'chat', panelX: 20, panelY: 20, panelWidth: 760,
    workspaces: [], workspaceId: '', docs: [], docId: '', events: [],
    calYear: 2026, calMonth: 8, calDay: '', calEvents: [], calEventId: '',
    groups: [{ groupId: 'g1', groupName: '研发群', unreadCount: 0 }],
    groupsPage: 1, groupsMore: false, groupId: 'g1',
    messages: [{
      msgId: 'm1', content: '他说的啥', fromOpenId: 'user-1', msgType: 'text',
      sendTime: '2026-08-16 10:00:00.000', param: {},
    }],
    messagesMore: false, messagesAnchor: 'm1', anchorMsgId: '',
    unreadTotal: 0, loading: false, error: '',
  }
  const inject: YzjPanelInject = {
    fetchWorkspaces: async () => ok([]), fetchDocs: async () => ok([]),
    fetchEvents: async () => ok([]), fetchGroups: async () => ok({ list: [] }),
    fetchMessages: async () => ok({ list: [] }),
    fetchWhoami: async () => ok({ openId: 'me', name: '我' }),
    fetchSearch: async () => ok([]), fetchDoc: async () => ok({}),
    fetchDocBlocks: async () => ok([]), fetchSheet: async () => ok({}),
    fetchWorkspace: async () => ok({}), fetchEvent: async () => ok({}),
    fetchContact: async openId => ok({ openId, name: '张炜' }),
    fetchFileData: async () => ok({}), sendMessage: async () => ok({ msgId: 'sent-1' }),
    uploadFile: async () => ok({ fileId: 'file-1' }), fetchWrite: async () => ok({}),
    decideWrite: async () => ok({}),
  }
  const actions = new Proxy({}, { get: () => () => undefined }) as YzjPanelProps['actions']
  return { ...inject, actions, useStore: selector => selector(state) }
}

describe('YzjPanel Agent shortcuts', () => {
  it('prepares a reply command and exposes Agent in the @ menu', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<YzjPanel {...panelProps()} />)
      await Promise.resolve()
    })

    const replyAgent = container.querySelector<HTMLButtonElement>('button[aria-label="@agent 回复"]')
    expect(replyAgent).not.toBeNull()
    act(() => replyAgent?.click())
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.value).toBe('@agent ')
    expect(container.textContent).toContain('回复：他说的啥')

    const mention = container.querySelector<HTMLButtonElement>('button[aria-label="@ 提及成员"]')
    act(() => mention?.click())
    const menu = container.querySelector<HTMLElement>('[aria-label="提及成员"]')
    expect(menu?.textContent).toContain('@agent')
    const menuAgent = Array.from(menu?.querySelectorAll('button') ?? []).find(button => button.textContent?.includes('@agent'))
    act(() => menuAgent?.click())
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.value).toBe('@agent ')

    act(() => root.unmount())
    container.remove()
  })
})
