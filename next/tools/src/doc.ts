/**
 * Doc-domain tools: knowledge bases, node browsing and mutation, imports,
 * download links, and block-level read/write.
 *
 * Ported (re-cast, not imported) from the previous system's `tool-yzj`, tool
 * names preserved on purpose — the dual-instance deployment removes the
 * same-name collision (F10), so the model's existing habits and every prompt
 * that mentions `yzj_doc_*` keep working. Gating lives in `guard.ts`.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  asArray, asBool, asNumber, asRecord, asString, clipJson, counted, docLink, named, runValue,
  titled, yzjToolOutput,
  listOf,
  type YzjToolBudget,
} from './shared.ts'

const PERMISSION: Record<number, string> = { 1: '可管理', 2: '可编辑', 3: '可查看', 9: '无权限' }
const SUFFIX: Record<string, string> = { otl: '在线文档', dbt: '多维表格' }

function dateOf(iso: unknown): string {
  const text = asString(iso)
  return text === '' ? '' : text.slice(0, 10)
}

/** One node line for list / recent digests. */
function nodeLine(record: unknown): string {
  const node = asRecord(record)
  const title = asString(node.title)
  const id = asString(node.id)
  const suffix = asString(node.fileSuffix)
  const updated = dateOf(node.updateTime)
  const suffixText = SUFFIX[suffix] ?? suffix
  const parts = [title === '' ? id : title, `(${id})`]
  if (suffixText !== '') parts.push(suffixText)
  if (updated !== '') parts.push(`更新 ${updated}`)
  if (asBool(node.hasChildren)) parts.push('含子节点')
  return parts.join(' · ')
}

function workspaceLine(record: unknown): string {
  const workspace = asRecord(record)
  const name = asString(workspace.name)
  const id = asString(workspace.id)
  const parts = [name === '' ? id : name, `(${id})`, asNumber(workspace.visibility) === 2 ? '个人' : '企业']
  const docCount = asNumber(workspace.docCount)
  const memberCount = asNumber(workspace.memberCount)
  if (docCount !== undefined) parts.push(`文档 ${String(docCount)}`)
  if (memberCount !== undefined) parts.push(`成员 ${String(memberCount)}`)
  const owner = asString(workspace.ownerName)
  if (owner !== '') parts.push(owner)
  return parts.join(' · ')
}

/** Inline text of one block, for the block-list preview. */
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

function blockLine(record: unknown): string {
  const block = asRecord(record)
  const text = blockText(block).replace(/\s+/gu, ' ').trim().slice(0, 60)
  return `- [${asString(block.type)}] ${asString(block.id)}${text === '' ? '' : `: ${text}`}`
}

/** Register the doc-domain tools. Returns the disposer for all of them. */
export function applyDocTools(ctx: Context, budget: YzjToolBudget): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'yzj_doc_workspace_list',
    description: 'List Yunzhijia knowledge bases (workspaces) with optional personal/enterprise filter. Returns one line per workspace with its KB_ID for doc/sheet operations.',
    presentCall: args => titled(`知识库列表${args.type === undefined || args.type === 'all' ? '' : args.type === 'personal' ? ' · 个人' : ' · 企业'}`, 'read'),
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
        const workspaces = listOf(json)
        const lines = workspaces.map(workspaceLine)
        return {
          content: lines.length === 0 ? '(no workspaces)' : lines.join('\n'),
          data: { list: clipJson(workspaces, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_workspace_get',
    description: 'Fetch one knowledge base detail by its KB_ID.',
    presentCall: args => titled(`查看知识库 ${args.id}`, 'read'),
    parameters: {
      id: { type: 'string', required: true, description: 'Knowledge base id (KB_ID).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'doc workspace get', ['doc', 'workspace', 'get', '--id', args.id], (json) => {
        const workspace = asRecord(json)
        return {
          content: workspaceLine(workspace),
          data: { record: clipJson(workspace, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_workspace_create',
    description: 'Create a personal knowledge base with the given name and optional description. Returns the new KB_ID.',
    presentCall: args => titled(named('新建知识库', args.name), 'edit'),
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
        const workspace = asRecord(json)
        const id = asString(workspace.id)
        return {
          content: `created 知识库 "${asString(workspace.name) || args.name}"${id === '' ? '' : ` (${id})`}`,
          data: { record: clipJson(workspace, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_list',
    description: 'List the direct child nodes of a knowledge base (one level), optionally under a parent doc. Nodes carry fileSuffix otl (在线文档) or dbt (多维表格).',
    presentCall: args => titled(`列出知识库 ${args.workspace} 的文档`, 'read'),
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
        const nodes = listOf(json)
        const lines = nodes.map(nodeLine)
        return {
          content: lines.length === 0 ? '(no nodes)' : lines.join('\n'),
          data: { list: clipJson(nodes, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_get',
    description: 'Fetch one knowledge-base node (doc or sheet) by id: title, type, permission, timestamps, and the open link.',
    presentCall: args => titled(`查看文档 ${args.id}`, 'read'),
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
        const permission = asNumber(node.permissionLevel)
        const lines = [`${title === '' ? id : title} (${id})`]
        const suffixText = SUFFIX[asString(node.fileSuffix)]
        if (suffixText !== undefined && suffixText !== '') lines.push(`类型：${suffixText}`)
        if (permission !== undefined && PERMISSION[permission] !== undefined) {
          lines.push(`权限：${String(PERMISSION[permission])}`)
        }
        const creator = asString(node.creatorName)
        if (creator !== '') lines.push(`创建人：${creator}`)
        const updated = dateOf(node.updateTime)
        if (updated !== '') lines.push(`更新时间：${updated}`)
        const link = asString(node.openWebUrl)
        if (link !== '') lines.push(link)
        return {
          content: lines.join('\n'),
          data: { record: clipJson(node, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_recent',
    description: 'List the current user\'s recently visited documents across knowledge bases, newest first, with pagination cursor support.',
    presentCall: () => titled('最近访问的文档', 'read'),
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
        const nodes = listOf(json)
        const lines = nodes.map((record) => {
          const node = asRecord(record)
          const kb = asString(node.kbName)
          const visit = asNumber(node.visitTime)
          const tail = [
            kb,
            visit === undefined ? '' : `访问 ${new Date(visit).toISOString().slice(0, 10)}`,
          ].filter(part => part !== '')
          const base = nodeLine(node)
          return tail.length === 0 ? base : `${base} · ${tail.join(' · ')}`
        })
        return {
          content: lines.length === 0 ? '(no recent docs)' : lines.join('\n'),
          data: { list: clipJson(nodes, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_create',
    description: 'Create an online doc (otl) in a knowledge base, optionally under a parent node. Returns the new node id and link. For 多维表格 use yzj_sheet_create; knowledge bases have no folder type — use a parent doc for grouping.',
    presentCall: args => titled(named('新建文档', args.title), 'edit'),
    parameters: {
      workspace: { type: 'string', required: true, description: 'Knowledge base id (KB_ID).' },
      title: { type: 'string', required: true, description: 'Doc title (also the node title; do not repeat it as a level-1 heading inside the doc).' },
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

  register(defineTool({
    name: 'yzj_doc_rename',
    description: 'Rename a knowledge-base node (online doc or 多维表格).',
    presentCall: args => titled(named('重命名文档为', args.title), 'edit'),
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

  register(defineTool({
    name: 'yzj_doc_move',
    description: 'Move a knowledge-base node under another parent node. Requires user confirmation.',
    presentCall: args => titled(`移动文档 ${args.id}`, 'move'),
    parameters: {
      id: { type: 'string', required: true, description: 'Node id (DOC_ID) to move.' },
      targetParentId: { type: 'string', required: true, description: 'Target parent node id (any doc can be a parent).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc move',
        ['doc', 'move', '--id', args.id, '--target-parent-id', args.targetParentId], (json) => {
          const node = asRecord(json)
          const id = asString(node.id) || args.id
          return {
            content: `moved (${id}) → parent (${args.targetParentId})\n${docLink(id)}`,
            data: { record: clipJson(node, { maxChars: budget.maxMetaChars }), id, link: docLink(id) },
          }
        })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_delete',
    description: 'Delete a knowledge-base node irreversibly. Requires user confirmation.',
    presentCall: args => titled(`删除文档 ${args.id}`, 'delete'),
    parameters: {
      id: { type: 'string', required: true, description: 'Node id (DOC_ID) to delete.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      /*
        `--yes` 是操作者那次签字的**兑现**，不是绕过它。

        yzj-cli 0.1.4 起，不可恢复的命令自己要一道确认（缺 `--yes` 答 exit 3
        `confirmation_required`）。而本系统里那道门在更靠前的地方：guard 把这个工具列为
        **强确认**，卡递到操作者面前，人按下「确认」之后才轮到这一行。两道门问的是同一件
        事，人真正看得见的是我们这一道。

        不补这一行的后果不是「多问一次」——CLI 直接拒绝执行，于是**操作者点的头落在空处**，
        而模型只看到一句 failed，然后去编一个别的办法。这一族五个删除工具就是这么死了一
        整段时间的，没有任何测试拦得住：单测打的是假 bridge，假 bridge 不认 --yes。
      */
      return runValue(ctx, budget, 'doc delete', ['doc', 'delete', '--id', args.id, '--yes'], () => ({
        content: `deleted doc (${args.id})`,
        data: { id: args.id },
      }))
    },
  }))

  register(defineTool({
    name: 'yzj_doc_import',
    description: 'Import files into a knowledge base. Inline mode (.md): pass fileName + content. Reference mode (docx/xlsx/xls/csv/pptx/pdf/html/htm): upload first via yzj_file_upload and pass fileName + fileId + fileSize.',
    presentCall: args => titled(counted('导入文档', args.items), 'edit'),
    parameters: {
      workspace: { type: 'string', required: true, description: 'Target knowledge base id (KB_ID).' },
      items: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fileName: { type: 'string', required: true, description: 'File name with extension; .md selects inline mode.' },
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
        const nodes = listOf(json)
        if (nodes.length > 0) {
          const lines = nodes.map((record) => {
            const node = asRecord(record)
            const id = asString(node.id)
            return `${asString(node.title) || asString(node.fileName) || id} (${id})\n${docLink(id)}`
          })
          return { content: lines.join('\n'), data: { list: clipJson(nodes, { maxChars: budget.maxMetaChars }) } }
        }
        return {
          content: `imported ${String(args.items.length)} item(s)`,
          data: { payload: clipJson(asRecord(json), { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_download_url',
    description: 'Get a temporary (30-minute) download URL for an Office/HTML file node in a knowledge base (docx/xlsx/xls/csv/pptx/pdf/html/htm). Not supported for otl/dbt/md nodes.',
    presentCall: args => titled(`取文档 ${args.id} 的下载链接`, 'read'),
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
        return {
          content: url === '' ? '(no download url in response)' : url,
          data: { record: clipJson(payload, { maxChars: budget.maxMetaChars }), url },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_block_list',
    description: 'List the block structure of an online doc, optionally rooted at one block. Each line shows type, id, and a text preview.',
    presentCall: args => titled(`读文档 ${args.id} 的正文`, 'read'),
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
        return {
          content: lines.length === 0 ? '(no blocks)' : lines.join('\n'),
          data: { list: clipJson(blocks, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_doc_block_insert',
    description: 'Insert blocks into an online doc. element is a JSON array of block objects (heading/paragraph/codeBlock/blockQuote/table; inline text nodes support bold/italic/underline/strike attrs).',
    presentCall: args => titled(`往文档 ${args.id} 里插入内容`, 'edit'),
    parameters: {
      id: { type: 'string', required: true, description: 'Doc node id (DOC_ID).' },
      element: { type: 'string', required: true, description: 'JSON array of block objects, e.g. [{"type":"paragraph","content":[{"type":"text","content":"正文"}]}].' },
      blockId: { type: 'string', description: 'Parent block id; defaults to "doc" (document root).' },
      index: { type: 'number', description: 'Insertion index. Omit to append at the end; 0 inserts at the top.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['doc', 'block', 'insert', '--id', args.id, '--element', args.element]
      /*
        插入的父块参数叫 `--parent-block-id` (yzj-cli 0.1.4 起)。

        旧名 `--block-id` 会被 argv 解析直接拒绝——而 `doc block list` **至今仍用旧名**，
        两条命令一个新名一个旧名，照着隔壁那行抄必错。这一条和 goal/writeback.ts 里那条
        是同一次实跑撞出来的：升级之后线上每一笔文档写入都在失败。
      */
      if (args.blockId !== undefined) command.push('--parent-block-id', args.blockId)
      /*
        用**等号形式**送 index：负数用空格形式会被当成一个未知短参数（`--index -1` 报
        `unexpected argument '-1'`），等号形式才解析得了。实测 `--index=-1` 与省略 index
        一样是追加到末尾，`--index 0` 插到标题下面——CLI 帮助里写的「默认 0」不对。
      */
      if (args.index !== undefined) command.push(`--index=${String(args.index)}`)
      return runValue(ctx, budget, 'doc block insert', command, json => ({
        content: `inserted blocks into doc (${args.id})\n${docLink(args.id)}`,
        data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
      }))
    },
  }))

  register(defineTool({
    name: 'yzj_doc_block_update',
    description: 'Update blocks in an online doc. operations is a JSON array; each entry needs {"operation":"update_content"|"update_attrs","blockId":"<concrete block id from yzj_doc_block_list>","content":[...]|"attrs":{...}}.',
    presentCall: args => titled(counted(`改文档 ${args.id} 的正文`, args.operations), 'edit'),
    parameters: {
      id: { type: 'string', required: true, description: 'Doc node id (DOC_ID).' },
      operations: { type: 'string', required: true, description: 'JSON array of update operations (see description).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc block update',
        ['doc', 'block', 'update', '--id', args.id, '--operations', args.operations], json => ({
          content: `updated blocks in doc (${args.id})\n${docLink(args.id)}`,
          data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
        }))
    },
  }))

  register(defineTool({
    name: 'yzj_doc_block_delete',
    description: 'Delete child blocks of a parent block irreversibly. operations is a JSON array; each entry needs {"blockId":"<parent block id — the CONTAINER>","startIndex":N,"endIndex":M}. Requires user confirmation.',
    presentCall: args => titled(counted(`删文档 ${args.id} 的段落`, args.operations), 'delete'),
    parameters: {
      id: { type: 'string', required: true, description: 'Doc node id (DOC_ID).' },
      operations: { type: 'string', required: true, description: 'JSON array of delete operations (see description).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'doc block delete',
        ['doc', 'block', 'delete', '--id', args.id, '--operations', args.operations, '--yes'], json => ({
          content: `deleted blocks in doc (${args.id})\n${docLink(args.id)}`,
          data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
        }))
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
