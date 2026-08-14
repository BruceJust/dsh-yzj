/**
 * The Yunzhijia panel's viewing store: open state, active tab, fetched data
 * per tab, drill-down selection, loading/error flags. Module level exports
 * the factory only (a module-level handle would pin store identity across
 * plugin reloads); the two registrations share the factory's handle.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Panel tabs. */
export type YzjTab = 'docs' | 'calendar' | 'chat' | 'me'

/** Yunzhijia panel viewing state (raw CLI payloads, rendered by components). */
export type YzjPanelState = {
  open: boolean
  tab: YzjTab
  workspaces: unknown[]
  workspaceId: string
  docs: unknown[]
  events: unknown[]
  groups: unknown[]
  groupId: string
  messages: unknown[]
  me: unknown
  searchKeyword: string
  searchResults: unknown[]
  loading: boolean
  error: string
}

/** Annotation twin of the actions literal below. */
export type YzjPanelActions = {
  setOpen: (draft: YzjPanelState, open: boolean) => void
  setTab: (draft: YzjPanelState, tab: YzjTab) => void
  setWorkspaces: (draft: YzjPanelState, workspaces: unknown[]) => void
  setWorkspaceId: (draft: YzjPanelState, id: string) => void
  setDocs: (draft: YzjPanelState, docs: unknown[]) => void
  setEvents: (draft: YzjPanelState, events: unknown[]) => void
  setGroups: (draft: YzjPanelState, groups: unknown[]) => void
  setGroupId: (draft: YzjPanelState, id: string) => void
  setMessages: (draft: YzjPanelState, messages: unknown[]) => void
  setMe: (draft: YzjPanelState, me: unknown) => void
  setSearchKeyword: (draft: YzjPanelState, keyword: string) => void
  setSearchResults: (draft: YzjPanelState, results: unknown[]) => void
  setLoading: (draft: YzjPanelState, loading: boolean) => void
  setError: (draft: YzjPanelState, error: string) => void
}

/** Create the Yunzhijia panel store handle. */
export function createYzjStore(): EngineStoreHandle<YzjPanelState, YzjPanelActions> {
  return defineStore({
    init: (): YzjPanelState => ({
      open: false,
      tab: 'docs',
      workspaces: [],
      workspaceId: '',
      docs: [],
      events: [],
      groups: [],
      groupId: '',
      messages: [],
      me: {},
      searchKeyword: '',
      searchResults: [],
      loading: false,
      error: '',
    }),
    persist: 'dsh.yzj.panel.v1',
    actions: {
      setOpen: (d: YzjPanelState, open: boolean) => { d.open = open },
      setTab: (d: YzjPanelState, tab: YzjTab) => { d.tab = tab },
      setWorkspaces: (d: YzjPanelState, workspaces: unknown[]) => { d.workspaces = workspaces },
      setWorkspaceId: (d: YzjPanelState, id: string) => { d.workspaceId = id },
      setDocs: (d: YzjPanelState, docs: unknown[]) => { d.docs = docs },
      setEvents: (d: YzjPanelState, events: unknown[]) => { d.events = events },
      setGroups: (d: YzjPanelState, groups: unknown[]) => { d.groups = groups },
      setGroupId: (d: YzjPanelState, id: string) => { d.groupId = id },
      setMessages: (d: YzjPanelState, messages: unknown[]) => { d.messages = messages },
      setMe: (d: YzjPanelState, me: unknown) => { d.me = me },
      setSearchKeyword: (d: YzjPanelState, keyword: string) => { d.searchKeyword = keyword },
      setSearchResults: (d: YzjPanelState, results: unknown[]) => { d.searchResults = results },
      setLoading: (d: YzjPanelState, loading: boolean) => { d.loading = loading },
      setError: (d: YzjPanelState, error: string) => { d.error = error },
    },
  })
}
