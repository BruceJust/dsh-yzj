/**
 * Doc-tool specs.
 *
 * Two layers on purpose. A fake bridge pins the ARGV CONTRACT and the digest
 * shape deterministically — `xtinterface` output is not fully specified (F9),
 * so the parsing has to be tolerant and the tolerance has to be tested. Then a
 * self-skipping real-CLI smoke acts as the protocol probe the risk table asks
 * for: if the CLI's shape moves, these are the tests that notice.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { YzjBridge, type YzjRunResult } from '@yzj-next/bridge'
import { WRITE_SPECS } from '../src/guard.ts'
import { LINEAGE_SPECS } from '../src/lineage.ts'
import { applyCalendarTools } from '../src/calendar.ts'
import { applyContactTools } from '../src/contact.ts'
import { applyDocTools } from '../src/doc.ts'
import { applyFileTools } from '../src/file.ts'
import { applyImTools } from '../src/im.ts'
import { applySheetTools } from '../src/sheet.ts'
import type { YzjToolBudget } from '../src/shared.ts'

const BUDGET: YzjToolBudget = { timeoutMs: 30_000, maxRenderChars: 5_000, maxMetaChars: 5_000 }

/** The JSON Schema `defineTool` compiles a parameter spec into. */
interface SchemaNode {
  type?: string
  enum?: readonly string[]
  items?: SchemaNode
  properties?: Record<string, SchemaNode>
  required?: readonly string[]
}

interface CapturedTool {
  name: string
  parameters?: SchemaNode
  presentCall?: (args: Record<string, unknown>) => { card: string; title?: string } | undefined
  execute: (args: Record<string, unknown>) => Promise<{
    content: string
    truncated: boolean
    data: unknown
  }>
}

/**
 * One value a parameter would accept.
 *
 * `defineTool` VALIDATES arguments before it calls a presenter and returns
 * undefined when they do not fit — so a presenter test has to feed each tool
 * its own schema's shape. A single shared bag of sample arguments silently
 * exercises only the tools it happens to satisfy, which is what the first
 * version of this spec did.
 */
function sampleFor(node: SchemaNode): unknown {
  if (node.enum !== undefined && node.enum.length > 0) return node.enum[0]
  if (node.type === 'number' || node.type === 'integer') return 1
  if (node.type === 'boolean') return true
  if (node.type === 'array') return [node.items === undefined ? {} : sampleFor(node.items)]
  if (node.type === 'object') {
    return Object.fromEntries((node.required ?? [])
      .map(key => [key, sampleFor(node.properties?.[key] ?? {})]))
  }
  return '样本'
}

/** The minimum call each tool accepts: every required parameter and nothing else. */
function sampleArgs(tool: CapturedTool): Record<string, unknown> {
  return sampleFor(tool.parameters ?? { type: 'object' }) as Record<string, unknown>
}

function okResult(json: unknown): YzjRunResult {
  return {
    ok: true, exitCode: 0, stdout: JSON.stringify(json), stderr: '',
    json, truncated: false, timedOut: false, durationMs: 1,
  }
}

/** Mount the doc tools over a scripted bridge and capture what was registered. */
function mountFake(reply: (command: readonly string[]) => YzjRunResult): {
  tools: Map<string, CapturedTool>
  commands: string[][]
} {
  const captured: CapturedTool[] = []
  const commands: string[][] = []
  const ctx = {
    tools: {
      register(definition: CapturedTool): () => void {
        captured.push(definition)
        return () => undefined
      },
    },
    yzjBridge: {
      run: async (command: readonly string[]): Promise<YzjRunResult> => {
        commands.push([...command])
        return Promise.resolve(reply(command))
      },
    },
  } as unknown as Context
  applyDocTools(ctx, BUDGET)
  applyImTools(ctx, BUDGET)
  applySheetTools(ctx, BUDGET)
  applyCalendarTools(ctx, BUDGET)
  applyFileTools(ctx, BUDGET)
  applyContactTools(ctx, BUDGET)
  return { tools: new Map(captured.map(tool => [tool.name, tool])), commands }
}

describe('the tool family', () => {
  it('registers every tool across the six domains under its original name', () => {
    // The names are load-bearing (TD-11): the dual-instance deployment removes
    // the same-layer collision, so every prompt and habit built on `yzj_*`
    // keeps working. A rename here is a silent break for the model.
    const { tools } = mountFake(() => okResult([]))
    expect([...tools.keys()].sort()).toEqual([
      'yzj_calendar_event_create', 'yzj_calendar_event_delete', 'yzj_calendar_event_get',
      'yzj_calendar_event_list', 'yzj_calendar_event_participants', 'yzj_calendar_event_update',
      'yzj_calendar_room_find',
      'yzj_contact_get', 'yzj_contact_search',
      'yzj_doc_block_delete', 'yzj_doc_block_insert', 'yzj_doc_block_list', 'yzj_doc_block_update',
      'yzj_doc_create', 'yzj_doc_delete', 'yzj_doc_download_url', 'yzj_doc_get',
      'yzj_doc_import', 'yzj_doc_list', 'yzj_doc_move', 'yzj_doc_recent',
      'yzj_doc_rename', 'yzj_doc_workspace_create', 'yzj_doc_workspace_get',
      'yzj_doc_workspace_list',
      'yzj_file_download', 'yzj_file_upload',
      'yzj_im_group_create', 'yzj_im_group_recent', 'yzj_im_group_search',
      'yzj_im_message_list', 'yzj_im_message_search', 'yzj_im_message_send',
      'yzj_sheet_create', 'yzj_sheet_get', 'yzj_sheet_record_create', 'yzj_sheet_record_delete',
      'yzj_sheet_record_list', 'yzj_sheet_record_update', 'yzj_sheet_table_create',
      'yzj_sheet_table_delete', 'yzj_sheet_table_get', 'yzj_sheet_table_rename',
      'yzj_whoami',
    ])
    expect(tools.size).toBe(44)
  })

  it('lets every tool say what it is doing in human words', () => {
    /*
      工作块只显示这一行。A tool with no `presentCall` renders as its bare name
      there, which is how `yzj_doc_block_update` ends up standing in for
      「改文档的正文」 — and the UI cannot fix that by parsing argsRaw, because
      only the tool knows what its own arguments mean. So the presenter is a
      requirement of the family, not a nicety, and it is checked here rather
      than noticed in a screenshot.
    */
    const { tools } = mountFake(() => okResult([]))
    const missing: string[] = []
    for (const [name, tool] of tools) {
      const view = tool.presentCall?.(sampleArgs(tool))
      const title = typeof view?.title === 'string' ? view.title.trim() : ''
      // A title that leaks `undefined` is worse than none: it reads as a bug
      // to the operator and tells them nothing.
      if (title === '' || title.includes('undefined')) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  /*
    这道断言只管**本包注册的那一批**（`yzj_*`）。

    确认表是**守卫的**表，不是某一个包的清单：守卫按名字在调用时拦，谁注册的都拦得住。
    v3.15 裁决② 之后表里多了三个 `commitment_*`——它们由对象层注册（修理动词族的话语
    兜底：提案归 agent、签发归人），在这个夹具里本来就不该出现。

    真正危险的方向是**反过来那一条**（写工具没进表 = 不经确认直接落库），它在下面
    单独锁。
  */
  it('gates every write tool the guard knows about, and no read tool', () => {
    const { tools } = mountFake(() => okResult([]))
    for (const name of Object.keys(WRITE_SPECS)) {
      if (!name.startsWith('yzj_')) continue
      expect(tools.has(name), `${name} is gated but not registered`).toBe(true)
    }
  })

  /**
   * 不可恢复的命令要带 `--yes` —— 那是操作者那次签字的**兑现**。
   *
   * yzj-cli 0.1.4 起，这些命令缺 `--yes` 直接答 exit 3 `confirmation_required`。而本
   * 系统里那道门在更靠前的地方：guard 把它们列为**强确认**，卡递到人面前、人按下确认，
   * 之后才轮到这一行。漏了它的后果不是「多问一次」——**人点的头落在空处**，CLI 拒绝
   * 执行，模型只看到一句 failed 然后去编一个别的办法。
   *
   * 这一条此前一个字都没测过，而整族删除工具就是这么死了一整段时间的：单测打的是假
   * bridge，假 bridge 不认 --yes。所以这里断言的是**发出去的 argv**，不是回包。
   */
  it('每一个不可恢复的写都把 --yes 一起送出去', async () => {
    const { tools, commands } = mountFake(() => okResult({}))
    await tools.get('yzj_doc_delete')?.execute({ id: 'doc-1' })
    await tools.get('yzj_doc_block_delete')?.execute({ id: 'doc-1', operations: '[]' })
    await tools.get('yzj_sheet_table_delete')?.execute({ id: 'sh-1', tableId: 1 })
    await tools.get('yzj_sheet_record_delete')?.execute({ id: 'sh-1', tableId: 1, recordIds: 'r1' })
    await tools.get('yzj_calendar_event_delete')?.execute({ id: 'ev-1' })
    expect(commands).toHaveLength(5)
    for (const command of commands) {
      expect(command, `${command.join(' ')} 少了 --yes`).toContain('--yes')
    }
  })

  /** guard 说 strong 的，就是 CLI 说要确认的那一批——两张表不许分家。 */
  it('强确认表覆盖每一个带 --yes 的命令', async () => {
    const { tools, commands } = mountFake(() => okResult({}))
    const names = [
      'yzj_doc_delete', 'yzj_doc_block_delete', 'yzj_sheet_table_delete',
      'yzj_sheet_record_delete', 'yzj_calendar_event_delete',
    ]
    for (const name of names) expect(WRITE_SPECS[name]?.level).toBe('strong')
    expect(commands).toHaveLength(0)
    expect(tools.size).toBeGreaterThan(0)
  })

  /**
   * 建群 = 创造一个新的听众集合，落在 **strong**。
   *
   * 它和别的 strong 不同：那些是「删掉的回不来」，这一条是「从此有一批人听得见这里
   * 说的每一句话」。不可逆的是**边界本身**——群能解散，谁在那段时间里听见了什么收不回来。
   */
  it('建群是强确认，且人数越界在打出去之前就拦下', async () => {
    expect(WRITE_SPECS.yzj_im_group_create?.level).toBe('strong')
    const { tools, commands } = mountFake(() => okResult({ groupId: 'g-1' }))
    const create = tools.get('yzj_im_group_create')
    await expect(create?.execute({ name: '专项群', memberOpenIds: ['a'] })).rejects.toThrow(/2-10/u)
    await expect(create?.execute({
      name: '专项群', memberOpenIds: Array.from({ length: 11 }, (_, i) => `p${String(i)}`),
    })).rejects.toThrow(/2-10/u)
    // 问过人再失败是最贵的一种失败：越界的调用一次都不该打到线上。
    expect(commands).toHaveLength(0)
    const value = await create?.execute({ name: '专项群', memberOpenIds: ['a', 'b'] })
    expect(commands[0]).toEqual(['im', 'group', 'create', '--name', '专项群', '--member-open-id', 'a', 'b'])
    // 回执里必须写着「默认不在岗」——否则代发过去没有人接收回执。
    expect(value?.content).toContain('默认不在岗')
  })

  it('omits absent optional flags rather than sending empty ones', async () => {
    const { tools, commands } = mountFake(() => okResult([]))
    await tools.get('yzj_doc_list')?.execute({ workspace: 'kb-1' })
    await tools.get('yzj_doc_list')?.execute({ workspace: 'kb-1', parentId: 'node-9' })
    expect(commands[0]).toEqual(['doc', 'list', '--workspace', 'kb-1'])
    expect(commands[1]).toEqual(['doc', 'list', '--workspace', 'kb-1', '--parent-id', 'node-9'])
  })

  it('renders a created doc with its id and open link', async () => {
    const { tools } = mountFake(() => okResult({ id: 'doc-77', title: '价格页 v2' }))
    const result = await tools.get('yzj_doc_create')?.execute({ workspace: 'kb-1', title: '价格页 v2' })
    expect(result?.content).toContain('价格页 v2')
    expect(result?.content).toContain('doc-77')
    expect(result?.data).toMatchObject({ id: 'doc-77' })
  })

  it('digests a workspace list into one line each', async () => {
    const { tools } = mountFake(() => okResult([
      { id: 'kb-1', name: '产品', visibility: 1, docCount: 12 },
      { id: 'kb-2', name: '个人', visibility: 2 },
    ]))
    const result = await tools.get('yzj_doc_workspace_list')?.execute({})
    expect(result?.content.split('\n')).toHaveLength(2)
    expect(result?.content).toContain('产品 · (kb-1) · 企业 · 文档 12')
    expect(result?.content).toContain('个人 · (kb-2) · 个人')
  })

  it('reads blocks out of the nested CLI envelope and previews their text', async () => {
    const { tools } = mountFake(() => okResult({
      data: {
        blocks: [
          { id: 'b1', type: 'heading', content: [{ type: 'text', content: '标题' }] },
          { id: 'b2', type: 'paragraph', textContent: '正文一段' },
        ],
      },
    }))
    const result = await tools.get('yzj_doc_block_list')?.execute({ id: 'doc-1' })
    expect(result?.content).toBe('- [heading] b1: 标题\n- [paragraph] b2: 正文一段')
  })

  it('reports an empty result rather than an empty string', async () => {
    const { tools } = mountFake(() => okResult([]))
    expect((await tools.get('yzj_doc_list')?.execute({ workspace: 'kb-1' }))?.content).toBe('(no nodes)')
  })

  it('turns a CLI failure into a model-readable digest, not an exception', async () => {
    const { tools } = mountFake(() => ({
      ok: false, exitCode: 1, stdout: '', stderr: '未登录，请先 auth login',
      truncated: false, timedOut: false, durationMs: 1,
    }))
    const result = await tools.get('yzj_doc_list')?.execute({ workspace: 'kb-1' })
    expect(result?.content).toContain('yzj doc list failed')
    expect(result?.content).toContain('auth login')
  })

  it('rejects an out-of-range limit before spending a CLI call', async () => {
    const { tools, commands } = mountFake(() => okResult([]))
    await expect(tools.get('yzj_doc_recent')?.execute({ limit: 500 })).rejects.toThrow(/between 1 and 100/)
    expect(commands).toHaveLength(0)
  })

  it('serializes import items as one JSON argument', async () => {
    const { tools, commands } = mountFake(() => okResult([]))
    await tools.get('yzj_doc_import')?.execute({
      workspace: 'kb-1',
      items: [{ fileName: 'a.md', content: '# hi' }],
    })
    expect(commands[0]?.slice(0, 4)).toEqual(['doc', 'import', '--workspace', 'kb-1'])
    expect(JSON.parse(commands[0]?.at(-1) ?? '[]')).toEqual([{ fileName: 'a.md', content: '# hi' }])
  })
})

describe('real-CLI protocol probe (self-skipping)', () => {
  it('reads real workspaces when the machine has a healthy login', async () => {
    const bridge = new YzjBridge(new Context(), {})
    if (!await bridge.check(10_000)) {
      console.warn('yzj-cli missing or unauthenticated — skipping the real-CLI probe')
      return
    }
    const captured: CapturedTool[] = []
    const ctx = {
      tools: { register: (definition: CapturedTool) => { captured.push(definition); return () => undefined } },
      yzjBridge: bridge,
    } as unknown as Context
    applyDocTools(ctx, BUDGET)
    const list = captured.find(tool => tool.name === 'yzj_doc_workspace_list')
    const result = await list?.execute({})
    expect(result?.content.length).toBeGreaterThan(0)
    expect(result?.content).not.toContain('failed')
  })
})

describe('cross-domain argv and validation', () => {
  it('refuses an IM send with both or neither target', async () => {
    const { tools } = mountFake(() => okResult({}))
    const send = tools.get('yzj_im_message_send')
    await expect(send?.execute({ msgType: 'text', content: 'x' }))
      .rejects.toThrow(/exactly one of groupId or toOpenId/)
    await expect(send?.execute({ msgType: 'text', content: 'x', groupId: 'g', toOpenId: 'o' }))
      .rejects.toThrow(/exactly one of groupId or toOpenId/)
  })

  it('refuses a file message carrying text, a reply, or mentions', async () => {
    const { tools } = mountFake(() => okResult({}))
    await expect(tools.get('yzj_im_message_send')?.execute({
      msgType: 'file', groupId: 'g', fileId: 'f', content: 'x',
    })).rejects.toThrow(/does not support content/)
  })

  it('reports an empty recent-group list as one line, not one line per character', async () => {
    const { tools } = mountFake(() => okResult({ list: [] }))
    const result = await tools.get('yzj_im_group_recent')?.execute({})
    expect(result?.content).toBe('(no recent groups)')
  })

  it('reads the sheet schema out of its envelope', async () => {
    const { tools } = mountFake(() => okResult({
      sheets: [{ id: 7, name: '任务表', fields: [{ name: '任务名' }, { name: '负责人' }] }],
    }))
    const result = await tools.get('yzj_sheet_get')?.execute({ id: 'dbt-1' })
    expect(result?.content).toBe('任务表 (7) · 字段: 任务名 / 负责人')
  })

  it('stringifies numeric table ids for the CLI', async () => {
    const { tools, commands } = mountFake(() => okResult({}))
    await tools.get('yzj_sheet_table_rename')?.execute({ id: 'dbt-1', tableId: 7, name: '新名' })
    expect(commands[0]).toEqual([
      'sheet', 'table', 'rename', '--id', 'dbt-1', '--table-id', '7', '--name', '新名',
    ])
  })

  it('repeats organizer and attendee flags once per openId', async () => {
    const { tools, commands } = mountFake(() => okResult({ id: 'ev-1' }))
    await tools.get('yzj_calendar_event_create')?.execute({
      title: '评审', start: '2026-08-19T10:00:00', end: '2026-08-19T11:00:00',
      organizerOpenIds: ['a'], attendeeOpenIds: ['b', 'c'],
    })
    const command = commands[0] ?? []
    expect(command.filter(part => part === '--meet-organizer-open-ids')).toHaveLength(1)
    expect(command.filter(part => part === '--attendee-open-ids')).toHaveLength(2)
  })

  it('refuses an event with no organizer before spending a CLI call', async () => {
    const { tools, commands } = mountFake(() => okResult({}))
    await expect(tools.get('yzj_calendar_event_create')?.execute({
      title: 'x', start: 's', end: 'e', organizerOpenIds: [],
    })).rejects.toThrow(/organizerOpenIds must not be empty/)
    expect(commands).toHaveLength(0)
  })

  it('refuses a multi-file upload that also names the file', async () => {
    const { tools } = mountFake(() => okResult({}))
    await expect(tools.get('yzj_file_upload')?.execute({ files: ['a', 'b'], name: 'x' }))
      .rejects.toThrow(/only allowed for a single file/)
  })
})

describe('lineage recording', () => {
  it('names one produced artifact per gated write tool that makes something', () => {
    // Provenance is the canonical unbackfillable fact: a write whose artifact
    // never entered the graph can never be traced afterwards.
    for (const name of ['yzj_doc_create', 'yzj_sheet_create', 'yzj_file_upload', 'yzj_im_message_send']) {
      expect(LINEAGE_SPECS[name], `${name} produces nothing`).toBeDefined()
    }
  })

  it('scopes a knowledge-base artifact to its knowledge base', () => {
    const produced = LINEAGE_SPECS.yzj_doc_create?.extract(
      { workspace: '6a84f0', title: '价格页' },
      { id: 'doc-1', link: 'https://example/doc-1', record: { title: '价格页' } },
    )
    expect(produced?.[0]).toMatchObject({
      uri: 'https://example/doc-1', placeKey: 'yzj-kb-6a84f0', kind: 'doc', title: '价格页',
    })
  })

  it('falls back to a node-scoped place when only the node id is known', () => {
    // Block edits carry no workspace; a stable node-scoped key still lets
    // crossing detection compare "came from that doc" against "spoken in that group".
    const produced = LINEAGE_SPECS.yzj_doc_block_insert?.extract({ id: 'doc-1' }, {})
    expect(produced?.[0]?.placeKey).toBe('yzj-doc-doc-1')
  })

  it('scopes a sent message to the conversation it went to', () => {
    const produced = LINEAGE_SPECS.yzj_im_message_send?.extract(
      { groupId: 'g-1' }, { msgId: 'm-9' },
    )
    expect(produced?.[0]).toMatchObject({ placeKey: 'yzj-group-g-1', kind: 'message' })
  })

  it('produces nothing when the CLI returned no id, rather than inventing one', () => {
    expect(LINEAGE_SPECS.yzj_doc_create?.extract({ workspace: '6a84f0' }, {})).toEqual([])
    expect(LINEAGE_SPECS.yzj_im_message_send?.extract({}, { msgId: 'm-9' })).toEqual([])
  })
})

/**
 * 修理动词族的**话语兜底**过同一道确认门 (v3.15 裁决②).
 *
 * §7.6 的兜底明标写着「作废/顺延/移交 = 对 agent 说」。此前它们在 agent 手上根本不
 * 存在——而一个**只能在承诺板上按**的动词是一种违规能力（凡只能在一个面上获得的能力
 * 就是违规能力）。正确形态是「对象寻址 + agent 提案 + 确认卡」，而第三段不必新造：
 * 写工具本来就过这道门。
 *
 * 这几条锁的就是「它们真的在门里」——一个漏进表外的写工具，会**不经确认直接落库**。
 */
describe('修理动词族在确认表里', () => {
  it('三个动词都在写确认表里，一个都不许漏', () => {
    for (const name of ['commitment_void', 'commitment_postpone', 'commitment_handoff']) {
      expect(WRITE_SPECS[name]).toBeDefined()
    }
  })

  /*
    **作废是 strong**：墓碑律——作废之后这条不会再被任何动词唤醒，而 strong 从不被
    授权租约放行。另两个改的是说出口过的事实（日子、执行者），可纠可再改。
  */
  it('作废是强确认，顺延与移交是标准确认', () => {
    expect(WRITE_SPECS.commitment_void?.level).toBe('strong')
    expect(WRITE_SPECS.commitment_postpone?.level).toBe('standard')
    expect(WRITE_SPECS.commitment_handoff?.level).toBe('standard')
  })
})

describe('yzj-cli 0.1.6 带来的两条闭环', () => {
  it('跨会话内容检索：argv 照平台的旗子发，回包按群聚合渲染', async () => {
    const { tools, commands } = mountFake(() => okResult({
      data: {
        count: 1,
        list: [{
          group: { groupId: 'g-1', groupName: '830 项目', groupType: 2 },
          hasMoreMessages: true,
          matchedMessageCount: 12,
          messages: [{
            message: {
              msgId: 'm-1', fromOpenId: 'u-1', msgType: 'text',
              content: '明天上午 10 点评审', sendTime: '2026-09-02 08:25:35',
            },
          }],
        }],
      },
    }))
    const search = tools.get('yzj_im_message_search')
    expect(search).toBeDefined()
    const value = await search?.execute({
      keyword: '评审', groupId: 'g-1', senderOpenId: 'u-1', start: '2026-08-01', end: '2026-09-03', limit: 5, page: 2,
    }) as { content: string; data: { count: number } }
    expect(commands[0]).toEqual([
      'im', 'message', 'search', '--keyword', '评审', '--group-id', 'g-1', '--sender-open-id', 'u-1',
      '--start', '2026-08-01', '--end', '2026-09-03', '--limit', '5', '--page', '2',
    ])
    /*
      **按群聚合**是平台回包的形状，渲染要把它说出来：哪个群、命中几条、还有没有——
      否则模型看到的是一串脱离语境的句子，正是「群回合里把别的群的话引进来」的温床。
    */
    expect(value.content).toContain('## 830 项目 (g-1) · 命中 12 条 · 还有更多')
    expect(value.content).toContain('明天上午 10 点评审')
    expect(value.content).toContain('<m-1>')
    expect(value.data.count).toBe(1)
    await expect(search?.execute({ keyword: '   ' })).rejects.toThrow(/keyword/u)
    await expect(search?.execute({ keyword: 'x', limit: 0 })).rejects.toThrow(/limit/u)
  })

  it('whoami 走原生命令，并把登录态读出来——登录快过期不该以一串莫名失败的形态被发现', async () => {
    const { tools, commands } = mountFake(() => okResult({
      data: {
        openId: 'op-1', name: '代少兵', department: '灵基Chat', jobTitle: '算法开发', jobNo: '69294',
        tokenStatus: 'valid', expiresAt: '2026-09-03T09:26:28+08:00',
      },
      identity: 'user', success: true,
    }))
    const value = await tools.get('yzj_whoami')?.execute({}) as { content: string; data: { tokenStatus?: string } }
    expect(commands[0]).toEqual(['whoami'])
    expect(value.content).toContain('代少兵 · 灵基Chat · 算法开发 · 工号 69294 · <op-1>')
    expect(value.content).toContain('登录态：valid · 到期 2026-09-03T09:26:28+08:00')
    expect(value.data.tokenStatus).toBe('valid')
  })
})

describe('yzj-cli 0.1.6 的 list 类回包（{ count, list }）', () => {
  it('知识库列表 / 日程列表 / 通讯录搜索在两种形状下渲染同一行', async () => {
    /*
      0.1.4 回裸数组，0.1.6 回 `{ count, list }`。只认数组的读法在新形状上得到的是
      「(no workspaces)」——**恰好为空**，而不是一句报错，所以这里两种都喂。
    */
    const workspace = { id: 'kb-1', name: '我的知识', bizType: 'my_knowledge', docCount: 7 }
    for (const shape of [[workspace], { count: 1, list: [workspace] }]) {
      const { tools } = mountFake(() => okResult(shape))
      const value = await tools.get('yzj_doc_workspace_list')?.execute({}) as { content: string }
      expect(value.content).toContain('我的知识')
    }
    const person = { name: '代少兵', openId: 'op-1', department: '灵基Chat' }
    for (const shape of [[person], { count: 1, list: [person], more: false }]) {
      const { tools } = mountFake(() => okResult(shape))
      const value = await tools.get('yzj_contact_search')?.execute({ keyword: '代' }) as { content: string }
      expect(value.content).toContain('代少兵')
    }
  })
})
