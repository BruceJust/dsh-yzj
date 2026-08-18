// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as react from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { describe, expect, it } from 'vitest'

type HierarchyHelpers = {
  normalizeHierarchyClaim(value: unknown): unknown
  buildHierarchyEntries(
    group: { sessions: unknown[] }, workspace: unknown, descendants: Map<string, unknown>,
    current: string | undefined, project: (input: unknown) => unknown,
  ): unknown[] | undefined
}

type ClientDefinition = {
  factory(require: (id: string) => unknown): {
    __workspaceHierarchyForTests: HierarchyHelpers
  }
}

async function loadHelpers(): Promise<HierarchyHelpers> {
  let definition: ClientDefinition | undefined
  ;(window as unknown as { __ModuleLoader__: { load(value: ClientDefinition): void } }).__ModuleLoader__ = {
    load(value) { definition = value },
  }
  const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
  const bundle = join(
    npmRoot, '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
  )
  await import(`${pathToFileURL(bundle).href}?hierarchy-test=${Date.now()}`)
  if (definition === undefined) throw new Error('Workspace client bundle did not register')
  const primitives = new Proxy({}, {
    get: () => function Primitive(): null { return null },
  })
  return definition.factory((id) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === '@deepseek-ai/dsh-client-runtime/client') {
      return {
        defineStore: (spec: unknown) => spec,
        indexSubagentDescendants: () => new Map(),
      }
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected client dependency: ${id}`)
  }).__workspaceHierarchyForTests
}

describe('patched Workspace hierarchy core', () => {
  it('rejects malformed claims and builds stable native branch entries', async () => {
    const helpers = await loadHelpers()
    expect(helpers.normalizeHierarchyClaim({ path: [{ id: '', label: 'bad' }] }))
      .toBeUndefined()
    expect(helpers.normalizeHierarchyClaim({
      path: [{ id: 'channel-1', label: '研发群', kind: 'group' }],
      leafLabel: '发布计划', aliases: ['群 · 研发群 · 发布计划'],
    })).toMatchObject({ leafLabel: '发布计划' })

    const session = {
      id: 'session-yzj-topic-1', displayTitle: '群 · 研发群 · 发布计划',
      blank: false, running: true, completed: false, updatedAt: 10,
    }
    const entries = helpers.buildHierarchyEntries(
      { sessions: [session] },
      { workspaceId: 'ws-1', path: '/tmp/yzj', title: '云之家 Agent' },
      new Map(),
      session.id,
      () => ({
        path: [{ id: 'channel-1', label: '研发群', kind: 'group' }],
        leafLabel: '发布计划',
      }),
    ) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'branch', key: 'ws-1::channel-1', label: '研发群',
      running: true, sessionCount: 1, containsCurrent: true,
    })
    expect(entries[0]?.children).toEqual([
      expect.objectContaining({
        kind: 'session', current: true,
        node: expect.objectContaining({ title: '发布计划' }),
      }),
    ])
  })

  it('falls back to the native flat Workspace rows when nobody claims a Session', async () => {
    const helpers = await loadHelpers()
    const entries = helpers.buildHierarchyEntries(
      { sessions: [{ id: 's1', displayTitle: 'ordinary', blank: false, running: false, updatedAt: 1 }] },
      { workspaceId: 'ws-1' }, new Map(), undefined, () => undefined,
    )
    expect(entries).toBeUndefined()
  })
})
