import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { clipMessage, finalReply } from './agent-support.ts'
import { YzjDeliveryOutcomeUnknownError, YzjTaskLeaseRevokedError } from './errors.ts'
import type { YzjAgentFactory } from './agent-factory.ts'
import type { YzjGatewayClient } from './client.ts'
import { summarizeGatewayTask, summarizeTurn } from './protocol.ts'
import type { GatewayState } from './state.ts'
import type { YzjTopicRoute, YzjTrigger } from './types.ts'

export interface AgentRunnerConfig {
  readonly taskTimeoutMs: number
  readonly maxReplyChars: number
}

export class YzjAgentRunner {
  constructor(
    private readonly client: YzjGatewayClient,
    private readonly factory: YzjAgentFactory,
    private readonly state: GatewayState,
    private readonly config: AgentRunnerConfig,
  ) {}

  async run(trigger: YzjTrigger, route: YzjTopicRoute): Promise<void> {
    let agent: Agent | undefined
    let activated = false
    let expired = false
    let cancelIssued = false
    let deliveryInFlight = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        expired = true
        if (activated && agent !== undefined) {
          cancelIssued = true
          this.revokeAuthority(trigger.message.msgId)
          agent.cancel({ kind: 'hook', reason: 'Yunzhijia Agent task timeout' })
        }
        reject(new Error('Yunzhijia Agent task timed out'))
      }, this.config.taskTimeoutMs)
    })
    const withinDeadline = <T>(operation: PromiseLike<T>): Promise<T> => (
      Promise.race([Promise.resolve(operation), timedOut])
    )
    try {
      const ensuring = this.factory.ensure(route)
      void ensuring.then((lateAgent) => {
        if (expired) this.factory.deactivate(lateAgent)
      }, () => undefined)
      agent = await withinDeadline(ensuring)
      const activeAgent = agent
      await withinDeadline(activeAgent.whenIdle())
      this.factory.activate(activeAgent, trigger, route)
      activated = true
      const deliver = async (content: string): Promise<void> => {
        deliveryInFlight = true
        await withinDeadline(this.reply(trigger, route, content, activeAgent))
        deliveryInFlight = false
      }
      try {
        const previous = summarizeGatewayTask(activeAgent.session.events, trigger.message.msgId)
        if (previous !== undefined) {
          const content = previous.reason === undefined
            ? '【Agent失败】\n任务上次执行未形成终态；为避免重复写入，本次没有自动重跑。'
            : finalReply(previous.text, previous.reason, this.config.maxReplyChars)
          await deliver(content)
          return
        }
        await deliver('【Agent】已接收，正在处理。')
        const firstSeq = activeAgent.session.seq
        activeAgent.followup(createUserMessage({
          content: [{ type: 'text', text: trigger.prompt }],
          source: {
            kind: 'yzj-agent',
            groupId: trigger.group.groupId,
            messageId: trigger.message.msgId,
            senderOpenId: trigger.message.fromOpenId,
            accountKey: route.accountKey,
            accountOrgId: route.accountOrgId,
            accountOpenId: route.accountOpenId,
            conversationKind: route.conversationKind,
            groupName: route.groupName,
            channelKey: route.channelKey,
            topicRootId: route.topicRootId,
            topicKey: route.topicKey,
            topicLabel: route.topicLabel,
            managedTitle: route.title,
            writeMode: 'standard',
          },
        }))
        await withinDeadline(activeAgent.whenIdle())
        const outcome = summarizeTurn(activeAgent.session.events, firstSeq)
        await deliver(finalReply(outcome.text, outcome.reason, this.config.maxReplyChars))
      } finally {
        activated = false
        this.factory.deactivate(activeAgent, !expired)
      }
    } catch (error) {
      if (expired && agent !== undefined) {
        if (activated) {
          cancelIssued = true
          agent.cancel({ kind: 'hook', reason: 'Yunzhijia Agent task timeout' })
        }
        this.factory.deactivate(agent, false)
        if (cancelIssued && !await this.waitForCancellation(agent)) {
          await this.factory.forceDispose(agent)
        }
      }
      if (error instanceof YzjTaskLeaseRevokedError) throw error
      if (deliveryInFlight) throw new YzjDeliveryOutcomeUnknownError(error)
      throw error
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  private revokeAuthority(messageId: string): void {
    try {
      this.state.revoke(messageId)
      void this.state.save().catch((error: unknown) => {
        console.error('[yzj-agent-gateway] failed to persist timed-out task revocation', error)
      })
    } catch (error) {
      console.error('[yzj-agent-gateway] failed to record timed-out task revocation', error)
    }
  }

  private async waitForCancellation(agent: Agent): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        agent.whenIdle().then(() => true, () => false),
        new Promise<false>(resolve => {
          timeout = setTimeout(() => resolve(false), Math.min(30_000, this.config.taskTimeoutMs))
        }),
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  async reportFailure(trigger: YzjTrigger, error: unknown, route?: YzjTopicRoute): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error)
    const content = clipMessage(`【Agent失败】\n${detail}`, this.config.maxReplyChars)
    const resolvedRoute = route ?? trigger.route
    if (resolvedRoute === undefined) {
      await this.client.reply(trigger.group.groupId, trigger.message.msgId, content)
      return
    }
    await this.reply(trigger, resolvedRoute, content)
  }

  private async reply(
    trigger: YzjTrigger,
    route: YzjTopicRoute,
    content: string,
    agent?: Agent,
  ): Promise<void> {
    const replyId = await this.client.reply(
      trigger.group.groupId,
      trigger.message.msgId,
      content,
      agent === undefined
        ? undefined
        : () => this.factory.assertActive(agent, trigger.message.msgId),
    )
    if (replyId === undefined) return
    this.state.recordMessageTopic(trigger.group.groupId, replyId, route.topicRootId)
    try {
      await this.state.save()
    } catch (error) {
      console.error('[yzj-agent-gateway] failed to persist reply topic mapping', error)
    }
  }
}
