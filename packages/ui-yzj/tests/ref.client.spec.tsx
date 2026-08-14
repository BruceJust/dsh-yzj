// @vitest-environment jsdom
/**
 * Reference-codec and context-resolution specs: encodeRef/decodeRef round
 * trips (including the group field), malformed refs degrade to undefined,
 * and the message branch re-fetches the original body by (groupId, msgId)
 * with a marked snapshot fallback when the anchor is absent.
 */
import { describe, expect, it } from 'vitest'
import { decodeRef, encodeRef } from '../src/client/input-source.ts'
import { clearRefContextCache, fetchRefContext } from '../src/client/context.ts'
import type { YzjPanelInject } from '../src/client/rpc.ts'
import type { YzjDragRef } from '../src/client/panel.tsx'

describe('encodeRef / decodeRef', () => {
  it('round-trips a full ref including group', () => {
    const ref: YzjDragRef = {
      kind: 'message', id: 'msg1', title: 'hello', sub: '08-14 22:14',
      url: 'https://example.com/1', group: 'grp1',
    }
    expect(decodeRef(encodeRef(ref))).toEqual(ref)
  })

  it('round-trips a minimal ref without optional fields', () => {
    const ref: YzjDragRef = { kind: 'doc', id: 'doc1', title: '计划' }
    expect(decodeRef(encodeRef(ref))).toEqual(ref)
  })

  it('rejects malformed refs', () => {
    expect(decodeRef('not-a-ref')).toBeUndefined()
    expect(decodeRef('yzj:{"kind":1}')).toBeUndefined()
    expect(decodeRef('yzj:not-json')).toBeUndefined()
  })
})

describe('fetchRefContext message branch', () => {
  function injectWith(messages: { ok: boolean; value?: unknown }): YzjPanelInject {
    const fail = () => ({ ok: false, error: { message: 'boom' } })
    return {
      fetchWorkspaces: async () => fail(),
      fetchDocs: async () => fail(),
      fetchEvents: async () => fail(),
      fetchGroups: async () => fail(),
      fetchMessages: async () => messages.ok ? { ok: true as const, value: messages.value ?? {} } : fail(),
      fetchWhoami: async () => fail(),
      fetchSearch: async () => fail(),
      fetchDoc: async () => fail(),
      fetchDocBlocks: async () => fail(),
      fetchSheet: async () => fail(),
      fetchWorkspace: async () => fail(),
      fetchEvent: async () => fail(),
      fetchContact: async () => fail(),
      fetchWrite: async () => fail(),
      decideWrite: async () => fail(),
    }
  }

  it('re-fetches the original body when the anchor is in the window', async () => {
    clearRefContextCache()
    const inject = injectWith({
      ok: true,
      value: { list: [{ msgId: 'msg1', content: '原文明文', fromOpenId: 'u1', sendTime: '2026-08-14 22:14:00.000' }] },
    })
    const block = await fetchRefContext(inject, { kind: 'message', id: 'msg1', title: '快照', group: 'grp1' })
    expect(block).toContain('所属会话：grp1')
    expect(block).toContain('发送人：u1')
    expect(block).toContain('原文：原文明文')
    expect(block).not.toContain('原文可能已变')
  })

  it('falls back to a marked snapshot when the anchor is absent', async () => {
    clearRefContextCache()
    const inject = injectWith({ ok: true, value: { list: [{ msgId: 'other', content: '别的消息' }] } })
    const block = await fetchRefContext(inject, { kind: 'message', id: 'msg1', title: '快照', group: 'grp1' })
    expect(block).toContain('内容（快照，原文可能已变）：快照')
  })

  it('falls back to a marked snapshot without a group', async () => {
    clearRefContextCache()
    const inject = injectWith({ ok: false })
    const block = await fetchRefContext(inject, { kind: 'message', id: 'msg1', title: '快照' })
    expect(block).toContain('内容（快照，原文可能已变）：快照')
  })
})
