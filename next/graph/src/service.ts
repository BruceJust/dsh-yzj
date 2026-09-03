/**
 * `ctx.yzjGraph` — the service face of the conversation-graph kernel.
 *
 * Writes are serialized through one promise chain (single process, single
 * writer) and are durable BEFORE the in-memory fold and the `yzj-graph/appended`
 * notification: a subscriber must never see an object state that a crash could
 * take back. Reads always take a viewer, which the orchestrator binds per turn
 * — there is deliberately no viewer-less public query.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { GraphLog } from './log.ts'
import { GraphStore } from './store.ts'
import { KERNEL_FAMILIES } from './vocabulary.ts'
import {
  GRAPH_ENVELOPE_VERSION,
  type GraphAppendInput, type GraphEvent, type GraphEventQuery, type GraphFamily,
  type GraphObject, type GraphQuery, type GraphReadHook, type GraphViewer,
  type JsonValue, type PlaceContract, type TopicHandle,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjGraph: YzjGraph
  }
  interface Events {
    /**
     * One event was appended and folded. Desktop cards re-render from this —
     * a graph event IS the update mechanism, so a live card needs no extra
     * machinery (§3.2).
     */
    'yzj-graph/appended'(event: GraphEvent): void
  }
}

/** How many appends may pass before the snapshot is refreshed. */
const SNAPSHOT_EVERY = 200

export interface GraphServiceConfig {
  /** Partition root; each account key gets a directory beneath it. */
  readonly root: string
  /** Select this account immediately instead of waiting for `selectAccount`. */
  readonly accountKey?: string
}

export class YzjGraph extends Service {
  private readonly store = new GraphStore()
  private log: GraphLog | undefined
  private accountKey: string | undefined
  private writes: Promise<unknown> = Promise.resolve()
  private nextSeq = 1
  private appendsSinceSnapshot = 0
  private readyResolve: (() => void) | undefined
  private readonly readyPromise: Promise<void>
  private loading: Promise<void> | undefined

  constructor(ctx: Context, private readonly config: GraphServiceConfig) {
    super(ctx, 'yzjGraph')
    this.readyPromise = new Promise<void>((resolve) => { this.readyResolve = resolve })
    for (const family of KERNEL_FAMILIES) this.store.register(family)
  }

  /** Drain in-flight writes and refresh the snapshot. Called on plugin dispose. */
  async flush(): Promise<void> {
    await this.writes.catch(() => undefined)
    if (this.log !== undefined && this.appendsSinceSnapshot > 0) {
      await this.log.writeSnapshot(this.store.foldedSeq, this.store.snapshotObjects())
      this.appendsSinceSnapshot = 0
    }
  }

  /**
   * Open one account partition. Switching accounts after events have been
   * written is the account-switch circuit breaker: the operator identity is
   * part of the log's meaning, so silently continuing under a new identity is
   * worse than stopping.
   */
  async selectAccount(accountKey: string): Promise<void> {
    if (this.accountKey === accountKey) {
      await this.loading
      return
    }
    if (this.accountKey !== undefined) {
      throw new Error('Yunzhijia graph account changed while the kernel was running')
    }
    this.accountKey = accountKey
    const log = new GraphLog(join(this.config.root, accountKey))
    this.loading = (async () => {
      const loaded = await log.load()
      if (loaded.damagedLines > 0) {
        console.error(`[yzj-next-graph] ${String(loaded.damagedLines)} unreadable log line(s) in ${accountKey}`)
      }
      this.store.hydrate(loaded.events, loaded.snapshot)
      this.nextSeq = this.store.lastSeq + 1
      this.log = log
      this.readyResolve?.()
    })()
    await this.loading
  }

  /** Resolves once a partition is open. Consumers await this before writing. */
  async ready(timeoutMs = 15_000): Promise<void> {
    if (this.log !== undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.readyPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Yunzhijia graph has no account partition selected')),
            timeoutMs,
          )
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** Register one object family's event vocabulary. */
  defineFamily(family: GraphFamily): () => void {
    return this.store.register(family)
  }

  /** Add a read-domain filter to every viewer-scoped read. */
  onRead(hook: GraphReadHook): () => void {
    return this.store.onRead(hook)
  }

  /**
   * Append one event. Rejects an unregistered type outright — "宁缺勿脏"
   * binds the write side, while the read side stays lenient.
   */
  async append<D extends JsonValue>(input: GraphAppendInput<D>): Promise<GraphEvent> {
    const family = this.store.familyForType(input.type)
    if (family === undefined) {
      throw new Error(`unknown graph event type "${input.type}"`)
    }
    const spec = family.events[input.type]
    if (spec === undefined) {
      throw new Error(`graph family "${family.kind}" does not declare "${input.type}"`)
    }
    const data = spec.schema.parse(input.data) as JsonValue
    const enqueued = this.writes.catch(() => undefined).then(async () => {
      const log = this.log
      if (log === undefined) throw new Error('Yunzhijia graph has no account partition selected')
      const event: GraphEvent = {
        v: GRAPH_ENVELOPE_VERSION,
        sv: spec.sv ?? 1,
        seq: this.nextSeq,
        time: Date.now(),
        type: input.type,
        data,
        actor: input.actor,
      }
      this.nextSeq += 1
      await log.append(event)
      this.store.apply(event)
      this.appendsSinceSnapshot += 1
      if (this.appendsSinceSnapshot >= SNAPSHOT_EVERY) {
        this.appendsSinceSnapshot = 0
        await log.writeSnapshot(this.store.foldedSeq, this.store.snapshotObjects())
      }
      this.ctx.emit('yzj-graph/appended', event)
      return event
    })
    this.writes = enqueued
    return enqueued
  }

  /** Viewer-scoped object query. */
  query(viewer: GraphViewer, query: GraphQuery = {}): readonly GraphObject[] {
    return this.store.query(viewer, query)
  }

  /** Viewer-scoped single object read. */
  object(viewer: GraphViewer, kind: string, id: string): GraphObject | undefined {
    return this.store.object(viewer, kind, id)
  }

  /**
   * Unfiltered read for state machines acting ON an object (an action bus does
   * not "view" the object, it transitions it). Never route a model-facing
   * query through this.
   */
  rawObject(kind: string, id: string): GraphObject | undefined {
    return this.store.rawObject(kind, id)
  }

  /** The object already opened under this anchor (幂等锚律). */
  findByIdemKey(idemKey: string): GraphObject | undefined {
    return this.store.findByIdemKey(idemKey)
  }

  /** Viewer-scoped edge/event read (lineage, crossing, audit). */
  events(viewer: GraphViewer, query: GraphEventQuery = {}): readonly GraphEvent[] {
    return this.store.eventsMatching(viewer, query)
  }

  /** Unfiltered event scan for kernel-internal derivations. */
  rawEvents(types: readonly string[]): readonly GraphEvent[] {
    return this.store.rawEvents(types)
  }

  /** Objects still awaiting an answer — the restart-recovery entry point (§5.5). */
  pendingAnswerables(viewer: GraphViewer): readonly GraphObject[] {
    return this.store.pendingAnswerables(viewer)
  }

  topicHandle(topicKey: string): TopicHandle | undefined {
    return this.store.topicHandle(topicKey)
  }

  /** The contract in force for one place. P1 always resolves the org default. */
  contractFor(placeKey: string): PlaceContract {
    return this.store.contractFor(placeKey)
  }

  /** Live revocation check — deliberately not snapshotted (§5.3). */
  isRevoked(messageId: string): boolean {
    return this.store.isRevoked(messageId)
  }

  /** The reason the revocation gave, when there is one. */
  revocationOf(messageId: string): string | undefined {
    return this.store.revocationOf(messageId)
  }
}
