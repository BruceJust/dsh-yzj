/**
 * Append-only JSONL storage for one account partition, plus its atomically
 * written materialization snapshot. Single process, single writer (§4): the
 * service serializes every append through one promise chain, and the snapshot
 * is only ever an optimization — the log alone is authoritative.
 */

import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GRAPH_ENVELOPE_VERSION, type GraphEvent, type GraphObject } from './types.ts'

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
  const { v, sv, seq, time, type, data, actor } = parsed
  if (v !== GRAPH_ENVELOPE_VERSION) return undefined
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return undefined
  if (typeof time !== 'number' || typeof type !== 'string' || type === '') return undefined
  if (!isRecord(actor) || typeof actor.kind !== 'string') return undefined
  return {
    v: GRAPH_ENVELOPE_VERSION,
    sv: typeof sv === 'number' ? sv : 1,
    seq,
    time,
    type,
    data: data as GraphEvent['data'],
    actor: actor as unknown as GraphEvent['actor'],
  }
}

/** One account partition's files. */
export class GraphLog {
  private readonly logPath: string
  private readonly snapshotPath: string

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
    const events: GraphEvent[] = []
    let damagedLines = 0
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      const event = decodeEvent(line)
      if (event === undefined) damagedLines += 1
      else events.push(event)
    }
    events.sort((left, right) => left.seq - right.seq)
    return { events, damagedLines, ...(snapshot === undefined ? {} : { snapshot }) }
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
    return { upToSeq: file.upToSeq, objects: file.objects as Record<string, GraphObject> }
  }

  /** Append one already-sequenced event. */
  async append(event: GraphEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await appendFile(this.logPath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  /** Replace the snapshot atomically (temp file + rename). */
  async writeSnapshot(upToSeq: number, objects: Record<string, GraphObject>): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const body: SnapshotFile = { v: 1, upToSeq, objects }
    const temporary = `${this.snapshotPath}.${String(process.pid)}.tmp`
    await writeFile(temporary, `${JSON.stringify(body)}\n`, 'utf8')
    await rename(temporary, this.snapshotPath)
  }
}
