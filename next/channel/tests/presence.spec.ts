/**
 * 多实例受话唯一律 —— 段 4q 的断言 (决策 #63, v3.23 + v3.23r 六收紧).
 *
 * 验收句只有一句：**宁可无人接单，不可两人动手。** 这里每一条都在两个方向上锁它：
 * 恰一实例开工（不是零，也不是二）；而每一处不确定都倒向「不接」。
 *
 * 协议是纯函数（`presence.ts`），所以两个实例可以在同一段内存里的「群消息流」上跑完
 * 整个 看一眼 → 认领 → 复核，不起通道、不起 agent——判断是会被改错的那一部分，判断
 * 错的代价是双写。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import type { YzjRunResult } from '@yzj-next/bridge'
import { readSignature, SIGNATURE_AGENT, signOutbound } from '@yzj-next/objects'
import {
  ackText, acksIn, classifyPeerOutbound, presenceDeclaration, presenceWithdrawal,
  resolveAddressee, resolveCommand, reviewClaim, withdrawRequestDraft, yieldNotice,
  type ClaimTier, type Resolution,
} from '../src/presence.ts'
import { triage, type TriageInput } from '../src/triage.ts'
import { deskSendPlan } from '../src/poller.ts'
import { ChannelState } from '../src/state.ts'
import { YzjChannelClient } from '../src/client.ts'
import { applyServe, serveRecordFor } from '../src/serve.ts'
import { outboundFingerprint, type YzjGroup, type YzjMessage } from '../src/protocol.ts'

const GROUP: YzjGroup = {
  groupId: 'g-1', groupName: '830 项目', groupType: 2,
  lastMsgId: 'm-0', lastMsgSendTime: '2026-09-03 10:00:00',
}

/** 两个操作者，各带一个「云小助」进了同一间屋子。 */
const BRUCE = { openId: 'op-bruce', name: 'Bruce' }
const ZHANG = { openId: 'op-zhang', name: '张三' }
/** 没有助理的同事。 */
const LISI = { openId: 'op-lisi', name: '李四' }

function message(overrides: Partial<YzjMessage> = {}): YzjMessage {
  return {
    msgId: 'm-1', content: '@next 帮我拉一份报表', fromOpenId: LISI.openId, msgType: 'text',
    sendTime: '2026-09-03 10:01:00', param: {}, ...overrides,
  }
}

/**
 * 寄生期唯一共享的服务端总序日志：群消息流。两个实例都往这里贴、从这里读。
 */
class Stream {
  readonly messages: YzjMessage[] = []
  private seq = 100

  post(from: { openId: string }, content: string, replyMsgId?: string): string {
    this.seq += 1
    const msgId = `m-${String(this.seq)}`
    this.messages.push({
      msgId, content, fromOpenId: from.openId, msgType: 'text',
      sendTime: `2026-09-03 10:0${String(this.seq % 10)}:00`,
      param: replyMsgId === undefined ? {} : { replyMsgId },
    })
    return msgId
  }

  after(msgId: string): YzjMessage[] {
    const at = this.messages.findIndex(candidate => candidate.msgId === msgId)
    return this.messages.slice(at + 1)
  }
}

/**
 * 一个实例在一次受话上要做的全部判断，按协议的顺序。
 *
 * 返回它最后做了什么：开工 / 静默让位 / 显式让位 / 等一周期 / 不接。「开工」恰好一次
 * 是所有断言的目标。
 */
interface Instance {
  readonly me: { openId: string; name: string }
  readonly scope: 'all' | 'self' | 'off'
  readonly peersOnDuty: { openId: string; name: string }[]
  readonly knownPeers: Record<string, string>
}

type Outcome =
  | { kind: 'worked'; tier: ClaimTier; ackId: string }
  | { kind: 'silent-yield'; to?: string; reason: string }
  | { kind: 'loud-yield'; to: string; reason: string; retract: string }
  | { kind: 'wait' }
  | { kind: 'unserved' }

function resolve(instance: Instance, stream: Stream, trigger: YzjMessage, waited: boolean): Resolution {
  const speakerPeer = instance.knownPeers[trigger.fromOpenId]
  return resolveAddressee({
    speakerOpenId: trigger.fromOpenId,
    selfOpenId: instance.me.openId,
    objectOwner: 'unknown',
    ...(speakerPeer === undefined || trigger.fromOpenId === instance.me.openId
      ? {}
      : { speakerInstance: { openId: trigger.fromOpenId, name: speakerPeer } }),
    waited,
    speakerAcked: acksIn(stream.after(trigger.msgId), trigger, instance.me.openId)
      .some(ack => ack.openId === trigger.fromOpenId),
    selfScope: instance.scope,
    peersOnDuty: instance.peersOnDuty,
  })
}

/** 看一眼 → 认领 → 复核，中间可以插进别的实例的动作（`between`）。 */
function claim(
  instance: Instance, stream: Stream, trigger: YzjMessage, resolution: Resolution,
  between: () => void = () => undefined,
): Outcome {
  if (resolution.kind === 'wait') return { kind: 'wait' }
  if (resolution.kind === 'unserved') return { kind: 'unserved' }
  if (resolution.kind === 'yield') {
    return { kind: 'silent-yield', reason: resolution.reason, ...(resolution.to === undefined ? {} : { to: resolution.to }) }
  }
  // 看一眼
  const seen = acksIn(stream.after(trigger.msgId), trigger, instance.me.openId)
  if (seen.length > 0) {
    const first = seen[0] as (typeof seen)[number]
    return { kind: 'silent-yield', to: first.openId, reason: first.tier === 'speaker' ? 'speaker-instance' : 'presence' }
  }
  // 认领 = ack（署名的）
  const ackId = stream.post(instance.me, signOutbound(ackText(`tsk-${instance.me.openId}`), instance.me.name), trigger.msgId)
  between()
  // 复核
  const { verdict } = reviewClaim({
    after: stream.after(trigger.msgId), trigger, selfOpenId: instance.me.openId, selfTier: resolution.tier, ackId,
  })
  if (verdict.win) return { kind: 'worked', tier: resolution.tier, ackId }
  const retract = stream.post(instance.me, signOutbound(yieldNotice(verdict.to), instance.me.name), ackId)
  return { kind: 'loud-yield', to: verdict.to, reason: verdict.reason, retract }
}

const bruce: Instance = {
  me: BRUCE, scope: 'all', peersOnDuty: [ZHANG], knownPeers: { [ZHANG.openId]: ZHANG.name },
}
const zhang: Instance = {
  me: ZHANG, scope: 'all', peersOnDuty: [BRUCE], knownPeers: { [BRUCE.openId]: BRUCE.name },
}

const worked = (outcomes: Outcome[]): Outcome[] => outcomes.filter(outcome => outcome.kind === 'worked')

describe('断言⑤ 双实例同群同触发 —— 恰一实例开工，零双写', () => {
  it('两个对群在岗重叠：先 ack 的赢，后 ack 的显式让位并不开工', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    const outcomes: Outcome[] = []
    // Bruce 的实例先到；张三的实例在它 ack 之后、复核之前也 ack 了（真实轮询相位差）。
    let zhangOutcome: Outcome | undefined
    outcomes.push(claim(bruce, stream, trigger, resolve(bruce, stream, trigger, false), () => {
      // 张三看一眼时 Bruce 的 ack 已经在流里——静默让位，没开口无需撤。
      zhangOutcome = claim(zhang, stream, trigger, resolve(zhang, stream, trigger, false))
    }))
    outcomes.push(zhangOutcome as Outcome)
    expect(worked(outcomes)).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ kind: 'worked', tier: 'presence' })
    expect(outcomes[1]).toMatchObject({ kind: 'silent-yield', to: BRUCE.openId, reason: 'presence' })
  })

  it('两边同时 ack（看一眼都没看到对方）：服务端总序更早者赢，输方有让位帖', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    // 两边都先看了一眼（都空），再各自 ack——模拟同一轮询相位。
    const resolutionB = resolve(bruce, stream, trigger, false)
    const resolutionZ = resolve(zhang, stream, trigger, false)
    expect(acksIn(stream.after(trigger.msgId), trigger, BRUCE.openId)).toHaveLength(0)
    const ackB = stream.post(BRUCE, signOutbound(ackText('tsk-b'), BRUCE.name), trigger.msgId)
    const ackZ = stream.post(ZHANG, signOutbound(ackText('tsk-z'), ZHANG.name), trigger.msgId)
    // 复核：双方观察同一顺序。
    const reviewB = reviewClaim({ after: stream.after(trigger.msgId), trigger, selfOpenId: BRUCE.openId, selfTier: (resolutionB as { tier: ClaimTier }).tier, ackId: ackB })
    const reviewZ = reviewClaim({ after: stream.after(trigger.msgId), trigger, selfOpenId: ZHANG.openId, selfTier: (resolutionZ as { tier: ClaimTier }).tier, ackId: ackZ })
    expect(reviewB.verdict).toEqual({ win: true })
    expect(reviewZ.verdict).toEqual({ win: false, to: BRUCE.openId, reason: 'ack-order' })
  })

  it('镜像的顺序：张三先 ack 就是张三赢——裁决只看总序，不看谁是谁', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    const ackZ = stream.post(ZHANG, signOutbound(ackText('tsk-z'), ZHANG.name), trigger.msgId)
    const ackB = stream.post(BRUCE, signOutbound(ackText('tsk-b'), BRUCE.name), trigger.msgId)
    const reviewB = reviewClaim({ after: stream.after(trigger.msgId), trigger, selfOpenId: BRUCE.openId, selfTier: 'presence', ackId: ackB })
    const reviewZ = reviewClaim({ after: stream.after(trigger.msgId), trigger, selfOpenId: ZHANG.openId, selfTier: 'presence', ackId: ackZ })
    expect(reviewZ.verdict).toEqual({ win: true })
    expect(reviewB.verdict).toMatchObject({ win: false, to: ZHANG.openId })
  })

  it('本 ack 不在窗口里（回包没给 id）：退化为 openId 字典序，仍然恰一赢', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    stream.post(ZHANG, signOutbound(ackText('tsk-z'), ZHANG.name), trigger.msgId)
    stream.post(BRUCE, signOutbound(ackText('tsk-b'), BRUCE.name), trigger.msgId)
    const reviewB = reviewClaim({ after: stream.after(trigger.msgId), trigger, selfOpenId: BRUCE.openId, selfTier: 'presence' })
    const reviewZ = reviewClaim({ after: stream.after(trigger.msgId), trigger, selfOpenId: ZHANG.openId, selfTier: 'presence' })
    // 'op-bruce' < 'op-zhang'：确定性比公平重要，因为不确定的那一头是双写。
    expect(reviewB.verdict).toEqual({ win: true })
    expect(reviewZ.verdict).toMatchObject({ win: false, to: BRUCE.openId })
  })

  it('只有一个在岗实例：没有对手，直接开工，tiebreak 是 sole', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    const solo: Instance = { me: BRUCE, scope: 'all', peersOnDuty: [], knownPeers: {} }
    const resolution = resolve(solo, stream, trigger, false)
    expect(resolution).toEqual({ kind: 'mine', tier: 'presence', tiebreak: 'sole', contenders: [] })
    expect(claim(solo, stream, trigger, resolution)).toMatchObject({ kind: 'worked' })
  })
})

describe('断言⑦② 发言者实例优先于在岗 —— 真身跟说话的人', () => {
  it('张三自己在群里 @next：他的实例 0 延迟接单，Bruce 的在岗实例让一周期后静默让位', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(ZHANG, '@next 帮我拉一份报表'), fromOpenId: ZHANG.openId })
    // Bruce 的实例：发言者有实例 → 等一周期。
    expect(resolve(bruce, stream, trigger, false)).toEqual({ kind: 'wait', cycles: 1 })
    // 张三的实例：发言者就是本人 → 发言者梯队，无对手。
    const mine = resolve(zhang, stream, trigger, false)
    expect(mine).toEqual({ kind: 'mine', tier: 'speaker', tiebreak: 'sole', contenders: [] })
    expect(claim(zhang, stream, trigger, mine)).toMatchObject({ kind: 'worked', tier: 'speaker' })
    // 一周期后 Bruce 再看：张三的实例 ack 了 → 静默让位，账上写明让给了谁。
    expect(resolve(bruce, stream, trigger, true))
      .toEqual({ kind: 'yield', reason: 'speaker-instance', to: ZHANG.openId })
  })

  it('梯队高于时序：在岗实例先 ack，发言者实例的 ack 窗口内到达，在岗实例照样让', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(ZHANG, '@next 帮我拉一份报表'), fromOpenId: ZHANG.openId })
    // Bruce（在岗梯队）没等就 ack 了——假设它不知道张三有实例。
    const naive: Instance = { me: BRUCE, scope: 'all', peersOnDuty: [], knownPeers: {} }
    const outcomeB = claim(naive, stream, trigger, resolve(naive, stream, trigger, false), () => {
      // 复核之前，张三的实例 ack 到了。
      stream.post(ZHANG, signOutbound(ackText('tsk-z'), ZHANG.name), trigger.msgId)
    })
    expect(outcomeB).toMatchObject({ kind: 'loud-yield', to: ZHANG.openId, reason: 'speaker-instance' })
    // 张三这一侧复核：Bruce 的 ack 更早、但梯队更低 → 张三赢。
    const reviewZ = reviewClaim({
      after: stream.after(trigger.msgId), trigger, selfOpenId: ZHANG.openId, selfTier: 'speaker',
    })
    expect(reviewZ.verdict).toEqual({ win: true })
  })

  it('发言者的实例没接（未 served 本群）：一周期后视同无实例，在岗实例接', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(ZHANG, '@next 帮我拉一份报表'), fromOpenId: ZHANG.openId })
    const solo: Instance = { me: BRUCE, scope: 'all', peersOnDuty: [], knownPeers: { [ZHANG.openId]: ZHANG.name } }
    expect(resolve(solo, stream, trigger, false)).toEqual({ kind: 'wait', cycles: 1 })
    expect(resolve(solo, stream, trigger, true)).toMatchObject({ kind: 'mine', tier: 'presence', tiebreak: 'sole' })
  })
})

describe('裸命令按同一把刀切，但不等', () => {
  const base = { selfOpenId: BRUCE.openId, selfScope: 'all' as const, peersOnDuty: [ZHANG] }

  it('本人的命令我答；有实例的人的命令归他的实例；没助理的人的命令归对群在岗的我', () => {
    expect(resolveCommand({ ...base, speakerOpenId: BRUCE.openId })).toEqual({ kind: 'mine' })
    expect(resolveCommand({ ...base, speakerOpenId: ZHANG.openId, speakerInstance: ZHANG }))
      .toEqual({ kind: 'yield', reason: 'speaker-instance', to: ZHANG.openId })
    expect(resolveCommand({ ...base, speakerOpenId: LISI.openId })).toEqual({ kind: 'mine' })
  })

  it('仅本人：他人的命令不由我答', () => {
    expect(resolveCommand({ ...base, selfScope: 'self', speakerOpenId: LISI.openId }))
      .toEqual({ kind: 'yield', reason: 'presence', to: ZHANG.openId })
    expect(resolveCommand({ ...base, selfScope: 'self', peersOnDuty: [], speakerOpenId: LISI.openId }))
      .toEqual({ kind: 'unserved' })
  })
})

describe('断言⑦③ 对象归属是第零级 —— 跨实例永不竞赛', () => {
  it('回复同侪实例的消息：不是叫我，静默让位给它，哪怕我对群在岗', () => {
    const resolution = resolveAddressee({
      speakerOpenId: LISI.openId, selfOpenId: BRUCE.openId,
      objectOwner: 'peer', objectOwnerOpenId: ZHANG.openId,
      waited: false, speakerAcked: false, selfScope: 'all', peersOnDuty: [],
    })
    expect(resolution).toEqual({ kind: 'yield', reason: 'object-owner', to: ZHANG.openId })
  })

  it('回复本实例的消息：级 0 判归本图，往下正常走', () => {
    const resolution = resolveAddressee({
      speakerOpenId: LISI.openId, selfOpenId: BRUCE.openId,
      objectOwner: 'self', waited: false, speakerAcked: false, selfScope: 'all', peersOnDuty: [ZHANG],
    })
    expect(resolution).toMatchObject({ kind: 'mine', contenders: [ZHANG.openId] })
  })
})

describe('仅本人合同 —— 不声明、不算在岗、与他人天然无冲突', () => {
  it('同事的 @ 不由仅本人的实例接：有在岗同侪就让给它，没有就如实不接', () => {
    const base = {
      speakerOpenId: LISI.openId, selfOpenId: BRUCE.openId, objectOwner: 'unknown' as const,
      waited: false, speakerAcked: false, selfScope: 'self' as const,
    }
    expect(resolveAddressee({ ...base, peersOnDuty: [ZHANG] }))
      .toEqual({ kind: 'yield', reason: 'presence', to: ZHANG.openId })
    expect(resolveAddressee({ ...base, peersOnDuty: [] })).toEqual({ kind: 'unserved' })
  })

  it('本人自己的 @ 仍由本人的实例接——仅本人不是不接单', () => {
    expect(resolveAddressee({
      speakerOpenId: BRUCE.openId, selfOpenId: BRUCE.openId, objectOwner: 'unknown',
      waited: false, speakerAcked: false, selfScope: 'self', peersOnDuty: [ZHANG],
    })).toEqual({ kind: 'mine', tier: 'speaker', tiebreak: 'sole', contenders: [] })
  })
})

describe('断言⑦⑥ 署名可伪造但失效方向安全 —— 永不导向双写', () => {
  it('一条伪造署名的 ack 让在岗实例静默让位：无人接单，不是两人动手', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    // 一个陌生账号贴了一条长得像同侪 ack 的东西。
    stream.post({ openId: 'op-stranger' }, signOutbound(ackText('tsk-x'), '骗子'), trigger.msgId)
    const outcome = claim(bruce, stream, trigger, resolve(bruce, stream, trigger, false))
    expect(outcome).toMatchObject({ kind: 'silent-yield', to: 'op-stranger' })
    // 账上留痕可追：让给了谁写得清清楚楚——追责的起点。
    expect(worked([outcome])).toHaveLength(0)
  })

  it('伪造的让位帖对赢家没有任何作用：让位是输方自己的动作，不是别人替它做的', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    const outcome = claim(bruce, stream, trigger, resolve(bruce, stream, trigger, false), () => {
      stream.post({ openId: 'op-stranger' }, signOutbound(yieldNotice('张三'), '骗子'), trigger.msgId)
    })
    expect(outcome).toMatchObject({ kind: 'worked' })
  })
})

describe('断言⑦① 同侪回声 —— 代发登记话语在同侪在岗实例上零触发', () => {
  function input(overrides: Partial<TriageInput> = {}): TriageInput {
    return {
      group: GROUP,
      message: message(),
      isOwnOutbound: false,
      isSelfChat: false,
      aliases: ['@next'],
      acceptAccountMentions: false,
      operatorOpenId: BRUCE.openId,
      repliesToAgent: () => false,
      cardForAnchor: () => undefined,
      resolveKeyword: () => undefined,
      ...overrides,
    }
  }

  it('张三实例的代发登记话语带着触发词进群：Bruce 的实例判 peer-echo，永不 trigger', () => {
    const utterance = signOutbound('@next 登记承诺：李四 下周三前交方案 [card#commitment:cmt-1]', ZHANG.name)
    const outcome = triage(input({
      message: message({ content: utterance, fromOpenId: ZHANG.openId }),
      signature: readSignature(utterance),
    }))
    expect(outcome).toEqual({
      kind: 'peer-echo', operatorOpenId: ZHANG.openId, operatorName: ZHANG.name, signal: 'other',
    })
  })

  it('同一句话不带署名（人说的）才是受话——署名是分水岭', () => {
    const outcome = triage(input({ message: message({ content: '@next 登记承诺：李四 下周三前交方案', fromOpenId: ZHANG.openId }) }))
    expect(outcome).toEqual({ kind: 'trigger' })
  })

  it('自己账号发出的署名消息也是回声（工具直连 CLI 的那条路不过出站登记）', () => {
    const own = signOutbound('@next 请看一下', BRUCE.name)
    expect(triage(input({
      message: message({ content: own, fromOpenId: BRUCE.openId }),
      signature: readSignature(own),
    }))).toEqual({ kind: 'echo-suppressed' })
  })

  it('同侪回声在命令与卡片动作之前：一条署名的「/cancel」也不是命令', () => {
    const text = signOutbound('/cancel', ZHANG.name)
    expect(triage(input({
      message: message({ content: text, fromOpenId: ZHANG.openId }), signature: readSignature(text),
    }))).toMatchObject({ kind: 'peer-echo' })
  })

  /*
    实测 2026-09-03（群 6a8400d4…）：同事的实例跑的是署名之前的构建，它的 ack 不带落款；
    它回复我们的消息 → 我们判受话 → 我们 ack 回复它 → 它判受话 → 两个实例对打了十几轮。
    活的幽灵双胞胎。过渡期规则：机器形状即实例出站。
  */
  it('过渡期：署名之前的实例发的「【Agent】已接收」也是同侪回声，永不受话——两个实例不再对打', () => {
    const legacyAck = message({
      msgId: 'm-legacy', content: '【Agent】已接收，正在处理。', fromOpenId: ZHANG.openId,
      // 它回复的是我们的消息——正是 v4.7「回复 agent 消息即受话」会点着的那种。
      param: { replyMsgId: 'ours-1' },
    })
    const outcome = triage(input({ message: legacyAck, repliesToAgent: () => true }))
    expect(outcome).toEqual({ kind: 'peer-echo', operatorOpenId: ZHANG.openId, operatorName: '', signal: 'ack' })
    // 旧构建的终态回帖带句柄，也是机器形状。
    expect(triage(input({
      message: message({ content: '。\n\n回复「验收」或「打回 <原因>」定终态。[card#task:tsk-1]', fromOpenId: ZHANG.openId }),
      repliesToAgent: () => true,
    }))).toMatchObject({ kind: 'peer-echo' })
    // 旧构建的确认卡同理。
    expect(triage(input({
      message: message({ content: '【云之家确认】云之家操作确认：新建知识库文档', fromOpenId: ZHANG.openId }),
    }))).toMatchObject({ kind: 'peer-echo' })
    // 自己旧构建留下的、没登记的机器话回来了：回声。
    expect(triage(input({
      message: message({ content: '【Agent】本回合没有产生回复。', fromOpenId: BRUCE.openId }),
    }))).toEqual({ kind: 'echo-suppressed' })
  })

  it('旧构建的 ack 在看一眼/复核里也算同侪认领：它真的会开工', () => {
    const stream = new Stream()
    const trigger = message({ msgId: stream.post(LISI, '@next 帮我拉一份报表') })
    stream.post(ZHANG, '【Agent】已接收，正在处理。', trigger.msgId)
    const acks = acksIn(stream.after(trigger.msgId), trigger, BRUCE.openId)
    expect(acks.map(ack => ack.openId)).toEqual([ZHANG.openId])
    expect(claim(bruce, stream, trigger, resolve(bruce, stream, trigger, false)))
      .toMatchObject({ kind: 'silent-yield', to: ZHANG.openId })
  })

  it('同侪出站的三种信号都认得出：在岗声明 / 退岗 / ack / 让位', () => {
    expect(classifyPeerOutbound(signOutbound(presenceDeclaration('张三'), '张三'))).toBe('presence-declared')
    expect(classifyPeerOutbound(signOutbound(presenceWithdrawal('张三'), '张三'))).toBe('presence-withdrawn')
    expect(classifyPeerOutbound(signOutbound(ackText('tsk-1'), '张三'))).toBe('ack')
    expect(classifyPeerOutbound(signOutbound(yieldNotice('Bruce'), '张三'))).toBe('yield')
    expect(classifyPeerOutbound(signOutbound('已登记承诺。', '张三'))).toBe('other')
  })
})

describe('断言⑤′ 桌面出站对称 —— 非在岗场所不就地点火', () => {
  it('不在岗、有同侪在岗：话照发、不点火、由它接单（不是拒发）', () => {
    expect(deskSendPlan({ addressesAgent: true, repliesToAgent: false, onDuty: false, peerOnDuty: true }))
      .toBe('send-deferred')
  })

  it('不在岗、也没人在岗：拒发——一个永远没人应答的公开 @ 比拦下它糟', () => {
    expect(deskSendPlan({ addressesAgent: true, repliesToAgent: false, onDuty: false, peerOnDuty: false }))
      .toBe('refuse')
  })

  it('在岗：就地点火，同侪见 ack 让位', () => {
    expect(deskSendPlan({ addressesAgent: true, repliesToAgent: false, onDuty: true, peerOnDuty: true }))
      .toBe('send-and-ignite')
  })

  it('回复同侪实例的消息 = 文本传送门：动作经文本到达真身实例，本机永不就地动手', () => {
    expect(deskSendPlan({ addressesAgent: true, repliesToAgent: false, onDuty: true, repliesToPeer: true }))
      .toBe('send-deferred')
  })
})

describe('署名协议 —— 一切实例出站恒带署名，桌面出站不带', () => {
  let state: ChannelState
  let sent: string[]

  beforeEach(async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'yzj-next-presence-')), 'state.json')
    state = new ChannelState(file)
    await state.load()
    state.selectAccount('acct-1')
    sent = []
  })

  function client(): YzjChannelClient {
    const ctx = {
      yzjBridge: {
        run: async (command: readonly string[]): Promise<YzjRunResult> => {
          sent.push(command[command.indexOf('--content') + 1] ?? '')
          const json = { msgId: `sent-${String(sent.length)}`, groupId: 'g-1' }
          return Promise.resolve({
            ok: true, exitCode: 0, stdout: JSON.stringify(json), stderr: '', json,
            truncated: false, timedOut: false, durationMs: 1,
          })
        },
      },
    } as unknown as Context
    const instance = new YzjChannelClient(ctx, state, 5_000)
    instance.pinIdentity({ orgId: 'org-1', openId: BRUCE.openId, name: BRUCE.name })
    return instance
  }

  it('agent 出站落款「—— 云小助（Bruce）」，且回声指纹按签完的正文算', async () => {
    await client().send({ groupId: 'g-1' }, '【Agent】已接收，正在处理。')
    expect(sent[0]).toMatch(new RegExp(`—— ${SIGNATURE_AGENT}（Bruce）$`, 'u'))
    expect(readSignature(sent[0] ?? '')).toEqual({ agent: SIGNATURE_AGENT, operator: 'Bruce' })
    // 回来的那条带着落款；登记要认得出它是我们的，否则 agent 会回答自己。
    expect(state.isOwnOutbound('sent-1', 'g-1', outboundFingerprint('g-1', sent[0] ?? ''))).toBe(true)
    expect(state.isAgentOutboundId('sent-1')).toBe(true)
  })

  it('桌面出站是人自己在说话：不签', async () => {
    await client().send({ groupId: 'g-1' }, '@next 帮我拉一份报表', undefined, 'desk')
    expect(readSignature(sent[0] ?? '')).toBeUndefined()
    expect(sent[0]).toBe('@next 帮我拉一份报表')
  })

  it('已经签过的不再签', async () => {
    await client().send({ groupId: 'g-1' }, signOutbound('已登记。', 'Bruce'))
    expect((sent[0] ?? '').match(/—— 云小助/gu)).toHaveLength(1)
  })
})

describe('在岗声明 —— 接单 = 人签发的身份/听众敏感动作', () => {
  it('接单记录带范围：对群在岗 / 仅本人；摘单不带', () => {
    expect(serveRecordFor('g1', true, '830 项目', 'all'))
      .toEqual({ placeKey: 'yzj-group-g1', served: true, groupName: '830 项目', scope: 'all' })
    expect(serveRecordFor('g1', true, '830 项目', 'self')).toMatchObject({ scope: 'self' })
    expect(serveRecordFor('g1', false, '830 项目', 'all')).not.toHaveProperty('scope')
  })

  it('范围随接单一起落盘', async () => {
    const saved: unknown[] = []
    await applyServe({
      groupId: 'g1', on: true, scope: 'self',
      allowedGroupIds: new Set(), deniedGroupIds: new Set(),
      record: async () => undefined,
      persist: async (id, served, scope) => { saved.push([id, served, scope]) },
    })
    expect(saved).toEqual([['g1', true, 'self']])
  })

  it('请对方退岗是拟稿，不是代发：措辞里说清一个群只能有一个在岗实例', () => {
    const draft = withdrawRequestDraft('张三', '830 项目')
    expect(draft).toContain('张三')
    expect(draft).toContain('830 项目')
    expect(draft).toContain('一个群只能有一个在岗实例')
  })
})

describe('运行态：同侪观测与让位一周期都要落盘', () => {
  let state: ChannelState
  let file: string

  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'yzj-next-presence-state-')), 'state.json')
    state = new ChannelState(file)
    await state.load()
    state.selectAccount('acct-1')
  })

  it('在岗观测只往前走：更早的观测不能推翻更晚的', () => {
    state.setPeerPresence('g-1', ZHANG.openId, { on: true, msgId: 'm-2', time: 200, name: '张三' })
    state.setPeerPresence('g-1', ZHANG.openId, { on: false, msgId: 'm-1', time: 100, name: '张三' })
    expect(state.peersOnDutyIn('g-1').map(peer => peer.openId)).toEqual([ZHANG.openId])
    state.setPeerPresence('g-1', ZHANG.openId, { on: false, msgId: 'm-3', time: 300, name: '张三' })
    expect(state.peersOnDutyIn('g-1')).toEqual([])
  })

  it('一个月没出声的同侪不再当它存在：级 1 的一周期延迟不为卸了的助理永远付', async () => {
    const now = Date.now()
    state.rememberPeer(ZHANG.openId, '张三', now - 31 * 24 * 60 * 60 * 1_000)
    state.rememberPeer(LISI.openId, '李四', now)
    await state.save(now)
    expect(state.peerOf(ZHANG.openId)).toBeUndefined()
    expect(state.peerOf(LISI.openId)?.name).toBe('李四')
  })

  it('停车、范围、同侪都跨重启存活——游标过了的触发不能靠内存', async () => {
    state.setServed('g-1', true, 'self')
    state.rememberPeer(ZHANG.openId, '张三', Date.now())
    state.recordPeerMessage({ msgId: 'ack-1', groupId: 'g-1', openId: ZHANG.openId, time: Date.now(), signal: 'ack', replyMsgId: 'm-1' })
    state.park({ group: GROUP, message: message(), readyAt: 5 })
    await state.save()

    const reopened = new ChannelState(file)
    await reopened.load()
    reopened.selectAccount('acct-1')
    expect(reopened.scopeOf('g-1')).toBe('self')
    expect(reopened.peerOf(ZHANG.openId)?.name).toBe('张三')
    expect(reopened.peerAcksOn('g-1', 'm-1').map(ack => ack.openId)).toEqual([ZHANG.openId])
    expect(reopened.parked().map(entry => entry.message.msgId)).toEqual(['m-1'])
    reopened.unpark('m-1')
    expect(reopened.parked()).toEqual([])
  })
})
