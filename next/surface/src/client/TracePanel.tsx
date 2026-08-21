/**
 * 完整轨迹 (§7.1 trace-link) — every node of the turn, unfolded.
 *
 * The design says 「轨迹沿用 harness 会话视图，产品只做入口」. Taking the whole
 * `conversation` seat took that view with it, so the entry has to lead
 * somewhere we render. This is that somewhere — and it is still not a second
 * store: it reads the host's own conversation snapshot, the same array the
 * fused column folds.
 *
 * What the column folds, this unfolds. The work block exists because "ran six
 * tools" is ONE event to a reader; the audit question is the opposite one, and
 * it needs every argument, every result, every retry and every context
 * injection in the order they happened. A product that only ever shows the
 * folded version has decided on the reader's behalf that the detail does not
 * exist.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { clockOf, type TrajectoryNode } from './stream.ts'
import tokens from './tokens.module.css'
import css from './contract.module.css'
import trace from './trace.module.css'

export interface TracePanelProps {
  nodes: readonly TrajectoryNode[]
  title: string
  close(): void
}

/** One unfolded row. `detail` is shown only when the row is opened. */
interface TraceRow {
  key: string
  kind: string
  label: string
  time: number
  summary: string
  detail: string
  tone: 'said' | 'tool' | 'think' | 'system' | 'error'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => asText(asRecord(block)?.text)).filter(text => text !== '').join('\n')
}

/** Flatten the snapshot into audit rows, one per thing that happened. */
export function traceRows(nodes: readonly TrajectoryNode[]): TraceRow[] {
  const rows: TraceRow[] = []
  for (const [index, node] of nodes.entries()) {
    const kind = node.kind ?? ''
    const time = typeof node.time === 'number' ? node.time : 0
    const key = `${String(node.seq ?? index)}:${kind}`
    if (kind === 'assistant') {
      // One assistant STEP is several things: what it thought, what it said,
      // and what it decided to call. The audit view keeps them apart.
      for (const [at, raw] of (node.blocks ?? []).entries()) {
        const block = asRecord(raw)
        const blockKind = asText(block?.kind)
        if (blockKind === 'reasoning') {
          rows.push({
            key: `${key}:r${String(at)}`, kind: 'reasoning', label: '思考', time,
            summary: asText(block?.text).replace(/\s+/gu, ' ').slice(0, 120),
            detail: asText(block?.text), tone: 'think',
          })
        } else if (blockKind === 'text') {
          rows.push({
            key: `${key}:t${String(at)}`, kind: 'text', label: '回答', time,
            summary: asText(block?.text).replace(/\s+/gu, ' ').slice(0, 120),
            detail: asText(block?.text), tone: 'said',
          })
        } else if (blockKind === 'tool-call') {
          rows.push({
            key: `${key}:c${String(at)}`, kind: 'tool-call',
            label: `调用 ${asText(block?.name)}`, time,
            summary: asText(block?.argsRaw).replace(/\s+/gu, ' ').slice(0, 120),
            detail: pretty(block?.argsRaw), tone: 'tool',
          })
        }
      }
      continue
    }
    if (kind === 'tool-result') {
      const call = asRecord(node.call)
      const body = contentText(node.content) || pretty(node.content)
      rows.push({
        key, kind, label: `结果 ${asText(call?.name)}`, time,
        summary: body.replace(/\s+/gu, ' ').slice(0, 120),
        detail: body,
        tone: node.isError === true ? 'error' : 'tool',
      })
      continue
    }
    if (kind === 'user' || kind === 'steering' || kind === 'context') {
      const body = contentText(node.content)
      const source = asRecord(node.source)
      rows.push({
        key, kind,
        label: kind === 'steering' ? 'steering' : source?.kind === 'yzj-next' ? '云之家入站' : '输入',
        time,
        summary: body.replace(/\s+/gu, ' ').slice(0, 120),
        // The whole preamble, deliberately: this is where "what was the model
        // actually told" is answered, and the folded column hides it.
        detail: body,
        tone: 'system',
      })
      continue
    }
    if (kind === 'turn-error') {
      rows.push({
        key, kind, label: '回合失败', time,
        summary: asText(node.message), detail: pretty(node), tone: 'error',
      })
      continue
    }
    rows.push({
      key, kind, label: kind === '' ? '节点' : kind, time,
      summary: contentText(node.content).replace(/\s+/gu, ' ').slice(0, 120),
      detail: pretty(node), tone: 'system',
    })
  }
  return rows
}

export function YzjTracePanel(props: TracePanelProps): ReactNode {
  const { nodes, title, close } = props
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [onlyTools, setOnlyTools] = useState(false)
  const rows = useMemo(() => traceRows(nodes), [nodes])
  const shown = onlyTools
    ? rows.filter(row => row.kind === 'tool-call' || row.kind === 'tool-result')
    : rows

  return (
    <div className={`${tokens.tokens} ${css.mask}`} onClick={close}>
      <div
        className={`${css.panel} ${trace.panel}`}
        role="dialog"
        aria-label="完整轨迹"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.head}>
          <span className={css.avatar}>≡</span>
          <span>
            <div className={css.title}>完整轨迹</div>
            <div className={css.sub}>{title} · {rows.length} 个节点，按发生顺序</div>
          </span>
          <button
            type="button"
            className={trace.filter}
            onClick={() => { setOnlyTools(value => !value) }}
          >
            {onlyTools ? '看全部' : '只看工具'}
          </button>
          <button type="button" className={css.close} onClick={close} aria-label="关闭">×</button>
        </div>

        <div className={trace.body}>
          {shown.length === 0 && <div className={trace.calm}>这个会话还没有轨迹。</div>}
          {shown.map((row) => {
            const isOpen = open[row.key] ?? false
            return (
              <div className={trace.row} key={row.key}>
                <button
                  type="button"
                  className={trace.rowHead}
                  onClick={() => { setOpen(value => ({ ...value, [row.key]: !isOpen })) }}
                >
                  <span className={trace.twist}>{isOpen ? '▾' : '▸'}</span>
                  <span className={`${trace.label} ${trace[row.tone] ?? ''}`}>{row.label}</span>
                  <span className={trace.summary}>{row.summary}</span>
                  <span className={trace.clock}>{clockOf(row.time)}</span>
                </button>
                {isOpen && <pre className={trace.detail}>{row.detail}</pre>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
