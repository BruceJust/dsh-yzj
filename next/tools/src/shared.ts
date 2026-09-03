/**
 * Shared plumbing for the yzj tool family: the common output contract, digest
 * builders, CLI payload accessors, and the capped presentation payload.
 *
 * Re-cast from the previous system's proven shape. The one contract worth
 * restating: the model sees ONLY `content`; the UI reads the clipped `data`
 * through `presentationMeta`, which is durable on `tool/result.meta` but never
 * model-visible. Keeping them apart is what lets a card show a full record
 * while the transcript stays small.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { ToolCallKind, ToolCallView } from '@deepseek-ai/dsh-tools/presentation'
import type { YzjRunResult } from '@yzj-next/bridge'
import type {} from '@yzj-next/bridge'

/** Per-invocation budget shared by every tool in the family. */
export interface YzjToolBudget {
  /** Cooperative timeout per bridge invocation in milliseconds. */
  readonly timeoutMs: number
  /** Cap on the model-facing digest in characters. */
  readonly maxRenderChars: number
  /** Cap on the UI presentation payload in characters. */
  readonly maxMetaChars: number
}

/** The common tool result. */
export interface YzjToolValue {
  content: string
  truncated: boolean
  data: JsonValue
}

type UnknownRecord = Record<string, unknown>

function digestOf(text: string, max: number): { content: string; truncated: boolean } {
  if (text.length <= max) return { content: text, truncated: false }
  return { content: text.slice(0, max), truncated: true }
}

/** Heuristic: does this stderr look like an auth failure worth a login hint? */
function looksUnauthenticated(stderr: string): boolean {
  return /(auth|login|登录|token|credential|unauthorized|未授权|10000400|93001)/i.test(stderr)
}

/**
 * CLI 说「这一步要人点头」的退出码 (yzj-cli 0.1.4 exit 3 协议)。
 *
 * **它和 guard 的确认门是同一扇门**，而人真正看得见的是我们这一扇：guard 把不可恢复
 * 的操作列为强确认，操作者在卡上按下「确认」，然后我们才发这条命令——所以命令里带
 * `--yes` 是那次点头的**兑现**，不是绕过它。
 *
 * 反过来说，一旦真的收到 exit 3，含义是**我们这边漏了 `--yes`**，不是「让模型换个
 * 方式再试」。这不是假想：0.1.4 之后一整族删除工具都是这样死的——五个删除工具全在
 * 强确认表里，操作者被问、按了确认，CLI 却因为没有 `--yes` 拒绝执行。**人点的头落在
 * 了空处**，而模型只看到一句「failed」，于是它会去编一个别的办法。
 */
export const CONFIRM_REQUIRED_EXIT = 10

/** A model-facing failure digest from a non-ok bridge invocation. */
export function failureDigest(label: string, result: YzjRunResult, max: number): YzjToolValue {
  /*
    exit 3 单独说 —— 它不是一次失败，是一处漏装。

    混在「failed」里，模型会当成一次可以绕开的错误去另想办法；说成它本来的样子，
    读日志的人当场知道该去补哪一行。
  */
  if (result.exitCode === CONFIRM_REQUIRED_EXIT) {
    const { content, truncated } = digestOf(
      `yzj ${label} 没有执行：这条命令要求显式确认，而调用它的工具没有带上 --yes。`
      + `这不是你能换个方式绕过去的错误，也不该重试——`
      + `不可恢复的操作在本系统里由操作者在确认卡上签字，工具应当在签字之后把 --yes 一起送出。`
      + `请如实报告这一步没有执行。\n${result.stderr.trim()}`,
      max,
    )
    return { content, truncated, data: {} }
  }
  const reason = result.timedOut ? 'timed out' : `exit ${String(result.exitCode ?? 'killed')}`
  const detail = result.stderr.trim() === '' ? '(no stderr)' : result.stderr.trim()
  const hint = looksUnauthenticated(result.stderr)
    ? '\n提示：yzj-cli 可能未登录，请先运行 `yzj-cli auth login` 完成登录。'
    : ''
  const { content, truncated } = digestOf(`yzj ${label} failed (${reason}): ${detail}${hint}`, max)
  return { content, truncated, data: {} }
}

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

/**
 * Deep-clip a CLI payload for UI presentation: long strings truncate, arrays
 * cap, and an over-budget result degrades to a marker rather than blowing the
 * durable event up. Pure and lossy — it never feeds the model.
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
      for (const [key, child] of Object.entries(node as UnknownRecord)) {
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
  if (json !== undefined && json.length > options.maxChars) return { __oversized: true }
  return clipped as Record<string, JsonValue>
}

/** Run one bridge command and shape it into the common tool value. */
export async function runValue(
  ctx: Context,
  budget: YzjToolBudget,
  label: string,
  command: readonly string[],
  format: (json: unknown) => { content: string; data: unknown },
): Promise<YzjToolValue> {
  const result = await ctx.yzjBridge.run(command, { timeoutMs: budget.timeoutMs })
  if (!result.ok) return failureDigest(label, result, budget.maxRenderChars)
  const { content, data } = format(result.json)
  const digest = digestOf(content, budget.maxRenderChars)
  return { content: digest.content, truncated: digest.truncated, data: data as JsonValue }
}

/** Canonical open link for a knowledge-base node. */
export function docLink(id: string): string {
  return `https://www.yunzhijia.com/knowledge/lingee/#/store/doc/${id}`
}

/**
 * 这次调用的人话标题。
 *
 * `dsh-tools` 有一条现成的契约回答「这次调用在干什么」：工具自己声明
 * `presentCall`，宿主把它挂到 tool/call 帧上，UI 直接读。工作台的工作块只显示
 * 这一行——参数、输出、重试留给完整轨迹。
 *
 * 由 UI 从 `argsRaw` 里猜是不行的：知道 `yzj_doc_block_update --id X` 意味着
 * 「改文档《价格页》的正文」的只有工具自己。这个 helper 让每个工具用一行说清楚。
 */
export function titled(title: string, kind: ToolCallKind = 'other'): ToolCallView {
  return { card: 'generic', title, kind }
}

/** 标题里带一个引号名字；名字为空时退回到 id，再空就只留动词。 */
export function named(verb: string, name: string, id = ''): string {
  const what = name.trim() === '' ? id.trim() : name.trim()
  return what === '' ? verb : `${verb}《${what.length > 24 ? `${what.slice(0, 24)}…` : what}》`
}

/**
 * 「N 条」这种量词，0 或数不出来时就不说。
 *
 * 参数有的是真数组、有的是 JSON 字符串（多维表格那几个工具按 CLI 的形状收
 * 字符串），两种都数得出来才不会在一半的工具上退化成没有量词。
 */
export function counted(title: string, count: unknown): string {
  let n: number | undefined
  if (Array.isArray(count)) n = count.length
  else if (typeof count === 'number') n = count
  else if (typeof count === 'string') {
    try {
      const parsed: unknown = JSON.parse(count)
      if (Array.isArray(parsed)) n = parsed.length
    } catch { /* 不是 JSON 就别猜 */ }
  }
  return n === undefined || n <= 0 ? title : `${title} · ${String(n)} 条`
}

/** The shared `output` contract for the whole family. */
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
