import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { YzjAgentFactory } from '../src/agent-factory.ts'
import type { YzjGatewayClient } from '../src/client.ts'
import type { GatewayState } from '../src/state.ts'

describe('YzjAgentFactory lifecycle', () => {
  it('disposes every AgentHandle owned by the gateway', async () => {
    const factory = new YzjAgentFactory({} as Context, {} as YzjGatewayClient, {} as GatewayState, {
      cwd: '/workspace',
      preset: 'standard',
      maxProgressReplies: 5,
      maxReplyChars: 3_500, agentIdleMs: 0,
    })
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)
    const handles = (factory as unknown as { handles: Map<string, AgentHandle> }).handles
    handles.set('session-1', { dispose: first } as unknown as AgentHandle)
    handles.set('session-2', { dispose: second } as unknown as AgentHandle)

    await factory.dispose()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(handles.size).toBe(0)
  })

  it('revokes active task authority in gateway state before shutdown cancellation', async () => {
    const revoke = vi.fn()
    const save = vi.fn(async () => undefined)
    const cancel = vi.fn()
    const agent = { session: { id: 'session-active' }, cancel } as unknown as Agent
    const state = { revoke, save } as unknown as GatewayState
    const factory = new YzjAgentFactory({} as Context, {} as YzjGatewayClient, state, {
      cwd: '/workspace', preset: 'standard', maxProgressReplies: 5,
      maxReplyChars: 3_500, agentIdleMs: 0,
    })
    const activeRuns = (factory as unknown as {
      activeRuns: Map<Agent, { trigger: { message: { msgId: string } } }>
    }).activeRuns
    activeRuns.set(agent, { trigger: { message: { msgId: 'task-active' } } })

    await factory.dispose()

    expect(revoke).toHaveBeenCalledWith('task-active')
    expect(save).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith({ kind: 'disposed' })
  })

  it('waits for an in-flight creation and disposes its eventual handle', async () => {
    const factory = new YzjAgentFactory({} as Context, {} as YzjGatewayClient, {} as GatewayState, {
      cwd: '/workspace', preset: 'standard', maxProgressReplies: 5, maxReplyChars: 3_500, agentIdleMs: 0,
    })
    const disposeHandle = vi.fn(async () => undefined)
    const internals = factory as unknown as {
      handles: Map<string, AgentHandle>
      creations: Map<string, Promise<Agent>>
    }
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve }).then(() => {
      internals.handles.set('session-pending', { dispose: disposeHandle } as unknown as AgentHandle)
      return {} as Agent
    })
    internals.creations.set('session-pending', pending)

    const disposal = factory.dispose()
    await Promise.resolve()
    expect(disposeHandle).not.toHaveBeenCalled()
    release()
    await disposal

    expect(disposeHandle).toHaveBeenCalledOnce()
    await expect(factory.ensure('session-late', 'Late topic')).rejects.toThrow('factory is disposed')
  })

  it('bounds teardown when an in-flight creation never settles', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const factory = new YzjAgentFactory({} as Context, {} as YzjGatewayClient, {} as GatewayState, {
        cwd: '/workspace', preset: 'standard', maxProgressReplies: 5,
        maxReplyChars: 3_500, agentIdleMs: 0,
      })
      const creations = (factory as unknown as {
        creations: Map<string, Promise<Agent>>
      }).creations
      creations.set('never', new Promise<Agent>(() => undefined))

      const disposal = factory.dispose()
      await vi.advanceTimersByTimeAsync(30_000)
      await expect(disposal).resolves.toBeUndefined()

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('timed out during creation/release'),
      )
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('attaches Sessions and updates only Gateway-managed titles', async () => {
    let currentTitle: { title: string } | undefined
    let managedTitle: string | undefined
    const rename = vi.fn((_session: unknown, title: string) => {
      currentTitle = { title: title.slice(0, 10) }
      return currentTitle
    })
    const attachSession = vi.fn(async () => undefined)
    const state = {
      managedTitle: () => managedTitle,
      setManagedTitle: (_sessionId: string, title: string) => { managedTitle = title },
      save: async () => undefined,
    } as unknown as GatewayState
    const ctx = {
      sessionTitle: { get: () => currentTitle, rename },
    } as unknown as Context
    const factory = new YzjAgentFactory(ctx, {} as YzjGatewayClient, state, {
      cwd: '/workspace', preset: 'standard', maxProgressReplies: 5, maxReplyChars: 3_500, agentIdleMs: 0,
    })
    factory.setWorkspace({ attachSession } as never)
    const agent = { session: { id: 'session-1', header: { cwd: '/workspace' } } } as unknown as Agent
    const metadata = factory as unknown as {
      ensureMetadata(agent: Agent, title: string): Promise<void>
    }

    await metadata.ensureMetadata(agent, '群 · 研发群 · 话题一')
    await metadata.ensureMetadata(agent, '群 · 研发群 · 话题二')
    currentTitle = { title: '用户手工标题' }
    await metadata.ensureMetadata(agent, '群 · 研发群 · 话题三')

    expect(attachSession).toHaveBeenCalledTimes(3)
    expect(rename).toHaveBeenCalledTimes(2)
    expect(rename).toHaveBeenLastCalledWith(agent.session, '群 · 研发群 · 话题二')
    expect(managedTitle).toBe('群 · 研发群 · 话题二'.slice(0, 10))
  })

  it('releases an owned AgentHandle after the topic becomes idle', async () => {
    vi.useFakeTimers()
    try {
      const disposeHandle = vi.fn(async () => undefined)
      const agent = { session: { id: 'session-idle' } } as unknown as Agent
      const ctx = { agents: { get: () => undefined } } as unknown as Context
      const factory = new YzjAgentFactory(ctx, {} as YzjGatewayClient, {} as GatewayState, {
        cwd: '/workspace', preset: 'standard', maxProgressReplies: 5,
        maxReplyChars: 3_500, agentIdleMs: 5,
      })
      const internals = factory as unknown as {
        handles: Map<string, AgentHandle>
        scheduleIdle(agent: Agent): void
      }
      internals.handles.set(agent.session.id, { agent, dispose: disposeHandle })

      internals.scheduleIdle(agent)
      await vi.advanceTimersByTimeAsync(5)

      expect(disposeHandle).toHaveBeenCalledOnce()
      expect(internals.handles.has(agent.session.id)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('force-disposes only the owned handle for a timed-out Agent', async () => {
    const disposeHandle = vi.fn(async () => undefined)
    const agent = { session: { id: 'session-timeout' } } as unknown as Agent
    const factory = new YzjAgentFactory({} as Context, {} as YzjGatewayClient, {} as GatewayState, {
      cwd: '/workspace', preset: 'standard', maxProgressReplies: 5,
      maxReplyChars: 3_500, agentIdleMs: 0,
    })
    const handles = (factory as unknown as { handles: Map<string, AgentHandle> }).handles
    handles.set(agent.session.id, { agent, dispose: disposeHandle })

    await factory.forceDispose(agent)

    expect(disposeHandle).toHaveBeenCalledOnce()
    expect(handles.has(agent.session.id)).toBe(false)
  })

  it('quarantines a Session when forced disposal does not settle', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const agent = { session: { id: 'session-stuck' } } as unknown as Agent
      const factory = new YzjAgentFactory({} as Context, {} as YzjGatewayClient, {} as GatewayState, {
        cwd: '/workspace', preset: 'standard', maxProgressReplies: 5,
        maxReplyChars: 3_500, agentIdleMs: 0,
      })
      const handles = (factory as unknown as { handles: Map<string, AgentHandle> }).handles
      handles.set(agent.session.id, {
        agent, dispose: async () => new Promise<void>(() => undefined),
      })

      const forcing = factory.forceDispose(agent)
      await vi.advanceTimersByTimeAsync(30_000)
      await forcing

      expect(handles.has(agent.session.id)).toBe(true)
      await expect(factory.ensure(agent.session.id, 'Topic')).rejects.toThrow('quarantined')
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('indexes progress reply IDs to the active topic', async () => {
    const recordMessageTopic = vi.fn()
    const state = {
      recordMessageTopic,
      save: async () => undefined,
    } as unknown as GatewayState
    const client = {
      reply: async () => 'progress-reply-1',
    } as unknown as YzjGatewayClient
    const factory = new YzjAgentFactory({} as Context, client, state, {
      cwd: '/workspace', preset: 'standard', maxProgressReplies: 5, maxReplyChars: 3_500, agentIdleMs: 0,
    })
    const agent = {} as Agent
    const message = {
      msgId: 'task-1', content: '@agent 执行', fromOpenId: 'user-1', msgType: 'text',
      sendTime: '2099-01-01 00:00:00.000', param: {},
    }
    const group = {
      groupId: 'group-1', groupName: '研发群', groupType: 2,
      lastMsgId: message.msgId, lastMsgSendTime: message.sendTime, lastMsg: message,
    }
    const route = {
      accountKey: 'account-key', accountOrgId: 'org-1', accountOpenId: 'agent-self',
      conversationKind: 'group' as const, channelKey: 'channel-key', topicRootId: 'root-1',
      topicKey: 'topic-key', sessionId: 'session-1', title: '话题',
    }
    factory.activate(agent, { group, message, context: [message], prompt: '执行', route }, route)

    const result = await (factory as unknown as {
      sendProgress(agent: Agent, message: string): Promise<{ sent: boolean }>
    }).sendProgress(agent, '完成第一步')

    expect(result.sent).toBe(true)
    expect(recordMessageTopic).toHaveBeenCalledWith('group-1', 'progress-reply-1', 'root-1')
  })
})
