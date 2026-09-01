/**
 * `ctx.yzjPledger` — the service face of the private ledger.
 *
 * It is the graph kernel's own log core with a DIFFERENT CONSTITUTION
 * (PTD-1): same fold, same idempotency-anchor collapse, same
 * durable-before-notify ordering — and three policy differences that are the
 * whole point of the second store:
 *
 * ① **viewer 单态.** Every read below takes NO viewer. There is no `place`
 *    query to reject because there is no `place` query to write (断言⑨).
 * ② **审计导出不可触及.** The audit export projection replays the ORGANIZATION
 *    store's sources. This service is never one of them — the second exception
 *    region of 对称保留律 is a fact about which sources the exporter walks, not
 *    a filter it applies (§2 policy②).
 * ③ **组织与他人不可导出、本人可取走与销毁.** The directory is self-contained
 *    and {@link directory} says where it is; {@link destroy} is the only
 *    deletion path there is (§2 policy③).
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import {
  GraphStore,
  type GraphEvent, type GraphObject, type JsonValue,
} from '@yzj-next/graph'
import { PledgerLog } from './log.ts'
import { PLEDGER_FAMILIES } from './vocabulary.ts'
import {
  PLEDGER_ENVELOPE_VERSION,
  type PledgerAppendInput, type PledgerViewer,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The private ledger. **Optional on purpose**: `pledger.enabled = false`
     * provides nothing at all, so every consumer's degradation path is the one
     * it already has for「服务没挂」 rather than a second, private branch
     * (断言⑩).
     */
    yzjPledger?: YzjPledger
  }
  interface Events {
    /**
     * One private event was appended and folded. The vault re-renders from
     * this. It is emitted on the plugin context like any other cordis event —
     * and no organization-side package subscribes to it, because no
     * organization-side package may import this module at all (PTD-3).
     */
    'yzj-pledger/appended'(event: GraphEvent): void
  }
}

/** How many appends may pass before the snapshot is refreshed. */
const SNAPSHOT_EVERY = 100

export interface PledgerServiceConfig {
  /** Root directory; each operator gets a self-contained directory beneath it. */
  readonly root: string
}

export class YzjPledger extends Service {
  private readonly store = new GraphStore()
  private log: PledgerLog | undefined
  private operatorOpenId: string | undefined
  private writes: Promise<unknown> = Promise.resolve()
  private nextSeq = 1
  private appendsSinceSnapshot = 0
  private loading: Promise<void> | undefined

  constructor(ctx: Context, private readonly config: PledgerServiceConfig) {
    super(ctx, 'yzjPledger')
    for (const family of PLEDGER_FAMILIES) this.store.register(family)
  }

  /**
   * The one viewer this ledger has.
   *
   * Private rather than a parameter: {@link PledgerViewer} has a single
   * inhabitant, and handing it to callers would invite somebody to build a
   * second one. Reads below simply do not ask who is looking, because the
   * directory answers that question before the process starts.
   */
  private get viewer(): PledgerViewer {
    return { kind: 'operator', openId: this.operatorOpenId ?? '' }
  }

  /**
   * Open one operator's ledger.
   *
   * **归属键 = operatorOpenId（人，非 accountKey）** (PTD-8): the ledger travels
   * with the person. Switching operators mid-run is the same circuit breaker
   * the graph kernel has — the identity IS part of what this log means, so
   * silently continuing under another one is worse than stopping.
   */
  async open(operatorOpenId: string): Promise<void> {
    if (this.operatorOpenId === operatorOpenId) {
      await this.loading
      return
    }
    if (this.operatorOpenId !== undefined) {
      throw new Error('私账账本的归属人在运行中变了——账随人不随实例，这里必须停下')
    }
    this.operatorOpenId = operatorOpenId
    const log = new PledgerLog(join(this.config.root, operatorOpenId))
    this.loading = (async () => {
      const loaded = await log.load()
      if (loaded.damagedLines > 0) {
        console.error(`[yzj-next-pledger] ${String(loaded.damagedLines)} unreadable ledger line(s)`)
      }
      this.store.hydrate(loaded.events, loaded.snapshot)
      this.nextSeq = this.store.lastSeq + 1
      this.log = log
    })()
    await this.loading
  }

  /** True once a ledger is open. Consumers degrade rather than block on it. */
  get ready(): boolean {
    return this.log !== undefined
  }

  /** Who this ledger belongs to. Undefined until the channel resolves identity. */
  get owner(): string | undefined {
    return this.operatorOpenId
  }

  /**
   * Where the ledger lives on disk — 「本人可取走」 made actionable.
   *
   * The directory is self-contained (no external index, no reverse reference
   * from the organization graph), so copying it IS taking the whole ledger.
   * 断言⑪ asserts exactly that: a copy of this path opens on its own.
   */
  get directory(): string | undefined {
    return this.log?.directory
  }

  /** Drain in-flight writes and refresh the snapshot. Called on dispose. */
  async flush(): Promise<void> {
    await this.writes.catch(() => undefined)
    if (this.log !== undefined && this.appendsSinceSnapshot > 0) {
      await this.log.writeSnapshot(this.store.foldedSeq, this.store.snapshotObjects())
      this.appendsSinceSnapshot = 0
    }
  }

  /**
   * Append one private event.
   *
   * Rejects an unregistered type outright — 宁缺勿脏 binds the write side here
   * exactly as it does on the organization graph.
   */
  async append<D extends JsonValue>(input: PledgerAppendInput<D>): Promise<GraphEvent> {
    const family = this.store.familyForType(input.type)
    if (family === undefined) throw new Error(`unknown pledger event type "${input.type}"`)
    const spec = family.events[input.type]
    if (spec === undefined) {
      throw new Error(`pledger family "${family.kind}" does not declare "${input.type}"`)
    }
    const data = spec.schema.parse(input.data) as JsonValue
    const enqueued = this.writes.catch(() => undefined).then(async () => {
      const log = this.log
      if (log === undefined) throw new Error('私账账本还没打开（云之家身份未就绪）')
      const event: GraphEvent = {
        v: PLEDGER_ENVELOPE_VERSION,
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
      this.ctx.emit('yzj-pledger/appended', event)
      return event
    })
    this.writes = enqueued
    return enqueued
  }

  /** One private object by ref. No viewer — see the class comment. */
  object(kind: string, id: string): GraphObject | undefined {
    return this.store.rawObject(kind, id)
  }

  /** Private objects of one kind, newest first. No viewer. */
  query(kind: string, status?: readonly string[]): readonly GraphObject[] {
    return this.store.query(this.viewer, {
      kind,
      ...(status === undefined ? {} : { status }),
    })
  }

  /** The object already opened under this anchor (幂等锚律). */
  findByIdemKey(idemKey: string): GraphObject | undefined {
    return this.store.findByIdemKey(idemKey)
  }

  /** Raw private-event scan for derivations (patterns, fatigue, cases). */
  events(types: readonly string[]): readonly GraphEvent[] {
    return this.store.rawEvents(types)
  }

  /**
   * 销毁 —— two-step confirmation lives at the entrance, the erasure lives here.
   *
   * After this the service holds no ledger: it is not "emptied", it is closed.
   * A later `open()` for the same person starts a genuinely new account, which
   * is the honest meaning of destroying one.
   */
  async destroy(): Promise<void> {
    await this.writes.catch(() => undefined)
    const log = this.log
    if (log === undefined) return
    this.log = undefined
    this.operatorOpenId = undefined
    this.loading = undefined
    this.nextSeq = 1
    this.appendsSinceSnapshot = 0
    this.store.hydrate([])
    await log.destroy()
  }
}
