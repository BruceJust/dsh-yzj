// @vitest-environment jsdom
/**
 * '@' source specs: the three candidate groups (同事/会话/文档) plus the
 * codec carrier register in journey-5 order; warm data feeds group/doc
 * candidates; the contact group requires a query and scopes the visibility
 * hint; picks resolve through the shared name→ref map.
 */
import { describe, expect, it } from 'vitest'
import {
  clearYzjSourceCaches, createYzjSources,
  SOURCE_CONTACTS, SOURCE_DOCS, SOURCE_GROUPS, SOURCE_NAME,
} from '../src/client/input-source.ts'
import type { YzjPanelInject } from '../src/client/rpc.ts'

let sessionSeq = 0

/** A fresh session id per call so the module-level warm cache never leaks. */
function freshSession(): never {
  sessionSeq += 1
  return { sessionId: `s${sessionSeq}` } as never
}

function injectWith(over: Partial<YzjPanelInject> = {}): YzjPanelInject {
  const fail = async () => ({ ok: false, error: { message: 'boom' } })
  return {
    fetchWorkspaces: fail,
    fetchDocs: fail,
    fetchEvents: fail,
    fetchGroups: fail,
    fetchMessages: fail,
    fetchWhoami: fail,
    fetchSearch: fail,
    fetchDoc: fail,
    fetchDocBlocks: fail,
    fetchSheet: fail,
    fetchWorkspace: fail,
    fetchEvent: fail,
    fetchContact: fail,
    fetchWrite: fail,
    decideWrite: fail,
    ...over,
  }
}

describe('createYzjSources', () => {
  it('registers the three groups plus the carrier in journey-5 order', () => {
    const sources = createYzjSources(injectWith())
    expect(sources.map(source => [source.name, source.order])).toEqual([
      [SOURCE_CONTACTS, 0],
      [SOURCE_GROUPS, 1],
      [SOURCE_DOCS, 2],
      [SOURCE_NAME, 9],
    ])
    expect(sources.every(source => source.trigger === '@')).toBe(true)
  })

  it('the carrier source offers no candidates but carries a codec', async () => {
    const sources = createYzjSources(injectWith())
    const carrier = sources.find(source => source.name === SOURCE_NAME)!
    expect(await carrier.candidates(freshSession(), { query: '' })).toEqual([])
    expect(carrier.codec).toBeDefined()
  })

  it('group candidates come from the warm recent sessions', async () => {
    const inject = injectWith({
      fetchGroups: async () => ({ ok: true, value: { list: [{ groupId: 'g1', groupName: '需求群', unreadCount: 3 }] } }),
      fetchWorkspaces: async () => ({ ok: true, value: [] }),
    })
    const sources = createYzjSources(inject)
    const groups = sources.find(source => source.name === SOURCE_GROUPS)!
    const session = freshSession()
    await groups.warm?.(session)
    const hits = await groups.candidates(session, { query: '需求' })
    expect(hits.length).toBe(1)
    expect(hits[0].name).toBe('需求群')
    expect(hits[0].description).toContain('未读 3')
    expect(await groups.candidates(session, { query: '不存在' })).toEqual([])
  })

  it('doc candidates come from the first-level docs of warm workspaces', async () => {
    const inject = injectWith({
      fetchWorkspaces: async () => ({ ok: true, value: [{ id: 'kb1', name: '团队知识库' }] }),
      fetchGroups: async () => ({ ok: true, value: { list: [] } }),
      fetchDocs: async (workspace) => workspace === 'kb1'
        ? { ok: true, value: [{ id: 'd1', title: '接口规范', fileSuffix: 'otl', updateTime: '2026-08-14T10:00:00.000' }] }
        : { ok: false, error: { message: 'x' } },
    })
    const sources = createYzjSources(inject)
    const docs = sources.find(source => source.name === SOURCE_DOCS)!
    const session = freshSession()
    await docs.warm?.(session)
    const hits = await docs.candidates(session, { query: '接口' })
    expect(hits.length).toBe(1)
    expect(hits[0].name).toBe('接口规范')
    expect(hits[0].description).toContain('文档')
  })

  it('contact candidates require a query and carry the visibility hint', async () => {
    const inject = injectWith({
      fetchSearch: async (keyword) => keyword === '老黎'
        ? { ok: true, value: [{ name: '老黎', oId: 'u1', department: '产品部' }] }
        : { ok: true, value: [] },
    })
    const sources = createYzjSources(inject)
    const contacts = sources.find(source => source.name === SOURCE_CONTACTS)!
    const session = freshSession()
    expect(await contacts.candidates(session, { query: '' })).toEqual([])
    const hits = await contacts.candidates(session, { query: '老黎' })
    expect(hits.length).toBe(1)
    expect(hits[0].description).toContain('仅你有权查看的范围')
  })

  it('a pick resolves through the shared name→ref map', async () => {
    const inject = injectWith({
      fetchGroups: async () => ({ ok: true, value: { list: [{ groupId: 'g1', groupName: '需求群' }] } }),
      fetchWorkspaces: async () => ({ ok: true, value: [] }),
    })
    const sources = createYzjSources(inject)
    const groups = sources.find(source => source.name === SOURCE_GROUPS)!
    const session = freshSession()
    await groups.warm?.(session)
    const hits = await groups.candidates(session, { query: '' })
    const picked = groups.onPick?.({ candidate: hits[0], session })
    expect(picked?.insert.source).toBe(SOURCE_GROUPS)
    expect(picked?.insert.ref).toContain('"group"')
    expect(picked?.insert.label).toContain('需求群')
  })

  it('clearYzjSourceCaches resets the warm state', async () => {
    const inject = injectWith({
      fetchGroups: async () => ({ ok: true, value: { list: [] } }),
      fetchWorkspaces: async () => ({ ok: true, value: [] }),
    })
    const sources = createYzjSources(inject)
    const groups = sources.find(source => source.name === SOURCE_GROUPS)!
    const session = freshSession()
    await groups.warm?.(session)
    clearYzjSourceCaches()
    expect(await groups.candidates(freshSession(), { query: '' })).toEqual([])
  })
})
