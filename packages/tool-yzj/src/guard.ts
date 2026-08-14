/**
 * Approval guard for destructive or irreversible yzj operations. Returns an
 * `ask` pre-tool decision so the composed ApprovalService routes the call
 * through the GUI approval panel; `next()` delegates everything else.
 * The reasons mirror the yzj-cli skill's dangerous-operation list.
 */

import type { Context } from '@deepseek-ai/cordis'

interface DangerousSpec {
  reason: string
  /** Optional predicate over the parsed call arguments; defaults to always ask. */
  when?: (args: Record<string, unknown>) => boolean
}

/** Tool name → confirmation spec for the operations that must never run unconfirmed. */
const DANGEROUS: Record<string, DangerousSpec> = {
  yzj_doc_delete: { reason: '删除知识库文档节点，不可恢复' },
  yzj_doc_move: { reason: '移动知识库文档节点' },
  yzj_doc_block_delete: { reason: '删除文档块内容，不可恢复' },
  yzj_sheet_table_delete: { reason: '删除数据表及其全部记录，不可恢复' },
  yzj_sheet_record_delete: { reason: '删除多维表格记录，不可恢复' },
  yzj_calendar_event_delete: { reason: '取消/删除日程' },
  yzj_im_message_send: { reason: '发送 IM 消息到云之家会话，发出后不可撤回' },
  yzj_file_upload: { reason: '上传文件到云之家，即刻落服务端' },
  yzj_file_download: { reason: '下载文件并覆盖本地已有文件', when: args => args.overwrite === true },
}

/**
 * Register the `tools/pre-execute` ask guard.
 * @param ctx - Cordis context carrying the tools registry.
 */
export function applyApprovalGuard(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const spec = DANGEROUS[exec.name]
    if (spec === undefined) return next()
    const args = typeof exec.arguments === 'object' && exec.arguments !== null
      ? exec.arguments as Record<string, unknown>
      : {}
    if (spec.when !== undefined && !spec.when(args)) return next()
    return { kind: 'ask', reason: `云之家操作确认：${spec.reason}` }
  })
}
