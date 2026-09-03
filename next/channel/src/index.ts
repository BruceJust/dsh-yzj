/**
 * `@yzj-next/channel` — transport plus orchestrator.
 *
 * This is the one package that knows both Yunzhijia and the graph, which is
 * why every registration surface converges here: it provides the turn binding
 * object families read, the card-delivery seam they write through, and the
 * poller that turns messages into turns.
 * @module @yzj-next/channel
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@yzj-next/bridge'
import type {} from '@yzj-next/cards'
import type {} from '@yzj-next/graph'
import { memoriesFor, type TurnBinding } from '@yzj-next/objects'
import { YzjChannelClient } from './client.ts'
import { ChannelHealth } from './health.ts'
import { YzjTopicReader } from './topics.ts'
import { YzjCardDelivery } from './delivery.ts'
import { YzjOrchestrator } from './orchestrator.ts'
import { YzjPoller } from './poller.ts'
import { ChannelState } from './state.ts'
import { accountKeyFor, type YzjIdentity } from './protocol.ts'
import { applyServe } from './serve.ts'
import { withdrawRequestDraft } from './presence.ts'
import type { ServeOutcome } from './topics.ts'

export { triage, parseCommand, type TriageOutcome, type TriageInput } from './triage.ts'
export {
  accountKeyFor, conversationKindForGroup, groupIdFromPlaceKey, isSelfChat,
  isTriageableConversation, outboundFingerprint, parseGroup, parseMessage,
  placeKeyFor, renderChatContext, resolveTopicRootId, topicRouteFor,
  type YzjGroup, type YzjIdentity, type YzjMessage, type YzjTopicRoute,
} from './protocol.ts'
export { ChannelState, type ConversationRecord } from './state.ts'
export { YzjChannelClient } from './client.ts'
export { ChannelHealth } from './health.ts'
export {
  YzjTopicReader, parseSendTime, sessionIdOfTopic, sniffMime, topicKeyOfSession,
  type AttachmentBody, type ConversationRow, type DeskSend, type PresenceView, type ServeOutcome,
  type TopicDescriptor, type TopicMessage, type YzjTopics,
} from './topics.ts'
export {
  ackText, acksIn, claimVerdict, classifyPeerOutbound, presenceDeclaration, presenceWithdrawal,
  resolveAddressee, reviewClaim, tierOfPeer, withdrawRequestDraft, yieldNotice,
  type AckObservation, type ClaimTier, type ClaimVerdict, type Contender, type PeerSignal,
  type Resolution, type ResolveInput, type YieldReason,
} from './presence.ts'
export { applyServe, serveRecordFor, type ServeRecord } from './serve.ts'
export { sourceFor, yzjSourceOf, type YzjNextMessageSource } from './source.ts'
export { YzjCardDelivery } from './delivery.ts'
export {
  YzjOrchestrator, DeliveryOutcomeUnknownError, clipMessage, priorTurnFor, summarizeTurn,
  CHANNEL_PROMPT,
} from './orchestrator.ts'
export { YzjPoller, deskSendPlan, onDutyIn, unlinkPlan } from './poller.ts'

export const name = 'yzj-next-channel'
export const inject = [
  'agentDefaultModel', 'agentPresets', 'agents', 'sessions', 'sessionTitle',
  'systemPrompt', 'tools', 'workspaceRegistry', 'yzjBridge', 'yzjCards', 'yzjGraph',
]

const defaultHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')

export interface Config {
  enabled?: boolean
  pollIntervalMs?: number
  groupPages?: number
  contextMessages?: number
  /** Display title of the workspace this instance's conversations live in. */
  workspaceTitle?: string
  /** Pages a first-seen conversation scan may consume per poll. */
  discoveryPages?: number
  /** Consecutive poll failures before the outage becomes a visible object. */
  healthFailureThreshold?: number
  /** Idle time before a topic's Agent is released (the Session survives). */
  agentIdleMs?: number
  aliases?: string[]
  acceptAccountMentions?: boolean
  /**
   * Conversations this instance acts in. **Empty means NONE** (v3.15 裁决①).
   *
   * 收窄之前，空集是「到处都在岗」——于是这个集合同时兼职表达两件事（配置与逐群
   * 决定），而那正是一道**双向悬崖**：名单只剩一个群时把它关掉，集合变空，agent
   * 在 46 个真实工作群里同时上岗。合同默认最严的构造性兑现是空集 = 全关。
   */
  allowedGroupIds?: string[]
  /**
   * 全量上岗 —— **显式写下来的那一种** (v3.15 裁决①).
   *
   * 「到处都在岗」是一个合法的部署选择（旧系统平价切换那天可能就要它），错的是让它
   * 由**一个集合恰好为空**来表达：语义与数据结构分离之后，那道悬崖就没有了——关掉
   * 最后一个群只是关掉最后一个群。
   */
  serveAll?: boolean
  preset?: string
  cwd?: string
  stateFile?: string
  cliTimeoutMs?: number
  taskTimeoutMs?: number
  maxReplyChars?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  pollIntervalMs: z.number().step(1).min(1_000).default(5_000),
  groupPages: z.number().step(1).min(1).max(20).default(3),
  contextMessages: z.number().step(1).min(1).max(20).default(20),
  workspaceTitle: z.string().default('云之家'),
  discoveryPages: z.number().step(1).min(1).max(20).default(10),
  healthFailureThreshold: z.number().step(1).min(1).default(3),
  agentIdleMs: z.number().step(1).min(0).default(10 * 60_000),
  aliases: z.array(z.string()).default(['@agent', '@智能体']),
  acceptAccountMentions: z.boolean().default(false),
  allowedGroupIds: z.array(z.string()).default([]),
  serveAll: z.boolean().default(false),
  preset: z.string().default('standard'),
  cwd: z.string().default(join(defaultHome, 'yzj-next', 'workspace')),
  stateFile: z.string().default(join(defaultHome, 'yzj-next', 'channel-state.json')),
  cliTimeoutMs: z.number().step(1).min(1_000).default(60_000),
  taskTimeoutMs: z.number().step(1).min(10_000).default(30 * 60_000),
  maxReplyChars: z.number().step(1).min(200).max(4_000).default(3_500),
})

const absolute = (value: string): string => (isAbsolute(value) ? value : resolve(value))

export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return
  const pollIntervalMs = config.pollIntervalMs ?? 5_000
  /**
   * 接单场所 —— the deployment's blast radius.
   *
   * Read by two things now: the poller (what it acts in) and the topic
   * reader (which rows the desktop draws as places rather than as plain
   * conversations). One source, because a left column that disagreed with
   * the gate would promise an agent that never answers.
   */
  /**
   * The deployment's blast radius, as one LIVE set.
   *
   * Config is the baseline; the operator's later decisions are merged onto it
   * from durable state at boot (see `applyServedOverrides`). Everything that
   * gates on it — the poller's `served()`, the desktop's on-duty rendering —
   * reads it through `.has()` at call time rather than snapshotting, which is
   * what lets 接单/移出 take effect without a restart.
   */
  const allowedGroupIds = new Set(config.allowedGroupIds ?? [])
  /*
    被**明确**移出服务的群 —— 和「从没提过」分开存。

    落库那一层本来就是三值的（`Record<string, boolean>`）；值丢在「合并成一个 Set」
    那一步：接入 `add`、移出 `delete`，于是一次明确的「不」和一次从未发生的决定长得
    一模一样。而那个集合还兼职表达配置——空集是「这个部署没有名单，到处都在岗」。
    两个含义挤在一个数据结构里，就有了一道双向的悬崖，见 `poller.ts` 的 `allowed()`。
  */
  const deniedGroupIds = new Set<string>()
  /** 触发词的单一事实源：门用它判定，桌面用它预填与预告。 */
  const aliases = config.aliases ?? ['@agent', '@智能体']
  const cwd = absolute(config.cwd ?? join(defaultHome, 'yzj-next', 'workspace'))
  const state = new ChannelState(absolute(config.stateFile ?? join(defaultHome, 'yzj-next', 'channel-state.json')))
  const client = new YzjChannelClient(ctx, state, config.cliTimeoutMs ?? 60_000)
  const orchestrator = new YzjOrchestrator(ctx, client, state, {
    cwd,
    preset: config.preset ?? 'standard',
    maxReplyChars: config.maxReplyChars ?? 3_500,
    taskTimeoutMs: config.taskTimeoutMs ?? 30 * 60_000,
    contextMessages: config.contextMessages ?? 20,
    agentIdleMs: config.agentIdleMs ?? 10 * 60_000,
  })
  const health = new ChannelHealth(ctx, {
    failureThreshold: config.healthFailureThreshold ?? 3,
  })
  const onError = (error: unknown): void => { console.error('[yzj-next-channel]', error) }

  ctx.effect(() => {
    let disposed = false
    let interval: ReturnType<typeof setInterval> | undefined
    const disposers: (() => unknown)[] = []

    /**
     * Everything that needs the operator's identity is wired only once it is
     * known: the turn binding needs a decider, and card delivery needs
     * somebody to deliver to.
     */
    const onIdentity = async (identity: YzjIdentity): Promise<void> => {
      /*
        What a person decided beats what the bundle shipped.

        It has to run HERE and not after `state.load()`: the state file is
        per-account and `servedOverrides()` reads the ACTIVE account, which
        does not exist until the poller has resolved the identity. Reading it
        earlier threw inside the boot `Promise.all`, which took the whole
        startup chain with it — the poller never began, so the desktop showed
        an empty conversation list and every group looked unserved.

        `onIdentity` is the first moment both facts exist, and it still runs
        before the first poll consumes the allow-list.
      */
      for (const [groupId, on] of Object.entries(state.servedOverrides())) {
        // 两个集合各自成立：明确开的进 allowed，明确关的进 denied，没提过的哪个都不进。
        if (on) { allowedGroupIds.add(groupId); deniedGroupIds.delete(groupId) } else { deniedGroupIds.add(groupId); allowedGroupIds.delete(groupId) }
      }
      const binding: TurnBinding = {
        viewer: { kind: 'operator', openId: identity.openId },
        decider: identity.openId,
        accountKey: accountKeyFor(identity),
        accountOrgId: identity.orgId,
        accountOpenId: identity.openId,
        // 署名要落的名字 (决策 #63)：通道的出站与工具直连的出站签同一个名。
        operatorName: identity.name,
      }
      orchestrator.setDefaultBinding(binding)
      // The desktop surface acts as the operator. Until this is set, the card
      // system's actor is a bare `operator` that no `allowedActors` accepts —
      // fail closed while the identity is still unknown.
      ctx.yzjCards.setDesktopActor({ kind: 'operator', openId: identity.openId }, identity.name)
      const delivery = new YzjCardDelivery(ctx, client, identity.openId)
      disposers.push(ctx.provide('yzjCardChannel', delivery))
      // The read/write face the desktop surface consumes. Provided only once
      // the identity is known: a topic reader with no operator cannot tell
      // "our own words" from anybody else's.
      disposers.push(ctx.provide('yzjTopics', new YzjTopicReader(
        ctx, client, state, identity.openId, identity.orgId,
        (route, text) => orchestrator.lightAsk(route, text),
        (placeKey, text, replyTo) => poller.sendFromDesktop(placeKey, text, replyTo),
        (openId, text) => poller.sendToPerson(openId, text),
        (groupId) => poller.allowed(groupId),
        aliases,
        async (groupId: string, on: boolean, scope?: 'all' | 'self'): Promise<ServeOutcome> => {
          /*
            **接单 = 人签发的身份/听众敏感动作** (决策 #63 §8 B5①)。

            触发者范围含他人（`all`）= **对群在岗**：切开即向群发一次在岗声明帖——群即
            审计面。接单前先读场所近史：已有同侪对群在岗 → **第二在岗押门**（P1 一个场所
            一个在岗），这一次不接，给两条出口——请对方退岗（拟稿亲发）/ 改为仅本人。
            仅本人（`self`）不声明、不算在岗：它只服务自己的操作者，与他人天然无冲突。
          */
          const wasOn = poller.allowed(groupId)
          const previousScope = state.scopeOf(groupId) ?? 'all'
          const nextScope = on ? (scope ?? (wasOn ? previousScope : 'all')) : undefined
          const declared = poller.declaredIn(groupId)
          if (on && nextScope === 'all' && !declared) {
            await poller.scanPresence(groupId).catch(onError)
            const peer = state.peersOnDutyIn(groupId)[0]
            if (peer !== undefined) {
              return {
                served: wasOn,
                ...(wasOn ? { scope: previousScope } : {}),
                conflict: { openId: peer.openId, name: peer.name, since: peer.since },
                draft: withdrawRequestDraft(peer.name, poller.groupNameOf(groupId) ?? groupId),
              }
            }
          }
          /*
            **动作先落图，再物化到运行态** (v3.15 裁决⑤)。顺序与失败语义见 `applyServe`。
          */
          await applyServe({
            groupId,
            on,
            ...(nextScope === undefined ? {} : { scope: nextScope }),
            allowedGroupIds,
            deniedGroupIds,
            nameOf: (id) => poller.groupNameOf(id),
            record: async (record) => {
              try {
                await ctx.yzjGraph.append({
                  type: 'contract/served',
                  data: { ...record },
                  actor: ctx.yzjCards.desktopActor(),
                })
              } catch (error) {
                // 记不下这一笔就不改触达：一次没有出处的接单，正是这条裁决要消灭的东西。
                onError(error)
                throw error
              }
            },
            persist: async (id, served, servedScope) => {
              state.setServed(id, served, servedScope)
              await state.save()
            },
          })
          // 声明帖在运行态之后：先把岗接了，再向群说；说不出去也记岗，但要报「群里还不知道」。
          let announced: boolean | undefined
          let memoryDraft: string | undefined
          if (on && nextScope === 'all' && !declared) {
            announced = await poller.declarePresence(groupId).catch((error: unknown) => { onError(error); return false })
          } else if ((!on || nextScope === 'self') && declared) {
            announced = await poller.withdrawPresence(groupId).catch((error: unknown) => { onError(error); return false })
            /*
              在岗移交 = 退岗帖 + 接岗者的在岗帖；背景包里的**场所记忆**须人签发的脱密
              （越境律），所以只拟稿不代发。私语不迁移——这里读的只有场所轴。
            */
            const placeKey = `yzj-group-${groupId}`
            const lines = memoriesFor(ctx, 'place', placeKey).map(memory => `- ${memory.summary}`)
            if (lines.length > 0) {
              memoryDraft = [
                `「${poller.groupNameOf(groupId) ?? groupId}」这个群里我的助理学到的惯例，交给接岗的你：`,
                ...lines,
              ].join('\n')
            }
          }
          return {
            served: on,
            ...(nextScope === undefined ? {} : { scope: nextScope }),
            ...(announced === undefined ? {} : { announced }),
            ...(memoryDraft === undefined ? {} : { memoryDraft }),
          }
        },
        cwd,
        {
          of: (groupId) => poller.presenceIn(groupId),
          peers: () => state.peers(),
        },
      )))
      disposers.push(ctx.provide('yzjTurns', {
        bindingFor: (agent) => orchestrator.bindingFor(agent),
        defaultBinding: () => orchestrator.defaultBinding(),
      }))
      // The terminal echo owed to every text surface a resolved card reached.
      disposers.push(ctx.on('yzj-cards/resolved', (payload) => {
        void (async (): Promise<void> => {
          for (const projection of payload.projections) {
            await delivery.echo(projection, payload.echoText)
          }
        })().catch(onError)
      }))
      /*
        「继续」 puts the interrupted intent back on its own rails.

        Off the DECISION rather than off the keyword: the same press works from
        the group's text reply and from the desktop button, because both land
        as `task/resumed` on the one action bus.
      */
      disposers.push(ctx.on('yzj-graph/appended', (event) => {
        if (event.type !== 'task/resumed') return
        const data = event.data as { taskId?: unknown }
        if (typeof data.taskId !== 'string') return
        void orchestrator.resumeTask(data.taskId).then((resumed) => {
          if (!resumed) {
            console.warn(`[yzj-next-channel] task ${String(data.taskId)} has no resume address`)
          }
        }).catch(onError)
      }))
      // A retried approval re-issues the work as a NEW turn. The retry is
      // recorded and announced here; re-dispatching it into the topic session
      // rides on the task object's own re-run path.
      disposers.push(ctx.on('yzj-approval/retry-requested', (payload) => {
        console.warn(`[yzj-next-channel] approval ${payload.approvalId} retry requested (${payload.toolName})`)
      }))
      // A handoff is answerable from the desktop card as well as the DM, so it
      // executes off the DECISION rather than off the command that opened it.
      disposers.push(ctx.on('yzj-graph/appended', (event) => {
        if (event.type !== 'approval/decided') return
        const data = event.data as { approvalId?: unknown; status?: unknown; decidedBy?: unknown }
        if (typeof data.approvalId !== 'string') return
        void poller.onApprovalDecided(
          data.approvalId,
          data.status === 'approved',
          typeof data.decidedBy === 'string' ? data.decidedBy : identity.openId,
        ).catch(onError)
      }))
      await Promise.resolve()
    }

    // Declared after `onIdentity`, which closes over it: the identity hook
    // only runs inside the first poll, by which point this is bound.
    const poller: YzjPoller = new YzjPoller(ctx, client, state, orchestrator, health, {
      aliases,
      acceptAccountMentions: config.acceptAccountMentions ?? false,
      groupPages: config.groupPages ?? 3,
      contextMessages: config.contextMessages ?? 20,
      discoveryPages: config.discoveryPages ?? 10,
      pollIntervalMs,
      allowedGroupIds,
      deniedGroupIds,
      serveAll: config.serveAll ?? false,
    }, onError, onIdentity)

    void Promise.all([
      state.load(),
      mkdir(cwd, { recursive: true }),
      // Before the first poll: the desktop needs somewhere to put a session
      // the moment one exists, and an operator opening the workbench before
      // any Yunzhijia traffic should still find a usable window.
      orchestrator.ensureWorkspace(config.workspaceTitle ?? '云之家'),
    ])
      .then(async () => {
        if (disposed) return
        await poller.poll()
        if (!disposed) interval = setInterval(() => { void poller.poll() }, pollIntervalMs)
      })
      .catch(onError)

    return async () => {
      disposed = true
      if (interval !== undefined) clearInterval(interval)
      for (const dispose of disposers.reverse()) dispose()
      await orchestrator.dispose()
      await state.save().catch(onError)
    }
  })
}
