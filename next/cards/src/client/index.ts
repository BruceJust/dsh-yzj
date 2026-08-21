/**
 * Browser half of the card system: the keyed `tool.call.toolview` seat for
 * every gated Yunzhijia write.
 *
 * The name list is duplicated here rather than imported, because a browser
 * bundle may not reach into the node-side tool package. A name missing from
 * this list only means that call renders as an ordinary tool row — the GATE
 * itself lives in the guard and is unaffected either way.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { YzjApprovalCard } from './approval-card.tsx'
import { createCardInject, type CardInject } from './rpc.ts'

export { YzjApprovalCard } from './approval-card.tsx'
export { createCardInject, type CardInject, type CardWire } from './rpc.ts'

export const inject = ['slots', 'connection']

/**
 * Every tool the approval guard gates. Keep in sync with `WRITE_SPECS` in
 * `@yzj-next/tools`; a mismatch changes presentation only.
 */
export const YZJ_GATED_TOOL_NAMES = [
  'yzj_doc_delete', 'yzj_doc_block_delete', 'yzj_sheet_table_delete',
  'yzj_sheet_record_delete', 'yzj_calendar_event_delete',
  'yzj_im_message_send', 'yzj_file_upload', 'yzj_file_download',
  'yzj_doc_move', 'yzj_doc_workspace_create', 'yzj_doc_create',
  'yzj_doc_rename', 'yzj_doc_import', 'yzj_doc_block_insert',
  'yzj_doc_block_update', 'yzj_sheet_create', 'yzj_sheet_table_create',
  'yzj_sheet_table_rename', 'yzj_sheet_record_create', 'yzj_sheet_record_update',
  'yzj_calendar_event_create', 'yzj_calendar_event_update',
] as const

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const cardInject: CardInject = createCardInject(connection)
  for (const toolName of YZJ_GATED_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      {
        name: 'tool.call.toolview',
        key: toolName,
        inject: () => ({ inject: cardInject }),
      },
      YzjApprovalCard,
    ))
  }
}
