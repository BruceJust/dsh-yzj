import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { YzjGatewayClient } from '../src/client.ts'
import type { YzjAgentRunner } from '../src/agent-runner.ts'
import { topicRouteFor } from '../src/protocol.ts'
import { YzjAgentPoller, type PollerConfig } from '../src/poller.ts'
import { GatewayState } from '../src/state.ts'
import type { YzjGroup, YzjMessage } from '../src/types.ts'

const CONFIG: PollerConfig = {
  aliases: ['@agent'],
  acceptAccountMentions: true,
  groupPages: 1,
  contextMessages: 20,
  discoveryPages: 10,
  pollIntervalMs: 5_000,
  maxConcurrentTasks: 2,
  allowedGroupIds: new Set(),
  allowedSenderOpenIds: new Set(),
}

function triggerMessage(): YzjMessage {
  return {
    content: '@agent 执行任务',
    fromOpenId: 'user-1',
    msgId: 'msg-1',
    msgType: 'text',
    sendTime: '2099-01-01 00:00:00.000',
    param: {},
  }
}

function currentGroup(message: YzjMessage, includePreview = true): YzjGroup {
  return {
    groupId: 'group-1',
    groupName: '研发群',
    groupType: 2,
    lastMsgId: message.msgId,
    lastMsgSendTime: message.sendTime,
    ...(includePreview ? { lastMsg: message } : {}),
  }
}

async function state(): Promise<GatewayState> {
  const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-recovery-'))
  const result = new GatewayState(join(directory, 'state.json'))
  await result.load()
  result.selectAccount({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' })
  return result
}

describe('YzjAgentPoller recovery edges', () => {
  it('fetches a fresh first-seen trigger when the group preview is absent', async () => {
    const message = triggerMessage()
    let runCount = 0
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [currentGroup(message, false)],
      messages: async () => [message],
      contextFor: async () => [message],
    } as unknown as YzjGatewayClient
    const runner = {
      run: async () => { runCount += 1 },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const poller = new YzjAgentPoller(client, await state(), runner, CONFIG, () => undefined)

    await poller.poll()
    await poller.stop()

    expect(runCount).toBe(1)
  })

  it('keeps the old cursor when an incremental fetch is empty', async () => {
    const message = triggerMessage()
    const gatewayState = await state()
    gatewayState.setCursor('group-1', 'msg-old')
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [currentGroup(message)],
      messages: async () => [],
    } as unknown as YzjGatewayClient
    const runner = {
      run: async () => undefined,
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const poller = new YzjAgentPoller(client, gatewayState, runner, CONFIG, () => undefined)

    await poller.poll()
    await poller.stop()

    expect(gatewayState.cursor('group-1')).toBe('msg-old')
  })

  it('replays a durable pending task after restart', async () => {
    const message = triggerMessage()
    const fileState = await state()
    const group = currentGroup(message)
    fileState.admit({
      group,
      message,
      context: [message],
      prompt: '[用户任务]\n执行任务',
      route: topicRouteFor(
        { orgId: 'org-1', openId: 'agent-self' }, group, message, [message],
      ),
    })
    await fileState.save()
    let runCount = 0
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [],
    } as unknown as YzjGatewayClient
    const runner = {
      run: async () => { runCount += 1 },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const poller = new YzjAgentPoller(client, fileState, runner, CONFIG, () => undefined)

    await poller.poll()
    await poller.stop()

    expect(runCount).toBe(1)
    expect(fileState.pendingTasks()).toEqual([])
  })

  it('rejects a login account change between polls', async () => {
    let identityCalls = 0
    const client = {
      identity: async () => {
        identityCalls += 1
        return identityCalls === 1
          ? { orgId: 'org-1', openId: 'agent-self', name: 'Agent' }
          : { orgId: 'org-2', openId: 'other-account', name: 'Other' }
      },
      recentGroups: async () => [],
    } as unknown as YzjGatewayClient
    const errors: unknown[] = []
    const runner = {
      run: async () => undefined,
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const poller = new YzjAgentPoller(client, await state(), runner, CONFIG, error => errors.push(error))

    await poller.poll()
    await poller.poll()
    await poller.stop()

    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('login account changed')
  })
})
