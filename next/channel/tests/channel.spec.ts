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
import { onDutyIn, unlinkPlan } from '../src/poller.ts'
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

/**
 * 在不在岗：**「从没提过」和「明确说了不」是两回事** (三值纪律在合同上的同一次应用).
 *
 * 此前只有一个集合：接入就 `add`、移出就 `delete`。于是一次明确的「不」和一次从未发生
 * 的决定压成了同一个状态，而这个集合还兼职表达配置——空集是「这个部署没有名单，到处都
 * 在岗」。两个含义挤在一个数据结构里，就有了一道**双向的悬崖**，而两个方向都是实的：
 *
 * - 名单空着的部署里点开一个群 → 集合变非空 → 另外 45 个群悄悄下岗（本实例现在就是
 *   这个状态：落库里只有一条 true，而界面上一片「未接入」）；
 * - 名单只剩一个的部署里把它关掉 → 集合变空 → **agent 在 46 个真实工作群里同时上岗**。
 *
 * 后一种正是承诺板 `set-served` 那段注释在担心的爆炸半径——而那个开关自己就有这个洞。
 * 设计 v4.18「合同默认最严」也押在这一条上：说不清「明确关掉」，那句话就是空的。
 */
describe('在不在岗：说过的「不」压得过任何默认', () => {
  const none = new Set<string>()

  it('名单空着 = 这个部署没有名单，到处都在岗', () => {
    expect(onDutyIn({ groupId: 'g1', allowedGroupIds: none, deniedGroupIds: none })).toBe(true)
  })

  it('名单非空 = 只在名单里在岗', () => {
    const allowed = new Set(['g1'])
    expect(onDutyIn({ groupId: 'g1', allowedGroupIds: allowed, deniedGroupIds: none })).toBe(true)
    expect(onDutyIn({ groupId: 'g2', allowedGroupIds: allowed, deniedGroupIds: none })).toBe(false)
  })

  it('明确关掉的群，名单空着也不在岗 —— 这是那道悬崖的护栏', () => {
    /*
      旧写法把「关掉」实现成从集合里 delete：集合本来就空，delete 是个空操作，
      于是操作者按下的「移出服务」**什么都没发生**，而界面会告诉他已经移出了。
    */
    expect(onDutyIn({
      groupId: 'g1', allowedGroupIds: none, deniedGroupIds: new Set(['g1']),
    })).toBe(false)
  })

  /*
    **悬崖还有一半没修，这里不假装修好了。**

    关掉最后一个群 → `allowed` 变空 → 空集仍然「全部放行」→ 其余 45 个群集体上岗。
    denied 只护得住被点名关掉的那一个。

    真正的根还在「空集」身兼两职：它既是配置语句（这个部署没有名单），又是运行态的
    累加结果。分开的修法要么把「空 = 全开」改成「空 = 全关」（收窄，合 v4.18
    「合同默认最严」），要么让「空 = 全开」只由**配置**说了算（加宽）——**两个方向都会
    改变 agent 在 46 个真实工作群里的触达**，那是账号主人的决定，不是实现能自己定的。

    所以这里只锁住不含糊的那半条，另半条如实记在偏离清单上等裁决。写一条断言去钉住
    当前这个行为，等于把 bug 写成规格。
  */

  it('先关后开，开得回来 —— 两个集合各自成立，不许互相残留', () => {
    const allowed = new Set(['g1'])
    const denied = new Set<string>()
    expect(onDutyIn({ groupId: 'g1', allowedGroupIds: allowed, deniedGroupIds: denied })).toBe(true)
  })
})

/**
 * `/unlink` 摘除 —— **与收养对称的减法动词** (v4.22 裁决②).
 *
 * 作废杀掉承诺、移交换掉执行者，而这里只是「这件事不再算在那个目标名下」——那件事还
 * 在做。用前两个去表达它，都是拿一个语义过重的动作凑一个轻的意思，图上留下的是假账。
 */
describe('摘除的裁定', () => {
  it('这个话题里没有挂着目标的承诺时，说没有可摘的——不是说你没权限', () => {
    expect(unlinkPlan({ fromOpenId: 'u-1' })).toBe('nothing')
  })

  it('自己登记的那条：摘', () => {
    expect(unlinkPlan({ attached: { delegatedBy: 'u-1' }, fromOpenId: 'u-1' })).toBe('unlink')
  })

  it('别人登记的那条：不归你摘', () => {
    expect(unlinkPlan({ attached: { delegatedBy: 'u-2' }, fromOpenId: 'u-1' })).toBe('not-mine')
  })

  /*
    老数据里没有 owner 时**放行**——一条谁都摘不掉的边，比放宽一点更坏。
    与验收席位、板上的渲染过滤共用同一个谓词与同一条纪律（宁可宽，不可锁死）。
  */
  it('老数据没记 owner 时放行，不把人锁在自己的账本外面', () => {
    expect(unlinkPlan({ attached: {}, fromOpenId: 'u-1' })).toBe('unlink')
  })
})
