/**
 * Turn binding — the orchestration seam object families read instead of
 * reaching into the transport.
 *
 * `viewer` is the load-bearing field: it is derived by the orchestrator from
 * the turn's message source and is NEVER a model-facing parameter (§4.1). A
 * model that could name its own viewer would read cross-place facts and then
 * speak them into a group, which is exactly the leak the signature rule
 * exists to prevent.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GraphViewer } from '@yzj-next/graph'

/** Everything an object family needs to know about the turn it is running in. */
export interface TurnBinding {
  /** Read domain for this turn. */
  readonly viewer: GraphViewer
  /** openId permitted to answer cards this turn opens (P1: the operator). */
  readonly decider: string
  /** The account partition this turn belongs to. */
  readonly accountKey: string
  /** Pinned account identity, re-verified before every gated Yunzhijia call. */
  readonly accountOrgId?: string
  readonly accountOpenId?: string
  readonly topicKey?: string
  readonly placeKey?: string
  /** Listener set inherited by objects this turn registers. */
  readonly audience?: readonly string[]
  /** The inbound Yunzhijia message that admitted this turn, when there was one. */
  readonly messageId?: string
  /**
   * 这一回合的活 —— 产出归属的精确锚 (v3.10 4h⑤).
   *
   * 没有它，工件只能按**话题**归集：一个同时服务两个目标的会话里产出的任何东西，
   * 都会同时算进两个目标的产出栏，而没有任何办法说清哪一份是哪一份的。有了它，
   * 精确归属成为常态、话题级归集降为兜底，兜底那些才标「共用会话」——把共用从
   * 常态变兜底，正是这一条要买的东西。
   *
   * 桌面自发的回合没有它（没有活，只有一次对话），那时的归集照旧走话题级兜底。
   */
  readonly taskId?: string
  /**
   * `write mode` granted by the gateway admission, when there was one.
   *
   * `read-only` is not a weaker grant — it is a REFUSAL, issued by 轻问: a
   * one-shot projection answers a question and is not allowed to change
   * anything while doing so. It is enforced in the monotonic guard rather than
   * in a prompt, because "ask a question, get a number" stops being true the
   * first time a model decides the helpful thing to do is write the number
   * down somewhere.
   */
  readonly writeMode?: 'standard' | 'read-only'
  /**
   * 操作者的显示名 —— 署名协议要落款的那个名字 (决策 #63, §8 B5②).
   *
   * 一切实例出站恒带「—— 云小助（Bruce）」。通道那一侧从身份里读；模型直连 CLI 的
   * `yzj_im_message_send` 够不到通道，它从这里读——两条出站路签的是同一个名字。
   */
  readonly operatorName?: string
  /**
   * 这一回合的**认领态** —— 受话唯一律的运行时结果 (决策 #63, §6.4 认领协议).
   *
   * 一次受话可能到达 N 个实例；本回合能开工，是因为它在梯队协议里**赢了**（或者根本
   * 没有对手）。记在绑定上，合同面板与审计读得到「这一回合凭什么动手」。
   *
   * 写前复核不读这里：让位落的是 `authority/revoked`（撤销穿透，guard 逐调用实时查），
   * 一个输了却已进入工作的回合在第一个写调用处被截断——双写的最后一道机械防线。
   */
  readonly claim?: {
    readonly tier: 'speaker' | 'presence' | 'standby'
    readonly tiebreak: 'sole' | 'tier' | 'msgId'
    readonly contenders: readonly string[]
  }
}

/** Provided by the channel plugin. Absent means no transport is mounted. */
export interface YzjTurns {
  /** Binding for a turn admitted through Yunzhijia, when this agent has one. */
  bindingFor(agent: Agent): TurnBinding | undefined
  /** Binding for a desktop-originated turn: operator viewer, no place. */
  defaultBinding(): TurnBinding | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjTurns?: YzjTurns
  }
}
