/**
 * Turning two streams and a pile of graph objects into one readable column.
 *
 * The rule that shapes everything here: **a topic is one conversation.** What
 * people said, what the agent did, and what the agent is asking are the same
 * story in three idioms, so they share one time axis and one column. The only
 * grouping that survives is the one that helps a reader — consecutive agent
 * machinery collapses into a single work block, because "ran 6 tools" is one
 * event to a human and six to a log.
 *
 * Every row also carries the ONE fact this screen exists to make unmissable:
 * **who could hear it.** 公 means it is in the room; 私 means it is between the
 * operator and the agent. That is not decoration — it is the difference
 * between a thought and a statement to your colleagues, and a product that
 * renders both in the same grey bubble has quietly made them the same thing.
 */

import type { StreamArtifactWire, StreamCard, TopicMessageWire } from './rpc.ts'

/**
 * One node of the host's conversation snapshot.
 *
 * Deliberately typed against what the runtime actually emits — `user`,
 * `assistant`, `steering`, `context`, `tool-result`, `model-retry`, `command`,
 * `turn-error` — rather than against names that sound right. An earlier
 * version of this file guessed (`user-message`, `assistant-message`), matched
 * nothing, and produced a column that rendered work blocks and cards but not
 * one word anybody had said.
 */
export interface TrajectoryNode {
  readonly kind?: string
  readonly seq?: number
  readonly time?: number
  /** `user` / `steering` / `context`: the message body. */
  readonly content?: unknown
  /** `user` / `steering` / `context`: how the message got in. */
  readonly source?: unknown
  /** `assistant`: text, reasoning and tool-call blocks of one step. */
  readonly blocks?: readonly unknown[]
  /** `tool-result`: the call it answers. */
  readonly call?: unknown
  /** `tool-result`: when the call went out, so a step can report its duration. */
  readonly callTime?: number | null
  /** `tool-result`: the tool's own render intent for the call and for the result. */
  readonly callView?: unknown
  readonly resultView?: unknown
  readonly isError?: boolean
  /** `command`: the slash command's name. */
  readonly name?: string
  readonly [key: string]: unknown
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The text of a `content` block array. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => asText(asRecord(block)?.text))
    .filter(text => text !== '')
    .join('\n')
}

/** The text an assistant step actually SAID, excluding its reasoning. */
function assistantText(blocks: readonly unknown[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .map(asRecord)
    .filter(block => block?.kind === 'text')
    .map(block => asText(block?.text))
    .join('')
    .trim()
}

/**
 * The operator's actual words, with the turn preamble stripped.
 *
 * The prompt handed to the model carries the place, the topic, the recent
 * messages and only then the utterance. Showing that block back to the person
 * who typed one sentence is showing them our plumbing.
 */
function utteranceOf(text: string): string {
  for (const marker of ['[用户任务]', '[轻问]']) {
    const at = text.lastIndexOf(marker)
    if (at >= 0) return text.slice(at + marker.length).trim()
  }
  return text.trim()
}

/** Who could hear this row. */
export type Audibility = 'public' | 'private'

/** One step inside a work block. */
export interface WorkStep {
  readonly tool: string
  readonly detail: string
  readonly state: 'done' | 'running' | 'failed'
  /** Memory steps read differently from tool calls, so they are marked. */
  readonly memory: boolean
  /** How long the call took, when both ends are in the window. */
  readonly ms?: number
  /** When a still-running call went out — what its live clock counts from. */
  readonly since?: number
}

/**
 * The parts of the live snapshot that are not nodes yet.
 *
 * The host keeps three separate facts about a turn in flight: the tool calls
 * that have gone out and not come back (`runningCalls`), the assistant output
 * being streamed (`partial`), and whether the turn is open at all (`running`).
 * None of them is in `nodes` — nodes are the FINALIZED log. Rendering only
 * nodes therefore means the column sits perfectly still for the whole run and
 * then snaps to a finished block, which is precisely why a reader could not
 * tell working from done.
 */
export interface LiveWork {
  /** Tool calls the host has seen go out with no result yet. */
  readonly calls?: readonly {
    readonly callId?: string
    readonly name?: string
    readonly argsRaw?: string
    readonly time?: number
    /** The tool's own render intent for this pending call. */
    readonly callView?: unknown
  }[]
  /** Assistant output mid-stream. */
  readonly partial?: { readonly blocks?: readonly unknown[] } | null
  /** The turn is open. True with no partial and no calls = waiting for the model. */
  readonly running?: boolean
}

export type StreamRow =
  | { readonly kind: 'divider'; readonly key: string; readonly time: number; readonly label: string }
  | {
    readonly kind: 'message'
    readonly key: string
    readonly time: number
    readonly who: string
    readonly text: string
    readonly mine: boolean
    readonly voice: Audibility
    readonly quote?: string
    /** The message the quote points at, so it can be followed. */
    readonly quoteId?: string
    /** Attachments, already resolved to fetchable URLs by the channel. */
    readonly images?: TopicMessageWire['images']
    readonly file?: TopicMessageWire['file']
  }
  | {
    readonly kind: 'said'
    readonly key: string
    readonly time: number
    readonly speaker: 'operator' | 'agent' | 'steering' | 'ask' | 'askAnswer'
    readonly voice: Audibility
    readonly text: string
  }
  | {
    readonly kind: 'work'
    readonly key: string
    readonly time: number
    readonly voice: Audibility
    readonly steps: readonly WorkStep[]
    /**
     * The block's own state, so the head can be read without opening it.
     * A block is 进行中 while any step is still out, 有失败 when a step came
     * back an error, 已完成 otherwise.
     */
    readonly state: 'running' | 'failed' | 'done'
    /** First call out to last result in, for a settled block. */
    readonly ms: number
  }
  /**
   * The turn, while it is still happening.
   *
   * Not a node — nodes are finalized — which is exactly why it has its own
   * row: without it the column has no way to say "still going", and a reader
   * cannot distinguish an agent that is thinking from one that has stopped.
   */
  | {
    readonly kind: 'live'
    readonly key: 'live'
    readonly time: number
    readonly mode: 'text' | 'thinking' | 'waiting'
    readonly text: string
  }
  /** A slash command and other machinery a reader should see but not read. */
  | { readonly kind: 'sysline'; readonly key: string; readonly time: number; readonly text: string }
  | { readonly kind: 'card'; readonly key: string; readonly time: number; readonly card: StreamCard }
  | {
    readonly kind: 'artifact'
    readonly key: string
    readonly time: number
    readonly artifact: StreamArtifactWire
  }

const DAY = 24 * 60 * 60 * 1_000

export function dayLabel(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return ''
  const when = new Date(time)
  const today = new Date()
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (time >= midnight) return '今天'
  if (time >= midnight - DAY) return '昨天'
  return `${String(when.getMonth() + 1)}月${String(when.getDate())}日`
}

/** Consulting what it knows, rather than acting on the world. */
function isMemoryTool(tool: string): boolean {
  return tool.startsWith('memory_') || tool === 'graph_query'
}

/**
 * What one call DID, in the words of whoever actually knows: the tool.
 *
 * `dsh-tools` has a contract for exactly this question — a tool declares
 * `presentCall` / `presentResult`, and the host hangs the resulting render
 * intent on the call and result frames. Reading it is the difference between a
 * step that says 「把补丁定稿并跑一遍校验」 and one that dumps
 * `{"command":"…","timeoutMs":15000}` into the middle of the conversation.
 *
 * Deriving a label from `argsRaw` here instead would be this column guessing
 * about packages it does not own — the same class of mistake as inventing node
 * kinds. Where a tool declares nothing, the step says its NAME and nothing
 * else, and the arguments stay where the design puts them: 完整轨迹.
 */
function labelOf(callView: unknown, resultView: unknown): string {
  const call = asRecord(callView)
  // A terminal card's title IS the command; the sentence is its `description`.
  if (call?.card === 'terminal') {
    const said = asText(call.description).trim()
    if (said !== '') return said
  }
  // The completed card's replacement title, when the tool wrote one, is the
  // more accurate label — it knows how the call turned out.
  const done = asText(asRecord(resultView)?.title).trim()
  if (done !== '') return done
  return asText(call?.title).trim()
}

/** One folded step, read off whichever node kind produced it. */
function stepOf(node: TrajectoryNode): WorkStep | undefined {
  if (node.kind === 'tool-result') {
    const call = asRecord(node.call)
    const tool = asText(call?.name) || 'tool'
    const callTime = typeof node.callTime === 'number' ? node.callTime : undefined
    const done = typeof node.time === 'number' ? node.time : undefined
    return {
      tool,
      detail: labelOf(node.callView, node.resultView),
      // A tool that came back an error is not a finished step, and drawing it
      // with the same green ✓ as a successful one is how a failed run reads
      // as a successful one.
      state: node.isError === true ? 'failed' : 'done',
      // Memory and graph reads are the agent consulting what it knows rather
      // than acting on the world; the block marks them apart for that reason.
      memory: isMemoryTool(tool),
      ...(callTime === undefined || done === undefined || done < callTime
        ? {}
        : { ms: done - callTime }),
    }
  }
  if (node.kind === 'model-retry') {
    return { tool: 'model-retry', detail: asText(node.reason), state: 'running', memory: false }
  }
  if (node.kind === 'compaction') {
    return { tool: 'compaction', detail: '上下文已压缩', state: 'done', memory: true }
  }
  // A context injection that is not our own turn preamble is machinery too.
  // Its BODY is a system reminder written for the model — pages of it — so the
  // block names the producer and stops there; the text is in 完整轨迹.
  if (node.kind === 'context') {
    return {
      tool: asText(asRecord(node.provenance)?.name) || 'context',
      detail: '上下文注入',
      state: 'done',
      memory: true,
    }
  }
  return undefined
}

interface Sortable {
  readonly time: number
  readonly seat: number
  readonly row: StreamRow
}

/**
 * Build the column.
 *
 * @param nodes - the session's own conversation nodes (host-owned snapshot).
 * @param messages - this topic's Yunzhijia messages.
 * @param cards - answerable objects belonging to this topic.
 * @param artifacts - what this topic produced.
 * @param inPlace - true when this session is a window onto a real place, which
 *   is what makes the agent's answers PUBLIC. A local session has no room for
 *   anything to be public in, and marking its rows 公 would be a lie about who
 *   is listening.
 * @param live - the turn in flight (see {@link LiveWork}).
 * @returns rows in ascending time, with day dividers inserted.
 */
export function buildStream(
  nodes: readonly TrajectoryNode[],
  messages: readonly TopicMessageWire[],
  cards: readonly StreamCard[],
  artifacts: readonly StreamArtifactWire[] = [],
  inPlace = true,
  live: LiveWork = {},
): StreamRow[] {
  const items: Sortable[] = []
  let seat = 0
  const at = (time: unknown): number => (
    typeof time === 'number' && Number.isFinite(time) ? time : 0
  )
  /*
    「已发到群里」是一个断言，不该靠猜。

    过去每一条 agent 文本只要所在会话是个云之家话题，就被标成 public，脚注写
    「已发到 X · 群内所有人可见」。现场反证：群里的任务被一次 502 判死，操作者
    在私语里说「继续完成」，agent 把活干完、答案写得很好——**一个字都没发出去**，
    而这一列言之凿凿地说它发了。

    所以改成看证据：agent 的回复是以操作者账号投进群的，于是它会以一条 own
    消息回到同一个窗口里（投递文本以答案正文开头）。窗口里找得到开头，就是发过；
    窗口覆盖得到、却找不到，就是没发过。

    窗口之外的历史我们确实不知道——那一段维持旧的假定，并且不提供「发到群里」，
    免得把一条早就发过的答案再发一遍。谎话被限制在看不见的那一段，而当下这一段
    是准的。
  */
  const spokenHere = new Set<string>()
  let earliestMessage = Number.POSITIVE_INFINITY
  for (const message of messages) {
    const when = at(message.time)
    if (when > 0 && when < earliestMessage) earliestMessage = when
    if (message.own !== true) continue
    const opening = openingOf(message.content)
    if (opening !== '') spokenHere.add(opening)
  }
  const audibilityOf = (text: string, when: number): Audibility => {
    if (!inPlace) return 'private'
    // Older than anything we can see: keep the historical assumption.
    if (!Number.isFinite(earliestMessage) || when < earliestMessage) return 'public'
    return spokenHere.has(openingOf(text)) ? 'public' : 'private'
  }

  // Consecutive machinery folds into one block; anything a person said or the
  // agent answered breaks it.
  let pending: WorkStep[] = []
  let pendingTime = 0
  /** Earliest call-out and latest result-in of the block being folded. */
  let blockStart = 0
  let blockEnd = 0
  const fold = (step: WorkStep, time: number): void => {
    if (pending.length === 0) {
      pendingTime = time
      blockStart = step.since ?? (step.ms === undefined ? time : time - step.ms)
      blockEnd = time
    } else {
      blockEnd = Math.max(blockEnd, time)
    }
    pending.push(step)
  }
  const flush = (): void => {
    if (pending.length === 0) return
    const steps = pending
    const state = steps.some(step => step.state === 'running')
      ? 'running'
      : steps.some(step => step.state === 'failed') ? 'failed' : 'done'
    items.push({
      time: pendingTime,
      seat: seat++,
      row: {
        kind: 'work',
        key: `w:${String(pendingTime)}:${String(steps.length)}`,
        time: pendingTime,
        // Work is always private: the room sees the answer, never the six
        // tool calls it took to get there.
        voice: 'private',
        steps,
        state,
        ms: state === 'running' || blockEnd <= blockStart ? 0 : blockEnd - blockStart,
      },
    })
    pending = []
  }

  /**
   * Message ids the IM read already produced. A turn admitted from a group
   * exists twice — once as the Yunzhijia message and once as the session's own
   * user node — and rendering both turns one utterance into two. The id is
   * what makes them the same utterance; when the IM read lagged or failed, the
   * id is absent and the session node renders instead of nothing.
   */
  const shown = new Set(messages.map(message => message.msgId))
  /** Seq of the newest 轻问, so its answer can be marked as one too. */
  let askedAt: number | undefined

  for (const [index, node] of nodes.entries()) {
    const kind = node.kind ?? ''
    const time = at(node.time)
    const key = `s:${String(node.seq ?? index)}:${kind}`
    const source = asRecord(node.source)
    const fromYunzhijia = source?.kind === 'yzj-next'
    const readOnly = source?.writeMode === 'read-only'

    // The turn preamble we injected is a message node, not machinery — but
    // only for OUR turns; anything else claiming to be context is machinery.
    const spoken = kind === 'user' || kind === 'steering'
      || (kind === 'context' && fromYunzhijia)

    if (!spoken) {
      const step = stepOf(node)
      if (step !== undefined) {
        fold(step, time)
        continue
      }
      flush()
      if (kind === 'command') {
        items.push({
          time,
          seat: seat++,
          row: { kind: 'sysline', key, time, text: `/${node.name ?? ''}` },
        })
        continue
      }
      if (kind === 'turn-error') {
        items.push({
          time,
          seat: seat++,
          row: { kind: 'sysline', key, time, text: `本回合失败：${asText(node.message) || '未知错误'}` },
        })
        continue
      }
      if (kind !== 'assistant') continue
      const text = assistantText(node.blocks)
      // A step that only called tools said nothing; its calls are already the
      // work block's steps.
      if (text === '') continue
      // The ANSWER to a projection is a projection too: it never went to the
      // group, and drawing it in the same public blue as a delivered reply
      // would say it did.
      const answersAnAsk = askedAt !== undefined && (node.seq ?? 0) > askedAt
      items.push({
        time,
        seat: seat++,
        row: answersAnAsk
          ? { kind: 'said', key, time, speaker: 'askAnswer', voice: 'private', text }
          // What the agent says IS the reply that went to the group.
          : { kind: 'said', key, time, speaker: 'agent', voice: audibilityOf(text, time), text },
      })
      continue
    }

    flush()
    blockStart = 0
    blockEnd = 0
    const messageId = asText(source?.messageId)
    if (fromYunzhijia && messageId !== '' && shown.has(messageId)) continue
    const text = utteranceOf(contentText(node.content))
    if (text === '') continue
    if (readOnly) askedAt = node.seq ?? 0
    items.push({
      time,
      seat: seat++,
      row: {
        kind: 'said',
        key,
        time,
        speaker: readOnly ? 'ask' : kind === 'steering' ? 'steering' : 'operator',
        // A group utterance was public when it was made; what the operator
        // types at this desk never leaves it.
        voice: fromYunzhijia && messageId !== '' ? 'public' : 'private',
        text,
      },
    })
  }

  /*
   * The tail of a turn in flight.
   *
   * A call that has gone out and not come back belongs to the block being
   * folded right now — it is the same run of machinery, one step of which
   * simply has not answered yet. Folding it in is what makes the block say
   * 进行中 instead of quietly ending one step short of the truth.
   */
  const calls = live.calls ?? []
  for (const call of calls) {
    const started = typeof call.time === 'number' && Number.isFinite(call.time) ? call.time : 0
    const tool = asText(call.name) || 'tool'
    fold({
      tool,
      detail: labelOf(call.callView, undefined),
      state: 'running',
      memory: isMemoryTool(tool),
      since: started,
    }, started)
  }
  flush()

  /*
   * The unfinished answer.
   *
   * Nothing above renders it, because nodes are finalized — so without this
   * row the column stands perfectly still for the whole generation. It is
   * appended after the sort rather than dated into it: it is happening NOW,
   * and giving it a synthetic timestamp would either invent a day divider or
   * make the function depend on the clock.
   */
  const liveRow = live.running !== true || calls.length > 0
    ? undefined
    : liveTail(live.partial?.blocks)

  for (const message of messages) {
    // Our own outbound is already the agent's answer above; showing it again
    // would turn one utterance into two.
    if (message.own) continue
    items.push({
      time: message.time,
      seat: seat++,
      row: {
        kind: 'message',
        key: `m:${message.msgId}`,
        time: message.time,
        who: message.fromName,
        text: message.content,
        mine: false,
        voice: 'public',
        ...(message.replyToSummary === undefined ? {} : { quote: message.replyToSummary }),
        ...(message.replyToId === undefined ? {} : { quoteId: message.replyToId }),
        ...(message.images === undefined ? {} : { images: message.images }),
        ...(message.file === undefined ? {} : { file: message.file }),
      },
    })
  }

  for (const card of cards) {
    // The graph's birth time, not a field the family may or may not keep in
    // its own state: most do not, and reading state sorted every card to
    // epoch zero, piling the topic's cards above the conversation that
    // produced them.
    const time = at(card.at)
    items.push({
      time,
      seat: seat++,
      row: { kind: 'card', key: `c:${card.kind}:${card.id}`, time, card },
    })
  }

  for (const artifact of artifacts) {
    items.push({
      time: artifact.time,
      seat: seat++,
      row: {
        kind: 'artifact',
        key: `a:${artifact.uri}:${String(artifact.time)}`,
        time: artifact.time,
        artifact,
      },
    })
  }

  items.sort((left, right) => (left.time - right.time) || (left.seat - right.seat))

  const out: StreamRow[] = []
  let lastDay = ''
  for (const item of items) {
    if (item.time > 0) {
      const label = dayLabel(item.time)
      if (label !== lastDay) {
        lastDay = label
        out.push({ kind: 'divider', key: `d:${label}`, time: item.time, label })
      }
    }
    out.push(item.row)
  }
  if (liveRow !== undefined) out.push(liveRow)
  return out
}

/** The last line of a long thought — proof of life, not a transcript. */
function tailOf(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  const last = lines.at(-1) ?? ''
  return last.length > 120 ? `…${last.slice(-120)}` : last
}

/** What to show while the model is mid-answer. */
function liveTail(blocks: readonly unknown[] | undefined): StreamRow {
  const text = assistantText(blocks)
  if (text !== '') return { kind: 'live', key: 'live', time: 0, mode: 'text', text }
  const thought = (blocks ?? [])
    .map(asRecord)
    .filter(block => block?.kind === 'reasoning')
    .map(block => asText(block?.text))
    .join('')
    .trim()
  return thought === ''
    // Request out, first token not back. The one state where a still screen
    // is the truth — so it says so rather than showing nothing.
    ? { kind: 'live', key: 'live', time: 0, mode: 'waiting', text: '' }
    : { kind: 'live', key: 'live', time: 0, mode: 'thinking', text: tailOf(thought) }
}

/** `HH:mm`, or empty when the row carries no usable time. */
export function clockOf(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return ''
  const when = new Date(time)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(when.getHours())}:${pad(when.getMinutes())}`
}

/**
 * A duration a person reads at a glance.
 *
 * Sub-second work is reported in milliseconds because "0.3秒" reads as a
 * rounding artifact; anything longer is reported in the unit somebody would
 * actually say out loud.
 */
export function durationOf(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 1_000) return `${String(Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}秒`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return seconds === 0 ? `${String(minutes)}分` : `${String(minutes)}分${String(seconds)}秒`
}

/** Deterministic avatar colour, so the same person is the same colour. */
export function avatarOf(name: string): { text: string; color: string } {
  const palette = ['#2E63D9', '#6D4FA3', '#B45309', '#15803D', '#0E7490', '#B91C1C', '#4B5563']
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 100_000
  return {
    text: name.trim().slice(0, 1).toUpperCase() || '·',
    color: palette[hash % palette.length] ?? '#4B5563',
  }
}

/**
 * Whether a message's TEXT is just the attachment's own placeholder.
 *
 * Yunzhijia sends a file as `content: "[文件]:r29-summary.md"` plus a `param`
 * carrying the real name — so drawing both put the filename on screen twice,
 * once as a bare line of text and once on the card. The placeholder is the
 * platform's way of describing an attachment to clients that cannot render
 * one; we can, so it is not a caption, it is a duplicate.
 *
 * Matched against the ACTUAL name rather than by pattern: a person who happens
 * to write 「[文件]:计划」 in a sentence is saying something, and this must not
 * eat it.
 */
export function isPlaceholderOnly(content: string, name: string | undefined): boolean {
  const text = content.trim()
  if (text === '') return true
  if (text === '[图片]') return true
  if (name === undefined) return false
  return text === `[文件]:${name}` || text === `[文件]：${name}` || text === name
}

/**
 * The opening of an utterance, normalised for matching.
 *
 * A delivered reply is the answer's body plus a summary and the acceptance
 * line, so the OPENING is what the two copies share. Long enough not to collide
 * across different answers, short enough to survive the clip the delivery
 * applies to very long ones.
 */
export function openingOf(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length < 8 ? flat : flat.slice(0, 40)
}
