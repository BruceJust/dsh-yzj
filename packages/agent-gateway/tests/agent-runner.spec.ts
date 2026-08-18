import { describe, expect, it, vi } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { YzjGatewayClient } from '../src/client.ts'
import type { YzjAgentFactory } from '../src/agent-factory.ts'
import { YzjDeliveryOutcomeUnknownError } from '../src/errors.ts'
import { YzjAgentRunner } from '../src/agent-runner.ts'
import { topicRouteFor } from '../src/protocol.ts'
import type { GatewayState } from '../src/state.ts'
import type { YzjTrigger } from '../src/types.ts'

function trigger(): YzjTrigger {
  const message = {
    content: '@agent 完成任务',
    fromOpenId: 'user-1',
    msgId: 'msg-1',
    msgType: 'text',
    sendTime: '2099-01-01 00:00:00.000',
    param: {},
  }
  return {
    group: {
      groupId: 'group-1', groupName: '研发群', groupType: 2, lastMsgId: message.msgId,
      lastMsgSendTime: message.sendTime, lastMsg: message,
    },
    message,
    context: [message],
    prompt: '[用户任务]\n完成任务',
  }
}

function gatewayState(): GatewayState {
  return {
    recordMessageTopic: () => undefined,
    revoke: () => undefined,
    save: async () => undefined,
  } as unknown as GatewayState
}

function completedAgent(): AgentHandle {
  const events: SessionEvent[] = [
    { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
  ] as SessionEvent[]
  return {
    session: { events, get seq() { return events.length } },
    followup: async () => {
      events.push({
        seq: 1, time: 2, type: 'assistant/message',
        data: {
          turn: 1, step: 1,
          message: {
            id: 'answer-1', role: 'assistant',
            source: { kind: 'model', provider: 'test', model: 'test' },
            content: [{ type: 'text', text: '任务执行完成' }],
          },
        },
      } as SessionEvent)
      events.push({
        seq: 2, time: 3, type: 'turn/end',
        data: { turn: 1, reason: { kind: 'completed' } },
      } as SessionEvent)
    },
    whenIdle: async () => undefined,
    cancel: () => undefined,
  } as unknown as AgentHandle
}

describe('YzjAgentRunner', () => {
  it('replies with acknowledgement and the completed Agent result', async () => {
    const replies: string[] = []
    const client = {
      reply: async (_groupId: string, _messageId: string, content: string) => {
        replies.push(content)
        return `reply-${String(replies.length)}`
      },
    } as unknown as YzjGatewayClient
    const factory = {
      ensure: async () => completedAgent(),
      activate: () => undefined,
      deactivate: () => undefined,
    } as unknown as YzjAgentFactory
    const recordMessageTopic = vi.fn()
    const state = {
      recordMessageTopic,
      save: async () => undefined,
    } as unknown as GatewayState
    const runner = new YzjAgentRunner(client, factory, state, {
      taskTimeoutMs: 5_000,
      maxReplyChars: 3_500,
    })

    const task = trigger()
    await runner.run(task, topicRouteFor(
      { orgId: 'org-1', openId: 'agent-self' }, task.group, task.message, task.context,
    ))

    expect(replies).toHaveLength(2)
    expect(replies[0]).toContain('已接收，正在处理')
    expect(replies[1]).toBe('【Agent完成】\n任务执行完成')
    expect(recordMessageTopic).toHaveBeenCalledTimes(2)
    expect(recordMessageTopic).toHaveBeenNthCalledWith(1, 'group-1', 'reply-1', 'msg-1')
    expect(recordMessageTopic).toHaveBeenNthCalledWith(2, 'group-1', 'reply-2', 'msg-1')
  })

  it('redelivers a persisted task result without executing the task again', async () => {
    const task = trigger()
    const events = [
      {
        seq: 0, time: 1, type: 'user/message',
        data: {
          role: 'user', content: [],
          source: { kind: 'yzj-agent', messageId: task.message.msgId },
        },
      },
      {
        seq: 1, time: 2, type: 'assistant/message',
        data: {
          turn: 1, step: 1,
          message: {
            id: 'answer-old', role: 'assistant',
            source: { kind: 'model', provider: 'test', model: 'test' },
            content: [{ type: 'text', text: '此前已经完成' }],
          },
        },
      },
      { seq: 2, time: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    const followup = vi.fn()
    const agent = {
      session: { events, get seq() { return events.length } },
      followup,
      whenIdle: async () => undefined,
      cancel: () => undefined,
    }
    const replies: string[] = []
    const client = {
      reply: async (_groupId: string, _messageId: string, content: string) => {
        replies.push(content)
        return 'redelivered'
      },
    } as unknown as YzjGatewayClient
    const factory = {
      ensure: async () => agent,
      activate: vi.fn(),
      deactivate: vi.fn(),
    } as unknown as YzjAgentFactory
    const runner = new YzjAgentRunner(client, factory, gatewayState(), {
      taskTimeoutMs: 5_000, maxReplyChars: 3_500,
    })

    await runner.run(task, topicRouteFor(
      { orgId: 'org-1', openId: 'agent-self' }, task.group, task.message, task.context,
    ))

    expect(replies).toEqual(['【Agent完成】\n此前已经完成'])
    expect(followup).not.toHaveBeenCalled()
  })

  it('does not fail a delivered reply when topic-mapping persistence fails', async () => {
    const client = {
      reply: async () => 'reply-delivered',
    } as unknown as YzjGatewayClient
    const factory = {
      ensure: async () => completedAgent(), activate: () => undefined, deactivate: () => undefined,
    } as unknown as YzjAgentFactory
    const state = {
      recordMessageTopic: () => undefined,
      save: async () => { throw new Error('disk full') },
    } as unknown as GatewayState
    const runner = new YzjAgentRunner(client, factory, state, {
      taskTimeoutMs: 5_000, maxReplyChars: 3_500,
    })
    const task = trigger()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(runner.run(task, topicRouteFor(
        { orgId: 'org-1', openId: 'agent-self' }, task.group, task.message, task.context,
      ))).resolves.toBeUndefined()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('classifies a reply that crosses the deadline as delivery-unknown', async () => {
    const never = new Promise<string | undefined>(() => undefined)
    let replies = 0
    const client = {
      reply: async () => {
        replies += 1
        return replies === 1 ? 'ack' : never
      },
    } as unknown as YzjGatewayClient
    const factory = {
      ensure: async () => completedAgent(),
      activate: () => undefined,
      assertActive: () => undefined,
      deactivate: () => undefined,
    } as unknown as YzjAgentFactory
    const runner = new YzjAgentRunner(client, factory, gatewayState(), {
      taskTimeoutMs: 5, maxReplyChars: 200,
    })
    const task = trigger()

    await expect(runner.run(task, topicRouteFor(
      { orgId: 'org-1', openId: 'agent-self' }, task.group, task.message, task.context,
    ))).rejects.toBeInstanceOf(YzjDeliveryOutcomeUnknownError)
  })

  it('times out while Agent creation is still pending', async () => {
    const factory = {
      ensure: async () => new Promise<never>(() => undefined),
    } as unknown as YzjAgentFactory
    const runner = new YzjAgentRunner({} as YzjGatewayClient, factory, gatewayState(), {
      taskTimeoutMs: 5, maxReplyChars: 200,
    })
    const task = trigger()

    await expect(runner.run(task, topicRouteFor(
      { orgId: 'org-1', openId: 'agent-self' }, task.group, task.message, task.context,
    ))).rejects.toThrow('timed out')
  })

  it('does not hang when a timed-out Agent never becomes idle after cancellation', async () => {
    let idleCalls = 0
    const never = new Promise<void>(() => undefined)
    const cancel = vi.fn()
    const agent = {
      session: { events: [], seq: 0 },
      followup: () => undefined,
      whenIdle: () => {
        idleCalls += 1
        return idleCalls === 1 ? Promise.resolve() : never
      },
      cancel,
    }
    const forceDispose = vi.fn(async () => undefined)
    const factory = {
      ensure: async () => agent, activate: () => undefined, deactivate: () => undefined,
      forceDispose,
    } as unknown as YzjAgentFactory
    const client = { reply: async () => undefined } as unknown as YzjGatewayClient
    const revoke = vi.fn()
    const state = {
      recordMessageTopic: () => undefined,
      revoke,
      save: async () => undefined,
    } as unknown as GatewayState
    const runner = new YzjAgentRunner(client, factory, state, {
      taskTimeoutMs: 5, maxReplyChars: 200,
    })
    const task = trigger()

    await expect(runner.run(task, topicRouteFor(
      { orgId: 'org-1', openId: 'agent-self' }, task.group, task.message, task.context,
    ))).rejects.toThrow('timed out')
    expect(cancel).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith(task.message.msgId)
    expect(forceDispose).toHaveBeenCalledWith(agent)
  })

  it('reports a bounded failure to the source message', async () => {
    const replies: string[] = []
    const client = {
      reply: async (_groupId: string, _messageId: string, content: string) => {
        replies.push(content)
      },
    } as unknown as YzjGatewayClient
    const runner = new YzjAgentRunner(client, {} as YzjAgentFactory, gatewayState(), {
      taskTimeoutMs: 5_000,
      maxReplyChars: 200,
    })

    await runner.reportFailure(trigger(), new Error('model unavailable'))

    expect(replies).toEqual(['【Agent失败】\nmodel unavailable'])
  })
})
