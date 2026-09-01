/**
 * 人的动词 —— every write into the private ledger, in one place.
 *
 * Two rules bind everything in this file:
 *
 * - **actor 恒为 operator.** `gear/*`, `mirror/*` and every attribution are
 *   signed by a person (§8 持镜人条款). The agent has no tool that reaches
 *   these — see `tools.ts`, where the two model-facing tools are read-only or
 *   text-free.
 * - **原话直存.** Wherever a sentence of the operator's own words enters the
 *   ledger ({@link pledge}'s bet, {@link noteFact}'s fact), it arrives as a
 *   string the orchestration layer took verbatim from what the person typed.
 *   Nothing in this path can rewrite it, because nothing in this path is a
 *   model (PTD-12).
 *
 * 拒绝要**说得清是哪一种** (断言⑭): 立约有三种走不通，重复 / 越窗 / 无邀约——
 * 把它们压成一句「不行」，人就没有办法知道该做什么。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import type { PledgerCards } from './bus.ts'
import {
  expectationIdemKeyFor, factIdFor, inviteIdFor, mirrorIdFor,
} from './families.ts'
import type { Attribution, Gear, OrgAnchor } from './types.ts'

/** Why a write did not happen. Each reason names a different next step. */
export type PledgeRefusal =
  /** 同一裁决已经立过了——幂等锚吸收（改赌注 = 撤回，且不可再立）。 */
  | { readonly kind: 'duplicate'; readonly message: string }
  /** 邀约已经不开着了：这是**越窗**，不是重复。预期只在裁决时刻出生。 */
  | { readonly kind: 'window-closed'; readonly message: string }
  /** 这次裁决从来没有过邀约——事后补立走不通。 */
  | { readonly kind: 'no-invite'; readonly message: string }
  | { readonly kind: 'disabled'; readonly message: string }

export type PledgeOutcome =
  | { readonly ok: true; readonly expectationId: string }
  | { readonly ok: false; readonly refusal: PledgeRefusal }

const operatorActor = (ctx: Context): { kind: 'operator'; openId?: string } => {
  const openId = ctx.get('yzjPledger')?.owner
  return { kind: 'operator', ...(openId === undefined ? {} : { openId }) }
}

/**
 * 立约 —— the only door, and it is bound to ONE verdict's invite.
 *
 * 双锁 (PTD-13): 幂等锚防重复，立约时窗防事后补立。单锁可绕——一个只有幂等锚的
 * 实现，允许你在检验点前一天翻回三个月前的裁决补一句「我早就知道」，而那正是这
 * 整条环要防的自欺。
 */
export async function pledgeOnVerdict(
  ctx: Context,
  bus: PledgerCards,
  input: { readonly verdict: OrgAnchor; readonly text: string },
): Promise<PledgeOutcome> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) {
    return { ok: false, refusal: { kind: 'disabled', message: '私账层未启用。' } }
  }
  const existing = pledger.findByIdemKey(expectationIdemKeyFor(input.verdict))
  if (existing !== undefined) {
    return {
      ok: false,
      refusal: {
        kind: 'duplicate',
        message: '这次裁决已经立过预期了。预期**不可改笔**：改赌注 = 撤回，且同一裁决不可再立。',
      },
    }
  }
  const inviteId = inviteIdFor(input.verdict)
  const invite = pledger.object('invite', inviteId)
  if (invite === undefined) {
    return {
      ok: false,
      refusal: {
        kind: 'no-invite',
        message: '这次裁决没有开过立约邀约，所以现在立不了。'
          + '**预期只在裁决时刻出生**——事后补立会让金库长出一条「我早就知道」的行，那条环就白走了。',
      },
    }
  }
  if (asString(asRecord(invite.state)?.status) !== 'open') {
    return {
      ok: false,
      refusal: {
        kind: 'window-closed',
        message: '那次裁决的立约邀约已经关上了（你按下不表，或已经立过）。'
          + '这是**越窗**，不是重复：下一次裁决时我会再问你一次。',
      },
    }
  }
  const result = await bus.act({ kind: 'invite', id: inviteId }, 'pledge', operatorActor(ctx), 'desktop', input.text)
  if (result.outcome !== 'applied') {
    return { ok: false, refusal: { kind: 'window-closed', message: result.receipt } }
  }
  const expectation = pledger.findByIdemKey(expectationIdemKeyFor(input.verdict))
  return expectation === undefined
    ? { ok: false, refusal: { kind: 'window-closed', message: '立约没有落库，请再试一次。' } }
    : { ok: true, expectationId: expectation.id }
}

/** 不立 —— 按下不表。人用脚投票就是应答，连续三次这一族整体降频。 */
export async function declineInvite(
  ctx: Context, bus: PledgerCards, inviteId: string,
): Promise<string> {
  const result = await bus.act({ kind: 'invite', id: inviteId }, 'decline', operatorActor(ctx), 'desktop')
  return result.receipt
}

/**
 * 撤回 —— 唯一退出动词，留痕不删史.
 *
 * 前提消失时撤回预期是**诚实，不是失败**。所以它记理由、留在金库的已撤回区，而
 * 那一区一个动词都没有：撤回是终态，不悔棋。
 */
export async function withdrawExpectation(
  ctx: Context, expectationId: string, reason: string,
): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  await pledger.append({
    type: 'expectation/withdrawn',
    data: { expectationId, reason },
    actor: operatorActor(ctx),
  })
}

/**
 * 补登事实 —— 图外事实的唯一入口 (PTD-11).
 *
 * 系统不猜图外。线下评审、口头反馈、邮件结果，全部经这一句话进来，而这句话是
 * **人的原话**：`text` 由编排层从人打的字直取，模型工具上根本没有这个参数。
 */
export async function noteFact(
  ctx: Context,
  input: {
    readonly text: string
    readonly about:
      | { readonly kind: 'verdict'; readonly verdictRef: OrgAnchor }
      | { readonly kind: 'expectation'; readonly expectationId: string }
    readonly anchor?: string
  },
): Promise<string> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  const aboutKey = input.about.kind === 'verdict'
    ? `${input.about.verdictRef.kind}:${input.about.verdictRef.id}`
    : input.about.expectationId
  const factId = factIdFor(aboutKey, input.text, Date.now())
  await pledger.append({
    type: 'fact/noted',
    data: {
      factId,
      text: input.text,
      about: input.about.kind === 'verdict'
        ? { kind: 'verdict', verdictRef: { ...input.about.verdictRef } }
        : { kind: 'expectation', expectationId: input.about.expectationId },
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    },
    actor: operatorActor(ctx),
  })
  return factId
}

/**
 * 改归因 —— **更正即追加，最新生效** (§6 数据律).
 *
 * 不走动作总线：总线守的是「一张卡答完就不再接受动作」，而改归因恰恰是答完之后
 * 的那个动词。史不改，最新那条 `answered` 生效——这本账允许你重新看待一件旧事，
 * 但不允许你假装从没那么看过。
 */
export async function reattribute(
  ctx: Context, calibrationId: string, attribution: Attribution,
): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  const current = pledger.object('calibration', calibrationId)
  if (current === undefined) throw new Error(`找不到校准回执 ${calibrationId}`)
  if (asString(asRecord(current.state)?.status) === 'dismissed') {
    throw new Error('这条被标注了「配对错了」——先纠回，再谈归因。')
  }
  await pledger.append({
    type: 'calibration/answered',
    data: { calibrationId, attribution },
    actor: operatorActor(ctx),
  })
}

/**
 * 换挡 —— 档位是**人的私有设置**，也是回路的合环阀 (#61).
 *
 * `lease` 档在这里被**拒绝而不是假装**：租约本体是组织侧的既有事件，创建走强确认
 * 流程，而那一族还没有开门。私账代发一份并不存在的授权，会让免确认这件事在组织侧
 * 无迹可查——那是这条设计里最不能出的错 (PTD-7)。
 */
export async function shiftGear(
  ctx: Context,
  input: {
    readonly family: string
    readonly gear: Gear
    readonly entry: 'tail' | 'vault'
    readonly evidenceSnapshot?: string
  },
): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  if (input.gear === 'lease') {
    throw new Error(
      '租约档要先在组织侧签发一份授权租约（强确认流程），而授权租约族还没有开门。'
      + '私账只记你换过挡，不代发授权——免确认是组织侧行为，它的审计必须留在组织侧。',
    )
  }
  await pledger.append({
    type: 'gear/shifted',
    data: {
      family: input.family,
      gear: input.gear,
      entry: input.entry,
      ...(input.evidenceSnapshot === undefined ? {} : { evidenceSnapshot: input.evidenceSnapshot }),
    },
    actor: operatorActor(ctx),
  })
}

/**
 * 后视镜开关 —— **你预先签发的私账规则，不是 agent 临场的好意** (#61).
 *
 * 默认不开、随时可关。agent 只执行显示：它不会在你裁决的那一刻凑上来说「你上次
 * 就是这么错的」——那既是说教剧场，也是持镜人违规。
 */
export async function toggleMirror(
  ctx: Context, family: string, patternKey: string, on: boolean,
): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  await pledger.append({
    type: 'mirror/toggled',
    data: { family, patternKey, on, mirrorId: mirrorIdFor(family, patternKey) },
    actor: operatorActor(ctx),
  })
}

/** 重新打开这一族的邀约 —— 降频的唯一恢复动词，入口只在金库。 */
export async function reopenInvites(ctx: Context, family: string): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  await pledger.append({
    type: 'invite/reopened',
    data: { family },
    actor: operatorActor(ctx),
  })
}
