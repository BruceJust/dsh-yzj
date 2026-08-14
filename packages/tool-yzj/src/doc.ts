/**
 * Doc-domain tools: knowledge-base (workspace) management, node browsing and
 * mutation, imports, download links, and block-level read/write. Write tools
 * return the doc link per the yzj-cli contract; destructive operations are
 * gated by the approval guard (see guard.ts).
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  runValue, yzjToolOutput, docLink,
  asRecord, asArray, asString, asNumber, asBool, clipJson,
} from './shared.ts'
import type { YzjToolBudget } from './shared.ts'

const PERMISSION: Record<number, string> = { 1: '可管理', 2: '可编辑', 3: '可查看', 9: '无权限' }
const SUFFIX: Record<string, string> = { otl: '在线文档', dbt: '多维表格' }

function dateOf(iso: unknown): string {
  const text = asString(iso)
  return text === '' ? '' : text.slice(0, 10)
}

/** One node line for doc list / recent digests. */
function nodeLine(record: unknown): string {
  const node = asRecord(record)
  const title = asString(node.title)
  const id = asString(node.id)
  const suffix = asString(node.fileSuffix)
  const updated = dateOf(node.updateTime)
  const suffixText = SUFFIX[suffix] ?? suffix
  const head = title === '' ? id : title
  const parts = [head, `(${id})`]
  if (suffixText !== '') parts.push(suffixText)
  if (updated !== '') parts.push(`更新 ${updated}`)
  if (asBool(node.hasChildren)) parts.push('含子节点')
  return parts.join(' · ')
}

/** One workspace line. */
function workspaceLine(record: unknown): string {
  const ws = asRecord(record)
  const name = asString(ws.name)
  const id = asString(ws.id)
  const kind = asNumber(ws.visibility) === 2 ? '个人' : '企业'
  const parts = [name === '' ? id : name, `(${id})`, kind]
  const docCount = asNumber(ws.docCount)
  const memberCount = asNumber(ws.memberCount)
  if (docCount !== undefined) parts.push(`文档 ${docCount}`)
  if (memberCount !== undefined) parts.push(`成员 ${memberCount}`)
  const owner = asString(ws.ownerName)
  if (owner !== '') parts.push(owner)
  return parts.join(' · ')
}

/** Extract inline text from one block's content array. */
function blockText(block: unknown, depth = 0): string {
  if (depth > 4) return ''
  const record = asRecord(block)
  const own = asString(record.textContent)
  if (own !== '') return own
  const parts: string[] = []
  for (const child of asArray(record.content)) {
    const inline = asRecord(child)
    const text = asString(inline.content)
    if (text !== '') {
      parts.push(text)
    } else if (typeof inline.content === 'object' && inline.content !== null) {
      const nested = blockText(inline.content, depth + 1)
      if (nested !== '') parts.push(nested)
    }
  }
  return parts.join(' ')
}

/** One block line for block list digests. */
function blockLine(record: unknown): string {
  const block = asRecord(record)
  const type = asString(block.type)
  const id = asString(block.id)
  const text = blockText(block).replace(/\s+/g, ' ').trim().slice(0, 60)
  return `- [${type}] ${id}${text === '' ? '' : `: ${text}`}`
}

/** Register the doc-domain tools. */
export function applyDocTools(ctx: Context, budget: YzjToolBudget): void {
  ctx.tools.register(defineTool({
    name: 'yzj_doc_workspace_list',
    description: 'List Yunzhijia knowledge bases (workspaces) with optional personal/enterprise filter. Returns one line per workspace with its KB_ID for doc/sheet operations.',
    parameters: {
      type: { type: 'string', enum: ['all', 'personal', 'enterprise'], description: 'Filter: all (default), personal, or enterprise.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['doc', 'workspace', 'list']
      if (args.type !== undefined) command.push('--type', args.type)
      return runValue(ctx, budget, 'doc workspace list', command, (json) => {
        const workspaces = asArray(json)
        const lines = workspaces.map(workspaceLine)
        const content = lines.length === 0 ? '(no workspaces)' : lines.join('\n')
        return { content, data: { list: clipJson(workspaces, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_workspace_get',
    description: 'Fetch one knowledge base detail by its KB_ID.',
    parameters: {
      id: { type: 'string', required: true, description: 'Knowledge base id (KB_ID).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'doc workspace get', ['doc', 'workspace', 'get', '--id', args.id], (json) => {
        const ws = asRecord(json)
        const content = workspaceLine(ws)
        return { content, data: { record: clipJson(ws, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_workspace_create',
    description: 'Create a personal knowledge base with the given name and optional description. Returns the new KB_ID.',
    parameters: {
      name: { type: 'string', required: true, description: 'Knowledge base name.' },
      description: { type: 'string', description: 'Optional description.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['doc', 'workspace', 'create', '--name', args.name]
      if (args.description !== undefined) command.push('--description', args.description)
      return runValue(ctx, budget, 'doc workspace create', command, (json) => {
        const ws = asRecord(json)
        const id = asString(ws.id)
        const content = `created 知识库 "${asString(ws.name) || args.name}"${id === '' ? '' : ` (${id})`}`
        return { content, data: { record: clipJson(ws, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_list',
    description: 'List the direct child nodes of a knowledge base (one level), optionally under a parent doc. Nodes carry fileSuffix otl (在线文档) or dbt (多维表格).',
    parameters: {
      workspace: { type: 'string', required: true, description: 'Knowledge base id (KB_ID) from yzj_doc_workspace_list.' },
      parentId: { type: 'string', description: 'Optional parent node id to list its children instead of the workspace root.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['doc', 'list', '--workspace', args.workspace]
      if (args.parentId !== undefined) command.push('--parent-id', args.parentId)
      return runValue(ctx, budget, 'doc list', command, (json) => {
        const nodes = asArray(json)
        const lines = nodes.map(nodeLine)
        const content = lines.length === 0 ? '(no nodes)' : lines.join('\n')
        return { content, data: { list: clipJson(nodes, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_get',
    description: 'Fetch one knowledge-base node (doc or sheet) by id: title, type, permission, timestamps, and the open link.',
    parameters: {
      id: { type: 'string', required: true, description: 'Node id (DOC_ID).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'doc get', ['doc', 'get', '--id', args.id], (json) => {
        const node = asRecord(json)
        const title = asString(node.title)
        const id = asString(node.id)
        const suffix = asString(node.fileSuffix)
        const permission = asNumber(node.permissionLevel)
        const lines = [
          `${title === '' ? id : title} (${id})`,
        ]
        const suffixText = SUFFIX[suffix]
        if (suffixText !== '') lines.push(`类型：${suffixText}`)
        if (permission !== undefined && PERMISSION[permission] !== undefined) lines.push(`权限：${PERMISSION[permission]}`)
        const creator = asString(node.creatorName)
        if (creator !== '') lines.push(`创建人：${creator}`)
        const updated = dateOf(node.updateTime)
        if (updated !== '') lines.push(`更新时间：${updated}`)
        const link = asString(node.openWebUrl)
        if (link !== '') lines.push(link)
        return { content: lines.join('\n'), data: { record: clipJson(node, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_recent',
    description: 'List the current user\'s recently visited documents across knowledge bases, newest first, with pagination cursor support.',
    parameters: {
      limit: { type: 'number', description: 'Result count; default 20, max 100.' },
      lastVisitTime: { type: 'number', description: 'Pagination cursor: the visitTime (ms) of the last entry of the previous page.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['doc', 'recent']
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
          throw new Error('yzj_doc_recent: limit must be an integer between 1 and 100')
        }
        command.push('--limit', String(args.limit))
      }
      if (args.lastVisitTime !== undefined) command.push('--last-visit-time', String(args.lastVisitTime))
      return runValue(ctx, budget, 'doc recent', command, (json) => {
        const nodes = asArray(json)
        const lines = nodes.map((record) => {
          const node = asRecord(record)
          const kb = asString(node.kbName)
          const visit = asNumber(node.visitTime)
          const base = nodeLine(node)
          const tail = [kb === '' ? '' : kb, visit === undefined ? '' : `访问 ${new Date(visit).toISOString().slice(0, 10)}`]
            .filter(part => part !== '')
          return tail.length === 0 ? base : `${base} · ${tail.join(' · ')}`
        })
        const content = lines.length === 0 ? '(no recent docs)' : lines.join('\n')
        return { content, data: { list: clipJson(nodes, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_create',
    description: 'Create an online doc (otl) in a knowledge base, optionally under a parent node. Returns the new node id and link. For 多维表格 use yzj_sheet_create; knowledge bases have no folder type — use a parent doc for grouping.',
    parameters: {
      workspace: { type: 'string', required: true, description: 'Knowledge base id (KB_ID).' },
      title: { type: 'string', required: true, description: 'Doc title (also shown as the node title; do not repeat it as a level-1 heading inside the doc).' },
      parentId: { type: 'string', description: 'Optional parent node id to nest the doc under.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['doc', 'create', '--workspace', args.workspace, '--title', args.title]
      if (args.parentId !== undefined) command.push('--parent-id', args.parentId)
      return runValue(ctx, budget, 'doc create', command, (json) => {
        const node = asRecord(json)
        const id = asString(node.id)
        const link = docLink(id)
        return {
          content: `created 文档 "${asString(node.title) || args.title}"${id === '' ? '' : ` (${id})`}\n${link}`,
          data: { record: clipJson(node, { maxChars: budget.maxMetaChars }), id, link },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_rename',
    description: 'Rename a knowledge-base node (online doc or 多维表格).',
    parameters: {
      id: { type: 'string', required: true, description: 'Node id (DOC_ID).' },
      title: { type: 'string', required: true, description: 'New title.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc rename', ['doc', 'rename', '--id', args.id, '--title', args.title], (json) => {
        const node = asRecord(json)
        const id = asString(node.id) || args.id
        return {
          content: `renamed → "${args.title}" (${id})\n${docLink(id)}`,
          data: { record: clipJson(node, { maxChars: budget.maxMetaChars }), id, link: docLink(id) },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_move',
    description: 'Move a knowledge-base node under another parent node. Requires user confirmation.',
    parameters: {
      id: { type: 'string', required: true, description: 'Node id (DOC_ID) to move.' },
      targetParentId: { type: 'string', required: true, description: 'Target parent node id (any doc can be a parent).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc move',
        ['doc', 'move', '--id', args.id, '--target-parent-id', args.targetParentId],
        (json) => {
          const node = asRecord(json)
          const id = asString(node.id) || args.id
          return {
            content: `moved (${id}) → parent (${args.targetParentId})\n${docLink(id)}`,
            data: { record: clipJson(node, { maxChars: budget.maxMetaChars }), id, link: docLink(id) },
          }
        })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_delete',
    description: 'Delete a knowledge-base node irreversibly. Requires user confirmation.',
    parameters: {
      id: { type: 'string', required: true, description: 'Node id (DOC_ID) to delete.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc delete', ['doc', 'delete', '--id', args.id], () => ({
        content: `deleted doc (${args.id})`,
        data: { id: args.id },
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_import',
    description: 'Import files into a knowledge base. Inline mode (.md): pass fileName + content (content becomes the doc body; do not repeat the file title as a level-1 heading). Reference mode (docx/xlsx/xls/csv/pptx/pdf/html/htm): upload first via yzj_file_upload and pass fileName + fileId + fileSize.',
    parameters: {
      workspace: { type: 'string', required: true, description: 'Target knowledge base id (KB_ID).' },
      items: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fileName: { type: 'string', required: true, description: 'File name with extension; .md selects inline mode, other supported extensions reference mode.' },
            content: { type: 'string', description: 'Inline-mode markdown body (only for .md files).' },
            fileId: { type: 'string', description: 'Reference-mode uploaded file id (non-md formats).' },
            fileSize: { type: 'number', description: 'Reference-mode uploaded file size in bytes.' },
          },
        },
        description: 'Import items; .md uses content (inline), other formats use fileId+fileSize (reference).',
      },
      parentId: { type: 'string', description: 'Optional parent node id to import under.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['doc', 'import', '--workspace', args.workspace]
      if (args.parentId !== undefined) command.push('--parent-id', args.parentId)
      command.push('--items', JSON.stringify(args.items))
      return runValue(ctx, budget, 'doc import', command, (json) => {
        const nodes = asArray(json)
        if (nodes.length > 0) {
          const lines = nodes.map((record) => {
            const node = asRecord(record)
            const id = asString(node.id)
            return `${asString(node.title) || asString(node.fileName) || id} (${id})\n${docLink(id)}`
          })
          return { content: lines.join('\n'), data: { list: clipJson(nodes, { maxChars: budget.maxMetaChars }) } }
        }
        const raw = asRecord(json)
        const generic = Object.keys(raw).length === 0
          ? `imported ${args.items.length} item(s)`
          : `imported ${args.items.length} item(s)`
        return { content: generic, data: { payload: clipJson(raw, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_download_url',
    description: 'Get a temporary (30-minute) download URL for an Office/HTML file node in a knowledge base (docx/xlsx/xls/csv/pptx/pdf/html/htm). Not supported for otl/dbt/md nodes.',
    parameters: {
      id: { type: 'string', required: true, description: 'Node id (DOC_ID) of the file.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'doc download-url', ['doc', 'download-url', '--id', args.id], (json) => {
        const payload = asRecord(json)
        const url = asString(payload.url ?? payload.downloadUrl)
        const content = url === '' ? '(no download url in response)' : url
        return { content, data: { record: clipJson(payload, { maxChars: budget.maxMetaChars }), url } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_block_list',
    description: 'List the block structure of an online doc, optionally rooted at one block. Each block line shows type, id, and a text preview.',
    parameters: {
      id: { type: 'string', required: true, description: 'Doc node id (DOC_ID).' },
      blockId: { type: 'string', description: 'Optional block id to list only its subtree.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['doc', 'block', 'list', '--id', args.id]
      if (args.blockId !== undefined) command.push('--block-id', args.blockId)
      return runValue(ctx, budget, 'doc block list', command, (json) => {
        const blocks = asArray(asRecord(asRecord(json).data).blocks)
        const lines = blocks.map(blockLine)
        const content = lines.length === 0 ? '(no blocks)' : lines.join('\n')
        return { content, data: { list: clipJson(blocks, { maxChars: budget.maxMetaChars }) } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_block_insert',
    description: 'Insert blocks into an online doc. element is a JSON array of block objects (types: heading/paragraph/codeBlock/blockQuote/table; inline text nodes support bold/italic/underline/strike attrs). When inserting into a doc created by yzj_doc_create, do not repeat the doc title as a level-1 heading.',
    parameters: {
      id: { type: 'string', required: true, description: 'Doc node id (DOC_ID).' },
      element: { type: 'string', required: true, description: 'JSON array of block objects, e.g. [{"type":"paragraph","content":[{"type":"text","content":"正文"}]}].' },
      blockId: { type: 'string', description: 'Parent block id; defaults to "doc" (document root).' },
      index: { type: 'number', description: 'Insertion index; -1 (default) appends, 0 prepends.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['doc', 'block', 'insert', '--id', args.id, '--element', args.element]
      if (args.blockId !== undefined) command.push('--block-id', args.blockId)
      if (args.index !== undefined) command.push('--index', String(args.index))
      return runValue(ctx, budget, 'doc block insert', command, (json) => {
        const id = args.id
        return {
          content: `inserted blocks into doc (${id})\n${docLink(id)}`,
          data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id, link: docLink(id) },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_block_update',
    description: 'Update blocks in an online doc. operations is a JSON array; each entry needs {"operation":"update_content"|"update_attrs","blockId":"<concrete block id from yzj_doc_block_list>","content":[...]|"attrs":{...}} (content for update_content, attrs for update_attrs).',
    parameters: {
      id: { type: 'string', required: true, description: 'Doc node id (DOC_ID).' },
      operations: { type: 'string', required: true, description: 'JSON array of update operations (see description).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc block update',
        ['doc', 'block', 'update', '--id', args.id, '--operations', args.operations],
        (json) => ({
          content: `updated blocks in doc (${args.id})\n${docLink(args.id)}`,
          data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
        }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_doc_block_delete',
    description: 'Delete child blocks of a parent block irreversibly. operations is a JSON array; each entry needs {"blockId":"<parent block id — the CONTAINER, not the block itself>","startIndex":N,"endIndex":M} (half-open index range into the parent\'s content array). Requires user confirmation.',
    parameters: {
      id: { type: 'string', required: true, description: 'Doc node id (DOC_ID).' },
      operations: { type: 'string', required: true, description: 'JSON array of delete operations (see description).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc block delete',
        ['doc', 'block', 'delete', '--id', args.id, '--operations', args.operations],
        (json) => ({
          content: `deleted blocks in doc (${args.id})\n${docLink(args.id)}`,
          data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
        }))
    },
  }))
}
