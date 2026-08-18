import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { YzjGatewayClient } from '../src/client.ts'
import type { YzjAgentRunner } from '../src/agent-runner.ts'
import { YzjDeliveryOutcomeUnknownError } from '../src/errors.ts'
import { YzjAgentPoller } from '../src/poller.ts'
import { GatewayState } from '../src/state.ts'
import type { YzjGroup, YzjMessage, YzjTrigger } from '../src/types.ts'

function message(overrides: Partial<YzjMessage> = {}): YzjMessage {
  return {
    content: '@agent 总结最近讨论',
    fromOpenId: 'user-1',
    msgId: 'msg-1',
    msgType: 'text',
    sendTime: '2099-01-01 00:00:00.000',
    param: {},
    ...overrides,
  }
}

function group(lastMsg: YzjMessage): YzjGroup {
  return {
    groupId: 'group-1',
    groupName: '研发群',
    groupType: 2,
    lastMsgId: lastMsg.msgId,
    lastMsgSendTime: lastMsg.sendTime,
    lastMsg,
  }
}

describe('YzjAgentPoller', () => {
  it('admits one fresh mention, captures context, and deduplicates later polls', async () => {
    const triggerMessage = message()
    const laterMessage = message({ msgId: 'later', content: '随后的一条普通消息' })
    const currentGroup = group(laterMessage)
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [currentGroup],
      messages: async () => [
        message({ msgId: 'before', content: '背景消息' }), triggerMessage, laterMessage,
      ],
      contextFor: async () => [triggerMessage],
    } as unknown as YzjGatewayClient
    const runs: YzjTrigger[] = []
    const runner = {
      run: async (trigger: YzjTrigger) => { runs.push(trigger) },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-poller-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    const errors: unknown[] = []
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'],
      acceptAccountMentions: true,
      groupPages: 1,
      contextMessages: 20, discoveryPages: 10,
      pollIntervalMs: 5_000,
      maxConcurrentTasks: 2,
      allowedGroupIds: new Set(),
      allowedSenderOpenIds: new Set(),
    }, error => errors.push(error))

    await poller.poll()
    await poller.poll()
    await poller.stop()

    expect(errors).toEqual([])
    expect(runs).toHaveLength(1)
    expect(runs[0]?.prompt).toContain('[用户任务]\n总结最近讨论')
    expect(runs[0]?.context.map(item => item.msgId)).toEqual(['msg-1'])
    expect(runs[0]?.route).toMatchObject({
      accountOpenId: 'agent-self',
      topicRootId: 'msg-1',
      conversationKind: 'group',
    })
  })

  it('continues truncated first-seen discovery without losing an older command', async () => {
    const command = message({ msgId: 'command', content: '@agent 执行较早命令' })
    const later = message({ msgId: 'later', content: '后续普通消息' })
    const anchors: (string | undefined)[] = []
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [group(later)],
      messagesSince: async (_groupId: string, _cutoff: number, _pages: number, anchor?: string) => {
        anchors.push(anchor)
        return anchor === undefined
          ? { messages: [later], truncated: true, nextAnchor: later.msgId }
          : { messages: [command], truncated: false }
      },
      contextFor: async () => [command],
    } as unknown as YzjGatewayClient
    const runs: YzjTrigger[] = []
    const runner = {
      run: async (trigger: YzjTrigger) => { runs.push(trigger) },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-discovery-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: false,
      groupPages: 1, contextMessages: 20, discoveryPages: 1,
      pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, error => { throw error })

    await poller.poll()
    expect(state.cursor('group-1')).toBeUndefined()
    await poller.poll()
    await poller.stop()

    expect(anchors).toEqual([undefined, 'later'])
    expect(runs.map(run => run.message.msgId)).toEqual(['command'])
    expect(state.cursor('group-1')).toBe('later')
  })

  it('inspects a high-water preview missing from first-seen history', async () => {
    const command = message({ msgId: 'preview-command', content: '@agent 预览中的命令' })
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [group(command)],
      messagesSince: async () => ({ messages: [], truncated: false }),
      contextFor: async () => [command],
    } as unknown as YzjGatewayClient
    const runs: YzjTrigger[] = []
    const runner = {
      run: async (trigger: YzjTrigger) => { runs.push(trigger) },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-high-water-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: false,
      groupPages: 1, contextMessages: 20, discoveryPages: 1,
      pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, error => { throw error })

    await poller.poll()
    await poller.stop()

    expect(runs.map(run => run.message.msgId)).toEqual(['preview-command'])
    expect(state.cursor('group-1')).toBe('preview-command')
  })

  it('does not send a contradictory failure after an unknown reply outcome', async () => {
    const command = message({ msgId: 'uncertain-delivery' })
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [group(command)],
      messages: async () => [command],
      contextFor: async () => [command],
    } as unknown as YzjGatewayClient
    const reportFailure = vi.fn(async () => undefined)
    const runner = {
      run: async () => { throw new YzjDeliveryOutcomeUnknownError(new Error('timeout')) },
      reportFailure,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-uncertain-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: false,
      groupPages: 1, contextMessages: 20, discoveryPages: 1,
      pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, () => undefined)

    await poller.poll()
    await poller.stop()

    expect(reportFailure).not.toHaveBeenCalled()
    expect(state.pendingTasks().map(task => task.message.msgId)).toEqual(['uncertain-delivery'])
  })

  it('does not loop on gateway replies sent by the logged-in account', async () => {
    const selfMessage = message({
      fromOpenId: 'agent-self',
      content: '【Agent完成】\n已处理完成，结果中未再次触发命令。',
    })
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [group(selfMessage)],
      messages: async () => [selfMessage],
    } as unknown as YzjGatewayClient
    let runCount = 0
    const runner = {
      run: async () => { runCount += 1 },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-poller-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: true,
      groupPages: 1, contextMessages: 20, discoveryPages: 10, pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, () => undefined)

    await poller.poll()
    await poller.stop()
    expect(runCount).toBe(0)
  })

  it('accepts an explicit leading command from the logged-in account', async () => {
    const selfCommand = message({ fromOpenId: 'agent-self', content: '@agent 他说的啥' })
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [group(selfCommand)],
      messages: async () => [selfCommand],
      contextFor: async () => [selfCommand],
    } as unknown as YzjGatewayClient
    const runs: YzjTrigger[] = []
    const runner = {
      run: async (trigger: YzjTrigger) => { runs.push(trigger) },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-poller-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    state.selectAccount({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' })
    state.setCursor('group-1', selfCommand.msgId)
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: true,
      groupPages: 1, contextMessages: 20, discoveryPages: 10, pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, () => undefined)

    await poller.poll()
    await poller.stop()

    expect(runs).toHaveLength(1)
    expect(runs[0]?.prompt).toContain('[用户任务]\n他说的啥')
  })

  it('ignores a structured account mention without an agent alias by default', async () => {
    const accountMention = message({
      content: '我还没下载尝试，官网里面说可以',
      fromOpenId: 'user-2',
      param: { notifyType: 1, replyMsgId: 'question-1', replySummary: '这种 desktop 能 runtime 修改 UI 吗' },
    })
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [group(accountMention)],
      messages: async () => [accountMention],
    } as unknown as YzjGatewayClient
    let runCount = 0
    const runner = {
      run: async () => { runCount += 1 },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-poller-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: false,
      groupPages: 1, contextMessages: 20, discoveryPages: 10, pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, () => undefined)

    await poller.poll()
    await poller.stop()

    expect(runCount).toBe(0)
    expect(state.seen(accountMention.msgId)).toBe(false)
  })
})
