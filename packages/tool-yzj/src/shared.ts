/**
 * Shared tool plumbing for the yzj tool family: the common output contract,
 * digest builders, CLI payload accessors, and the capped presentation payload
 * every tool projects through `output.presentationMeta`.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { YzjRunResult } from '@dsh-yzj/bridge'
import type {} from '@dsh-yzj/bridge'

/** Resolved tool budget shared by the yzj tools. */
export interface YzjToolBudget {
  /** Cooperative timeout per bridge invocation in milliseconds. */
  timeoutMs: number
  /** Cap on the model-facing digest in characters. */
  maxRenderChars: number
  /** Cap on the UI presentation payload in characters (after clipping). */
  maxMetaChars: number
}

/**
 * The common tool result: `content` is the model-facing digest, `truncated`
 * records whether the cap cut it, and `data` is the capped structured payload
 * the UI reads through `presentationMeta` (never model-visible itself).
 */
export interface YzjToolValue {
  content: string
  truncated: boolean
  data: JsonValue
}

/** Cap a rendered digest at the character budget. */
function digestOf(text: string, max: number): { content: string; truncated: boolean } {
  if (text.length <= max) return { content: text, truncated: false }
  return { content: text.slice(0, max), truncated: true }
}

/** A model-facing failure digest from a non-ok bridge invocation. */
export function failureDigest(label: string, result: YzjRunResult, max: number): YzjToolValue {
  const reason = result.timedOut ? 'timed out' : `exit ${result.exitCode ?? 'killed'}`
  const detail = result.stderr.trim() === '' ? '(no stderr)' : result.stderr.trim()
  const hint = looksUnauthenticated(result.stderr)
    ? '\n提示：yzj-cli 可能未登录，请先运行 `yzj-cli auth login` 完成浏览器/设备码登录。'
    : ''
  const { content, truncated } = digestOf(`yzj ${label} failed (${reason}): ${detail}${hint}`, max)
  return { content, truncated, data: {} }
}

/** Heuristic: stderr mentions an auth/credential failure worth a login hint. */
function looksUnauthenticated(stderr: string): boolean {
  return /(auth|login|登录|token|credential|unauthorized|未授权)/i.test(stderr)
}

/** Wrap a digest into the common tool value with an empty payload. */
export function textValue(content: string, truncated: boolean): YzjToolValue {
  return { content, truncated, data: {} }
}

/** Build a common tool value from a digest and a capped payload. */
export function valueOf(content: string, truncated: boolean, data: JsonValue): YzjToolValue {
  return { content, truncated, data }
}

type UnknownRecord = Record<string, unknown>

export function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function asBool(value: unknown): boolean {
  return value === true
}

/** One line per array entry rendered by the per-domain formatters. */
export function linesOf(entries: readonly string[], max: number): { content: string; truncated: boolean } {
  return digestOf(entries.join('\n'), max)
}

/**
 * Deep-clip a CLI JSON payload for UI presentation: long strings truncate to
 * `maxString`, arrays cap at `maxItems`, and the result is dropped when its
 * JSON serialization still exceeds `maxChars` (returning `{}` instead). Pure
 * and lossy — never feeds the model.
 */
export function clipJson(
  value: unknown,
  options: { maxString?: number; maxItems?: number; maxChars: number },
): Record<string, JsonValue> {
  const maxString = options.maxString ?? 300
  const maxItems = options.maxItems ?? 100

  const clip = (node: unknown, depth: number): unknown => {
    if (depth > 6) return undefined
    if (typeof node === 'string') {
      return node.length <= maxString ? node : `${node.slice(0, maxString)}…`
    }
    if (Array.isArray(node)) {
      const kept = node.slice(0, maxItems).map(item => clip(item, depth + 1))
      return node.length > maxItems ? [...kept, { __clipped: node.length - maxItems }] : kept
    }
    if (typeof node === 'object' && node !== null) {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const clipped = clip(child, depth + 1)
        if (clipped !== undefined) out[key] = clipped
      }
      return out
    }
    return node
  }

  const clipped = clip(value, 0)
  if (clipped === undefined) return {}
  const json = JSON.stringify(clipped)
  if (json !== undefined && json.length > options.maxChars) {
    // Keep only the head of oversized payloads: UI cards degrade gracefully.
    return { __oversized: true }
  }
  return clipped as Record<string, JsonValue>
}

/** Run one bridge command and return a common tool value. */
export async function runValue(
  ctx: Context,
  budget: YzjToolBudget,
  label: string,
  command: readonly string[],
  format: (json: unknown) => { content: string; data: unknown },
): Promise<YzjToolValue> {
  const result = await (ctx.yzjBridge).run(command, { timeoutMs: budget.timeoutMs })
  if (!result.ok) return failureDigest(label, result, budget.maxRenderChars)
  const { content, data } = format(result.json)
  const digest = digestOf(content, budget.maxRenderChars)
  // Every formatter builds its payload from clipped JSON or raw CLI records
  // (lossless JSON by construction); the schema's `data: { type: 'json' }`
  // contract holds without a per-site cast.
  return { content: digest.content, truncated: digest.truncated, data: data as JsonValue }
}

/**
 * Build a common tool value from a plain CLI text (non-JSON or JSON-rendered)
 * with an empty presentation payload.
 */
export function textRunValue(
  result: YzjRunResult,
  label: string,
  max: number,
): YzjToolValue {
  if (!result.ok) return failureDigest(label, result, max)
  const raw = result.stdout.trim() === '' ? '(empty output)' : result.stdout.trim()
  const digest = digestOf(raw, max)
  return { content: digest.content, truncated: digest.truncated, data: {} }
}

/** Standard link returned by doc/sheet write tools. */
export function docLink(id: string): string {
  return `https://www.yunzhijia.com/knowledge/lingee/#/store/doc/${id}`
}

/** One line of a generic id/title record pair. */
export function idTitle(record: UnknownRecord): string {
  const id = asString(record.id)
  const title = asString(record.title)
  return title === '' ? id : `${title}${id === '' ? '' : ` (${id})`}`
}

/**
 * The shared tool `output` contract for the whole yzj family: the model sees
 * only `content` (rendered), the session log persists it, and the UI reads
 * the capped `data` payload through `presentationMeta` — which is never
 * model-visible.
 */
export const yzjToolOutput: {
  readonly schema: {
    readonly type: 'object'
    readonly additionalProperties: false
    readonly properties: {
      readonly content: { readonly type: 'string'; readonly required: true }
      readonly truncated: { readonly type: 'boolean'; readonly required: true }
      readonly data: { readonly type: 'json' }
    }
  }
  render(_args: unknown, value: YzjToolValue): { type: 'text'; text: string }[]
  presentationMeta(_args: unknown, value: YzjToolValue): JsonValue
} = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: { type: 'string', required: true },
      truncated: { type: 'boolean', required: true },
      data: { type: 'json' },
    },
  },
  render: (_args, value) => [{ type: 'text', text: value.content }],
  presentationMeta: (_args, value) => value.data,
}
