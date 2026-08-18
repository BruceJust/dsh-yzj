import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { YzjGatewayClient } from '../src/client.ts'
import type { YzjAgentRunner } from '../src/agent-runner.ts'
import { YzjAgentPoller } from '../src/poller.ts'
import { GatewayState } from '../src/state.ts'
import type { YzjMessage } from '../src/types.ts'

describe('YzjAgentPoller lifecycle', () => {
  it('waits for an in-flight poll and every task it enqueues during stop', async () => {
    const message: YzjMessage = {
      content: '@agent 执行任务', fromOpenId: 'user-1', msgId: 'msg-1',
      msgType: 'text', sendTime: '2099-01-01 00:00:00.000', param: {},
    }
    let enterPoll!: () => void
    const entered = new Promise<void>(resolve => { enterPoll = resolve })
    let releasePoll!: () => void
    const released = new Promise<void>(resolve => { releasePoll = resolve })
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => {
        enterPoll()
        await released
        return [{
          groupId: 'group-1', groupName: '研发群', groupType: 2, lastMsgId: message.msgId,
          lastMsgSendTime: message.sendTime, lastMsg: message,
        }]
      },
      messages: async () => [message],
      contextFor: async () => [message],
    } as unknown as YzjGatewayClient
    let runFinished = false
    const runner = {
      run: async () => { runFinished = true },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-lifecycle-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: true, groupPages: 1,
      contextMessages: 20, discoveryPages: 10, pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, () => undefined)

    const polling = poller.poll()
    await entered
    let stopFinished = false
    const stopping = poller.stop().then(() => { stopFinished = true })
    await Promise.resolve()
    expect(stopFinished).toBe(false)
    releasePoll()
    await Promise.all([polling, stopping])

    expect(runFinished).toBe(true)
    expect(stopFinished).toBe(true)
  })
})
