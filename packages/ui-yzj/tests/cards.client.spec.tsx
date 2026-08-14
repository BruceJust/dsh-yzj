// @vitest-environment jsdom
/**
 * Browser-half component specs: the keyed tool card renders pending and
 * settled blocks (structured meta payloads, error states, digest fallback),
 * and the panel store/inject face behave as the components expect.
 */
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { YzjToolCard } from '../src/client/cards.tsx'
import { createYzjStore } from '../src/client/stores.ts'
import { createYzjPanelInject } from '../src/client/rpc.ts'
import type { YzjPanelInject } from '../src/client/rpc.ts'

function renderCard(block: unknown, toolName = 'yzj_doc_get'): string {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <YzjToolCard
        toolName={toolName}
        block={block as ToolResultNode}
        callId="c1"
        cwd="/workspace"
        openFile={() => {}}
      />,
    )
  })
  return container.textContent ?? ''
}

function settledBlock(over: Partial<ToolResultNode>): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 1,
    callId: 'c1',
    call: { name: 'yzj_doc_get', argsRaw: '{"id":"doc1"}' },
    callTime: 1,
    content: [{ type: 'text', text: 'digest text' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

describe('YzjToolCard', () => {
  it('renders the family title for a pending call', () => {
    const running = { callId: 'c1', name: 'yzj_doc_list', argsRaw: '{"workspace":"kb"}', turn: 1, step: 1, time: 1, callView: null, subCalls: [] }
    const text = renderCard(running, 'yzj_doc_list')
    expect(text).toContain('文档列表')
    expect(text).toContain('执行中')
  })

  it('renders structured meta payloads for a settled doc call', () => {
    const block = settledBlock({
      meta: {
        record: {
          id: 'doc1',
          title: '项目计划',
          fileSuffix: 'otl',
          permissionLevel: 1,
          openWebUrl: 'https://www.yunzhijia.com/knowledge/lingee/#/store/doc/doc1',
        },
      },
    })
    const text = renderCard(block)
    expect(text).toContain('项目计划')
    expect(text).toContain('在线文档')
    expect(text).toContain('打开文档')
  })

  it('renders error state with the error text', () => {
    const block = settledBlock({ isError: true, content: [{ type: 'text', text: 'yzj doc get failed (exit 7): no permission' }] })
    const text = renderCard(block)
    expect(text).toContain('失败')
    expect(text).toContain('no permission')
  })

  it('falls back to a friendly summary when meta carries no structure', () => {
    const block = settledBlock({ meta: { __oversized: true } })
    const text = renderCard(block, 'yzj_doc_workspace_list')
    expect(text).toContain('已完成')
    expect(text).not.toContain('digest text')
  })

  it('renders friendly action summaries without ids for sends', () => {
    const block = settledBlock({
      meta: { payload: { msgId: '6a7f1234e4b0abc' }, msgId: '6a7f1234e4b0abc' },
    })
    const text = renderCard(block, 'yzj_im_message_send')
    expect(text).toContain('消息已发送')
    expect(text).not.toContain('6a7f1234e4b0abc')
  })
})

describe('createYzjStore', () => {
  it('initializes closed with the docs tab', () => {
    const handle = createYzjStore()
    const instance = handle.create()
    expect(instance.getSnapshot().open).toBe(false)
    expect(instance.getSnapshot().tab).toBe('docs')
  })

  it('bakes actions draft-stripped', () => {
    const handle = createYzjStore()
    const instance = handle.create()
    instance.actions.setOpen(true)
    instance.actions.setWorkspaces([{ id: 'kb1' }])
    expect(instance.getSnapshot().open).toBe(true)
    expect(instance.getSnapshot().workspaces).toEqual([{ id: 'kb1' }])
  })
})

describe('createYzjPanelInject', () => {
  function stubConnection(results: Record<string, { ok: true; value: unknown } | { ok: false; error: { message: string } }>): unknown {
    return {
      rpc: {
        call: (_channel: string, endpoint: string) => Promise.resolve(results[endpoint] ?? { ok: false, error: { message: 'unknown endpoint' } }),
      },
    }
  }

  it('forwards endpoint payloads and normalizes errors', async () => {
    const connection = stubConnection({
      workspaces: { ok: true, value: [{ id: 'kb1', name: '我的知识' }] },
    })
    const inject = createYzjPanelInject(connection as Parameters<typeof createYzjPanelInject>[0]) as YzjPanelInject
    const workspaces = await inject.fetchWorkspaces()
    expect(workspaces.ok && workspaces.value).toEqual([{ id: 'kb1', name: '我的知识' }])
    const events = await inject.fetchEvents('2026-08-14', '2026-08-14')
    expect(events).toEqual({ ok: false, error: { message: 'unknown endpoint' } })
  })

  it('fails closed without a connection', async () => {
    const inject = createYzjPanelInject(undefined)
    const result = await inject.fetchWhoami()
    expect(result).toEqual({ ok: false, error: { message: 'connection unavailable' } })
  })
})
