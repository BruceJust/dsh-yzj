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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  let result
  try {
    result = await ctx.yzjBridge.run(command)
  } catch (error) {
    // The bridge rejects only on spawn failure (binary missing, bad path) —
    // surface a structured error with the login hint instead of a 500.
    return internalError(`${label} failed: ${String(error)}；请确认已安装 yzj-cli 并完成 \`yzj-cli auth login\``)
  }
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

/* ── file-data proxy (docrest URLs need the CLI's auth) ─────────────── */

/** Largest payload the proxy returns (bytes) — keeps RPC and memory sane. */
const FILE_DATA_MAX_BYTES = 24 * 1024 * 1024
const fileDataCache = new Map<string, { dataUrl: string; bytes: number }>()
const fileDataInflight = new Map<string, Promise<{ dataUrl: string; bytes: number } | undefined>>()
let fileDataCachedBytes = 0

/** Sniff an image MIME from magic bytes ('' = not a known image). */
function sniffMime(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes.length >= 12 && bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  return ''
}

/** Download one file via the authenticated CLI; data URL or undefined. */
async function downloadFileData(ctx: Context, fileId: string): Promise<{ dataUrl: string; bytes: number } | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'yzj-file-'))
  const target = join(dir, 'payload.bin')
  try {
    const result = await ctx.yzjBridge.run(['file', 'download', '--id', fileId, '--output', target], { timeoutMs: 60_000 })
    if (!result.ok) return undefined
    const bytes = await readFile(target)
    if (bytes.length === 0 || bytes.length > FILE_DATA_MAX_BYTES) return undefined
    const mime = sniffMime(bytes) === '' ? 'application/octet-stream' : sniffMime(bytes)
    return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, bytes: bytes.length }
  } catch {
    return undefined
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Cached fileId → data URL (bounded by entries and total bytes). */
function rememberFileData(fileId: string, entry: { dataUrl: string; bytes: number }): void {
  fileDataCache.set(fileId, entry)
  fileDataCachedBytes += entry.bytes
  for (const [key, value] of fileDataCache) {
    if (fileDataCache.size <= 48 && fileDataCachedBytes <= 96 * 1024 * 1024) break
    fileDataCache.delete(key)
    fileDataCachedBytes -= value.bytes
  }
}

/** Resolve one file's data URL, deduped per fileId. */
async function fileDataFor(ctx: Context, fileId: string): Promise<{ dataUrl: string; bytes: number } | undefined> {
  const cached = fileDataCache.get(fileId)
  if (cached !== undefined) return cached
  let pending = fileDataInflight.get(fileId)
  if (pending === undefined) {
    pending = downloadFileData(ctx, fileId)
    fileDataInflight.set(fileId, pending)
  }
  const entry = await pending
  fileDataInflight.delete(fileId)
  if (entry !== undefined) rememberFileData(fileId, entry)
  return entry
}

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
      case 'im-send': {
        const groupId = stringField(payload, 'groupId')
        if (groupId === undefined) return internalError('im-send endpoint requires a groupId payload')
        const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
        const msgType = stringField(record, 'msgType') ?? 'text'
        if (msgType !== 'text' && msgType !== 'richText' && msgType !== 'file') {
          return internalError(`im-send endpoint rejects msg-type "${msgType}"`)
        }
        const content = stringField(record, 'content')
        const fileId = stringField(record, 'fileId')
        const replyMsgId = stringField(record, 'replyMsgId')
        const rawImages = record.images
        const images = Array.isArray(rawImages)
          ? rawImages.filter((item): item is string => typeof item === 'string' && item !== '')
          : []
        // Mirror the tool's validation: file needs a fileId and nothing else.
        if (msgType === 'file') {
          if (fileId === undefined) return internalError('im-send: msg-type file requires fileId')
          if (content !== undefined || replyMsgId !== undefined || images.length > 0) {
            return internalError('im-send: msg-type file does not support content, reply, or images')
          }
        } else {
          if (content === undefined || content.trim() === '') {
            return internalError('im-send: text/richText require non-empty content')
          }
          if (content.length > 4000) return internalError('im-send: content over 4000 chars')
          if (msgType !== 'richText' && images.length > 0) {
            return internalError('im-send: images are only supported for msg-type richText')
          }
        }
        const command = ['im', 'message', 'send', '--msg-type', msgType, '--group-id', groupId]
        if (content !== undefined) command.push('--content', content)
        if (fileId !== undefined) command.push('--file-id', fileId)
        if (replyMsgId !== undefined) command.push('--reply-msg-id', replyMsgId)
        for (const image of images) command.push('--image', image)
        return bridgeResult(ctx, 'im message send', command)
      }
      case 'file-upload': {
        const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
        const name = stringField(record, 'name')
        const base64 = stringField(record, 'base64')
        if (name === undefined || base64 === undefined) {
          return internalError('file-upload endpoint requires name and base64 payloads')
        }
        if (base64.length > 32 * 1024 * 1024) {
          return internalError('file-upload endpoint rejects payloads over 24MB (base64)')
        }
        let bytes: Buffer
        try {
          bytes = Buffer.from(base64, 'base64')
        } catch {
          return internalError('file-upload endpoint received invalid base64')
        }
        if (bytes.length === 0) return internalError('file-upload endpoint rejects empty files')
        if (bytes.length > 24 * 1024 * 1024) {
          return internalError('file-upload endpoint rejects files over 24MB')
        }
        const dir = await mkdtemp(join(tmpdir(), 'yzj-up-'))
        const target = join(dir, name.replace(/[\\/:*?"<>|]/g, '_'))
        try {
          await writeFile(target, bytes)
          const result = await ctx.yzjBridge.run(
            ['file', 'upload', '--file', target, '--name', name],
            { timeoutMs: 120_000 },
          )
          if (!result.ok) {
            const detail = result.stderr.trim() === '' ? `file upload failed (exit ${result.exitCode})` : result.stderr.trim()
            return internalError(detail)
          }
          const payloadJson = result.json ?? {}
          const fileId = stringField(payloadJson, 'fileId') ?? stringField(payloadJson, 'file_id') ?? stringField(payloadJson, 'id')
          if (fileId === undefined) return internalError('file upload returned no fileId')
          return { ok: true, value: { fileId, name, size: bytes.length } }
        } catch (error) {
          return internalError(`file upload failed: ${String(error)}`)
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {})
        }
      }
      case 'file-data': {
        const fileId = stringField(payload, 'fileId')
        if (fileId === undefined) return internalError('file-data endpoint requires a fileId payload')
        const entry = await fileDataFor(ctx, fileId)
        if (entry === undefined) return internalError(`file-data failed to download fileId ${fileId}`)
        return { ok: true, value: entry }
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
