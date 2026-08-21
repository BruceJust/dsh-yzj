/**
 * Channel health (§6.5).
 *
 * A real-person OAuth token expires and can be kicked (F11). Unattended, that
 * turns every poll into a silent no-op, and every pending confirmation card
 * sits on three surfaces saying "waiting" forever. A product whose trust rests
 * on **visible waiting** cannot be blind to its own silence — so the channel's
 * own offline state is an ordinary waiting object on the graph, opened after N
 * consecutive failures and closed the moment a poll succeeds.
 *
 * It is a graph object rather than a log line for the same reason every other
 * wait is: it has to be answerable, projectable, and still there after a
 * restart.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import { waitingIdFor, type WaitingState } from '@yzj-next/objects'

/** Yunzhijia error codes that mean "log in again", not "try again later". */
const AUTH_FAILURE = /10000400|93001|unauthorized|未授权|登录/i

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** The Yunzhijia channel went dark; `waitingId` is its graph object. */
    'yzj-channel/offline'(payload: {
      waitingId: string
      what: string
      authFailure: boolean
    }): void
    /** The channel recovered and its outage object closed. */
    'yzj-channel/online'(payload: { waitingId: string }): void
  }
}

export interface ChannelHealthConfig {
  /** Consecutive failures before the outage becomes visible. */
  readonly failureThreshold: number
}

export class ChannelHealth {
  private consecutiveFailures = 0
  private openWaitingId: string | undefined
  /**
   * Outages opened by this process. A wall-clock stamp alone is not a distinct
   * anchor — two outages inside the same millisecond would collapse onto one
   * object and the second would silently vanish.
   */
  private outages = 0

  constructor(
    private readonly ctx: Context,
    private readonly config: ChannelHealthConfig,
  ) {}

  /** Adopt an outage left open by a previous run. */
  adopt(): void {
    for (const object of this.ctx.yzjGraph.pendingAnswerables({ kind: 'operator', openId: '' })) {
      if (object.kind !== 'waiting') continue
      const state = object.state as unknown as WaitingState
      if (state.kind === 'system') {
        this.openWaitingId = state.waitingId
        this.consecutiveFailures = this.config.failureThreshold
        return
      }
    }
  }

  /** Record one failed poll. Opens the outage object at the threshold. */
  async recordFailure(error: unknown): Promise<void> {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures < this.config.failureThreshold) return
    if (this.openWaitingId !== undefined) return
    const detail = error instanceof Error ? error.message : String(error)
    const authFailure = AUTH_FAILURE.test(detail)
    const what = authFailure
      ? '云之家通道离线：登录态失效，请重新运行 `yzj-cli auth login`'
      : '云之家通道离线：连续轮询失败'
    // A fresh outage is a fresh wait — the anchor is scoped to when it began,
    // so a recovered-then-failed channel does not resurrect the old object and
    // inherit its elapsed time.
    this.outages += 1
    const waitingId = waitingIdFor('channel', `${what}@${String(Date.now())}#${String(this.outages)}`)
    try {
      await this.ctx.yzjGraph.append({
        type: 'waiting/opened',
        data: {
          waitingId,
          kind: 'system',
          what,
          openedAt: Date.now(),
          idemKey: waitingId,
        },
        actor: { kind: 'system' },
      })
      this.openWaitingId = waitingId
      // The IM channel is the thing that is down, so it cannot carry its own
      // outage notice — the desktop is the only exit that exists here. The
      // graph event drives any subscribed surface; the log line is what an
      // operator watching the process sees today.
      this.ctx.emit('yzj-channel/offline', { waitingId, what, authFailure })
      console.error(`[yzj-next-channel] ${what}`, error)
    } catch (appendError) {
      console.error('[yzj-next-channel] failed to record the channel outage', appendError)
    }
  }

  /** Record one successful poll; closes any open outage. */
  async recordSuccess(): Promise<void> {
    this.consecutiveFailures = 0
    const waitingId = this.openWaitingId
    if (waitingId === undefined) return
    this.openWaitingId = undefined
    this.ctx.emit('yzj-channel/online', { waitingId })
    try {
      await this.ctx.yzjGraph.append({
        type: 'waiting/closed',
        data: { waitingId, cause: 'resolved' },
        actor: { kind: 'system' },
      })
    } catch (error) {
      console.error('[yzj-next-channel] failed to close the channel outage', error)
    }
  }

  /** True while the channel is known to be down. */
  get offline(): boolean {
    return this.openWaitingId !== undefined
  }

  /** The open outage's id, for tests and diagnostics. */
  get outageId(): string | undefined {
    return this.openWaitingId
  }
}

/** Read one waiting object's state off the graph, if it exists. */
export function waitingStateOf(ctx: Context, waitingId: string): WaitingState | undefined {
  const object = ctx.yzjGraph.rawObject('waiting', waitingId)
  if (object === undefined) return undefined
  const data = asRecord(object.state)
  return asString(data?.waitingId) === undefined
    ? undefined
    : object.state as unknown as WaitingState
}
