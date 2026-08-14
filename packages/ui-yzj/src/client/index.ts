/**
 * Browser half: the sidebar-foot 云之家 toggle plus the frame-overlay
 * workspace panel, sharing one store, and the keyed tool-result cards for
 * every yzj tool. All data flows through the Connection RPC channel (`/yzj`)
 * registered by this package's node half; components receive every fact and
 * verb through the standard props shares.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { YzjToolCard, YZJ_TOOL_NAMES } from './cards.tsx'
import { YzjPanel, YzjPanelButton } from './panel.tsx'
import { createYzjStore } from './stores.ts'
import { createYzjPanelInject } from './rpc.ts'

export { createYzjStore } from './stores.ts'
export { createYzjPanelInject } from './rpc.ts'
export type { YzjPanelInject, YzjRpcError } from './rpc.ts'
export type { YzjPanelState, YzjPanelActions, YzjTab } from './stores.ts'
export type { YzjPanelProps } from './panel.tsx'

/** Required services: the slot registry and the connection transport. */
export const inject = ['slots', 'connection']

/**
 * Client plugin body: register the sidebar toggle, the overlay panel, and the
 * keyed tool views. All registrations are fiber-scoped effects.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const store = createYzjStore()
  const panelInject = createYzjPanelInject(connection)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'yzj', order: 100, label: () => '云之家', store },
    YzjPanelButton,
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'yzj-panel', order: 100, store, inject: () => panelInject },
    YzjPanel,
  ))

  for (const toolName of YZJ_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: toolName },
      YzjToolCard,
    ))
  }
}
