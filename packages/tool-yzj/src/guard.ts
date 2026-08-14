/**
 * Approval guard for yzj write operations, gated by a risk-level table
 * (design v1.6 §5.1/§5.5): read-only tools pass through, standard-level
 * writes ask, strong-level writes (deletion, irreversible) ask with the
 * strong flag and never merge into batch confirmations. The ask broadcasts a
 * `yzj/ask-pending` host event carrying the full parsed arguments so the
 * confirmation-card bridge (ui-yzj node half) can append the durable
 * `yzj/write-request` session event with complete parameter display.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Risk level of one gated write operation. */
export type YzjRiskLevel = 'standard' | 'strong'

interface DangerousSpec {
  reason: string
  /** 'strong' for irreversible operations (deletion etc.); never merged. */
  level: YzjRiskLevel
  /** Optional predicate over the parsed call arguments; defaults to always ask. */
  when?: (args: Record<string, unknown>) => boolean
}

/** Tool name → confirmation spec for every write tool in the yzj family. */
const WRITE_SPECS: Record<string, DangerousSpec> = {
  // --- strong: irreversible, never merged ---
  yzj_doc_delete: { reason: '删除知识库文档节点，不可恢复', level: 'strong' },
  yzj_doc_block_delete: { reason: '删除文档块内容，不可恢复', level: 'strong' },
  yzj_sheet_table_delete: { reason: '删除数据表及其全部记录，不可恢复', level: 'strong' },
  yzj_sheet_record_delete: { reason: '删除多维表格记录，不可恢复', level: 'strong' },
  yzj_calendar_event_delete: { reason: '取消/删除日程', level: 'strong' },
  // --- standard: side effects but reversible/new ---
  yzj_im_message_send: { reason: '发送 IM 消息到云之家会话，发出后不可撤回', level: 'standard' },
  yzj_file_upload: { reason: '上传文件到云之家，即刻落服务端', level: 'standard' },
  yzj_file_download: { reason: '下载文件并覆盖本地已有文件', level: 'standard', when: args => args.overwrite === true },
  yzj_doc_move: { reason: '移动知识库文档节点', level: 'standard' },
  yzj_doc_workspace_create: { reason: '新建知识库', level: 'standard' },
  yzj_doc_create: { reason: '新建知识库文档', level: 'standard' },
  yzj_doc_rename: { reason: '重命名知识库文档', level: 'standard' },
  yzj_doc_import: { reason: '导入文件到知识库', level: 'standard' },
  yzj_doc_block_insert: { reason: '向文档插入内容', level: 'standard' },
  yzj_doc_block_update: { reason: '更新文档内容', level: 'standard' },
  yzj_sheet_create: { reason: '新建多维表格', level: 'standard' },
  yzj_sheet_table_create: { reason: '新建数据表', level: 'standard' },
  yzj_sheet_table_rename: { reason: '重命名数据表', level: 'standard' },
  yzj_sheet_record_create: { reason: '新增多维表格记录', level: 'standard' },
  yzj_sheet_record_update: { reason: '更新多维表格记录', level: 'standard' },
  yzj_calendar_event_create: { reason: '新建日程', level: 'standard' },
  yzj_calendar_event_update: { reason: '更新日程', level: 'standard' },
}

/** The host-internal ask-pending event the guard emits before returning ask. */
export interface YzjAskPending {
  /** Exact tool call id; the approval answerer pairs it with the request. */
  callId: string
  toolName: string
  level: YzjRiskLevel
  reason: string
  /** Full parsed call arguments — displayed on the confirmation card. */
  args: Record<string, unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'yzj/ask-pending'(pending: YzjAskPending): void
  }
}

/**
 * Register the `tools/pre-execute` ask guard plus the ask-pending broadcast.
 * @param ctx - Cordis context carrying the tools registry.
 */
export function applyApprovalGuard(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const spec = WRITE_SPECS[exec.name]
    if (spec === undefined) return next()
    const args = typeof exec.arguments === 'object' && exec.arguments !== null
      ? exec.arguments as Record<string, unknown>
      : {}
    if (spec.when !== undefined && !spec.when(args)) return next()
    const reason = `云之家操作确认：${spec.reason}`
    ctx.emit('yzj/ask-pending', {
      callId: exec.callId,
      toolName: exec.name,
      level: spec.level,
      reason,
      args,
    })
    return { kind: 'ask', reason }
  })
}
