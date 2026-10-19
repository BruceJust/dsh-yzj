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
import { GENESIS_PREV, GENESIS_TYPE, eventHash, orphanReleases, verifyChain } from './ledger.ts'
import { GraphLog } from './log.ts'
import { GraphStore } from './store.ts'
import { KERNEL_FAMILIES } from './vocabulary.ts'
import {
  GRAPH_ENVELOPE_VERSION,
  type GraphActor, type GraphAppendInput, type GraphEvent, type GraphEventQuery, type GraphFamily,
  type GraphIntegrity, type GraphObject, type GraphQuery, type GraphReadHook, type GraphViewer,
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
    /**
     * 一个分区打开了：hydrate 与链校验都已完成。启动时要回看日志的东西挂在这里，不挂在
     * `ready()` 上——`ready()` 有 15 秒超时，而分区要等 CLI 拿到身份才会打开。
     * `lastSeqAtOpen` 之后的行都是这个进程写的，回看不该碰它们。
     */
    'yzj-graph/opened'(payload: GraphOpened): void
  }
}

/** 分区打开的那一刻。 */
export interface GraphOpened {
  readonly accountKey: string
  readonly lastSeqAtOpen: number
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
  /** 最后一行 v2 存着的 hash；还没有任何 v2 行时为 undefined——下一次追加先写起点。 */
  private lastHash: string | undefined
  private chain: Omit<GraphIntegrity, 'orphanActions'> = { verifiedThrough: 0 }
  private openedAt: GraphOpened | undefined

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
      // 断链不阻止加载，也不阻止继续写：账照记，断点照报。
      const { lastHash, ...chain } = verifyChain(loaded.events)
      this.lastHash = lastHash
      this.chain = chain
      if (chain.breakAt !== undefined) {
        console.error(`[yzj-next-graph] ledger chain breaks at seq ${String(chain.breakAt)} in ${accountKey}`)
      }
      this.log = log
      this.readyResolve?.()
      this.openedAt = { accountKey, lastSeqAtOpen: this.store.lastSeq }
      const opened = this.openedAt
      this.notify('yzj-graph/opened', () => { this.ctx.emit('yzj-graph/opened', opened) })
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

  /** 分区打开的那一刻；还没打开时为 undefined（晚到的插件据此补上 `yzj-graph/opened`）。 */
  get opened(): GraphOpened | undefined {
    return this.openedAt
  }

  /** 链的完整性（§13.1-9）。只读，不进模型工具面。 */
  integrity(): GraphIntegrity {
    return { ...this.chain, orphanActions: this.orphanActions().length }
  }

  /** 放行了、没结算的写（§13.4）。孤儿扫描与 `integrity()` 数的是同一个集合。 */
  orphanActions(): readonly GraphEvent[] {
    return orphanReleases(this.store.allEvents())
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
    if (input.type === GENESIS_TYPE) throw new Error(`"${GENESIS_TYPE}" is written by the kernel alone`)
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
      /*
        **起点在同一个串行写链里**（§13.1-6）：分区还没有任何 v2 行时，第一次追加之前先写
        genesis，封存它接手的那一段 v1。起点写失败，这次追加一并失败——一行没有起点的
        v2 是一段无从校验的链。起点不发 `yzj-graph/appended`：反应器不该多收一类事件。
      */
      if (this.lastHash === undefined) {
        const genesis = this.store.familyForType(GENESIS_TYPE)?.events[GENESIS_TYPE]
        if (genesis === undefined) throw new Error('the ledger family is not registered')
        await this.write(log, GENESIS_TYPE, genesis.schema.parse({
          v1Through: this.store.lastSeq,
          v1Digest: await log.digest(),
        }) as JsonValue, { kind: 'system' }, genesis.sv ?? 1)
      }
      const event = await this.write(log, input.type, data, input.actor, spec.sv ?? 1)
      this.notify('yzj-graph/appended', () => { this.ctx.emit('yzj-graph/appended', event) })
      return event
    })
    this.writes = enqueued
    return enqueued
  }

  /**
   * 通知订阅者。cordis 的 `emit` 不接住监听器同步抛出的错：不在这里接住，一个坏掉的
   * 监听器会让一行**已经落盘**的追加 reject——对 `action/released` 来说，就是写入不执行、
   * 却永远等不到 settled。落盘的那一行就是事实，监听器的错只是它自己的错。
   */
  private notify(name: string, emit: () => void): void {
    try {
      emit()
    } catch (error) {
      console.error(`[yzj-next-graph] a ${name} listener threw`, error)
    }
  }

  /**
   * 落一行：成链、写盘、推进链尾、折叠。只在串行写链里调用。
   *
   * `seq` 在写盘之前就消耗掉（写盘失败留下一个空洞，空洞不算断链）；`lastHash` 紧接
   * 写盘之后推进——这一行已经是盘上的事实，下一行必须接在它上面。
   */
  private async write(
    log: GraphLog, type: string, data: JsonValue, actor: GraphActor, sv: number,
  ): Promise<GraphEvent> {
    const unsigned: Omit<GraphEvent, 'hash'> = {
      v: GRAPH_ENVELOPE_VERSION, sv, seq: this.nextSeq, time: Date.now(), type, data, actor,
      prev: this.lastHash ?? GENESIS_PREV,
    }
    const event: GraphEvent = { ...unsigned, hash: eventHash(unsigned) }
    this.nextSeq += 1
    await log.append(event)
    this.lastHash = event.hash
    if (this.chain.breakAt === undefined) {
      this.chain = { genesisSeq: this.chain.genesisSeq ?? event.seq, verifiedThrough: event.seq }
    }
    this.store.apply(event)
    this.appendsSinceSnapshot += 1
    if (this.appendsSinceSnapshot >= SNAPSHOT_EVERY) {
      this.appendsSinceSnapshot = 0
      /*
        快照写失败只报错，不 reject：这一行已经落盘、已经折叠。reject 会让一行已落盘的
        `action/released` 被当成失败——写入不执行，却永远等不到 settled。
      */
      await log.writeSnapshot(this.store.foldedSeq, this.store.snapshotObjects()).catch((error: unknown) => {
        console.error('[yzj-next-graph] failed to refresh the snapshot', error)
      })
    }
    return event
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
