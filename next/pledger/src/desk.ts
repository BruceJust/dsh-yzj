/**
 * 桌面面 —— the one seam the surface consumes.
 *
 * 依赖方向铁律 (§1): `surface ──依赖──▶ pledger`, and never the other way. So
 * everything the desktop needs — 金库、私语流、后视镜条、两读卡、档位生效面 —
 * arrives through this single interface, and the surface never learns the shape
 * of the private log.
 *
 * **私账内容离开桌面通道即事故** (§7). Every projection below is for the
 * operator's own desktop render pass. None of it is reachable from `renderText`
 * on an organization card, from a native card, or from any place view — and
 * 断言⑧ uses the strings in here as canaries to prove it.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import { PledgerCards } from './bus.ts'
import { calibrationCard, type CalibrationState } from './calibration.ts'
import { DESTROY_PHRASE } from './destroy.ts'
import { familyOfCardKind } from './families.ts'
import { inviteCard, type InviteState } from './invite.ts'
import { mirrorCases, patternsIn } from './patterns.ts'
import { vaultView, type VaultView } from './vault.ts'
import {
  declineInvite, noteFact, pledgeOnVerdict, reattribute, reopenInvites,
  shiftGear, toggleMirror, withdrawExpectation,
  type PledgeOutcome,
} from './verbs.ts'
import { DEFAULT_PATTERN_WINDOW, type Attribution, type Gear, type OrgAnchor, type PatternWindow } from './types.ts'

/** One row of the private stream — 私语通道的两位新住客。 */
export interface PrivateRow {
  readonly kind: 'invite' | 'calibration'
  readonly id: string
  readonly at: number
  readonly seq: number
  readonly state: InviteState | CalibrationState
  readonly resolved: boolean
  readonly actions: readonly {
    readonly id: string
    readonly label: string
    readonly style?: string
    readonly needsInput: boolean
    readonly available: boolean
  }[]
}

/**
 * 后视镜条 —— **仅操作者桌面渲染层**，永不进文本通道 (#61 / 接缝⑤).
 *
 * 文本投影落在组织场所里，私账内容一混入即泄漏。所以这条只在桌面卡片的渲染管道
 * 上组合出来，`renderText` 那条路根本经不过它。
 */
export interface MirrorStrip {
  readonly family: string
  readonly patternLabel: string
  readonly cases: readonly { readonly calibrationId: string; readonly thenText: string; readonly factText: string }[]
  /** 「判断仍由你下」——文案随条，不是可选的礼貌。 */
  readonly note: string
}

/**
 * 条尾两读 —— 「这类确认还需要你吗›」(接缝④ / §7.1 语义扩员，零新入口).
 *
 * 分岔从一个出口扩成两个：这类裁决**不再需要你**（→ 租约）或它**需要你更多**
 * （→ 负重：摆开证据、不预选、无一键通过）。
 */
export interface TwoRead {
  readonly family: string
  readonly label: string
  readonly gear: Gear
  /** 证据来自你的私账——组织侧没人看得见这张卡。 */
  readonly evidence: readonly string[]
  readonly leaseAvailable: boolean
  readonly leaseNote?: string
  /** 「仅你可见 · 非消息」——两读卡自己说清它是什么。 */
  readonly note: string
}

/**
 * 档位生效面 —— `weight` 的桌面形态 (§4).
 *
 * `weight` = 摆开证据、**不预选**、**无一键通过**，且**仅操作者桌面**：文本投影
 * 不变，组织侧无人知晓你的档位。这个对象就是渲染层读的那一份指令。
 */
export interface GearEffect {
  readonly family: string
  readonly gear: Gear
  /** 负重档下：不预选任何动作。 */
  readonly preselect: boolean
  /** 负重档下：不给一键通过。 */
  readonly quickAccept: boolean
  /** 负重档下：把证据摊开。 */
  readonly spreadEvidence: boolean
}

export interface PledgerDesk {
  readonly enabled: boolean
  vault(window?: PatternWindow): VaultView | undefined
  /** 私语流：未答邀约与回执，静躺在这里，不老化不可催。 */
  privateRows(): readonly PrivateRow[]
  /** 后视镜条：这张组织侧卡片旁边，你自己签发的判例。空 = 不画。 */
  stripFor(cardKind: string): MirrorStrip | undefined
  /** 条尾两读：这类裁决还需要你吗。未启用 / 未知族 = 回落为原租约单出口。 */
  twoReadFor(cardKind: string): TwoRead | undefined
  /** 档位对渲染层的指令。未启用 = 默认档，界面一个字不变。 */
  gearEffectFor(cardKind: string): GearEffect
  act(kind: string, id: string, actionId: string, input?: string): Promise<{ receipt: string; outcome: string }>
  pledge(verdict: OrgAnchor, text: string): Promise<PledgeOutcome>
  decline(inviteId: string): Promise<string>
  withdraw(expectationId: string, reason: string): Promise<void>
  note(text: string, about: { kind: 'verdict'; verdictRef: OrgAnchor } | { kind: 'expectation'; expectationId: string }): Promise<string>
  reattribute(calibrationId: string, attribution: Attribution): Promise<void>
  shift(family: string, gear: Gear, entry: 'tail' | 'vault'): Promise<void>
  mirror(family: string, patternKey: string, on: boolean): Promise<void>
  reopenInvites(family: string): Promise<void>
  /**
   * 销毁要原样打出来的那句话 —— **服务端说了算，界面只是转述**.
   *
   * 两处各写一份字面，就是两份要一起维护的口令：它们一旦对不上，按钮是亮的而服务端
   * 拒绝，人会以为销毁坏了。发出来，客户端就没有第二个真相。
   */
  readonly destroyPhrase: string
  /** 销毁 —— 两段式的第二段。第一段（确认）在界面上，不在这里。 */
  destroy(confirm: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Absent when `pledger.enabled` is false — every consumer degrades on that. */
    yzjPledgerDesk?: PledgerDesk
  }
}

export function createDesk(ctx: Context, bus: PledgerCards): PledgerDesk {
  const window = DEFAULT_PATTERN_WINDOW
  const operatorActor = (): { kind: 'operator'; openId?: string } => {
    const openId = ctx.get('yzjPledger')?.owner
    return { kind: 'operator', ...(openId === undefined ? {} : { openId }) }
  }
  return {
    get enabled() {
      return ctx.get('yzjPledger')?.ready === true
    },

    destroyPhrase: DESTROY_PHRASE,

    vault(requested?: PatternWindow): VaultView | undefined {
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) return undefined
      return vaultView(pledger, { window: requested ?? window })
    },

    privateRows(): readonly PrivateRow[] {
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) return []
      const rows: PrivateRow[] = []
      for (const kind of ['invite', 'calibration'] as const) {
        const definition = kind === 'invite' ? inviteCard : calibrationCard
        for (const object of pledger.query(kind)) {
          const state = object.state as never
          rows.push({
            kind,
            id: object.id,
            at: object.createdAt,
            seq: object.createdSeq,
            state: object.state as unknown as InviteState | CalibrationState,
            resolved: definition.isResolved(state),
            actions: definition.actions.map(action => ({
              id: action.id,
              label: action.label,
              ...(action.style === undefined ? {} : { style: action.style }),
              needsInput: action.needsInput === true,
              available: action.available?.(state) ?? true,
            })),
          })
        }
      }
      return rows.sort((left, right) => left.seq - right.seq)
    },

    stripFor(cardKind: string): MirrorStrip | undefined {
      const pledger = ctx.get('yzjPledger')
      const family = familyOfCardKind(cardKind)?.family
      if (pledger === undefined || !pledger.ready || family === undefined) return undefined
      /*
        条上写的是**那个模式自己的名字**，不是一个拼出来的 id。

        上一版这里是 `mirrorIdFor(family, ...)`——一个内部地址，渲染出来是
        「delivery-acceptance:delivery-acceptance:q3」。条是一扇门，门上得写着门后
        是什么；写一个人读不懂的键，等于把门画成了墙。
      */
      const on = patternsIn(pledger, window).filter(one => one.family === family && one.mirror)
      const cases = mirrorCases(pledger, family, window)
      if (cases.length === 0 || on.length === 0) return undefined
      return {
        family,
        patternLabel: on.map(one => one.label).join(' · '),
        cases: cases.map(one => ({
          calibrationId: one.calibrationId,
          thenText: one.thenText,
          factText: one.factText,
        })),
        note: '仅你可见 · 你在金库签发的负重显示（回喂环）——判断仍由你下',
      }
    },

    twoReadFor(cardKind: string): TwoRead | undefined {
      const pledger = ctx.get('yzjPledger')
      const spec = familyOfCardKind(cardKind)
      if (pledger === undefined || !pledger.ready || spec === undefined) return undefined
      const view = vaultView(pledger, { window })
      const row = view.gears.find(one => one.family === spec.family)
      if (row === undefined) return undefined
      return {
        family: spec.family,
        label: spec.label,
        gear: row.gear,
        evidence: row.evidence,
        leaseAvailable: row.leaseAvailable,
        ...(row.leaseNote === undefined ? {} : { leaseNote: row.leaseNote }),
        note: '仅你可见 · 非消息 —— 证据来自你的私账，组织侧没人看得见这张卡',
      }
    },

    gearEffectFor(cardKind: string): GearEffect {
      const pledger = ctx.get('yzjPledger')
      const family = familyOfCardKind(cardKind)?.family
      const gear = (family === undefined || pledger === undefined || !pledger.ready)
        ? 'default'
        : (asString(asRecord(pledger.object('gear', family)?.state)?.gear) ?? 'default') as Gear
      return {
        family: family ?? '',
        gear,
        /*
          负重档 = 「你先拆，我再补」的显示形态。

          三件事一起改，缺一件就不是负重：**不预选**（预选就是替你先答了）、
          **无一键通过**（一键通过是把裁决压成一次手势）、**摆开证据**（否则
          「先手」没有材料）。
        */
        preselect: gear !== 'weight',
        quickAccept: gear !== 'weight',
        spreadEvidence: gear === 'weight',
      }
    },

    async act(kind, id, actionId, input) {
      const result = await bus.act({ kind, id }, actionId, operatorActor(), 'desktop', input)
      return { receipt: result.receipt, outcome: result.outcome }
    },

    pledge: async (verdict, text) => pledgeOnVerdict(ctx, bus, { verdict, text }),
    decline: async inviteId => declineInvite(ctx, bus, inviteId),
    withdraw: async (expectationId, reason) => { await withdrawExpectation(ctx, expectationId, reason) },
    note: async (text, about) => noteFact(ctx, { text, about }),
    reattribute: async (calibrationId, attribution) => { await reattribute(ctx, calibrationId, attribution) },
    shift: async (family, gear, entry) => { await shiftGear(ctx, { family, gear, entry }) },
    mirror: async (family, patternKey, on) => { await toggleMirror(ctx, family, patternKey, on) },
    reopenInvites: async family => { await reopenInvites(ctx, family) },

    /**
     * 销毁 —— **不可逆人签发终态同款门**.
     *
     * 两段式：界面上先说清会发生什么，然后人**把那句话打出来**。一个只需要点两下
     * 的销毁，和一个点一下的销毁，防住的是同一件事的零点几倍。
     */
    async destroy(confirm: string) {
      if (confirm !== DESTROY_PHRASE) {
        throw new Error(`销毁是不可逆的：请原样输入「${DESTROY_PHRASE}」以确认。`)
      }
      await ctx.get('yzjPledger')?.destroy()
    },
  }
}
