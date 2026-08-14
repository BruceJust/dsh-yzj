/**
 * RPC face for the Yunzhijia panel: every data verb the panel needs, backed
 * by the `/yzj` connection channel registered by this package's node half.
 * Plain callbacks over JSON — components never see the connection handle.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

/** One RPC failure, normalized for display. */
export interface YzjRpcError {
  message: string
}

/** The injected data face the panel receives. */
export interface YzjPanelInject {
  fetchWorkspaces: (type?: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchDocs: (workspace: string, parentId?: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchEvents: (start: string, end: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchGroups: (limit?: number, page?: number) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchMessages: (groupId: string, limit?: number, page?: { type: 'newest' | 'old' | 'new'; msgId?: string }) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchWhoami: () => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchSearch: (keyword: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchDoc: (id: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchDocBlocks: (id: string, blockId?: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  /** 多维表格 schema (tables and fields) — used for dbt drag previews. */
  fetchSheet: (id: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchWorkspace: (id: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchEvent: (id: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  fetchContact: (openId: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  /** One write-confirmation record for a tool call (undefined when not gated). */
  fetchWrite: (sessionId: string, callId: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
  /** Settle one pending write-confirmation decision. */
  decideWrite: (writeId: string, outcome: 'allowed-once' | 'rejected') => Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }>
}

/** Build the inject face from a connection handle; unavailable → failed calls. */
export function createYzjPanelInject(connection: ConnectionHandle | undefined): YzjPanelInject {
  const call = async (endpoint: string, payload: Record<string, unknown>)
    : Promise<{ ok: true; value: unknown } | { ok: false; error: YzjRpcError }> => {
    if (connection === undefined) return { ok: false, error: { message: 'connection unavailable' } }
    const result = await connection.rpc.call('/yzj', endpoint, payload)
    if (result.ok) return { ok: true, value: result.value }
    return { ok: false, error: { message: result.error.message } }
  }
  return {
    fetchWorkspaces: (type) => call('workspaces', type === undefined ? {} : { type }),
    fetchDocs: (workspace, parentId) => call('docs', parentId === undefined ? { workspace } : { workspace, parentId }),
    fetchEvents: (start, end) => call('events', { start, end }),
    fetchGroups: (limit, page) => call('groups', {
      ...(limit === undefined ? {} : { limit }),
      ...(page === undefined ? {} : { page }),
    }),
    fetchMessages: (groupId, limit, page) => call('messages', {
      groupId,
      ...(limit === undefined ? {} : { limit }),
      ...(page === undefined ? { type: 'newest' } : page),
    }),
    fetchWhoami: () => call('whoami', {}),
    fetchSearch: (keyword) => call('search', { keyword }),
    fetchDoc: (id) => call('doc-get', { id }),
    fetchDocBlocks: (id, blockId) => call('doc-blocks', blockId === undefined ? { id } : { id, blockId }),
    fetchSheet: (id) => call('sheet-get', { id }),
    fetchWorkspace: (id) => call('workspace-get', { id }),
    fetchEvent: (id) => call('event-get', { id }),
    fetchContact: (openId) => call('contact-get', { openId }),
    fetchWrite: (sessionId, callId) => call('write-list', { sessionId, callId }),
    decideWrite: (writeId, outcome) => call('write-decide', { writeId, outcome }),
  }
}
