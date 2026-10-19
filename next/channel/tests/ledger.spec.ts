/**
 * 通道这一侧的账（技术方案-下一代ERP账本 E0）：授权追得到人的那个字段在哪里出生，以及
 * agent 对外说的每一句话在日志里恰好留一行。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TurnBinding } from '@yzj-next/objects'
import { YzjOrchestrator } from '../src/orchestrator.ts'
import type { YzjMessage, YzjTopicRoute } from '../src/protocol.ts'

const ROUTE: YzjTopicRoute = {
  accountKey: 'acct-1', accountOrgId: 'org-1', accountOpenId: 'op-1',
  conversationKind: 'group', groupId: 'g-1', groupName: '群', placeKey: 'yzj-group-g-1',
  channelKey: 'c', topicRootId: 'm-root', topicKey: 'yzj-topic-1', topicLabel: 't',
  generation: 1, sessionId: 's-1', title: 't',
}

const message = (fromOpenId: string): YzjMessage => ({
  msgId: 'm-1', content: '@next 建个文档', fromOpenId, msgType: 'text', sendTime: '', param: {},
})

/** `bindingOf` is the one place a turn's authority is born; reach it directly. */
function bindingOf(trigger: YzjMessage): TurnBinding {
  const orchestrator = new YzjOrchestrator(new Context(), {} as never, {} as never, {} as never)
  return (orchestrator as unknown as { bindingOf(route: YzjTopicRoute, trigger: YzjMessage): TurnBinding })
    .bindingOf(ROUTE, trigger)
}

describe('接纳消息的发送者 (§13.3-2)', () => {
  it('回合绑定记下发消息的人——不是能答卡的人', () => {
    const binding = bindingOf(message('u-asker'))
    expect(binding).toMatchObject({ messageId: 'm-1', senderOpenId: 'u-asker', decider: 'op-1' })
  })

  it('发送者为空串就是缺失：宁可多问一次，也不放出一次无主的写', () => {
    expect(bindingOf(message(''))).not.toHaveProperty('senderOpenId')
  })
})
