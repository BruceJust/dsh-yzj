// @vitest-environment jsdom
/**
 * Confirmation-card specs: a gated pending record renders the domain body,
 * the risk tag (strong = red), and the decision verbs; an approved record
 * shows the executing state; ungated or settled records delegate to the
 * ordinary tool card.
 */
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { YzjWriteToolCard, writableDraft, type WriteCardInjected, type WriteCardStoreProps } from '../src/client/write-card.tsx'
import type { YzjWriteRecord } from '../src/write-gate.ts'
import { createYzjStore } from '../src/client/stores.ts'

type CardProps = Parameters<typeof YzjWriteToolCard>[0]

async function renderCard(over: Partial<CardProps>): Promise<string> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<YzjWriteToolCard {...over as CardProps} />)
    // Flush the async fetchWrite query and the resulting setState.
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return container.textContent ?? ''
}

const STORE = createYzjStore()

function storeProps(): WriteCardStoreProps {
  return {
    useStore: ((selector: (state: never) => unknown) => selector(STORE.create().getSnapshot() as never)) as WriteCardStoreProps['useStore'],
    actions: {} as WriteCardStoreProps['actions'],
  }
}

function baseProps(over: Partial<CardProps>): CardProps {
  return {
    toolName: 'yzj_im_message_send',
    callId: 'c1',
    block: { callId: 'c1', name: 'yzj_im_message_send', argsRaw: '{}', turn: 1, step: 1, time: 1, callView: null, subCalls: [] },
    cwd: '/workspace',
    openFile: () => {},
    inspect: () => {},
    fetchWrite: async () => undefined,
    decideWrite: async () => true,
    fetchMessages: async () => ({ ok: false, error: { message: 'x' } }),
    fetchDocs: async () => ({ ok: false, error: { message: 'x' } }),
    editDraft: () => {},
    ...storeProps(),
    ...over,
  }
}

function pendingRecord(over: Partial<YzjWriteRecord> = {}): YzjWriteRecord {
  return {
    writeId: 'w1', sessionId: 's1', toolName: 'yzj_im_message_send', callId: 'c1',
    level: 'standard', domain: 'im', args: { groupId: 'g1', content: '全文消息内容' },
    reason: 'r', status: 'pending', time: 1,
    ...over,
  }
}

describe('YzjWriteToolCard', () => {
  it('renders the confirmation body and verbs for a pending standard write', async () => {
    const injected: WriteCardInjected = {
      fetchWrite: async () => pendingRecord(),
      decideWrite: vi.fn(async () => true),
      fetchMessages: async () => ({ ok: false, error: { message: 'x' } }),
      fetchDocs: async () => ({ ok: false, error: { message: 'x' } }),
      editDraft: vi.fn(),
    }
    const text = await renderCard(baseProps({ ...injected }))
    expect(text).toContain('发送消息')
    expect(text).toContain('需确认')
    expect(text).toContain('群 g1')
    expect(text).toContain('全文消息内容')
    expect(text).toContain('确认')
    expect(text).toContain('取消')
    expect(text).toContain('查看上下文')
    expect(text).toContain('编辑')
  })

  it('marks strong deletions with the red tag', async () => {
    const injected: WriteCardInjected = {
      fetchWrite: async () => pendingRecord({ toolName: 'yzj_doc_delete', level: 'strong', domain: 'doc', args: { id: 'd1' } }),
      decideWrite: async () => true,
      fetchMessages: async () => ({ ok: false, error: { message: 'x' } }),
      fetchDocs: async () => ({ ok: false, error: { message: 'x' } }),
      editDraft: () => {},
    }
    const text = await renderCard(baseProps({ toolName: 'yzj_doc_delete', ...injected }))
    expect(text).toContain('删除文档')
    expect(text).toContain('强确认')
    expect(text).toContain('文档')
    expect(text).toContain('d1')
  })

  it('shows the executing state once approved', async () => {
    const injected: WriteCardInjected = {
      fetchWrite: async () => pendingRecord({ status: 'approved' }),
      decideWrite: async () => true,
      fetchMessages: async () => ({ ok: false, error: { message: 'x' } }),
      fetchDocs: async () => ({ ok: false, error: { message: 'x' } }),
      editDraft: () => {},
    }
    const text = await renderCard(baseProps({ ...injected }))
    expect(text).toContain('已批准，正在执行')
    expect(text).not.toContain('查看上下文')
    expect(text).not.toContain('取消')
  })

  it('delegates to the ordinary card when the call is not gated', async () => {
    const injected: WriteCardInjected = {
      fetchWrite: async () => undefined,
      decideWrite: async () => true,
      fetchMessages: async () => ({ ok: false, error: { message: 'x' } }),
      fetchDocs: async () => ({ ok: false, error: { message: 'x' } }),
      editDraft: () => {},
    }
    const text = await renderCard(baseProps({ ...injected }))
    expect(text).toContain('发送消息')
    expect(text).not.toContain('需确认')
  })

  it('delegates to the ordinary result card after settlement', async () => {
    const result: ToolResultNode = {
      kind: 'tool-result', seq: 1, time: 1, callId: 'c1',
      call: { name: 'yzj_im_message_send', argsRaw: '{}' }, callTime: 1,
      content: [{ type: 'text', text: 'sent (m1)' }], isError: false,
      callView: null, resultView: null, subCalls: [],
    }
    const injected: WriteCardInjected = {
      fetchWrite: async () => pendingRecord({ status: 'done' }),
      decideWrite: async () => true,
      fetchMessages: async () => ({ ok: false, error: { message: 'x' } }),
      fetchDocs: async () => ({ ok: false, error: { message: 'x' } }),
      editDraft: () => {},
    }
    const text = await renderCard(baseProps({ toolName: 'yzj_im_message_send', block: result, ...injected }))
    expect(text).toContain('sent (m1)')
    expect(text).not.toContain('需确认')
  })
})

describe('writableDraft', () => {
  it('extracts the im content for editing', () => {
    const record = pendingRecord()
    expect(writableDraft(record)).toBe('全文消息内容')
  })

  it('extracts sheet records JSON', () => {
    const record = pendingRecord({ domain: 'sheet', args: { id: 's1', tableId: 1, records: '[{"fieldsValue":{"a":"1"}}]' } })
    expect(writableDraft(record)).toBe('[{"fieldsValue":{"a":"1"}}]')
  })

  it('returns empty when nothing is editable', () => {
    const record = pendingRecord({ domain: 'calendar', args: { title: '', start: '2026-08-14' } })
    expect(writableDraft(record)).toBe('')
  })
})
