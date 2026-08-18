import { describe, expect, it } from 'vitest'
import {
  conversationKindForGroup,
  hasLeadingAgentAlias,
  isAgentTrigger,
  isTriggerableConversation,
  messageBelongsToTopic,
  parseGroup,
  parseMessage,
  renderChatContext,
  resolveTopicRootId,
  sessionIdForGroup,
  stripTriggerAliases,
  summarizeTurn,
  topicRootIdFor,
  topicRouteFor,
} from '../src/protocol.ts'

const ACCOUNT_1 = { orgId: 'org-1', openId: 'account-1' }
const ACCOUNT_2 = { orgId: 'org-1', openId: 'account-2' }

const MESSAGE = {
  content: '@agent 请总结最近讨论',
  fromOpenId: 'user-1',
  msgId: 'msg-1',
  msgType: 'text',
  sendTime: '2026-08-15 10:00:00.000',
  param: {},
} as const

describe('Yunzhijia message protocol', () => {
  it('parses mention and reply metadata from CLI JSON', () => {
    const message = parseMessage({
      ...MESSAGE,
      param: {
        notifyType: '1',
        notifyDesc: '[有人@你]',
        replyMsgId: 'parent-1',
        replyPersonName: '张三',
        replySummary: '原始问题',
      },
    })
    expect(message).toMatchObject({
      msgId: 'msg-1',
      param: { notifyType: 1, replyMsgId: 'parent-1', replySummary: '原始问题' },
    })
  })

  it('recognizes structured account mentions and configured text aliases', () => {
    const accountMention = parseMessage({ ...MESSAGE, content: '请处理', param: { notifyType: 1 } })!
    const mentionAll = parseMessage({
      ...MESSAGE, content: '请大家处理', param: { notifyType: 1, notifyToAll: '1' },
    })!
    expect(isAgentTrigger(accountMention, ['@agent'], true)).toBe(true)
    expect(isAgentTrigger(mentionAll, ['@agent'], true)).toBe(false)
    expect(isAgentTrigger(accountMention, ['@agent'], false)).toBe(false)
    expect(isAgentTrigger(MESSAGE, ['@agent'], false)).toBe(true)
    expect(isAgentTrigger({ ...MESSAGE, content: 'mail@agent.example' }, ['@agent'], false)).toBe(false)
    expect(hasLeadingAgentAlias({ ...MESSAGE, content: '  @agent 请处理' }, ['@agent'])).toBe(true)
    expect(hasLeadingAgentAlias({ ...MESSAGE, content: '结果中提到 @agent' }, ['@agent'])).toBe(false)
  })

  it('strips only trigger aliases from the submitted task', () => {
    expect(stripTriggerAliases('@agent  请创建一份文档', ['@agent'])).toBe('请创建一份文档')
  })

  it('renders bounded chronological context with reply summary', () => {
    const trigger = parseMessage({
      ...MESSAGE,
      param: { replyPersonName: '张三', replySummary: '原始问题' },
    })!
    const group = parseGroup({
      groupId: 'group-1', groupName: '研发群', lastMsgId: 'msg-1',
      lastMsgSendTime: MESSAGE.sendTime, lastMsg: trigger,
    })!
    const context = renderChatContext(group, [trigger], trigger)
    expect(context).toContain('研发群 (group-1)')
    expect(context).toContain('回复引用：张三：原始问题')
    expect(context).toContain('[触发消息]')
  })

  it('routes group replies by topic and isolates accounts and top-level topics', () => {
    const group = parseGroup({
      groupId: 'group-1', groupName: '研发群', groupType: 2, lastMsgId: 'reply-2',
      lastMsgSendTime: MESSAGE.sendTime,
    })!
    const root = parseMessage({ ...MESSAGE, content: '设计话题会话', msgId: 'root-1' })!
    const firstReply = parseMessage({
      ...MESSAGE, content: '@agent 给出方案', msgId: 'reply-1',
      param: { replyMsgId: 'root-1', replyRootMsgId: 'root-1' },
    })!
    const secondReply = parseMessage({
      ...MESSAGE, content: '@agent 继续实现', msgId: 'reply-2',
      param: { replyMsgId: 'reply-1', replyRootMsgId: 'root-1' },
    })!
    const nextRoot = parseMessage({ ...MESSAGE, content: '@agent 新任务', msgId: 'root-2' })!
    const first = topicRouteFor(ACCOUNT_1, group, firstReply, [root, firstReply])
    const second = topicRouteFor(ACCOUNT_1, group, secondReply, [root, firstReply, secondReply])
    const independent = topicRouteFor(ACCOUNT_1, group, nextRoot, [nextRoot])
    const otherAccount = topicRouteFor(ACCOUNT_2, group, firstReply, [root, firstReply])

    const nestedWithoutRoot = parseMessage({
      ...MESSAGE, content: '@agent 继续', msgId: 'reply-3', param: { replyMsgId: 'reply-1' },
    })!

    expect(topicRootIdFor(group, secondReply)).toBe('root-1')
    expect(resolveTopicRootId(group, nestedWithoutRoot, [root, firstReply])).toBe('root-1')
    expect(resolveTopicRootId(group, nestedWithoutRoot, [], (_groupId, msgId) => (
      msgId === 'reply-1' ? 'root-1' : undefined
    ))).toBe('root-1')
    expect(messageBelongsToTopic(secondReply, 'root-1')).toBe(true)
    expect(first.sessionId).toBe(second.sessionId)
    expect(first.sessionId).not.toBe(independent.sessionId)
    expect(first.sessionId).not.toBe(otherAccount.sessionId)
    expect(first.title).toContain('设计话题会话')
  })

  it('keeps one direct-chat Session and rejects system conversations', () => {
    const direct = parseGroup({
      groupId: 'peer-1-account-1', groupName: '张三', groupType: 1,
      lastMsgId: 'msg-2', lastMsgSendTime: MESSAGE.sendTime,
    })!
    const first = parseMessage({ ...MESSAGE, msgId: 'msg-1' })!
    const second = parseMessage({
      ...MESSAGE, msgId: 'msg-2', param: { replyMsgId: 'msg-1', replyRootMsgId: 'msg-1' },
    })!
    expect(conversationKindForGroup(direct)).toBe('direct')
    expect(topicRouteFor(ACCOUNT_1, direct, first).sessionId)
      .toBe(topicRouteFor(ACCOUNT_1, direct, second).sessionId)
    expect(topicRootIdFor(direct, second)).toBe('direct')
    expect(isTriggerableConversation({ ...direct, groupType: 3 })).toBe(false)
    expect(isTriggerableConversation({ ...direct, groupType: 8 })).toBe(false)
    expect(isTriggerableConversation({ ...direct, groupType: undefined })).toBe(false)
    expect(isTriggerableConversation({ ...direct, groupType: 99 })).toBe(false)
  })

  it('derives stable isolated legacy Session ids by conversation', () => {
    expect(sessionIdForGroup('group-1')).toBe(sessionIdForGroup('group-1'))
    expect(sessionIdForGroup('group-1')).not.toBe(sessionIdForGroup('group-2'))
    expect(sessionIdForGroup('group-1')).toMatch(/^session-yzj-[a-f0-9]{24}$/)
  })

  it('summarizes the final assistant message and turn reason', () => {
    const events = [
      { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
      {
        seq: 1, time: 2, type: 'assistant/message',
        data: {
          turn: 1, step: 1,
          message: { id: 'm', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '完成了' }] },
        },
      },
      { seq: 2, time: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(summarizeTurn(events as never, 0)).toEqual({ text: '完成了', reason: { kind: 'completed' } })
  })
})
