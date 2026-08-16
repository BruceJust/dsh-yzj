// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { clipboardImageFile, YzjPanel, type YzjPanelProps } from '../src/client/panel.tsx'
import type { YzjPanelInject } from '../src/client/rpc.ts'
import type { YzjPanelState } from '../src/client/stores.ts'

function clipboard(
  items: Array<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>,
  files: File[] = [],
): Pick<DataTransfer, 'items' | 'files'> {
  return {
    items: items as unknown as DataTransferItemList,
    files: files as unknown as FileList,
  }
}

describe('clipboardImageFile', () => {
  it('selects an image item without treating pasted text as a file', () => {
    const image = new File(['pixels'], 'clipboard.png', { type: 'image/png' })
    const data = clipboard([
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ])

    expect(clipboardImageFile(data)).toBe(image)
  })

  it('falls back to clipboard files when an item has no file handle', () => {
    const image = new File(['pixels'], 'clipboard.webp', { type: 'image/webp' })
    const data = clipboard([
      { kind: 'file', type: 'image/webp', getAsFile: () => null },
    ], [image])

    expect(clipboardImageFile(data)).toBe(image)
  })

  it('leaves ordinary text and non-image files untouched', () => {
    const documentFile = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const data = clipboard([
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ], [documentFile])

    expect(clipboardImageFile(data)).toBeUndefined()
  })
})

function panelProps(
  uploadFile: YzjPanelInject['uploadFile'],
  sendMessage: YzjPanelInject['sendMessage'],
): YzjPanelProps {
  const state: YzjPanelState = {
    open: true, tab: 'chat', panelX: 20, panelY: 20, panelWidth: 760,
    workspaces: [], workspaceId: '', docs: [], docId: '', events: [],
    calYear: 2026, calMonth: 8, calDay: '', calEvents: [], calEventId: '',
    groups: [{ groupId: 'g1', groupName: '研发群', unreadCount: 0 }],
    groupsPage: 1, groupsMore: false, groupId: 'g1', messages: [],
    messagesMore: false, messagesAnchor: '', anchorMsgId: '', unreadTotal: 0,
    loading: false, error: '',
  }
  const ok = async (value: unknown = {}): Promise<{ ok: true; value: unknown }> => ({ ok: true, value })
  const inject: YzjPanelInject = {
    fetchWorkspaces: async () => ok([]), fetchDocs: async () => ok([]),
    fetchEvents: async () => ok([]), fetchGroups: async () => ok({ list: [] }),
    fetchMessages: async () => ok({ list: [] }),
    fetchWhoami: async () => ok([{ openId: 'me', name: '我' }]),
    fetchSearch: async () => ok([]), fetchDoc: async () => ok({}),
    fetchDocBlocks: async () => ok([]), fetchSheet: async () => ok({}),
    fetchWorkspace: async () => ok({}), fetchEvent: async () => ok({}),
    fetchContact: async () => ok([]), fetchFileData: async () => ok({}),
    sendMessage, uploadFile, fetchWrite: async () => ok({}),
    decideWrite: async () => ok({}),
  }
  const actions = new Proxy({}, { get: () => () => undefined }) as YzjPanelProps['actions']
  return { ...inject, actions, useStore: selector => selector(state) }
}

describe('YzjPanel clipboard paste', () => {
  it('stages a pasted image and uploads it only after explicit send', async () => {
    const uploadFile = vi.fn<YzjPanelInject['uploadFile']>(async () => ({ ok: true, value: { fileId: 'file-1' } }))
    const sendMessage = vi.fn<YzjPanelInject['sendMessage']>(async () => ({ ok: true, value: { msgId: 'sent-1' } }))
    const createObjectURL = vi.fn(() => 'blob:clipboard-preview')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(YzjPanel, panelProps(uploadFile, sendMessage)))
      await Promise.resolve()
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')
    expect(textarea).not.toBeNull()
    const image = new File(['pixels'], 'clipboard.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: clipboard([{ kind: 'file', type: 'image/png', getAsFile: () => image }]),
    })
    await act(async () => { textarea?.dispatchEvent(event) })

    expect(event.defaultPrevented).toBe(true)
    expect(container.querySelector('[data-testid="pending-image"]')).not.toBeNull()
    expect(createObjectURL).toHaveBeenCalledWith(image)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()

    const send = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '发送')
    await act(async () => {
      send?.click()
      await vi.waitFor(() => {
        expect(uploadFile).toHaveBeenCalledWith('clipboard.png', expect.any(String), image.size)
        expect(sendMessage).toHaveBeenCalledWith('g1', '[图片]', {
          msgType: 'richText', images: ['file-1'],
        })
      })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(container.querySelector('[data-testid="pending-image"]')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:clipboard-preview')

    act(() => root.unmount())
    container.remove()
  })
})
