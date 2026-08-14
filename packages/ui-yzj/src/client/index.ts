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
import { YzjPanel, YzjFloatBall } from './panel.tsx'
import { createYzjStore } from './stores.ts'
import { createYzjPanelInject } from './rpc.ts'
import {
  YZJ_WRITE_TOOL_NAMES, YzjWriteToolCard,
  type WriteCardInjected,
} from './write-card.tsx'
import type { YzjWriteRecord } from '../write-gate.ts'

export { createYzjStore } from './stores.ts'
export { createYzjPanelInject } from './rpc.ts'
export type { YzjPanelInject, YzjRpcError } from './rpc.ts'
export type { YzjPanelState, YzjPanelActions, YzjTab } from './stores.ts'
export type { YzjPanelProps } from './panel.tsx'
export type { WriteCardInjected } from './write-card.tsx'

/** Required services: the slot registry, connection transport, and sessions. */
export const inject = ['slots', 'connection', 'sessions']

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The client session scope face (see the composer dock for the why). */
function scopeOf(ctx: ClientContext, sessionId: string): import('@deepseek-ai/dsh-client-runtime/client').AgentContext | undefined {
  const sessions = ctx.sessions as unknown as { scope: (id: string) => import('@deepseek-ai/dsh-client-runtime/client').AgentContext | undefined }
  return sessions.scope(sessionId)
}

/** Push plain text into a session's composer draft (slash/input-insert-text). */
function insertDraftText(actx: import('@deepseek-ai/dsh-client-runtime/client').AgentContext, text: string): void {
  const attempt = (): boolean => {
    const conversation = actx.get('conversation') as
      | { input: { for: (actx: unknown) => { state: { getSnapshot(): { draft: string; draftRev: number } } } } }
      | undefined
    const state = conversation?.input.for(actx).state.getSnapshot()
    const length = state?.draft.length ?? 0
    const draftRev = state?.draftRev ?? 0
    return actx.bail(actx, 'slash/input-insert-text', { text, span: { start: length, end: length, draftRev } }) === true
  }
  if (!attempt()) {
    setTimeout(attempt, 80)
  }
}

/**
 * Client plugin body: register the sidebar toggle, the overlay panel, the
 * keyed tool views, and the write-confirmation cards. All registrations are
 * fiber-scoped effects.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const store = createYzjStore()
  const panelInject = createYzjPanelInject(connection)
  // The engine caches one instance per handle × scope key, so this root
  // create() IS the instance the panel/button slots mount — actions here
  // drive the live panel.
  const panelInstance = store.create()
  const openWriteContextFor = (record: YzjWriteRecord): void => openWriteContext(panelInstance, panelInject, record)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'yzj-panel', order: 100, store, inject: () => panelInject },
    YzjPanel,
  ))

  // Floating ball entry: the ONLY panel entry (no sidebar button). Shares the
  // panel store; hidden while the panel is open; hover shows a quick-dock of
  // tab shortcuts. Lower order so the panel entry wins the stack.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'yzj-ball',
      order: 90,
      store,
      inject: () => ({
        fetchGroups: (limit, page) => panelInject.fetchGroups(limit, page),
      }),
    },
    YzjFloatBall,
  ))

  // Drop band: registered in `conversation.input.dock` (its own row above the
  // composer card) because `conversation.composer.dock` only renders in the
  // non-hero phase — a brand-new session would have no drop target at all.
  // The band itself stays hidden until a yzj drag crosses the window
  // (see composer.tsx); the panel entry is the floating ball only.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    {
      name: 'conversation.input.dock',
      id: 'yzj-drop-band',
      order: 100,
      inject: (sessionId: string): YzjDropInjected => {
        const actx = scopeOf(ctx, sessionId)
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
          insertText: (text): void => {
            if (actx !== undefined) insertDraftText(actx, text)
          },
        }
      },
    },
    YzjComposerDock,
  ))

  applyYzjAtSource(ctx, panelInject)

  // Write tools render only the confirmation-enhanced card (which falls back
  // to the ordinary card internally); registering both under the same key
  // would collide in the keyed toolview seat.
  const writeNames = YZJ_WRITE_TOOL_NAMES as readonly string[]
  for (const toolName of YZJ_TOOL_NAMES) {
    if (writeNames.includes(toolName)) continue
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: toolName },
      YzjToolCard,
    ))
  }

  for (const toolName of YZJ_WRITE_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      {
        name: 'tool.call.toolview',
        key: toolName,
        inject: (sessionId: string): WriteCardInjected => {
          const actx = scopeOf(ctx, sessionId)
          return {
            fetchWrite: async (callId): Promise<YzjWriteRecord | undefined> => {
              const result = await panelInject.fetchWrite(sessionId, callId)
              if (!result.ok) return undefined
              const list = asArray(asRecord(result.value).list)
              return list.length > 0 ? list[0] as YzjWriteRecord : undefined
            },
            decideWrite: async (writeId, outcome): Promise<boolean> => {
              const result = await panelInject.decideWrite(writeId, outcome)
              return result.ok && asRecord(result.value).settled === true
            },
            openContext: openWriteContextFor,
            editDraft: (text): void => {
              if (actx !== undefined) insertDraftText(actx, text)
            },
            fetchWhoami: async (): Promise<string> => {
              const result = await panelInject.fetchWhoami()
              if (!result.ok) return ''
              const users = asArray(result.value)
              return asString(asRecord(users[0] ?? {}).name)
            },
          }
        },
      },
      YzjWriteToolCard,
    ))
  }
}

/**
 * The 查看上下文 jump: open the shared panel store instance (the engine
 * caches one instance per handle × scope key, so this IS the panel's store)
 * and drive it onto the tab the write targets.
 */
function openWriteContext(
  instance: import('@deepseek-ai/dsh-client-runtime/client').EngineStoreInstance<
    import('./stores.ts').YzjPanelState,
    import('./stores.ts').YzjPanelActions
  >,
  inject: ReturnType<typeof createYzjPanelInject>,
  record: YzjWriteRecord,
): void {
  const actions = instance.actions
  actions.setOpen(true)
  actions.setError('')
  const args = asRecord(record.args)
  if (record.domain === 'im') {
    actions.setTab('chat')
    const groupId = asString(args.groupId)
    if (groupId !== '') {
      actions.setGroupId(groupId)
      // Anchor on the replied-to message when this write is a reply — the
      // context the user must verify before sending.
      const replyTarget = asString(args.replyMsgId)
      if (replyTarget !== '') actions.setAnchorMsgId(replyTarget)
      void inject.fetchMessages(groupId, 20).then((result) => {
        if (result.ok) {
          const list = asArray(asRecord(result.value).list)
          actions.setMessages([...list].reverse())
        }
      })
    }
  } else if (record.domain === 'doc' || record.domain === 'kb' || record.domain === 'sheet') {
    actions.setTab('docs')
    const workspace = asString(args.workspace)
    if (workspace !== '') {
      actions.setWorkspaceId(workspace)
      void inject.fetchDocs(workspace).then((result) => {
        if (result.ok) actions.setDocs(asArray(result.value))
      })
    }
  } else {
    actions.setTab('calendar')
  }
}
