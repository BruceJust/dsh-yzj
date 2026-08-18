import {
  accountKeyFor, hasLeadingAgentAlias, isAgentTrigger, isTriggerableConversation,
  renderChatContext, resolveTopicRootId, stripTriggerAliases, topicRouteFor,
} from './protocol.ts'
import type { GatewayState } from './state.ts'
import type { YzjGatewayClient } from './client.ts'
import type { YzjAgentRunner } from './agent-runner.ts'
import { YzjDeliveryOutcomeUnknownError, YzjTaskLeaseRevokedError } from './errors.ts'
import type { YzjGroup, YzjIdentity, YzjMessage, YzjTopicRoute, YzjTrigger } from './types.ts'

const SELF_COMMAND_RECOVERY_MS = 60 * 60_000

export interface PollerConfig {
  readonly aliases: readonly string[]
  readonly acceptAccountMentions: boolean
  readonly groupPages: number
  readonly contextMessages: number
  readonly discoveryPages: number
  readonly pollIntervalMs: number
  readonly maxConcurrentTasks: number
  readonly allowedGroupIds: ReadonlySet<string>
  readonly allowedSenderOpenIds: ReadonlySet<string>
}

export class YzjAgentPoller {
  private polling = false
  private stopped = false
  private abandonQueued = false
  private identity: YzjIdentity | undefined
  private recoveredPending = false
  private readonly startedAt = Date.now()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly discovery = new Map<string, {
    anchor: string
    highWater: string
    messages: YzjMessage[]
  }>()
  private activeTasks = 0
  private readonly taskWaiters: (() => void)[] = []
  private readonly pollWaiters: (() => void)[] = []

  constructor(
    private readonly client: YzjGatewayClient,
    private readonly state: GatewayState,
    private readonly runner: YzjAgentRunner,
    private readonly config: PollerConfig,
    private readonly onError: (error: unknown) => void,
  ) {}

  async poll(): Promise<void> {
    if (this.stopped || this.polling) return
    this.polling = true
    try {
      const observedIdentity = await this.client.identity()
      this.client.pinIdentity?.(observedIdentity)
      this.state.selectAccount(observedIdentity)
      if (this.identity === undefined) this.identity = observedIdentity
      else if (accountKeyFor(this.identity) !== accountKeyFor(observedIdentity)) {
        throw new Error('Yunzhijia login account changed while Agent gateway is running')
      }
      if (!this.recoveredPending) {
        this.recoveredPending = true
        for (const trigger of this.state.pendingTasks()) this.enqueue(trigger, this.routeFor(trigger))
      }
      const groups = await this.client.recentGroups(this.config.groupPages)
      for (const group of groups) await this.inspectGroup(group)
      await this.state.save()
    } catch (error) {
      this.onError(error)
    } finally {
      this.polling = false
      for (const resolve of this.pollWaiters.splice(0)) resolve()
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    const draining = (async (): Promise<void> => {
      if (this.polling) await new Promise<void>(resolve => this.pollWaiters.push(resolve))
      await Promise.allSettled([...this.queues.values()])
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      await Promise.race([
        draining,
        new Promise<void>(resolve => {
          timer = setTimeout(() => {
            timedOut = true
            this.abandonQueued = true
            resolve()
          }, 30_000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    if (timedOut) this.onError(new Error('Yunzhijia Agent poller shutdown timed out'))
  }

  private groupAllowed(groupId: string): boolean {
    return this.config.allowedGroupIds.size === 0 || this.config.allowedGroupIds.has(groupId)
  }

  private senderAllowed(openId: string): boolean {
    return this.config.allowedSenderOpenIds.size === 0 || this.config.allowedSenderOpenIds.has(openId)
  }

  private async inspectGroup(group: YzjGroup): Promise<void> {
    const cursor = this.state.cursor(group.groupId)
    if (!isTriggerableConversation(group) || !this.groupAllowed(group.groupId)) {
      this.state.setCursor(group.groupId, group.lastMsgId)
      return
    }
    if (cursor === group.lastMsgId) {
      await this.inspectCurrentSelfCommand(group)
      return
    }
    if (cursor === undefined) {
      const discoveredCursor = await this.inspectFirstSeenGroup(group)
      if (discoveredCursor !== undefined) this.state.setCursor(group.groupId, discoveredCursor)
      return
    }
    const messages = await this.client.messages(group.groupId, 20, cursor)
    for (const message of messages) await this.inspectMessage(group, message, messages)
    const newest = messages.at(-1)
    if (newest !== undefined) this.state.setCursor(group.groupId, newest.msgId)
  }

  private async inspectCurrentSelfCommand(group: YzjGroup): Promise<void> {
    const preview = group.lastMsg
    if (preview === undefined || preview.fromOpenId !== this.requireIdentity().openId) return
    if (this.state.seen(preview.msgId) || !hasLeadingAgentAlias(preview, this.config.aliases)) return
    const sentAt = Date.parse(preview.sendTime.replace(' ', 'T'))
    if (!Number.isFinite(sentAt) || sentAt < this.startedAt - SELF_COMMAND_RECOVERY_MS) return
    const history = await this.client.messages(group.groupId, this.config.contextMessages)
    const message = history.find(candidate => candidate.msgId === preview.msgId)
    if (message !== undefined) await this.inspectMessage(group, message, history)
  }

  private async inspectFirstSeenGroup(group: YzjGroup): Promise<string | undefined> {
    const freshness = Math.max(this.config.pollIntervalMs * 3, 30_000)
    const cutoff = this.startedAt - freshness
    const timestamp = group.lastMsg?.sendTime || group.lastMsgSendTime
    const latestAt = Date.parse(timestamp.replace(' ', 'T'))
    const continuation = this.discovery.get(group.groupId)
    const highWater = continuation?.highWater ?? group.lastMsgId
    if (!Number.isFinite(latestAt) || latestAt < cutoff) {
      this.discovery.delete(group.groupId)
      return highWater
    }
    const discovered = await this.client.messagesSince?.(
      group.groupId, cutoff, this.config.discoveryPages, continuation?.anchor,
    )
    const batch = discovered ?? {
      messages: await this.client.messages(group.groupId, this.config.contextMessages),
      truncated: false,
    }
    const batchIds = new Set(batch.messages.map(message => message.msgId))
    let history = [
      ...batch.messages,
      ...(continuation?.messages ?? []).filter(message => !batchIds.has(message.msgId)),
    ]
    if (batch.truncated && batch.nextAnchor !== undefined) {
      this.discovery.set(group.groupId, {
        anchor: batch.nextAnchor, highWater, messages: history,
      })
      return undefined
    }
    if (!history.some(message => message.msgId === highWater)) {
      const preview = group.lastMsg
      if (preview === undefined || preview.msgId !== highWater) {
        this.discovery.delete(group.groupId)
        return undefined
      }
      history = [...history, preview]
    }
    for (const message of history) {
      const sentAt = Date.parse(message.sendTime.replace(' ', 'T'))
      if (Number.isFinite(sentAt) && sentAt >= cutoff) {
        await this.inspectMessage(group, message, history)
      }
    }
    this.discovery.delete(group.groupId)
    return highWater
  }

  private async inspectMessage(
    group: YzjGroup,
    message: YzjMessage,
    fallbackContext: readonly YzjMessage[],
  ): Promise<void> {
    if (this.state.seen(message.msgId)) return
    if (message.fromOpenId === this.requireIdentity().openId && !hasLeadingAgentAlias(message, this.config.aliases)) return
    if (!this.senderAllowed(message.fromOpenId)) return
    if (!isAgentTrigger(message, this.config.aliases, this.config.acceptAccountMentions)) return
    const lookup = (groupId: string, msgId: string): string | undefined => (
      this.state.topicForMessage(groupId, msgId)
    )
    let topicRootId = resolveTopicRootId(group, message, fallbackContext, lookup)
    let context = await this.client.contextFor(
      group, message, this.config.contextMessages, topicRootId, lookup,
    )
    const canonicalRootId = resolveTopicRootId(group, message, context, lookup)
    if (canonicalRootId !== topicRootId) {
      topicRootId = canonicalRootId
      context = await this.client.contextFor(
        group, message, this.config.contextMessages, topicRootId, lookup,
      )
    }
    if (context.length === 0) {
      context = fallbackContext
        .filter(candidate => resolveTopicRootId(group, candidate, fallbackContext, lookup) === topicRootId)
        .slice(-this.config.contextMessages)
    }
    const route = topicRouteFor(this.requireIdentity(), group, message, context, topicRootId)
    for (const candidate of context) {
      if (resolveTopicRootId(group, candidate, context, lookup) === topicRootId) {
        this.state.recordMessageTopic(group.groupId, candidate.msgId, topicRootId)
      }
    }
    this.state.recordMessageTopic(group.groupId, message.msgId, topicRootId)
    const task = stripTriggerAliases(message.content, this.config.aliases) || message.content.trim()
    const prompt = `${renderChatContext(group, context, message, route)}\n\n[用户任务]\n${task}`
    const trigger: YzjTrigger = { group, message, context, prompt, route }
    if (!this.state.admit(trigger)) return
    try {
      await this.state.save()
    } catch (error) {
      this.state.forget(message.msgId)
      throw error
    }
    this.enqueue(trigger, route)
  }

  private requireIdentity(): YzjIdentity {
    if (this.identity === undefined) throw new Error('Yunzhijia Agent poller has no pinned identity')
    return this.identity
  }

  private routeFor(trigger: YzjTrigger): YzjTopicRoute {
    return trigger.route ?? topicRouteFor(
      this.requireIdentity(), trigger.group, trigger.message, trigger.context,
    )
  }

  private enqueue(trigger: YzjTrigger, route: YzjTopicRoute): void {
    const queueKey = route.topicKey
    const previous = this.queues.get(queueKey) ?? Promise.resolve()
    const queued = previous
      .catch(() => undefined)
      .then(() => this.abandonQueued ? undefined : this.execute(trigger, route))
      .catch(error => this.onError(error))
      .finally(() => {
        if (this.queues.get(queueKey) === queued) this.queues.delete(queueKey)
      })
    this.queues.set(queueKey, queued)
  }

  private async execute(trigger: YzjTrigger, route: YzjTopicRoute): Promise<void> {
    try {
      if (route.accountKey !== accountKeyFor(this.requireIdentity())) {
        throw new Error('Yunzhijia login account changed after this Agent task was admitted')
      }
      if (!await this.runWithSlot(trigger, route)) return
    } catch (error) {
      this.onError(error)
      if (error instanceof YzjDeliveryOutcomeUnknownError
        || error instanceof YzjTaskLeaseRevokedError) return
      try {
        await this.runner.reportFailure(trigger, error, route)
      } catch (reportError) {
        this.onError(reportError)
        return
      }
    }
    this.state.complete(trigger.message.msgId)
    try {
      await this.state.save()
    } catch (error) {
      this.onError(error)
    }
  }

  private async runWithSlot(trigger: YzjTrigger, route: YzjTopicRoute): Promise<boolean> {
    await this.acquireTaskSlot()
    try {
      if (this.abandonQueued) return false
      await this.client.assertPinnedIdentity?.()
      await this.runner.run(trigger, route)
      return true
    } finally {
      this.releaseTaskSlot()
    }
  }

  private async acquireTaskSlot(): Promise<void> {
    if (this.activeTasks < this.config.maxConcurrentTasks) {
      this.activeTasks += 1
      return
    }
    await new Promise<void>(resolve => this.taskWaiters.push(resolve))
  }

  private releaseTaskSlot(): void {
    const next = this.taskWaiters.shift()
    if (next === undefined) this.activeTasks -= 1
    else next()
  }
}
