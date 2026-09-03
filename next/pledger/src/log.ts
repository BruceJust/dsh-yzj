/**
 * 第二存储域落盘：`<root>/<operatorOpenId>/pledger.jsonl` + 原子写的快照。
 * 归属键 = 人（不是实例）；目录自包含（拷走即取走全账）；destroy 是唯一删除路径。
 */

import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GraphEvent, GraphObject } from '@yzj-next/graph'
import { PLEDGER_ENVELOPE_VERSION, PLEDGER_FOLD_VERSION } from './types.ts'

/** What one operator's private ledger holds on disk after a load. */
export interface LoadedPledger {
  readonly events: GraphEvent[]
  readonly snapshot?: { readonly upToSeq: number; readonly objects: Record<string, GraphObject> }
  /** Lines that failed to decode; surfaced so a corrupt ledger is never silent. */
  readonly damagedLines: number
}

interface SnapshotFile {
  v: number
  fv?: number
  upToSeq: number
  objects: Record<string, GraphObject>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Decode one pledger log line, or undefined when it is not a well-formed envelope. */
export function decodePledgerEvent(line: string): GraphEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const { v, sv, seq, time, type, data, actor } = parsed
  if (v !== PLEDGER_ENVELOPE_VERSION) return undefined
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return undefined
  if (typeof time !== 'number' || typeof type !== 'string' || type === '') return undefined
  if (!isRecord(actor) || typeof actor.kind !== 'string') return undefined
  return {
    v: PLEDGER_ENVELOPE_VERSION,
    sv: typeof sv === 'number' ? sv : 1,
    seq,
    time,
    type,
    data: data as GraphEvent['data'],
    actor: actor as unknown as GraphEvent['actor'],
  }
}

/** One operator's private-ledger directory. */
export class PledgerLog {
  private readonly logPath: string
  private readonly snapshotPath: string

  constructor(private readonly dir: string) {
    this.logPath = join(dir, 'pledger.jsonl')
    this.snapshotPath = join(dir, 'snapshot.json')
  }

  /** Where this ledger lives. The one thing 「本人可取走」 needs to be actionable. */
  get directory(): string {
    return this.dir
  }

  async load(): Promise<LoadedPledger> {
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
      const event = decodePledgerEvent(line)
      if (event === undefined) damagedLines += 1
      else events.push(event)
    }
    events.sort((left, right) => left.seq - right.seq)
    return { events, damagedLines, ...(snapshot === undefined ? {} : { snapshot }) }
  }

  private async readSnapshot(): Promise<LoadedPledger['snapshot']> {
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
    // A cache that cannot say which fold produced it is worse than no cache.
    if (file.fv !== PLEDGER_FOLD_VERSION) return undefined
    return { upToSeq: file.upToSeq, objects: file.objects as Record<string, GraphObject> }
  }

  async append(event: GraphEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await appendFile(this.logPath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  async writeSnapshot(upToSeq: number, objects: Record<string, GraphObject>): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const body: SnapshotFile = { v: 1, fv: PLEDGER_FOLD_VERSION, upToSeq, objects }
    const temporary = `${this.snapshotPath}.${String(process.pid)}.tmp`
    await writeFile(temporary, `${JSON.stringify(body)}\n`, 'utf8')
    await rename(temporary, this.snapshotPath)
  }

  /** 销毁 —— the ONLY deletion path in this ledger (§2, v1.1). Not a tombstone, not a soft flag: the directory goes.  */
  async destroy(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true })
  }
}
