/**
 * The Yunzhijia panel's viewing store: open state, active tab, fetched data
 * per tab, drill-down selection, loading/error flags. Module level exports
 * the factory only (a module-level handle would pin store identity across
 * plugin reloads); the two registrations share the factory's handle.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Panel tabs (我的 removed — the composer '@' covers directory search). */
export type YzjTab = 'docs' | 'calendar' | 'chat'

/** Yunzhijia panel viewing state (raw CLI payloads, rendered by components). */
export type YzjPanelState = {
  open: boolean
  tab: YzjTab
  /** Floating-window position (CSS px, viewport-relative). */
  panelX: number
  panelY: number
  workspaces: unknown[]
  workspaceId: string
  docs: unknown[]
  events: unknown[]
  groups: unknown[]
  groupsPage: number
  groupsMore: boolean
  groupId: string
  messages: unknown[]
  messagesMore: boolean
  messagesAnchor: string
  /** Message to scroll to and highlight after the group loads (jump anchor). */
  anchorMsgId: string
  /** Sum of unread counts across recent sessions (the floating-ball badge). */
  unreadTotal: number
  loading: boolean
  error: string
}

/** Annotation twin of the actions literal below. */
export type YzjPanelActions = {
  setOpen: (draft: YzjPanelState, open: boolean) => void
  setTab: (draft: YzjPanelState, tab: YzjTab) => void
  setPanelPosition: (draft: YzjPanelState, x: number, y: number) => void
  setWorkspaces: (draft: YzjPanelState, workspaces: unknown[]) => void
  setWorkspaceId: (draft: YzjPanelState, id: string) => void
  setDocs: (draft: YzjPanelState, docs: unknown[]) => void
  setEvents: (draft: YzjPanelState, events: unknown[]) => void
  setGroups: (draft: YzjPanelState, groups: unknown[]) => void
  setGroupsPage: (draft: YzjPanelState, page: number) => void
  setGroupsMore: (draft: YzjPanelState, more: boolean) => void
  appendGroups: (draft: YzjPanelState, groups: unknown[]) => void
  setGroupId: (draft: YzjPanelState, id: string) => void
  setMessages: (draft: YzjPanelState, messages: unknown[]) => void
  setMessagesMore: (draft: YzjPanelState, more: boolean) => void
  setMessagesAnchor: (draft: YzjPanelState, anchor: string) => void
  prependMessages: (draft: YzjPanelState, messages: unknown[]) => void
  setAnchorMsgId: (draft: YzjPanelState, id: string) => void
  setUnreadTotal: (draft: YzjPanelState, total: number) => void
  setLoading: (draft: YzjPanelState, loading: boolean) => void
  setError: (draft: YzjPanelState, error: string) => void
}

/** Create the Yunzhijia panel store handle. */
export function createYzjStore(): EngineStoreHandle<YzjPanelState, YzjPanelActions> {
  return defineStore({
    init: (): YzjPanelState => ({
      open: false,
      tab: 'docs',
      panelX: -1,
      panelY: -1,
      workspaces: [],
      workspaceId: '',
      docs: [],
      events: [],
      groups: [],
      groupsPage: 1,
      groupsMore: false,
      groupId: '',
      messages: [],
      messagesMore: false,
      messagesAnchor: '',
      anchorMsgId: '',
      unreadTotal: 0,
      loading: false,
      error: '',
    }),
    persist: 'dsh.yzj.panel.v2',
    actions: {
      setOpen: (d: YzjPanelState, open: boolean) => { d.open = open },
      setTab: (d: YzjPanelState, tab: YzjTab) => { d.tab = tab },
      setPanelPosition: (d: YzjPanelState, x: number, y: number) => { d.panelX = x; d.panelY = y },
      setWorkspaces: (d: YzjPanelState, workspaces: unknown[]) => { d.workspaces = workspaces },
      setWorkspaceId: (d: YzjPanelState, id: string) => { d.workspaceId = id },
      setDocs: (d: YzjPanelState, docs: unknown[]) => { d.docs = docs },
      setEvents: (d: YzjPanelState, events: unknown[]) => { d.events = events },
      setGroups: (d: YzjPanelState, groups: unknown[]) => { d.groups = groups },
      setGroupsPage: (d: YzjPanelState, page: number) => { d.groupsPage = page },
      setGroupsMore: (d: YzjPanelState, more: boolean) => { d.groupsMore = more },
      appendGroups: (d: YzjPanelState, groups: unknown[]) => {
        const seen = new Set(d.groups.map(group => String(asRecord(group).groupId)))
        d.groups = [...d.groups, ...groups.filter(group => !seen.has(String(asRecord(group).groupId)))]
      },
      setGroupId: (d: YzjPanelState, id: string) => { d.groupId = id },
      setMessages: (d: YzjPanelState, messages: unknown[]) => { d.messages = messages },
      setMessagesMore: (d: YzjPanelState, more: boolean) => { d.messagesMore = more },
      setMessagesAnchor: (d: YzjPanelState, anchor: string) => { d.messagesAnchor = anchor },
      prependMessages: (d: YzjPanelState, messages: unknown[]) => {
        const seen = new Set(d.messages.map(message => String(asRecord(message).msgId)))
        d.messages = [...messages.filter(message => !seen.has(String(asRecord(message).msgId))), ...d.messages]
      },
      setAnchorMsgId: (d: YzjPanelState, id: string) => { d.anchorMsgId = id },
      setUnreadTotal: (d: YzjPanelState, total: number) => { d.unreadTotal = total },
      setLoading: (d: YzjPanelState, loading: boolean) => { d.loading = loading },
      setError: (d: YzjPanelState, error: string) => { d.error = error },
    },
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}
