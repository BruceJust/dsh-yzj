/**
 * Sheet-domain tools (多维表格): file creation, schema reads, table management,
 * and record CRUD. Node-level rename/move/delete reuse the doc tools — a
 * 多维表格 IS a knowledge-base node with `fileSuffix=dbt`, and duplicating those
 * verbs here would mean two gates on one action.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  asArray, asNumber, asRecord, asString, clipJson, counted, docLink, named, runValue, titled,
  yzjToolOutput,
  type YzjToolBudget,
} from './shared.ts'

function tableLine(record: unknown): string {
  const table = asRecord(record)
  const id = asNumber(table.id)
  const name = asString(table.name)
  const fields = asArray(table.fields)
    .map(field => asString(asRecord(field).name))
    .filter(value => value !== '')
  const head = `${name === '' ? '(unnamed)' : name} (${id === undefined ? '?' : String(id)})`
  return fields.length === 0 ? head : `${head} · 字段: ${fields.join(' / ')}`
}

function recordLine(record: unknown): string {
  const row = asRecord(record)
  const id = asString(row.id ?? row.recordId)
  const fields = asRecord(row.fieldsValue ?? row.fields ?? row.values)
  const parts: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue
    let text: string
    if (typeof value === 'string') text = value
    else if (typeof value === 'number' || typeof value === 'boolean') text = String(value)
    else text = JSON.stringify(value)
    if (text.length > 80) text = `${text.slice(0, 80)}…`
    parts.push(`${key}=${text}`)
  }
  const body = parts.join(', ')
  return id === '' ? body : `${id}${body === '' ? '' : `: ${body}`}`
}

/** The record array from either a `{records: [...]}` payload or a bare array. */
function recordsOf(json: unknown): unknown[] {
  const records = asArray(asRecord(json).records)
  return records.length > 0 ? records : asArray(json)
}

/** Register the sheet-domain tools. Returns the disposer for all of them. */
export function applySheetTools(ctx: Context, budget: YzjToolBudget): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'yzj_sheet_create',
    description: 'Create a 多维表格 (dbt node) in a knowledge base, optionally under a parent. Returns the new node id and link; use yzj_sheet_get to read its schema.',
    presentCall: args => titled(named('新建多维表格', args.title), 'edit'),
    parameters: {
      workspace: { type: 'string', required: true, description: 'Knowledge base id (KB_ID).' },
      title: { type: 'string', required: true, description: 'Sheet title.' },
      parent: { type: 'string', description: 'Optional parent node id to nest under.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['sheet', 'create', '--workspace', args.workspace, '--title', args.title]
      if (args.parent !== undefined) command.push('--parent', args.parent)
      return runValue(ctx, budget, 'sheet create', command, (json) => {
        const node = asRecord(json)
        const id = asString(node.id)
        const link = docLink(id)
        return {
          content: `created 多维表格 "${asString(node.title) || args.title}"${id === '' ? '' : ` (${id})`}\n${link}`,
          data: { record: clipJson(node, { maxChars: budget.maxMetaChars }), id, link },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_get',
    description: 'Read a 多维表格\'s schema: one line per data table (integer table id, fields, views). Always call this before table/record operations to obtain real table ids and field names.',
    presentCall: args => titled(`查看多维表格 ${args.id}`, 'read'),
    parameters: { id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID, fileSuffix=dbt).' } },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'sheet get', ['sheet', 'get', '--id', args.id], (json) => {
        const sheets = asArray(asRecord(json).sheets)
        const lines = sheets.map(tableLine)
        return {
          content: lines.length === 0 ? '(no tables)' : lines.join('\n'),
          data: { schema: clipJson(json, { maxChars: budget.maxMetaChars }) },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_table_get',
    description: 'Read one data table\'s structure (fields and views) by its integer table id, resolved from yzj_sheet_get.',
    presentCall: args => titled(`查看数据表 ${args.tableId}`, 'read'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      tableId: { type: 'number', required: true, description: 'Integer data-table id from yzj_sheet_get.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runValue(ctx, budget, 'sheet table get',
        ['sheet', 'table', 'get', '--id', args.id, '--table-id', String(args.tableId)], (json) => {
          const table = asRecord(json)
          return {
            content: tableLine(table),
            data: { table: clipJson(table, { maxChars: budget.maxMetaChars }) },
          }
        })
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_table_create',
    description: 'Create a data table inside a 多维表格. fields and views are JSON arrays; field types include MultiLineText/Number/Currency/Percent/Date/Time/SingleSelect/MultipleSelect/Rating/Checkbox/Complete/ID/Phone/Email/Url/Contact/Attachment/Address/Note/Link; view types include Grid/Kanban/Gallery/Form/Gantt/Query.',
    presentCall: args => titled(named('新建数据表', args.name), 'edit'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      name: { type: 'string', required: true, description: 'Data-table name.' },
      fields: { type: 'string', required: true, description: 'JSON array of field definitions, e.g. [{"name":"任务名","type":"MultiLineText"}].' },
      views: { type: 'string', required: true, description: 'JSON array of view definitions, e.g. [{"name":"默认视图","type":"Grid"}].' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'sheet table create',
        ['sheet', 'table', 'create', '--id', args.id, '--name', args.name, '--fields', args.fields, '--views', args.views],
        json => ({
          content: `created 数据表 "${args.name}" in 多维表格 (${args.id})\n${docLink(args.id)}`,
          data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
        }))
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_table_rename',
    description: 'Rename a data table inside a 多维表格.',
    presentCall: args => titled(named('数据表重命名为', args.name), 'edit'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      tableId: { type: 'number', required: true, description: 'Integer data-table id.' },
      name: { type: 'string', required: true, description: 'New data-table name.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'sheet table rename',
        ['sheet', 'table', 'rename', '--id', args.id, '--table-id', String(args.tableId), '--name', args.name],
        () => ({
          content: `renamed 数据表 ${String(args.tableId)} → "${args.name}" (${args.id})`,
          data: { id: args.id, tableId: args.tableId, link: docLink(args.id) },
        }))
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_table_delete',
    description: 'Delete a data table and all its records irreversibly. Requires user confirmation.',
    presentCall: args => titled(`删除数据表 ${args.tableId}`, 'delete'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      tableId: { type: 'number', required: true, description: 'Integer data-table id to delete.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'sheet table delete',
        ['sheet', 'table', 'delete', '--id', args.id, '--table-id', String(args.tableId)], () => ({
          content: `deleted 数据表 ${String(args.tableId)} from 多维表格 (${args.id})`,
          data: { id: args.id, tableId: args.tableId },
        }))
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_record_list',
    description: 'List records of a data table with optional filter/search/pagination. Filter JSON: {"mode":"AND","criteria":[{"field":"字段名","operator":"Equals","values":["值"]}]} (operators: Equals/NotEqu/Greater/GreaterEqu/Less/LessEqu/GreaterEquAndLessEqu/BeginWith/EndWith/Contains/NotContains/Intersected/Empty/NotEmpty).',
    presentCall: args => titled(`读数据表 ${args.tableId} 的记录`, 'read'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      tableId: { type: 'number', required: true, description: 'Integer data-table id.' },
      filter: { type: 'string', description: 'Optional filter JSON object (see description).' },
      textValue: { type: 'string', description: 'Optional text search value.' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Optional field names to return only.' },
      viewId: { type: 'string', description: 'Optional view id to query through.' },
      pageToken: { type: 'string', description: 'Pagination cursor from the previous page\'s next_page_token.' },
      limit: { type: 'number', description: 'Max records; default 100, single call max 100.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const command = ['sheet', 'record', 'list', '--id', args.id, '--table-id', String(args.tableId)]
      if (args.filter !== undefined) command.push('--filter', args.filter)
      if (args.textValue !== undefined) command.push('--text-value', args.textValue)
      for (const field of args.fields ?? []) command.push('--fields', field)
      if (args.viewId !== undefined) command.push('--view-id', args.viewId)
      if (args.pageToken !== undefined) command.push('--page-token', args.pageToken)
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
          throw new Error('yzj_sheet_record_list: limit must be an integer between 1 and 100')
        }
        command.push('--limit', String(args.limit))
      }
      return runValue(ctx, budget, 'sheet record list', command, (json) => {
        const records = recordsOf(json)
        const root = asRecord(json)
        const next = asString(root.next_page_token ?? root.nextPageToken)
        const lines = records.map(recordLine)
        return {
          content: [
            ...(lines.length === 0 ? ['(no records)'] : lines),
            ...(next === '' ? [] : [`(more: page_token ${next})`]),
          ].join('\n'),
          data: { list: clipJson(records, { maxChars: budget.maxMetaChars }), nextPageToken: next },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_record_create',
    description: 'Create records in a data table. records is a JSON array; each entry: {"fieldsValue":{"字段名":"值"}} — field names must match the schema from yzj_sheet_get, values follow the field types (strings, numbers, booleans, arrays, or objects for Url/Contact/Attachment/Address/Note).',
    presentCall: args => titled(counted('新增记录', args.records), 'edit'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      tableId: { type: 'number', required: true, description: 'Integer data-table id.' },
      records: { type: 'string', required: true, description: 'JSON array of record entries with fieldsValue (see description).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'sheet record create',
        ['sheet', 'record', 'create', '--id', args.id, '--table-id', String(args.tableId), '--records', args.records],
        (json) => {
          const created = recordsOf(json)
          return {
            content: `created ${created.length > 0 ? String(created.length) : '?'} record(s) in 数据表 ${String(args.tableId)} (${args.id})\n${docLink(args.id)}`,
            data: { list: clipJson(created, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
          }
        })
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_record_update',
    description: 'Update records in a data table. records is a JSON array; each entry: {"id":"rec_xxx","fieldsValue":{"字段名":"新值"}} — only the fields to change.',
    presentCall: args => titled(counted('更新记录', args.records), 'edit'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      tableId: { type: 'number', required: true, description: 'Integer data-table id.' },
      records: { type: 'string', required: true, description: 'JSON array of {id, fieldsValue} entries (see description).' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'sheet record update',
        ['sheet', 'record', 'update', '--id', args.id, '--table-id', String(args.tableId), '--records', args.records],
        json => ({
          content: `updated record(s) in 数据表 ${String(args.tableId)} (${args.id})\n${docLink(args.id)}`,
          data: { payload: clipJson(json, { maxChars: budget.maxMetaChars }), id: args.id, link: docLink(args.id) },
        }))
    },
  }))

  register(defineTool({
    name: 'yzj_sheet_record_delete',
    description: 'Delete records irreversibly by comma-separated record ids. Requires user confirmation.',
    presentCall: args => titled(counted('删除记录', args.recordIds), 'delete'),
    parameters: {
      id: { type: 'string', required: true, description: 'The 多维表格 node id (DOC_ID).' },
      tableId: { type: 'number', required: true, description: 'Integer data-table id.' },
      recordIds: { type: 'string', required: true, description: 'Comma-separated record ids, e.g. "rec_abc,rec_def".' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      return runValue(ctx, budget, 'sheet record delete',
        ['sheet', 'record', 'delete', '--id', args.id, '--table-id', String(args.tableId), '--record-ids', args.recordIds],
        () => ({
          content: `deleted record(s) [${args.recordIds}] from 数据表 ${String(args.tableId)} (${args.id})`,
          data: { id: args.id, tableId: args.tableId, recordIds: args.recordIds },
        }))
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
