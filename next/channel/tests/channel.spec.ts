/**
 * Channel state and protocol specs: the echo protocol's two matching paths,
 * topic anchoring, and the hash-domain separation that keeps this system's
 * sessions out of the old one's.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChannelState } from '../src/state.ts'
import { isPictureAttachment } from '../src/topics.ts'
import {
  accountKeyFor, groupIdFromPlaceKey, isSelfChat, isTriageableConversation,
  outboundFingerprint, parseGroup, parseMessage, placeKeyFor, resolveTopicRootId,
  topicRouteFor, type YzjGroup, type YzjMessage,
  hasLeadingAlias, isAgentTrigger, stripTriggerAliases,
} from '../src/protocol.ts'

const IDENTITY = { orgId: 'org-1', openId: 'op-1', name: '操作者' }
const GROUP: YzjGroup = {
  groupId: 'g-1', groupName: 'dsh-2', groupType: 2,
  lastMsgId: 'm-9', lastMsgSendTime: '2026-08-18 10:00:00',
}

function message(overrides: Partial<YzjMessage> = {}): YzjMessage {
  return {
    msgId: 'm-1', content: 'hi', fromOpenId: 'op-1', msgType: 'text',
    sendTime: '2026-08-18 10:00:00', param: {}, ...overrides,
  }
}

let state: ChannelState
let file: string

beforeEach(async () => {
  file = join(await mkdtemp(join(tmpdir(), 'yzj-next-channel-')), 'state.json')
  state = new ChannelState(file)
  await state.load()
  state.selectAccount('acct-1')
})

describe('echo protocol (§5.2)', () => {
  it('recognises our own message by id once the send was recorded', () => {
    const fingerprint = outboundFingerprint('g-1', '【确认】写文档')
    state.registerOutbound('nonce-1', 'g-1', fingerprint)
    state.confirmOutbound('nonce-1', 'sent-1')
    expect(state.isOwnOutbound('sent-1', 'g-1', fingerprint)).toBe(true)
  })

  it('recognises it by fingerprint when the process died in the send window', () => {
    const fingerprint = outboundFingerprint('g-1', '【确认】写文档')
    // Pre-registered, never confirmed: exactly the crash window.
    state.registerOutbound('nonce-1', 'g-1', fingerprint)
    expect(state.isOwnOutbound('unknown-id', 'g-1', fingerprint)).toBe(true)
  })

  it('claims an unconfirmed fingerprint only once, so a later human repeat is heard', () => {
    const fingerprint = outboundFingerprint('g-1', '确认')
    state.registerOutbound('nonce-1', 'g-1', fingerprint)
    expect(state.isOwnOutbound('echo-1', 'g-1', fingerprint)).toBe(true)
    expect(state.isOwnOutbound('human-1', 'g-1', fingerprint)).toBe(false)
  })

  it('does not confuse the same text sent into a different conversation', () => {
    const fingerprint = outboundFingerprint('g-1', '确认')
    state.registerOutbound('nonce-1', 'g-1', fingerprint)
    expect(state.isOwnOutbound('x', 'g-2', outboundFingerprint('g-2', '确认'))).toBe(false)
  })

  it('survives a restart with its registry intact', async () => {
    const fingerprint = outboundFingerprint('g-1', '确认')
    state.registerOutbound('nonce-1', 'g-1', fingerprint)
    state.confirmOutbound('nonce-1', 'sent-1')
    state.setCursor('g-1', 'm-5')
    state.markProcessed('m-4')
    await state.save()

    const reopened = new ChannelState(file)
    await reopened.load()
    reopened.selectAccount('acct-1')
    expect(reopened.isOwnOutbound('sent-1', 'g-1', fingerprint)).toBe(true)
    expect(reopened.cursor('g-1')).toBe('m-5')
    expect(reopened.isProcessed('m-4')).toBe(true)
  })

  it('refuses to switch accounts mid-run', () => {
    expect(() => state.selectAccount('acct-2')).toThrow(/account changed/)
  })
})

describe('generations', () => {
  it('starts at one and advances only when asked', async () => {
    expect(state.generation('yzj-topic-x')).toBe(1)
    expect(state.advanceGeneration('yzj-topic-x')).toBe(2)
    await state.save()
    const reopened = new ChannelState(file)
    await reopened.load()
    reopened.selectAccount('acct-1')
    expect(reopened.generation('yzj-topic-x')).toBe(2)
  })
})

describe('topic anchoring', () => {
  it('anchors a DM to one running conversation rather than per message', () => {
    const dm: YzjGroup = { ...GROUP, groupType: 1 }
    expect(resolveTopicRootId(dm, message({ msgId: 'a' }))).toBe('direct')
    expect(resolveTopicRootId(dm, message({ msgId: 'b' }))).toBe('direct')
  })

  it('prefers the server-issued reply root over any derivation', () => {
    expect(resolveTopicRootId(GROUP, message({ param: { replyRootMsgId: 'root-1', replyMsgId: 'x' } })))
      .toBe('root-1')
  })

  it('uses the durable index before walking the parent chain', () => {
    const resolved = resolveTopicRootId(
      GROUP, message({ param: { replyMsgId: 'agent-reply' } }), [],
      (_groupId, msgId) => (msgId === 'agent-reply' ? 'root-7' : undefined),
    )
    expect(resolved).toBe('root-7')
  })

  it('walks the parent chain without looping on a cycle', () => {
    const context = [
      message({ msgId: 'p1', param: { replyMsgId: 'p2' } }),
      message({ msgId: 'p2', param: { replyMsgId: 'p1' } }),
    ]
    expect(resolveTopicRootId(GROUP, message({ param: { replyMsgId: 'p1' } }), context)).toBe('p1')
  })

  it('makes a bare group message its own root', () => {
    expect(resolveTopicRootId(GROUP, message({ msgId: 'solo' }))).toBe('solo')
  })
})

describe('key minting', () => {
  it('mints a session id in this system own hash domain', () => {
    const route = topicRouteFor(IDENTITY, GROUP, message(), [], 'root-1')
    expect(route.sessionId.startsWith('session-yzj-next-')).toBe(true)
    expect(route.topicKey.startsWith('yzj-topic-')).toBe(true)
    expect(route.placeKey).toBe('yzj-group-g-1')
  })

  it('gives a new generation a different session, so /new really is a new one', () => {
    const first = topicRouteFor(IDENTITY, GROUP, message(), [], 'root-1', 1)
    const second = topicRouteFor(IDENTITY, GROUP, message(), [], 'root-1', 2)
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('partitions by account', () => {
    const other = { ...IDENTITY, openId: 'op-2' }
    expect(accountKeyFor(other)).not.toBe(accountKeyFor(IDENTITY))
    expect(topicRouteFor(other, GROUP, message(), [], 'root-1').sessionId)
      .not.toBe(topicRouteFor(IDENTITY, GROUP, message(), [], 'root-1').sessionId)
  })

  it('round-trips a place key back to its conversation id', () => {
    expect(groupIdFromPlaceKey(placeKeyFor('direct', 'dm-1'))).toBe('dm-1')
    expect(groupIdFromPlaceKey(placeKeyFor('group', 'g-1'))).toBe('g-1')
    expect(groupIdFromPlaceKey('something-else')).toBeUndefined()
  })
})

describe('wire parsing', () => {
  it('keeps the reply fields triage depends on', () => {
    const parsed = parseMessage({
      msgId: 'm-1', content: '确认', fromOpenId: 'op-1', msgType: 'text',
      sendTime: '2026-08-18 10:00:00',
      param: { replyMsgId: 'c-1', replyRootMsgId: 'r-1', notifyType: '1', notifyToAll: 'false' },
    })
    expect(parsed?.param).toMatchObject({
      replyMsgId: 'c-1', replyRootMsgId: 'r-1', notifyType: 1, notifyToAll: false,
    })
  })

  it('drops a record with no message id rather than inventing one', () => {
    expect(parseMessage({ content: 'x' })).toBeUndefined()
    expect(parseGroup({ groupName: 'x' })).toBeUndefined()
  })

  it('tolerates the richText shape self-chat history actually contains', () => {
    const parsed = parseMessage({
      msgId: 'm-2', content: '[图片]\n回车就这样了', fromOpenId: 'op-1',
      msgType: 'richText', sendTime: '2025-05-05 18:03:19.977',
      param: { desc: [{ type: 'image', data: 'x' }] },
    })
    expect(parsed?.msgType).toBe('richText')
    expect(parsed?.param.replyMsgId).toBeUndefined()
  })

  it('acts only in direct chats and ordinary groups', () => {
    expect(isTriageableConversation({ ...GROUP, groupType: 1 })).toBe(true)
    expect(isTriageableConversation({ ...GROUP, groupType: 2 })).toBe(true)
    // Type 3 is a subscription feed: never a conversation to act in.
    expect(isTriageableConversation({ ...GROUP, groupType: 3 })).toBe(false)
  })

  it('recognises the operator own chat by its eid-paired id', () => {
    const selfChat: YzjGroup = {
      ...GROUP, groupType: 1,
      groupId: '67f334ade4b0b97fa155f48f-67f334ade4b0b97fa155f48f',
    }
    expect(isSelfChat(selfChat, IDENTITY)).toBe(true)
    expect(isSelfChat({ ...GROUP, groupType: 1, groupId: 'a-b' }, IDENTITY)).toBe(false)
  })
})

describe('图片是作为文件消息发来的（实测报文）', () => {
  it('recognises a pasted picture, whichever marker the client set', () => {
    // 真实报文：粘一张图进聊天,来的是 msgType:'file' + ftype:1 + picWidth/Height。
    expect(isPictureAttachment({ ftype: 1, ext: 'png', picWidth: 2025 })).toBe(true)
    // 只有尺寸、没有 ftype 的那一支
    expect(isPictureAttachment({ picWidth: 925 })).toBe(true)
    // 只有扩展名的那一支
    expect(isPictureAttachment({ ext: 'JPG' })).toBe(true)
  })

  it('leaves an actual document alone', () => {
    expect(isPictureAttachment({ ftype: 0, ext: 'md' })).toBe(false)
    expect(isPictureAttachment({ ext: 'xlsx' })).toBe(false)
    expect(isPictureAttachment({})).toBe(false)
  })
})

describe('触发词的边界：中文不留空格（实测缺陷）', () => {
  const aliases = ['@next', '@下一代']
  const msg = (content: string): YzjMessage => ({
    msgId: 'm', content, fromOpenId: 'u', msgType: 'text', sendTime: '', param: {},
  })

  it('answers when the mention runs straight into Chinese', () => {
    /*
      现场：830 项目群 17:38「@next他发的是什么东西」——没有回应，日志里也
      没有任何解释。旧规则要求 @next 后面跟空格或六个标点之一，而中文里
      没人会在 @ 之后打空格。
    */
    expect(isAgentTrigger(msg('@next他发的是什么东西'), aliases, false)).toBe(true)
    expect(isAgentTrigger(msg('@下一代帮我看下这个'), aliases, false)).toBe(true)
    expect(isAgentTrigger(msg('问一下@next他发的什么'), aliases, false)).toBe(true)
  })

  it('still answers the shapes that already worked', () => {
    expect(isAgentTrigger(msg('@next 帮我看下'), aliases, false)).toBe(true)
    expect(isAgentTrigger(msg('@next'), aliases, false)).toBe(true)
    expect(isAgentTrigger(msg('@next，看一下'), aliases, false)).toBe(true)
    expect(isAgentTrigger(msg('先看这个 @next'), aliases, false)).toBe(true)
  })

  it('still refuses to fire inside a longer word', () => {
    // 这才是那个前瞻真正要防的东西：@next 不该被 @nextgen 触发。
    expect(isAgentTrigger(msg('@nextgen 是另一个东西'), aliases, false)).toBe(false)
    expect(isAgentTrigger(msg('mail@next'), aliases, false)).toBe(false)
    expect(isAgentTrigger(msg('完全没提到它'), aliases, false)).toBe(false)
  })

  it('applies the same boundary to the leading-alias check', () => {
    expect(hasLeadingAlias('@next他发的是什么东西', aliases)).toBe(true)
    expect(hasLeadingAlias('@next 帮我看下', aliases)).toBe(true)
    expect(hasLeadingAlias('@nextgen 别乱来', aliases)).toBe(false)
    expect(hasLeadingAlias('前面有字@next', aliases)).toBe(false)
  })

  it('strips the trigger out of what the agent is asked', () => {
    expect(stripTriggerAliases('@next他发的是什么东西', aliases)).toBe('他发的是什么东西')
  })
})
