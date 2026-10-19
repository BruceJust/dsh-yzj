/**
 * The authorization-lease seam.
 *
 * Leases themselves are a later segment (they open on real approval fatigue),
 * but the guard's decision ORDER is part of the finished design and cannot be
 * retrofitted without re-reasoning about every branch: 逃逸封禁 → 身份复验 →
 * **租约命中放行** → 合同写级 → ask (§5.1). Declaring the seat now means the
 * lease family, when it arrives, is a plugin that provides a service — not a
 * patch that reopens the guard.
 *
 * A lease is an object-level or period-level pre-authorization ("writes to this
 * table this period need no confirmation, 8/1–8/5"). Its revocation is a
 * revocation-class hard item: it pierces the turn snapshot and takes effect on
 * the very next call, which is why the check is a live call and not a value
 * captured when the turn opened.
 */

/** What a call would need a lease to cover. */
export interface LeaseQuery {
  /** The tool about to run. */
  readonly toolName: string
  /** Parsed call arguments, for object-level scoping. */
  readonly args: Record<string, unknown>
  /** The place the call is happening in, when it has one. */
  readonly placeKey?: string
  /** Who the call is running as. */
  readonly openId?: string
}

/** The lease that released a call, and the person who signed it. */
export interface CoveringLease {
  readonly leaseId: string
  readonly grantedBy: string
}

/** Provided by the lease object family. Absent means "no leases exist". */
export interface YzjLeases {
  /**
   * Whether a live, unexpired, unrevoked lease covers this call. Returning
   * `true` skips the confirmation card; everything before it in the guard's
   * order (escape, identity, revocation) has already run and cannot be
   * skipped by a lease.
   */
  covers(query: LeaseQuery): boolean
  /**
   * **哪一张**租约放行了它（技术方案-下一代ERP账本 §13.3-1）。一个布尔值只能说「放了」，
   * 说不出凭谁签的字——而账要的正是后者：`action/released` 的授权来源要追得到签发人。
   * 多张同时命中取 `period.from` 最早的，相同再按 `leaseId` 字典序：同一个问题永远同一个答案。
   */
  coveringLease(query: LeaseQuery): CoveringLease | undefined
  /** 此刻生效的租约 id，与 `coveringLease` 同一套判据——回合环境快照记的就是它。 */
  activeLeaseIds(): readonly string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjLeases?: YzjLeases
  }
}
