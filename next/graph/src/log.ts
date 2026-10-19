/**
 * Append-only JSONL storage for one account partition, plus its atomically
 * written materialization snapshot. Single process, single writer (§4): the
 * service serializes every append through one promise chain, and the snapshot
 * is only ever an optimization — the log alone is authoritative.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GRAPH_FOLD_VERSION, type GraphEvent, type GraphObject } from './types.ts'

/** What one partition holds on disk after a load. */
export interface LoadedLog {
  readonly events: GraphEvent[]
  /** Objects folded up to `upToSeq`, when a usable snapshot existed. */
  readonly snapshot?: { readonly upToSeq: number; readonly objects: Record<string, GraphObject> }
  /** Lines that failed to decode; surfaced so a corrupt log is never silent. */
  readonly damagedLines: number
}

interface SnapshotFile {
  v: number
  /** 算出这份缓存的那一版折叠逻辑。对不上就当它不存在。 */
  fv?: number
  upToSeq: number
  objects: Record<string, GraphObject>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Decode one log line, or undefined when it is not a well-formed envelope. */
export function decodeEvent(line: string): GraphEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const { v, sv, seq, time, type, data, actor, prev, hash } = parsed
  /*
    **读兼容 v1，并保留行里原来的 `v`**（§13.1-3）。只把常量改成 2，所有 v1 行都会被拒，
    整份旧日志等于消失；把 v1 读成 v2，又等于替一段从没成过链的历史作证。
  */
  if (v !== 1 && v !== 2) return undefined
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return undefined
  if (typeof time !== 'number' || typeof type !== 'string' || type === '') return undefined
  if (!isRecord(actor) || typeof actor.kind !== 'string') return undefined
  // v2 是成链的那一段：缺 prev / hash 就不是一行完整的证据。值对不对是链校验的事，不在这里。
  if (v === 2 && (typeof sv !== 'number' || typeof prev !== 'string' || typeof hash !== 'string')) return undefined
  return {
    v,
    sv: typeof sv === 'number' ? sv : 1,
    seq,
    time,
    type,
    data: data as GraphEvent['data'],
    actor: actor as unknown as GraphEvent['actor'],
    ...(v === 2 ? { prev: prev as string, hash: hash as string } : {}),
  }
}

/**
 * 一份日志的原始文本 → 按 seq 升序的事件与损坏行数。分区加载与离线审计共用这一个函数：
 * 「同一份文件」在两处必须读出同一串行，链的答案才可能相同。
 */
export function parseLog(raw: string): { events: GraphEvent[]; damagedLines: number } {
  const events: GraphEvent[] = []
  let damagedLines = 0
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const event = decodeEvent(line)
    if (event === undefined) damagedLines += 1
    else events.push(event)
  }
  events.sort((left, right) => left.seq - right.seq)
  return { events, damagedLines }
}

/** One account partition's files. */
export class GraphLog {
  private readonly logPath: string
  private readonly snapshotPath: string
  /**
   * 文件尾可能停在半行上：上次崩在写一半，或者上一次追加报了错、不知道写进去多少。
   * 这时直接追加，新行会和那半行粘成一行损坏行——一行已落盘的 `action/released` 就此
   * 在重载时消失，而它放出去的写已经发生了。所以先补一个换行；多出来的空行加载时跳过。
   */
  private unterminated = false

  constructor(private readonly dir: string) {
    this.logPath = join(dir, 'graph.jsonl')
    this.snapshotPath = join(dir, 'snapshot.json')
  }

  /** Read the snapshot (best effort) and every log line. */
  async load(): Promise<LoadedLog> {
    await mkdir(this.dir, { recursive: true })
    const snapshot = await this.readSnapshot()
    let raw: string
    try {
      raw = await readFile(this.logPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { events: [], damagedLines: 0, ...(snapshot === undefined ? {} : { snapshot }) }
    }
    this.unterminated = raw !== '' && !raw.endsWith('\n')
    return { ...parseLog(raw), ...(snapshot === undefined ? {} : { snapshot }) }
  }

  private async readSnapshot(): Promise<LoadedLog['snapshot']> {
    let raw: string
    try {
      raw = await readFile(this.snapshotPath, 'utf8')
    } catch {
      return undefined
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
    if (!isRecord(parsed)) return undefined
    const file = parsed as Partial<SnapshotFile>
    if (file.v !== 1 || typeof file.upToSeq !== 'number' || !isRecord(file.objects)) return undefined
    /*
      **折叠版本对不上就当没有快照**（`GRAPH_FOLD_VERSION`）。

      没有 `fv` 的那些是这条规矩之前写下的，同样作废——它们正是问题最大的一批：谁也
      说不清它们是哪一版 reduce 折出来的。丢掉一份缓存的代价是一次全量重放；留着一份
      说谎的缓存，代价是账本从此和它自己的日志不一致，而且不报错。
    */
    if (file.fv !== GRAPH_FOLD_VERSION) return undefined
    return { upToSeq: file.upToSeq, objects: file.objects as Record<string, GraphObject> }
  }

  /** Append one already-sequenced event. */
  async append(event: GraphEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const line = `${this.unterminated ? '\n' : ''}${JSON.stringify(event)}\n`
    this.unterminated = true
    await appendFile(this.logPath, line, 'utf8')
    this.unterminated = false
  }

  /** 此刻整个日志文件原始字节的 sha256；文件不存在就是空串的 sha256。 */
  async digest(): Promise<string> {
    let bytes: Buffer
    try {
      bytes = await readFile(this.logPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      bytes = Buffer.alloc(0)
    }
    return createHash('sha256').update(bytes).digest('hex')
  }

  /** Replace the snapshot atomically (temp file + rename). */
  async writeSnapshot(upToSeq: number, objects: Record<string, GraphObject>): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const body: SnapshotFile = { v: 1, fv: GRAPH_FOLD_VERSION, upToSeq, objects }
    const temporary = `${this.snapshotPath}.${String(process.pid)}.tmp`
    await writeFile(temporary, `${JSON.stringify(body)}\n`, 'utf8')
    await rename(temporary, this.snapshotPath)
  }
}
