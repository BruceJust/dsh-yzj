/**
 * Tool-result cards for the yzj tool family, registered into ui-tool's
 * keyed `tool.call.toolview` slot. Pure presentation over the frozen call
 * slice, aligned with the design prototype: icon box + title + status pill,
 * human-readable rows, and NO raw ids (openIds / msgIds / fileIds / table
 * ids stay model-visible in the digest but never hit the card). Action
 * results render friendly summaries instead of the raw CLI text.
 */
import type { ReactNode } from 'react'
import {
  IconChecklistOutline14,
  IconCloseFill14,
  IconDataOutline16,
  IconFolderOpenOutline16,
  IconNewChatOutline16,
  IconRefreshOutline14,
  IconSendOutline14,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/src/client/contract/slots.ts'
import css from './cards.module.css'

/** Every wire tool name this package renders. */
export const YZJ_TOOL_NAMES = [
  'yzj_whoami',
  'yzj_contact_search',
  'yzj_contact_get',
  'yzj_doc_workspace_list',
  'yzj_doc_workspace_get',
  'yzj_doc_workspace_create',
  'yzj_doc_list',
  'yzj_doc_get',
  'yzj_doc_recent',
  'yzj_doc_create',
  'yzj_doc_rename',
  'yzj_doc_move',
  'yzj_doc_delete',
  'yzj_doc_import',
  'yzj_doc_download_url',
  'yzj_doc_block_list',
  'yzj_doc_block_insert',
  'yzj_doc_block_update',
  'yzj_doc_block_delete',
  'yzj_sheet_create',
  'yzj_sheet_get',
  'yzj_sheet_table_get',
  'yzj_sheet_table_create',
  'yzj_sheet_table_rename',
  'yzj_sheet_table_delete',
  'yzj_sheet_record_list',
  'yzj_sheet_record_create',
  'yzj_sheet_record_update',
  'yzj_sheet_record_delete',
  'yzj_calendar_event_list',
  'yzj_calendar_event_get',
  'yzj_calendar_event_create',
  'yzj_calendar_event_update',
  'yzj_calendar_event_delete',
  'yzj_calendar_event_participants',
  'yzj_calendar_room_find',
  'yzj_im_message_send',
  'yzj_im_message_list',
  'yzj_im_group_recent',
  'yzj_file_upload',
  'yzj_file_download',
] as const

/** Short human titles per tool family. */
const FAMILY_TITLES: Record<string, string> = {
  yzj_whoami: '我的信息',
  yzj_contact_search: '通讯录搜索',
  yzj_contact_get: '用户详情',
  yzj_doc_workspace_list: '知识库列表',
  yzj_doc_workspace_get: '知识库详情',
  yzj_doc_workspace_create: '新建知识库',
  yzj_doc_list: '文档列表',
  yzj_doc_get: '文档详情',
  yzj_doc_recent: '最近文档',
  yzj_doc_create: '新建文档',
  yzj_doc_rename: '重命名文档',
  yzj_doc_move: '移动文档',
  yzj_doc_delete: '删除文档',
  yzj_doc_import: '导入文档',
  yzj_doc_download_url: '文件下载链接',
  yzj_doc_block_list: '文档结构',
  yzj_doc_block_insert: '插入内容',
  yzj_doc_block_update: '更新内容',
  yzj_doc_block_delete: '删除内容',
  yzj_sheet_create: '新建多维表格',
  yzj_sheet_get: '多维表格结构',
  yzj_sheet_table_get: '数据表结构',
  yzj_sheet_table_create: '新建数据表',
  yzj_sheet_table_rename: '重命名数据表',
  yzj_sheet_table_delete: '删除数据表',
  yzj_sheet_record_list: '记录列表',
  yzj_sheet_record_create: '新增记录',
  yzj_sheet_record_update: '更新记录',
  yzj_sheet_record_delete: '删除记录',
  yzj_calendar_event_list: '日程列表',
  yzj_calendar_event_get: '日程详情',
  yzj_calendar_event_create: '新建日程',
  yzj_calendar_event_update: '更新日程',
  yzj_calendar_event_delete: '取消日程',
  yzj_calendar_event_participants: '日程参会人',
  yzj_calendar_room_find: '空闲会议室',
  yzj_im_message_send: '发送消息',
  yzj_im_message_list: '聊天记录',
  yzj_im_group_recent: '最近会话',
  yzj_file_upload: '上传文件',
  yzj_file_download: '下载文件',
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** Stringify a field for display (numbers included). */
function field(node: UnknownRecord, key: string): string {
  const value = node[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

/** One display row. */
function row(title: string, sub: string, key: string): ReactNode {
  return (
    <div className={css.row} key={key}>
      <div className={css.rowTitle}>{title}</div>
      {sub !== '' && <div className={css.rowSub}>{sub}</div>}
    </div>
  )
}

function linkRow(url: string, label: string, key: string): ReactNode {
  return (
    <a key={key} className={css.link} href={url} target="_blank" rel="noreferrer">{label}</a>
  )
}

/** Generic list body from title/sub key lists (ids never displayed). */
function listRows(list: unknown[], titleKeys: string[], subKeys: string[]): ReactNode {
  return (
    <div className={css.rows}>
      {list.map((item, index) => {
        const node = asRecord(item)
        const title = titleKeys.map(key => field(node, key)).find(value => value !== '') ?? ''
        const sub = subKeys.map(key => field(node, key)).filter(value => value !== '').join(' · ')
        return row(title === '' ? `第 ${index + 1} 项` : title, sub, `x${index}`)
      })}
    </div>
  )
}

/** Workspace/doc node sub-line. */
function nodeSub(node: UnknownRecord): string {
  const suffix = asString(node.fileSuffix)
  const updated = asString(node.updateTime).slice(0, 10)
  const parts = [suffix === '' ? '' : suffix === 'dbt' ? '多维表格' : '在线文档', updated]
  return parts.filter(part => part !== '').join(' · ')
}

/** Doc-domain body (workspaces, doc lists, doc records). */
function DocBody(meta: UnknownRecord): ReactNode {
  const list = asArray(meta.list)
  if (list.length > 0) {
    return (
      <div className={css.rows}>
        {list.map((item, index) => {
          const node = asRecord(item)
          const name = asString(node.name) !== '' ? asString(node.name) : asString(node.title)
          const kind = asNumber(node.visibility) === 2 ? '个人' : ''
          const url = asString(node.openWebUrl)
          return (
            <div key={`n${index}`} className={css.rowWrap}>
              {row(`${name}${kind === '' ? '' : ` · ${kind}`}`, nodeSub(node), `n${index}`)}
              {url !== '' && linkRow(url, '打开', `l${index}`)}
            </div>
          )
        })}
      </div>
    )
  }
  const record = asRecord(meta.record)
  const title = asString(record.title) || asString(record.name)
  const link = asString(record.openWebUrl)
  if (title !== '') {
    const suffix = asString(record.fileSuffix)
    const permission: Record<number, string> = { 1: '可管理', 2: '可编辑', 3: '可查看', 9: '无权限' }
    const perm = typeof record.permissionLevel === 'number' ? permission[record.permissionLevel] : undefined
    const sub = [suffix === 'dbt' ? '多维表格' : suffix === 'otl' ? '在线文档' : '', perm ?? '', asString(record.creatorName), asString(record.updateTime).slice(0, 10)]
      .filter(part => part !== '')
      .join(' · ')
    return (
      <div className={css.rows}>
        {row(title, sub, 'r')}
        {link !== '' && linkRow(link, '打开文档', 'l')}
      </div>
    )
  }
  return null
}

/** Block list body: block text + its type label. */
function BlockBody(meta: UnknownRecord): ReactNode {
  const blocks = asArray(meta.list)
  if (blocks.length === 0) return null
  return (
    <div className={css.rows}>
      {blocks.map((item, index) => {
        const block = asRecord(item)
        const type = asString(block.type)
        const content = asString(block.content).replace(/\s+/g, ' ').slice(0, 80)
        const label = type === 'heading' ? '标题' : type === 'paragraph' ? '段落' : type === 'code' ? '代码' : type === 'text' ? '文本' : type === '' ? '' : type
        return row(content === '' ? '(空块)' : content, label, `b${index}`)
      })}
    </div>
  )
}

/** Sheet-domain body (schema, table structure, records). */
function SheetBody(meta: UnknownRecord): ReactNode {
  const schema = asRecord(meta.schema)
  const sheets = asArray(schema.sheets)
  if (sheets.length > 0) {
    return (
      <div className={css.rows}>
        {sheets.map((item, index) => {
          const table = asRecord(item)
          const fields = asArray(table.fields).map(field => asString(asRecord(field).name)).filter(name => name !== '')
          return row(asString(table.name), fields.length === 0 ? '' : `字段：${fields.join(' / ')}`, `t${index}`)
        })}
      </div>
    )
  }
  const table = asRecord(meta.table)
  if (asString(table.name) !== '') {
    const fields = asArray(table.fields).map(field => asString(asRecord(field).name)).filter(name => name !== '')
    return (
      <div className={css.rows}>
        {row(asString(table.name), fields.length === 0 ? '' : `字段：${fields.join(' / ')}`, 't')}
      </div>
    )
  }
  const records = asArray(meta.list)
  if (records.length > 0) {
    return (
      <div className={css.rows}>
        {records.map((item, index) => {
          const record = asRecord(item)
          const fields = asRecord(record.fieldsValue ?? record.fields)
          const values = Object.entries(fields).map(([key, value]) => {
            const text = typeof value === 'string' ? value : JSON.stringify(value)
            return `${key}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`
          })
          return row(values.join(' · ') === '' ? '(空记录)' : values.join(' · '), '', `r${index}`)
        })}
      </div>
    )
  }
  return null
}

/** Calendar-domain body (events). */
function CalendarBody(meta: UnknownRecord): ReactNode {
  const events = asArray(meta.list)
  if (events.length === 0) return null
  const clock = (ms: unknown): string => {
    if (typeof ms !== 'number') return ''
    const date = new Date(ms)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return (
    <div className={css.rows}>
      {events.map((item, index) => {
        const event = asRecord(item)
        const start = clock(event.startDate)
        const end = clock(event.endDate)
        const time = start === '' ? '' : `${start}${end === '' ? '' : ` → ${end}`}`
        const person = asString(event.personName)
        return row(asString(event.title), [time, person].filter(part => part !== '').join(' · '), `e${index}`)
      })}
    </div>
  )
}

/** IM-domain body (messages / recent groups). */
function ImBody(meta: UnknownRecord): ReactNode {
  const messages = asArray(meta.list)
  if (messages.length > 0 && asString(asRecord(messages[0]).sendTime) !== '') {
    return (
      <div className={css.rows}>
        {messages.map((item, index) => {
          const message = asRecord(item)
          const time = asString(message.sendTime).slice(5, 16)
          const content = asString(message.content)
          const reply = asString(asRecord(message.param).replySummary)
          return row(content === '' ? '(文件/图片消息)' : content, [time, reply === '' ? '' : `↳ ${reply}`].filter(part => part !== '').join(' · '), `m${index}`)
        })}
      </div>
    )
  }
  const groups = messages
  if (groups.length > 0) {
    return (
      <div className={css.rows}>
        {groups.map((item, index) => {
          const group = asRecord(item)
          const unread = asNumber(group.unreadCount)
          const last = asString(asRecord(group.lastMsg).content)
          return row(asString(group.groupName), [unread !== undefined && unread > 0 ? `未读 ${unread}` : '', last.replace(/\s+/g, ' ').slice(0, 40)].filter(part => part !== '').join(' · '), `g${index}`)
        })}
      </div>
    )
  }
  return null
}

/** Contact-domain body (whoami / search / details). */
function ContactBody(meta: UnknownRecord): ReactNode {
  const list = asArray(meta.list)
  const record = asRecord(meta.record)
  const users = list.length > 0 ? list : [record]
  if (users.length === 0 || (list.length === 0 && Object.keys(record).length === 0)) return null
  return (
    <div className={css.rows}>
      {users.map((item, index) => {
        const user = asRecord(item)
        const name = asString(user.name)
        const department = asString(user.department ?? user.fulldepartment)
        const jobTitle = asString(user.jobTitle)
        const sub = [department, jobTitle].filter(part => part !== '').join(' · ')
        return (
          <div className={css.row} key={`u${index}`}>
            <div className={css.rowTitle}>
              {typeof user.photoUrl === 'string' && user.photoUrl !== ''
                ? <img className={css.avatar} src={user.photoUrl} alt="" referrerPolicy="no-referrer" />
                : <span className={css.avatarFallback}>{name.slice(0, 1)}</span>}
              <span>{name}</span>
            </div>
            {sub !== '' && <div className={css.rowSub}>{sub}</div>}
          </div>
        )
      })}
    </div>
  )
}

/** Friendly summary for action results (ids never shown). */
function ActionBody(meta: UnknownRecord, toolName: string): ReactNode {
  const rowsOut: ReactNode[] = []
  const link = asString(meta.link)
  const url = asString(meta.url)
  const output = asString(meta.output)
  const recordIds = asArray(meta.recordIds)
  const push = (title: string, sub: string, key: string): void => {
    rowsOut.push(row(title, sub, key))
  }
  if (toolName === 'yzj_im_message_send') push('消息已发送', '', 'sent')
  else if (toolName === 'yzj_file_upload') push('上传成功', '', 'up')
  else if (toolName === 'yzj_file_download') push('已下载到本地', output, 'dl')
  else if (toolName === 'yzj_doc_download_url') { /* link row below */ }
  else if (toolName.includes('_delete')) push('已删除', '', 'del')
  else if (toolName.includes('_create')) push('已创建', '', 'cr')
  else if (toolName.includes('_rename')) push('已重命名', '', 'rn')
  else if (toolName.includes('_move')) push('已移动', '', 'mv')
  else if (toolName.includes('_insert')) push('已插入内容', '', 'ins')
  else if (toolName.includes('_update')) push('已更新', recordIds.length > 0 ? `${recordIds.length} 条记录` : '', 'upd')
  else push('已完成', '', 'done')
  if (url !== '') rowsOut.push(linkRow(url, '下载链接', 'url'))
  if (link !== '') rowsOut.push(linkRow(link, '打开', 'link'))
  return <div className={css.rows}>{rowsOut}</div>
}

/** Family icon for the card header. */
function familyIcon(toolName: string): ReactNode {
  if (toolName.startsWith('yzj_im_')) return toolName === 'yzj_im_message_send' ? <IconSendOutline14 /> : <IconNewChatOutline16 />
  if (toolName.startsWith('yzj_contact_') || toolName === 'yzj_whoami') return <IconUserOutline16 />
  if (toolName.startsWith('yzj_sheet_')) return <IconDataOutline16 />
  if (toolName.startsWith('yzj_calendar_')) return <IconChecklistOutline14 />
  if (toolName.startsWith('yzj_file_')) return <IconRefreshOutline14 />
  return <IconFolderOpenOutline16 />
}

/**
 * The keyed atomic tool view: one card for every yzj tool. Pending calls
 * show the family icon and an 执行中 pill; settled calls render structured
 * rows (or a friendly action summary) — the raw digest (which carries ids)
 * is never shown to the human, and error text keeps the pill red.
 */
export function YzjToolCard({ toolName, block }: ToolCallViewProps) {
  const family = FAMILY_TITLES[toolName] ?? '云之家'
  if (!('kind' in block) || block.kind !== 'tool-result') {
    return (
      <div className={css.card}>
        <div className={css.header}>
          <span className={css.iconBox}>{familyIcon(toolName)}</span>
          <span className={css.title}>{family}</span>
          <span className={`${css.tag} ${css.tagRun}`}>执行中</span>
        </div>
      </div>
    )
  }

  if (block.isError) {
    return (
      <div className={`${css.card} ${css.errorCard}`}>
        <div className={css.header}>
          <span className={css.iconBox}><IconCloseFill14 /></span>
          <span className={css.title}>{family}</span>
          <span className={`${css.tag} ${css.tagFail}`}>失败</span>
        </div>
        <div className={css.text}>{resultText(block)}</div>
      </div>
    )
  }

  const meta = asRecord(block.meta)
  let body: ReactNode = null
  if (toolName === 'yzj_doc_block_list') body = BlockBody(meta)
  else if (toolName === 'yzj_calendar_event_participants') body = listRows(asArray(meta.list), ['name'], ['jobTitle', 'department'])
  else if (toolName === 'yzj_calendar_room_find') body = listRows(asArray(meta.list), ['name', 'title'], ['capacity', 'floor'])
  else if (toolName.startsWith('yzj_doc_')) body = DocBody(meta)
  else if (toolName.startsWith('yzj_sheet_')) body = SheetBody(meta)
  else if (toolName.startsWith('yzj_calendar_')) body = CalendarBody(meta)
  else if (toolName.startsWith('yzj_im_')) body = ImBody(meta)
  else if (toolName.startsWith('yzj_contact_') || toolName === 'yzj_whoami') body = ContactBody(meta)
  if (body === null) body = ActionBody(meta, toolName)

  return (
    <div className={css.card}>
      <div className={css.header}>
        <span className={css.iconBox}>{familyIcon(toolName)}</span>
        <span className={css.title}>{family}</span>
        <span className={css.tag}>云之家</span>
      </div>
      {body}
    </div>
  )
}

/** Settled result text blocks, flattened (error messages only). */
function resultText(block: Extract<ToolCallBlock, { kind: 'tool-result' }>): string {
  return block.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}
