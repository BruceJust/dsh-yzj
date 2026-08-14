/**
 * Confirmation card for yzj write tools, registered into the keyed
 * `tool.call.toolview` seat for every gated write tool name. While a write
 * call sits in the approval gate (status pending/approved), the card shows
 * the full gated arguments by domain, the risk level (strong = red), and the
 * decision verbs (确认 / 取消 / 查看上下文 / 编辑). Settled or ungated calls
 * fall back to the ordinary result card, whose content comes from the
 * durable tool events — replay-safe by construction.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { BakedActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { YzjWriteRecord } from '../write-gate.ts'
import { YzjToolCard } from './cards.tsx'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/src/client/contract/slots.ts'
import type { YzjPanelActions, YzjPanelState } from './stores.ts'
import css from './cards.module.css'

/**
 * Every tool name gated by `@dsh-yzj/tool-yzj`'s approval guard. Keep in
 * sync with `tool-yzj/src/guard.ts` `WRITE_SPECS` (a mismatch only affects
 * which calls render the confirmation card, never the gate itself).
 */
export const YZJ_WRITE_TOOL_NAMES = [
  // strong
  'yzj_doc_delete', 'yzj_doc_block_delete', 'yzj_sheet_table_delete',
  'yzj_sheet_record_delete', 'yzj_calendar_event_delete',
  // standard
  'yzj_im_message_send', 'yzj_file_upload', 'yzj_file_download',
  'yzj_doc_move', 'yzj_doc_workspace_create', 'yzj_doc_create',
  'yzj_doc_rename', 'yzj_doc_import', 'yzj_doc_block_insert',
  'yzj_doc_block_update', 'yzj_sheet_create', 'yzj_sheet_table_create',
  'yzj_sheet_table_rename', 'yzj_sheet_record_create', 'yzj_sheet_record_update',
  'yzj_calendar_event_create', 'yzj_calendar_event_update',
] as const

/** The injected decision face the confirmation card receives. */
export interface WriteCardInjected {
  /** One gated record for the call, or undefined when not gated. */
  fetchWrite: (callId: string) => Promise<YzjWriteRecord | undefined>
  /** Settle the pending decision; false when the record is no longer pending. */
  decideWrite: (writeId: string, outcome: 'allowed-once' | 'rejected') => Promise<boolean>
  /** Fresh message window for the 查看上下文 jump (chat domain). */
  fetchMessages: (groupId: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>
  /** Fresh doc window for the 查看上下文 jump (doc/kb/sheet domains). */
  fetchDocs: (workspace: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>
  /** Push a draft text back into the composer for editing. */
  editDraft: (text: string) => void
}

/** Store shares the card uses for the panel jump (registered with `store`). */
export type WriteCardStoreProps = {
  useStore: <R>(selector: (state: YzjPanelState) => R) => R
  actions: BakedActions<YzjPanelState, YzjPanelActions>
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

/** Short Chinese title per gated tool (mirrors cards.tsx families). */
const WRITE_TITLES: Record<string, string> = {
  yzj_doc_delete: '删除文档',
  yzj_doc_block_delete: '删除内容',
  yzj_sheet_table_delete: '删除数据表',
  yzj_sheet_record_delete: '删除记录',
  yzj_calendar_event_delete: '取消日程',
  yzj_im_message_send: '发送消息',
  yzj_file_upload: '上传文件',
  yzj_file_download: '下载文件',
  yzj_doc_move: '移动文档',
  yzj_doc_workspace_create: '新建知识库',
  yzj_doc_create: '新建文档',
  yzj_doc_rename: '重命名文档',
  yzj_doc_import: '导入文档',
  yzj_doc_block_insert: '插入内容',
  yzj_doc_block_update: '更新内容',
  yzj_sheet_create: '新建多维表格',
  yzj_sheet_table_create: '新建数据表',
  yzj_sheet_table_rename: '重命名数据表',
  yzj_sheet_record_create: '新增记录',
  yzj_sheet_record_update: '更新记录',
  yzj_calendar_event_create: '新建日程',
  yzj_calendar_event_update: '更新日程',
}

/** Domain labels for the card header. */
const DOMAIN_LABELS: Record<string, string> = {
  im: '消息', doc: '文档', kb: '知识库', sheet: '多维表格', calendar: '日程', file: '文件', other: '云之家',
}

function row(title: string, sub: string, key: string): ReactNode {
  return (
    <div className={css.row} key={key}>
      <div className={css.rowTitle}>{title}</div>
      {sub !== '' && <div className={css.rowSub}>{sub}</div>}
    </div>
  )
}

/** The full draft text a card's 编辑 verb restores into the composer. */
export function writableDraft(record: YzjWriteRecord): string {
  const args = asRecord(record.args)
  const content = asString(args.content)
  if (content !== '') return content
  const records = asString(args.records)
  if (records !== '') return records
  const title = asString(args.title)
  if (title !== '') return title
  return ''
}

/** The 查看上下文 jump: open the panel on the tab the write targets. */
function openContext(props: WriteCardInjected & WriteCardStoreProps, record: YzjWriteRecord): void {
  props.actions.setOpen(true)
  props.actions.setError('')
  const args = asRecord(record.args)
  if (record.domain === 'im') {
    props.actions.setTab('chat')
    const groupId = asString(args.groupId)
    if (groupId !== '') {
      props.actions.setGroupId(groupId)
      void props.fetchMessages(groupId).then((result) => {
        if (result.ok) {
          const list = asArray(asRecord(result.value).list)
          props.actions.setMessages([...list].reverse())
        }
      })
    }
  } else if (record.domain === 'doc' || record.domain === 'kb' || record.domain === 'sheet') {
    props.actions.setTab('docs')
    const workspace = asString(args.workspace)
    if (workspace !== '') {
      props.actions.setWorkspaceId(workspace)
      void props.fetchDocs(workspace).then((result) => {
        if (result.ok) props.actions.setDocs(asArray(result.value))
      })
    }
  } else {
    props.actions.setTab('calendar')
  }
}

/** One line of gated arguments, domain-specific. */
function ArgBody({ record }: { record: YzjWriteRecord }): ReactNode {
  const args = asRecord(record.args)
  const str = (key: string): string => asString(args[key])
  const list = (key: string): unknown[] => asArray(args[key])
  const rows: ReactNode[] = []
  const push = (title: string, sub: string, key: string): void => { rows.push(row(title, sub, key)) }
  switch (record.domain) {
    case 'im':
      push('目标', str('groupId') !== '' ? `群 ${str('groupId')}` : `单聊 ${str('toOpenId')}`, 't')
      push('类型', str('msgType'), 'mt')
      if (str('content') !== '') {
        rows.push(<div className={css.fullText} key="c">{str('content')}</div>)
      }
      if (list('atOpenIds').length > 0) push('@', list('atOpenIds').join(', '), 'at')
      if (args.atAll === true) push('@', '@所有人', 'atall')
      if (str('replyMsgId') !== '') push('回复', str('replyMsgId'), 'rp')
      break
    case 'doc':
      push('文档', str('id'), 'id')
      if (str('workspace') !== '') push('知识库', str('workspace'), 'ws')
      if (str('title') !== '') push('标题', str('title'), 'ti')
      if (str('parentId') !== '') push('父节点', str('parentId'), 'pa')
      if (record.toolName === 'yzj_doc_move') push('目标父节点', str('targetParentId'), 'tp')
      if (str('operations') !== '') push('操作', str('operations').slice(0, 200), 'op')
      if (str('element') !== '') push('插入内容', str('element').slice(0, 200), 'el')
      break
    case 'kb':
      push('知识库名称', str('name'), 'n')
      if (str('description') !== '') push('简介', str('description'), 'd')
      break
    case 'sheet':
      push('多维表格', str('id'), 'id')
      if (str('tableId') !== '') push('数据表', str('tableId'), 'tb')
      if (str('records') !== '') push('记录', str('records').slice(0, 300), 'rc')
      if (str('recordIds') !== '') push('删除记录', str('recordIds'), 'rd')
      break
    case 'calendar':
      push('标题', str('title'), 't')
      if (str('start') !== '') push('开始', str('start'), 's')
      if (str('end') !== '') push('结束', str('end'), 'e')
      if (list('organizerOpenIds').length > 0) push('组织者', list('organizerOpenIds').join(', '), 'o')
      break
    case 'file':
      if (list('files').length > 0) push('文件', list('files').join(', '), 'f')
      if (str('name') !== '') push('文件名', str('name'), 'n')
      if (str('output') !== '') push('输出', str('output'), 'o')
      break
    default:
      rows.push(<div className={css.text} key="j">{JSON.stringify(args)}</div>)
  }
  return <div className={css.rows}>{rows}</div>
}

/**
 * The gated confirmation card. Pending/approved records render the decision
 * surface; everything else (ungated, cancelled, done, failed) delegates to
 * the ordinary tool card so the durable result stays the terminal display.
 */
export function YzjWriteToolCard(props: ToolCallViewProps & WriteCardInjected & WriteCardStoreProps) {
  const { toolName, callId } = props
  const [record, setRecord] = useState<YzjWriteRecord | undefined>(undefined)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    setReady(false)
    props.fetchWrite(callId)
      .then((found) => { if (live) { setRecord(found); setReady(true) } })
      .catch(() => { if (live) setReady(true) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId])

  if (!ready || record === undefined || (record.status !== 'pending' && record.status !== 'approved')) {
    return <YzjToolCard {...props} />
  }

  const strong = record.level === 'strong'
  const settled = record.status === 'approved'
  const title = WRITE_TITLES[toolName] ?? `云之家 · ${DOMAIN_LABELS[record.domain] ?? '写操作'}`
  const draft = writableDraft(record)
  const decide = (outcome: 'allowed-once' | 'rejected', next: YzjWriteRecord['status']): void => {
    void props.decideWrite(record.writeId, outcome).then((ok) => {
      if (ok) setRecord({ ...record, status: next })
    })
  }

  return (
    <div className={strong ? `${css.card} ${css.strongCard}` : css.card} role="status">
      <div className={css.header}>
        <span className={css.icon}>☁</span>
        <span className={css.title}>{title}</span>
        <span className={strong ? `${css.tag} ${css.tagStrong}` : css.tag}>
          {strong ? '强确认' : '需确认'}
        </span>
      </div>
      <ArgBody record={record} />
      {settled ? (
        <div className={css.text}>已批准，正在执行…</div>
      ) : (
        <div className={css.actions}>
          <button type="button" className={css.actionPrimary} onClick={() => decide('allowed-once', 'approved')}>确认</button>
          <button type="button" className={css.action} onClick={() => decide('rejected', 'cancelled')}>取消</button>
          <button type="button" className={css.action} onClick={() => openContext(props, record)}>查看上下文</button>
          {draft !== '' && (
            <button type="button" className={css.action} onClick={() => {
              props.editDraft(draft)
              decide('rejected', 'cancelled')
            }}>编辑</button>
          )}
        </div>
      )}
    </div>
  )
}
