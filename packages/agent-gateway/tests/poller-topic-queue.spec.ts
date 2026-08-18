import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { YzjGatewayClient } from '../src/client.ts'
import type { YzjAgentRunner } from '../src/agent-runner.ts'
import { YzjAgentPoller } from '../src/poller.ts'
import { GatewayState } from '../src/state.ts'
import type { YzjMessage, YzjTopicRoute } from '../src/types.ts'

function message(msgId: string, content: string, param: YzjMessage['param'] = {}): YzjMessage {
  return {
    msgId, content, param, fromOpenId: 'user-1', msgType: 'text',
    sendTime: '2099-01-01 00:00:00.000',
  }
}

describe('YzjAgentPoller topic queues', () => {
  it('serializes one topic while allowing another topic in the same group to run concurrently', async () => {
    const root = message('root-a', '话题 A')
    const first = message('task-a1', '@agent 第一步', { replyMsgId: root.msgId, replyRootMsgId: root.msgId })
    const second = message('task-a2', '@agent 第二步', { replyMsgId: first.msgId, replyRootMsgId: root.msgId })
    const independent = message('task-b', '@agent 独立话题')
    const group = {
      groupId: 'group-1', groupName: '研发群', groupType: 2,
      lastMsgId: independent.msgId, lastMsgSendTime: independent.sendTime, lastMsg: independent,
    }
    const client = {
      identity: async () => ({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }),
      recentGroups: async () => [group],
      messages: async () => [first, second, independent],
      contextFor: async (_group: unknown, trigger: YzjMessage) => (
        trigger.msgId === independent.msgId ? [independent] : [root, first, ...(trigger === second ? [second] : [])]
      ),
    } as unknown as YzjGatewayClient
    const activeTopics = new Set<string>()
    let sameTopicOverlap = false
    let activeCount = 0
    let maxActiveCount = 0
    const starts: string[] = []
    const runner = {
      run: async (trigger: { message: YzjMessage }, route: YzjTopicRoute) => {
        if (activeTopics.has(route.topicKey)) sameTopicOverlap = true
        activeTopics.add(route.topicKey)
        activeCount += 1
        maxActiveCount = Math.max(maxActiveCount, activeCount)
        starts.push(trigger.message.msgId)
        await new Promise(resolve => setTimeout(resolve, 20))
        activeCount -= 1
        activeTopics.delete(route.topicKey)
      },
      reportFailure: async () => undefined,
    } as unknown as YzjAgentRunner
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-topic-queue-'))
    const state = new GatewayState(join(directory, 'state.json'))
    await state.load()
    state.selectAccount({ orgId: 'org-1', openId: 'agent-self', name: 'Agent' })
    state.setCursor(group.groupId, 'before')
    const poller = new YzjAgentPoller(client, state, runner, {
      aliases: ['@agent'], acceptAccountMentions: false, groupPages: 1,
      contextMessages: 20, discoveryPages: 10, pollIntervalMs: 5_000, maxConcurrentTasks: 2,
      allowedGroupIds: new Set(), allowedSenderOpenIds: new Set(),
    }, error => { throw error })

    await poller.poll()
    await poller.stop()

    expect(sameTopicOverlap).toBe(false)
    expect(maxActiveCount).toBe(2)
    expect(starts.indexOf('task-a1')).toBeLessThan(starts.indexOf('task-a2'))
  })
})
