/**
 * Yunzhijia browser surface, node half: the `/yzj` Connection RPC channel over
 * `ctx.yzjBridge`. The browser half fetches workspaces, docs, events, chats,
 * and contacts through it; the model-facing tools remain in `@dsh-yzj/tool-yzj`.
 * Only lossless CLI-parsed JSON crosses the channel — never harness live
 * objects.
 * @module @dsh-yzj/ui-yzj
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@dsh-yzj/bridge'
import { applyWriteGate, type YzjWriteRecord } from './write-gate.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ui-yzj'
/** Services required by the board channel. */
export const inject = ['connection', 'yzjBridge']

/** Internal failure envelope matching the closed RpcError union. */
function internalError(message: string): { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } } {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** One bridge call projected into the RPC result envelope. */
async function bridgeResult(
  ctx: Context,
  label: string,
  command: readonly string[],
): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } }> {
  const result = await ctx.yzjBridge.run(command)
  if (!result.ok) {
    const detail = result.stderr.trim() === '' ? `${label} failed (exit ${result.exitCode})` : result.stderr.trim()
    return internalError(detail)
  }
  return { ok: true, value: result.json ?? {} }
}

/** Validate a string field of an RPC payload. */
function stringField(payload: unknown, key: string): string | undefined {
  const value = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Cap an integer field at the CLI's real `--limit` bound (1-20 for im). */
function clampLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined
  return Math.min(value, CLI_LIMIT_MAX)
}

/** Hard CLI cap for im `--limit` (verified against yzj-cli 0.x). */
const CLI_LIMIT_MAX = 20

/** Project a write-gate record into lossless JSON for the browser card. */
function projectRecord(record: YzjWriteRecord): YzjWriteRecord {
  return {
    writeId: record.writeId,
    sessionId: record.sessionId,
    toolName: record.toolName,
    ...record.callId === undefined ? {} : { callId: record.callId },
    level: record.level,
    domain: record.domain,
    args: record.args,
    reason: record.reason,
    status: record.status,
    ...record.error === undefined ? {} : { error: record.error },
    time: record.time,
    ...record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt },
  }
}

/** The write-gate query/decide face consumed by the RPC handler. */
export interface YzjWriteGateFace {
  list: (sessionId: string, callId?: string) => YzjWriteRecord[]
  decide: (writeId: string, outcome: 'allowed-once' | 'rejected') => boolean
}

/**
 * Build the `/yzj` RPC handler: `workspaces`, `docs`, `events`, `groups`,
 * `messages`, `whoami`, `search`, `doc-get`, `doc-blocks`, `sheet-get`,
 * `workspace-get`, `event-get`, `contact-get`, `write-list`, and
 * `write-decide` endpoints, all backed by the yzj-cli bridge and the
 * write-gate. Endpoint payloads are validated as lossless JSON before use.
 * @param ctx - Cordis context carrying the bridge service.
 * @param writeGate - the confirmation-card bridge face.
 */
export function createRpcHandler(ctx: Context, writeGate: YzjWriteGateFace): ConnectionRpcHandler {
  return async (endpoint, payload, _signal) => {
    switch (endpoint) {
      case 'workspaces': {
        const type = stringField(payload, 'type')
        const command = ['doc', 'workspace', 'list']
        if (type !== undefined) command.push('--type', type)
        return bridgeResult(ctx, 'doc workspace list', command)
      }
      case 'docs': {
        const workspace = stringField(payload, 'workspace')
        if (workspace === undefined) return internalError('docs endpoint requires a workspace payload')
        const command = ['doc', 'list', '--workspace', workspace]
        const parentId = stringField(payload, 'parentId')
        if (parentId !== undefined) command.push('--parent-id', parentId)
        return bridgeResult(ctx, 'doc list', command)
      }
      case 'events': {
        const start = stringField(payload, 'start')
        const end = stringField(payload, 'end')
        if (start === undefined || end === undefined) return internalError('events endpoint requires start and end payloads')
        return bridgeResult(ctx, 'calendar event list', ['calendar', 'event', 'list', '--start', start, '--end', end])
      }
      case 'groups': {
        const command = ['im', 'group', 'recent']
        if (typeof payload === 'object' && payload !== null) {
          const limit = clampLimit((payload as Record<string, unknown>).limit)
          if (limit !== undefined) command.push('--limit', String(limit))
          const page = (payload as Record<string, unknown>).page
          if (typeof page === 'number' && Number.isInteger(page) && page > 0) command.push('--page', String(page))
        }
        return bridgeResult(ctx, 'im group recent', command)
      }
      case 'messages': {
        const groupId = stringField(payload, 'groupId')
        if (groupId === undefined) return internalError('messages endpoint requires a groupId payload')
        const command = ['im', 'message', 'list', '--group-id', groupId]
        const type = stringField(payload, 'type')
        if (type !== undefined) command.push('--type', type)
        const msgId = stringField(payload, 'msgId')
        if (msgId !== undefined) command.push('--msg-id', msgId)
        if (typeof payload === 'object' && payload !== null) {
          const limit = clampLimit((payload as Record<string, unknown>).limit)
          if (limit !== undefined) command.push('--limit', String(limit))
        }
        return bridgeResult(ctx, 'im message list', command)
      }
      case 'whoami': {
        return bridgeResult(ctx, 'contact user get', ['contact', 'user', 'get'])
      }
      case 'doc-get': {
        const id = stringField(payload, 'id')
        if (id === undefined) return internalError('doc-get endpoint requires an id payload')
        return bridgeResult(ctx, 'doc get', ['doc', 'get', '--id', id])
      }
      case 'doc-blocks': {
        const id = stringField(payload, 'id')
        if (id === undefined) return internalError('doc-blocks endpoint requires an id payload')
        const command = ['doc', 'block', 'list', '--id', id]
        const blockId = stringField(payload, 'blockId')
        if (blockId !== undefined) command.push('--block-id', blockId)
        return bridgeResult(ctx, 'doc block list', command)
      }
      case 'sheet-get': {
        const id = stringField(payload, 'id')
        if (id === undefined) return internalError('sheet-get endpoint requires an id payload')
        return bridgeResult(ctx, 'sheet get', ['sheet', 'get', '--id', id])
      }
      case 'workspace-get': {
        const id = stringField(payload, 'id')
        if (id === undefined) return internalError('workspace-get endpoint requires an id payload')
        return bridgeResult(ctx, 'doc workspace get', ['doc', 'workspace', 'get', '--id', id])
      }
      case 'event-get': {
        const id = stringField(payload, 'id')
        if (id === undefined) return internalError('event-get endpoint requires an id payload')
        return bridgeResult(ctx, 'calendar event get', ['calendar', 'event', 'get', '--id', id])
      }
      case 'contact-get': {
        const openId = stringField(payload, 'openId')
        if (openId === undefined) return internalError('contact-get endpoint requires an openId payload')
        return bridgeResult(ctx, 'contact user get', ['contact', 'user', 'get', '--open-id', openId])
      }
      case 'search': {
        const keyword = stringField(payload, 'keyword')
        if (keyword === undefined) return internalError('search endpoint requires a keyword payload')
        return bridgeResult(ctx, 'contact user search', ['contact', 'user', 'search', '--keyword', keyword])
      }
      case 'write-list': {
        const sessionId = stringField(payload, 'sessionId')
        if (sessionId === undefined) return internalError('write-list endpoint requires a sessionId payload')
        const callId = stringField(payload, 'callId')
        const list = writeGate.list(sessionId, callId).map(projectRecord)
        return { ok: true, value: { list } }
      }
      case 'write-decide': {
        const writeId = stringField(payload, 'writeId')
        const outcome = stringField(payload, 'outcome')
        if (writeId === undefined || outcome === undefined) {
          return internalError('write-decide endpoint requires writeId and outcome payloads')
        }
        if (outcome !== 'allowed-once' && outcome !== 'rejected') {
          return internalError(`write-decide endpoint rejects outcome "${outcome}"`)
        }
        const settled = writeGate.decide(writeId, outcome)
        return { ok: true, value: { settled } }
      }
      default:
        return internalError(`unknown /yzj endpoint ${endpoint}`)
    }
  }
}

/**
 * Register the `/yzj` channel over the built handler.
 * @param ctx - Cordis context carrying the connection and bridge services.
 */
export function apply(ctx: Context): void {
  const writeGate = applyWriteGate(ctx)
  const handler = createRpcHandler(ctx, writeGate)
  ctx.connection.rpc.handle('/yzj', handler, { authority: 'loopback' })
}
