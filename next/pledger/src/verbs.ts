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
import { QUOTA_RANGE } from './ring.ts'
import {
  anchoredJson, snapshot,
  type AnchoredText, type Attribution, type Gear, type GearEntry, type OrgAnchor,
} from './types.ts'

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
      | { readonly kind: 'verdict'; readonly verdict: AnchoredText }
      | { readonly kind: 'expectation'; readonly expectationId: string }
    readonly anchor?: string
  },
): Promise<string> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  const now = Date.now()
  const aboutKey = input.about.kind === 'verdict'
    ? `${input.about.verdict.anchor?.kind ?? ''}:${input.about.verdict.anchor?.id ?? ''}`
    : input.about.expectationId
  const factId = factIdFor(aboutKey, input.text, now)
  await pledger.append({
    type: 'fact/noted',
    data: {
      factId,
      // 人的原话，一张照片 —— 图外事实本来就没有锚（立此存照律）。
      fact: anchoredJson(snapshot(input.text, undefined, now)),
      about: input.about.kind === 'verdict'
        ? { kind: 'verdict', verdict: anchoredJson(input.about.verdict) }
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
    /** `'receipt'` = 就地合环那一个入口（入口不垄断律）。 */
    readonly entry: GearEntry
    readonly evidenceSnapshot?: readonly AnchoredText[]
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
  /*
    **换挡的依据也要立此存照**（v2.0 由可空改必填）。

    不存它，半年后回看只剩一个「我换过挡」的空记录——换挡也是裁决，而一次读不出
    依据的裁决，和一条只有 id 的判例是同一种空壳。
  */
  const now = Date.now()
  const evidence = input.evidenceSnapshot ?? [
    snapshot(`换挡时这一族的档位是 ${gearNow(ctx, input.family)}`, undefined, now),
  ]
  await pledger.append({
    type: 'gear/shifted',
    data: {
      family: input.family,
      gear: input.gear,
      entry: input.entry,
      evidenceSnapshot: evidence.map(anchoredJson),
    },
    actor: operatorActor(ctx),
  })
}

/** 这一族此刻的档位。换挡留痕要说得出「从哪一档换过来的」。 */
function gearNow(ctx: Context, family: string): string {
  return asString(asRecord(ctx.get('yzjPledger')?.object('gear', family)?.state)?.gear) ?? 'default'
}

/**
 * 后视镜开关 —— **你预先签发的私账规则，不是 agent 临场的好意** (#61).
 *
 * 默认不开、随时可关。agent 只执行显示：它不会在你裁决的那一刻凑上来说「你上次
 * 就是这么错的」——那既是说教剧场，也是持镜人违规。
 */
export async function toggleMirror(
  ctx: Context, family: string, patternKey: string, on: boolean,
  /** 在哪儿开的。就地合环记 `'receipt'`——入口不垄断律的留痕面。 */
  entry: 'vault' | 'receipt' = 'vault',
): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  await pledger.append({
    type: 'mirror/toggled',
    data: { family, patternKey, on, entry, mirrorId: mirrorIdFor(family, patternKey) },
    actor: operatorActor(ctx),
  })
}

/**
 * 调全局日配额 —— **扩触发面的对偶**，也是软合同里唯一由人调的那几个数之一.
 *
 * `0` 是合法值：**全关邀约**。一个不能被关到零的「可调」，是假的可调。
 */
export async function setDailyQuota(ctx: Context, quota: number): Promise<void> {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined) throw new Error('私账层未启用')
  if (!Number.isInteger(quota) || quota < QUOTA_RANGE.min || quota > QUOTA_RANGE.max) {
    throw new Error(`日配额只能是 ${String(QUOTA_RANGE.min)}-${String(QUOTA_RANGE.max)} 的整数。`)
  }
  await pledger.append({
    type: 'invite/quota-set',
    data: { quota },
    actor: operatorActor(ctx),
  })
}

/**
 * 照旧对表 —— 锚死显形的**第二个出口** (v2.0 / #62-A3).
 *
 * 前提变了，可你仍然想对这次判断打一格：那也是完全正当的。给不出这个出口，显形
 * 就变成了一句只能顺从的通知。**它什么都不写**：把这一行标成「照旧」是查看者的
 * 选择，不是账上的事实——真正的落账在后来那张回执上。
 */
export function settleAnyway(): { readonly note: string } {
  return { note: '前提变了，但你的判断照旧对表——事实回流来的时候，回执照样会出。' }
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
