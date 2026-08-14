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
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { YzjToolCard, YZJ_TOOL_NAMES } from './cards.tsx'
import { YzjComposerDock, dragInsertRequest, type YzjDropInjected } from './composer.tsx'
import { applyYzjAtSource } from './input-source.ts'
import { YzjPanel, YzjPanelButton } from './panel.tsx'
import { createYzjStore } from './stores.ts'
import { createYzjPanelInject } from './rpc.ts'

export { createYzjStore } from './stores.ts'
export { createYzjPanelInject } from './rpc.ts'
export type { YzjPanelInject, YzjRpcError } from './rpc.ts'
export type { YzjPanelState, YzjPanelActions, YzjTab } from './stores.ts'
export type { YzjPanelProps } from './panel.tsx'

/** Required services: the slot registry, connection transport, and sessions. */
export const inject = ['slots', 'connection', 'sessions']

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

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
    {
      name: 'conversation.composer.dock',
      id: 'yzj-drop-band',
      order: 100,
      inject: (sessionId: string): YzjDropInjected => {
        // The node-half write-gate imports host-only types that merge the
        // host `ctx.sessions` declaration over the browser runtime's in this
        // single-program package; re-narrow to the client scope face.
        const sessions = ctx.sessions as unknown as { scope: (id: string) => import('@deepseek-ai/dsh-client-runtime/client').AgentContext | undefined }
        const actx = sessions.scope(sessionId)
        return {
          insertReference: (ref) => {
            if (actx === undefined) return
            // Resolve the span from the LIVE input store — component
            // snapshots are point-in-time and would carry a stale draftRev.
            const attempt = (): boolean => {
              const conversation = actx.get('conversation') as
                | { input: { for: (actx: unknown) => { state: { getSnapshot(): { draft: string; draftRev: number } } } } }
                | undefined
              const state = conversation?.input.for(actx).state.getSnapshot()
              const length = state?.draft.length ?? 0
              const draftRev = state?.draftRev ?? 0
              return actx.bail(actx, 'slash/input-insert-reference', dragInsertRequest(ref, { start: length, end: length, draftRev })) === true
            }
            if (!attempt()) {
              // One retry after a frame: the drop may have raced an input
              // mutation that bumped draftRev past our snapshot.
              setTimeout(() => { attempt() }, 80)
            }
          },
        }
      },
    },
    YzjComposerDock,
  ))

  applyYzjAtSource(ctx, panelInject)

  for (const toolName of YZJ_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: toolName },
      YzjToolCard,
    ))
  }
}
