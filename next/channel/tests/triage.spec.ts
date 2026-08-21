/**
 * Triage specs — the ordering rules, one test each.
 *
 * The deadlock case has its own test and its own reason for existing: v2.4 of
 * the plan put object addressing ahead of commands, which made `/cancel` sent
 * as a reply to a blocked approval card queue behind the very turn it was
 * meant to unblock. If someone reorders those two branches again, this is the
 * test that fails.
 */

import { describe, expect, it } from 'vitest'
import type { CardProjection } from '@yzj-next/cards'
import { parseCommand, triage, type TriageInput } from '../src/triage.ts'
import type { YzjGroup, YzjMessage } from '../src/protocol.ts'

const GROUP: YzjGroup = {
  groupId: 'g-1', groupName: 'dsh-2', groupType: 2,
  lastMsgId: 'm-0', lastMsgSendTime: '2026-08-18 10:00:00',
}
const DM: YzjGroup = { ...GROUP, groupId: 'dm-1', groupName: '自聊', groupType: 1 }

const PROJECTION: CardProjection = {
  cardRef: { kind: 'approval', id: 'apv-1' },
  surface: 'yzj:text',
  msgAnchors: ['card-msg-1', 'card-msg-2'],
  placeKey: 'yzj-dm-dm-1',
}

function message(overrides: Partial<YzjMessage> = {}): YzjMessage {
  return {
    msgId: 'm-1',
    content: '你好',
    fromOpenId: 'op-1',
    msgType: 'text',
    sendTime: '2026-08-18 10:01:00',
    param: {},
    ...overrides,
  }
}

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    group: GROUP,
    message: message(),
    isOwnOutbound: false,
    isSelfChat: false,
    aliases: ['@agent'],
    acceptAccountMentions: false,
    operatorOpenId: 'op-1',
    repliesToAgent: candidate => (
      PROJECTION.msgAnchors.includes(candidate.param.replyMsgId ?? '')
    ),
    cardForAnchor: anchor => (PROJECTION.msgAnchors.includes(anchor) ? PROJECTION : undefined),
    resolveKeyword: (_ref, text) => {
      for (const [keyword, actionId] of [['确认', 'approve'], ['取消', 'reject']] as const) {
        if (!text.startsWith(keyword)) continue
        const rest = text.slice(keyword.length).replace(/^[\s，,：:]+/u, '').trim()
        return { actionId, ...(rest === '' ? {} : { input: rest }) }
      }
      return undefined
    },
    ...overrides,
  }
}

describe('① echo suppression', () => {
  it('drops a message the outbound registry claims as ours', () => {
    expect(triage(input({ isOwnOutbound: true }))).toEqual({ kind: 'echo-suppressed' })
  })

  it('does not drop the operator own reply just because the openId matches', () => {
    // In self-chat the agent's card and the human's answer share one openId;
    // only the registry can tell them apart, and it says this one is not ours.
    const outcome = triage(input({
      group: DM,
      isSelfChat: true,
      isOwnOutbound: false,
      message: message({ content: '确认', param: { replyMsgId: 'card-msg-1' } }),
    }))
    expect(outcome).toMatchObject({ kind: 'card-action', actionId: 'approve' })
  })
})

describe('② commands come before object addressing', () => {
  it('treats /cancel replied to a blocked card as a command, not steering', () => {
    const outcome = triage(input({
      message: message({ content: '/cancel', param: { replyMsgId: 'card-msg-1' } }),
    }))
    expect(outcome).toEqual({ kind: 'command', name: 'cancel', argument: '' })
  })

  it('accepts a command addressed with an alias in a group', () => {
    expect(triage(input({ message: message({ content: '@agent /new 价格页' }) })))
      .toEqual({ kind: 'command', name: 'new', argument: '价格页' })
  })

  it('does not read a bare slash or a mid-sentence slash as a command', () => {
    expect(parseCommand('/ ', ['@agent'])).toBeUndefined()
    expect(parseCommand('见 /docs/readme', ['@agent'])).toBeUndefined()
  })
})

describe('③ object addressing', () => {
  it('resolves a keyword reply on any registered fragment of the card', () => {
    expect(triage(input({ message: message({ content: '确认', param: { replyMsgId: 'card-msg-2' } }) })))
      .toMatchObject({ kind: 'card-action', actionId: 'approve' })
  })

  it('carries the text after the keyword as the action input', () => {
    expect(triage(input({ message: message({ content: '取消 价格还没定', param: { replyMsgId: 'card-msg-1' } }) })))
      .toMatchObject({ kind: 'card-action', actionId: 'reject', input: '价格还没定' })
  })

  it('routes a non-keyword reply into the conversation as a turn', () => {
    expect(triage(input({ message: message({ content: '再等等', param: { replyMsgId: 'card-msg-1' } }) })))
      .toMatchObject({ kind: 'trigger' })
  })

  it('hears a colleague replying to the agent, exactly as if they had typed @ (v4.7)', () => {
    // v2.5 F13 read a reply as privileged steering and limited it to the
    // operator. v4.7 retires that: replying to somebody addresses them, and a
    // colleague doing it is talking to the agent — not exercising a privilege.
    // The authority check is the admission whitelist, the same one @ passes.
    expect(triage(input({
      message: message({ content: '再等等', fromOpenId: 'other-1', param: { replyMsgId: 'card-msg-1' } }),
    }))).toMatchObject({ kind: 'trigger' })
  })

  it('hears the same reply in a direct chat', () => {
    expect(triage(input({
      group: DM,
      message: message({ content: '再等等', fromOpenId: 'other-1', param: { replyMsgId: 'card-msg-1' } }),
    }))).toMatchObject({ kind: 'trigger' })
  })

  it('needs no alias for an anchored reply', () => {
    expect(triage(input({ message: message({ content: '确认', param: { replyRootMsgId: 'card-msg-1' } }) })))
      .toMatchObject({ kind: 'card-action' })
  })
})

describe('④/⑤ triggers and noise', () => {
  it('accepts an alias anywhere in a group message', () => {
    expect(triage(input({ message: message({ content: '帮我 @agent 写个文档' }) })))
      .toEqual({ kind: 'trigger' })
  })

  it('drops an ordinary group message', () => {
    expect(triage(input())).toMatchObject({ kind: 'noise' })
  })

  it('accepts an account mention only when configured to', () => {
    const mention = message({ content: '看下这个', param: { notifyType: 1 } })
    expect(triage(input({ message: mention }))).toMatchObject({ kind: 'noise' })
    expect(triage(input({ message: mention, acceptAccountMentions: true }))).toEqual({ kind: 'trigger' })
  })

  it('ignores an @all notification even when mentions are accepted', () => {
    expect(triage(input({
      message: message({ content: '全体注意', param: { notifyType: 1, notifyToAll: true } }),
      acceptAccountMentions: true,
    }))).toMatchObject({ kind: 'noise' })
  })
})

describe('self-chat whitelist (§5.2)', () => {
  const selfChat = (overrides: Partial<TriageInput> = {}): TriageInput => (
    input({ group: DM, isSelfChat: true, ...overrides })
  )

  it('drops an ordinary note to self', () => {
    expect(triage(selfChat({ message: message({ content: '记一下：明天开会' }) })))
      .toMatchObject({ kind: 'noise' })
  })

  it('drops a mid-sentence alias in self-chat — only a leading one triggers', () => {
    expect(triage(selfChat({ message: message({ content: '回头问 @agent 一下' }) })))
      .toMatchObject({ kind: 'noise' })
    expect(triage(selfChat({ message: message({ content: '@agent 查一下价格页' }) })))
      .toEqual({ kind: 'trigger' })
  })

  it('lets commands and both object-addressing branches through', () => {
    expect(triage(selfChat({ message: message({ content: '/cancel' }) })))
      .toMatchObject({ kind: 'command' })
    expect(triage(selfChat({ message: message({ content: '确认', param: { replyMsgId: 'card-msg-1' } }) })))
      .toMatchObject({ kind: 'card-action' })
    expect(triage(selfChat({ message: message({ content: '等等', param: { replyMsgId: 'card-msg-1' } }) })))
      .toMatchObject({ kind: 'trigger' })
  })
})

/**
 * A reply to a card that is not one of its keywords.
 *
 * Caught live: the agent asked "通讯录里有 5 位李婷，是哪一位?", the operator
 * replied "客户成功部那位李婷", and the system answered
 * 「请回复：验收 / 打回 <原因>」. The agent could not hear the answer to its own
 * question — the object had an entrance and an exit while the CONVERSATION had
 * neither. A sentence belongs in the conversation.
 */
describe('a sentence replied to a card', () => {
  const replied = (content: string, from = 'op-1'): TriageInput => input({
    message: message({
      content, fromOpenId: from,
      param: { replyMsgId: PROJECTION.msgAnchors[0] },
    }),
    resolveKeyword: () => undefined,
  })

  it('is a turn, not a malformed keyword', () => {
    expect(triage(replied('客户成功部那位李婷')).kind).toBe('trigger')
  })

  it('still lets a real keyword win — 「验收」 is an answer, not a remark', () => {
    const outcome = triage({
      ...replied('验收'),
      resolveKeyword: () => ({ actionId: 'accept' }),
    })
    expect(outcome).toMatchObject({ kind: 'card-action', actionId: 'accept' })
  })

  it('treats a colleague replying to the agent as addressing it, same as @ (v4.7)', () => {
    // v2.5 F13 limited steering to the operator, on the theory that a reply
    // was a privileged channel. v4.7 retires that: replying to somebody's
    // message addresses them, and a colleague doing it is talking to the
    // agent exactly as if they had typed @. The authority check is the
    // admission whitelist, in both routes — not the reply mechanism.
    expect(triage(replied('照我说的做', 'someone-else')).kind).toBe('trigger')
  })
})

/**
 * 受话判定 (v4.7) — the agent is addressed by @, or by being replied to.
 *
 * The rule replaces "contains @". Its whole point is that replying to
 * somebody's message addresses them: that is an IM instinct, not a feature,
 * and it is what makes an ack's 「回复本条可继续」 true instead of decorative.
 */
describe('受话判定：回复 agent 的消息即向它受话', () => {
  const repliedTo = (anchor: string, content = '那就按这个来'): TriageInput => input({
    message: message({ content, param: { replyMsgId: anchor } }),
    repliesToAgent: candidate => candidate.param.replyMsgId === 'agent-msg',
    cardForAnchor: () => undefined,
    resolveKeyword: () => undefined,
  })

  it('hears a reply to any agent message, not only to a card', () => {
    // The ack 「回复本条可继续」 is posted as an ordinary message with no card
    // behind it. If only cards could be replied to, that sentence would be a
    // promise the triage cannot keep.
    expect(triage(repliedTo('agent-msg')).kind).toBe('trigger')
  })

  it('stays deaf to a reply aimed at somebody else', () => {
    // Two colleagues talking to each other in a group the agent can see is
    // not work for the agent. 冷链平铺: their chain does not even earn a card.
    expect(triage(repliedTo('a-colleague-msg')).kind).toBe('noise')
  })

  it('hears a reply to the agent inside self-chat too', () => {
    // The self-chat rule keeps BARE notes-to-self quiet. A deliberate reply to
    // the agent's own message was never one of those.
    expect(triage({
      ...repliedTo('agent-msg'),
      isSelfChat: true,
      group: DM,
    }).kind).toBe('trigger')
  })

  it('still keeps a bare note to self quiet', () => {
    expect(triage({
      ...repliedTo('nothing', '记得下午开会'),
      isSelfChat: true,
      group: DM,
    }).kind).toBe('noise')
  })
})
