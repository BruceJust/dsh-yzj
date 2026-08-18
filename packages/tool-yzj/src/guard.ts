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
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const GATEWAY_ESCAPE_TOOLS = new Set([
  'bash', 'pwsh', 'subagent', 'subagent_fork', 'workflow', 'ralph',
  'create_goal', 'update_goal', 'send_message',
])

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

interface GatewaySource {
  kind: 'yzj-agent'
  writeMode?: unknown
  messageId: string
  accountOrgId: string
  accountOpenId: string
}

/**
 * Locate the current turn's gateway source. Revocation is judged through the
 * injected checker (the gateway's own state via `ctx.yzjRevocations`); the
 * legacy in-log `yzj/authority-revoked` scan stays for logs written before
 * revocations moved out of the Session log.
 */
function gatewaySource(
  exec: Pick<ToolExecution, 'agent'>,
  isRevoked?: (messageId: string) => boolean,
): GatewaySource | undefined {
  const events = exec.agent?.session.events
  if (events === undefined) return undefined
  const revoked = new Set<string>()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const eventType = event.type as string
    if (eventType === 'yzj/authority-revoked') {
      const messageId = (event.data as { messageId?: unknown }).messageId
      if (typeof messageId === 'string') revoked.add(messageId)
      continue
    }
    if (eventType === 'turn/start') return undefined
    if (eventType !== 'user/message') continue
    const value = (event.data as unknown as { source?: unknown }).source
    if (typeof value !== 'object' || value === null) return undefined
    const source = value as Partial<GatewaySource>
    if (source.kind !== 'yzj-agent') return undefined
    if (typeof source.messageId !== 'string'
      || typeof source.accountOrgId !== 'string'
      || typeof source.accountOpenId !== 'string') {
      throw new Error('Yunzhijia Agent turn is missing its pinned task or account identity')
    }
    if (revoked.has(source.messageId) || isRevoked?.(source.messageId) === true) {
      throw new Error('Yunzhijia Agent task authority was revoked after timeout')
    }
    return source as GatewaySource
  }
  return undefined
}

/**
 * Standard writes are pre-authorized only inside the current turn admitted by
 * the Yunzhijia @agent gateway. Earlier turns and ordinary Web prompts never
 * inherit this authority; strong writes still ask below.
 */
export function isGatewayStandardWrite(exec: Pick<ToolExecution, 'agent'>): boolean {
  return gatewaySource(exec)?.writeMode === 'standard'
}

async function assertGatewayIdentity(ctx: Context, source: GatewaySource): Promise<void> {
  const result = await ctx.yzjBridge.run(['contact', 'user', 'get'], { timeoutMs: 10_000 })
  if (!result.ok) throw new Error('Cannot verify the Yunzhijia account before Agent tool execution')
  const first = Array.isArray(result.json) ? result.json[0] : result.json
  const identity = typeof first === 'object' && first !== null
    ? first as Record<string, unknown>
    : {}
  if (identity.orgId !== source.accountOrgId || identity.openId !== source.accountOpenId) {
    throw new Error('Yunzhijia login account changed after this Agent task was admitted')
  }
}

/**
 * Register the `tools/pre-execute` ask guard plus the ask-pending broadcast.
 * @param ctx - Cordis context carrying the tools registry.
 */
export function applyApprovalGuard(ctx: Context): void {
  // Optional cross-package channel: absent (gateway plugin not loaded) means
  // no state-backed revocations exist and the in-log scan alone decides.
  const isRevoked = (messageId: string): boolean => (
    ctx.get('yzjRevocations')?.isRevoked(messageId) === true
  )
  ctx.on('tools/pre-execute', async (exec, next) => {
    const source = gatewaySource(exec, isRevoked)
    if (source !== undefined && GATEWAY_ESCAPE_TOOLS.has(exec.name)) {
      return { kind: 'deny', reason: 'Yunzhijia Agent turns cannot use shell or delegated execution tools' }
    }
    if (source !== undefined && exec.name.startsWith('yzj_')) {
      await assertGatewayIdentity(ctx, source)
    }
    const spec = WRITE_SPECS[exec.name]
    if (spec === undefined) return next()
    if (spec.level === 'standard' && isGatewayStandardWrite(exec)) return next()
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
