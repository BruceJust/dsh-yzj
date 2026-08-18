// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  forwardMessagePayload, messageCopyText, YzjPanel, type YzjPanelProps,
} from '../src/client/panel.tsx'
import type { YzjPanelInject } from '../src/client/rpc.ts'
import { putMessageWindow } from '../src/client/im-cache.ts'
import type { YzjPanelState } from '../src/client/stores.ts'

describe('message action payloads', () => {
  it('copies text, file names, and link cards predictably', () => {
    expect(messageCopyText({ msgType: 'text', content: '正文' })).toBe('正文')
    expect(messageCopyText({ msgType: 'file', param: { name: '报告.pdf' } })).toBe('报告.pdf')
    expect(messageCopyText({
      msgType: 'other', content: '说明',
      param: { title: '详情', webpageUrl: 'https://example.com' },
    })).toBe('详情\n说明\nhttps://example.com')
  })

  it('preserves supported text, file, and rich-image forward payloads', () => {
    expect(forwardMessagePayload({ msgType: 'text', content: '正文' })).toEqual({
      content: '正文', opts: { msgType: 'text' },
    })
    expect(forwardMessagePayload({ msgType: 'file', param: { file_id: 'file-1' } })).toEqual({
      opts: { msgType: 'file', fileId: 'file-1' },
    })
    expect(forwardMessagePayload({
      msgType: 'richText', content: '图文\n[图片]',
      param: { desc: [{ type: 'image', data: 'image-1' }] },
    })).toEqual({
      content: '图文\n[图片]', opts: { msgType: 'richText', images: ['image-1'] },
    })
  })
})

const ok = async (value: unknown = {}): Promise<{ ok: true; value: unknown }> => ({ ok: true, value })

function panelProps(
  sendMessage: YzjPanelInject['sendMessage'],
  fetchMessages: YzjPanelInject['fetchMessages'] = async () => ok({ list: [] }),
): YzjPanelProps {
  const state: YzjPanelState = {
    open: true, tab: 'chat', panelX: 20, panelY: 20, panelWidth: 760,
    workspaces: [], workspaceId: '', docs: [], docId: '', events: [],
    calYear: 2026, calMonth: 8, calDay: '', calEvents: [], calEventId: '',
    groups: [
      { groupId: 'g1', groupName: '当前群', unreadCount: 0 },
      { groupId: 'g2', groupName: '目标群', unreadCount: 0 },
    ],
    groupsPage: 1, groupsMore: false, groupId: 'g1',
    messages: [{
      msgId: 'm1', content: '需要转发', msgType: 'text', fromOpenId: 'user-1',
      sendTime: '2026-08-16 10:00:00.000', param: {},
    }],
    messagesMore: false, messagesAnchor: 'm1', anchorMsgId: '', unreadTotal: 0,
    loading: false, error: '',
  }
  const inject: YzjPanelInject = {
    fetchWorkspaces: async () => ok([]), fetchDocs: async () => ok([]),
    fetchEvents: async () => ok([]), fetchGroups: async () => ok({ list: [] }),
    fetchMessages,
    fetchWhoami: async () => ok([{ openId: 'me', name: '我' }]),
    fetchSearch: async () => ok([]), fetchDoc: async () => ok({}),
    fetchDocBlocks: async () => ok([]), fetchSheet: async () => ok({}),
    fetchWorkspace: async () => ok({}), fetchEvent: async () => ok({}),
    fetchContact: async () => ok([]), fetchFileData: async () => ok({}),
    sendMessage, uploadFile: async () => ok({ fileId: 'file-1' }),
    fetchWrite: async () => ok({}), decideWrite: async () => ok({}),
  }
  const actions = new Proxy({}, { get: () => () => undefined }) as YzjPanelProps['actions']
  return { ...inject, actions, useStore: selector => selector(state) }
}

describe('YzjPanel message context menu', () => {
  it('copies and forwards only after an explicit target choice', async () => {
    const sendMessage = vi.fn<YzjPanelInject['sendMessage']>(async () => ({ ok: true, value: { msgId: 'sent-1' } }))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(YzjPanel, panelProps(sendMessage)))
      await Promise.resolve()
    })
    const row = container.querySelector<HTMLElement>('[data-message-id="m1"]')
    expect(row).not.toBeNull()

    const openMenu = async (): Promise<void> => {
      await act(async () => {
        row?.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: 120, clientY: 160,
        }))
        await new Promise(resolve => requestAnimationFrame(resolve))
      })
    }
    await openMenu()
    const menu = container.querySelector<HTMLElement>('[role="menu"][aria-label="消息操作"]')
    expect(menu?.textContent).toContain('复制')
    expect(menu?.textContent).toContain('回复')
    expect(menu?.textContent).toContain('转发')
    expect(menu?.textContent).not.toContain('撤回')
    const copy = Array.from(menu?.querySelectorAll('button') ?? []).find(button => button.textContent === '复制')
    await act(async () => {
      copy?.click()
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('需要转发'))
    })

    await openMenu()
    const forward = Array.from(container.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === '转发') as HTMLButtonElement
    act(() => forward.click())
    expect(sendMessage).not.toHaveBeenCalled()
    const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-label="转发消息"]')
    const target = Array.from(dialog?.querySelectorAll('button') ?? []).find(button => button.textContent?.includes('目标群'))
    await act(async () => {
      target?.click()
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith('g2', '需要转发', { msgType: 'text' }))
    })

    act(() => root.unmount())
    container.remove()
  })
})

describe('YzjPanel cached conversation sync', () => {
  it('requests newer messages immediately when a cached group opens', async () => {
    putMessageWindow('g1', [{ msgId: 'cached-1', content: '缓存消息', msgType: 'text' }], true)
    const fetchMessages = vi.fn<YzjPanelInject['fetchMessages']>(async () => ({
      ok: true,
      value: { list: [{ msgId: 'new-1', content: '最新消息', msgType: 'text' }] },
    }))
    const sendMessage = vi.fn<YzjPanelInject['sendMessage']>(async () => ({ ok: true, value: {} }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(YzjPanel, panelProps(sendMessage, fetchMessages)))
      await Promise.resolve()
    })

    const group = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('当前群'))
    await act(async () => {
      group?.click()
      await vi.waitFor(() => {
        expect(fetchMessages).toHaveBeenCalledWith('g1', 30, { type: 'new', msgId: 'cached-1' })
      })
    })

    act(() => root.unmount())
    container.remove()
  })
})
