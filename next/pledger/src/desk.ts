/**
 * 桌面面 —— the one seam the surface consumes.
 *
 * 依赖方向铁律 (§1): `surface ──依赖──▶ pledger`, and never the other way. So
 * everything the desktop needs — 金库、私语流、证据面、后视镜条、两读卡、档位生效面、
 * 金库内检索 — arrives through this single interface.
 *
 * **私账内容离开桌面通道即事故** (§7). Every projection below is for the
 * operator's own desktop render pass; 断言⑧ uses their strings as canaries.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import { PledgerCards } from './bus.ts'
import { calibrationCard, type CalibrationState } from './calibration.ts'
import { DESTROY_PHRASE } from './destroy.ts'
import { vaultExport, type VaultExport } from './export.ts'
import { PROPOSAL_FAMILIES, familyOfCardKind } from './families.ts'
import { inviteCard, type InviteState } from './invite.ts'
import { anchoredOf, attributionDistribution, mirrorCases, patternsIn } from './patterns.ts'
import { invitesToday, quotaOf } from './ring.ts'
import { FORBIDDEN_VERBS, vaultView, type VaultView } from './vault.ts'
import {
  declineInvite, noteFact, pledgeOnVerdict, reattribute, reopenInvites, setDailyQuota,
  settleAnyway, shiftGear, toggleMirror, withdrawExpectation,
  type PledgeOutcome,
} from './verbs.ts'
import { isAlive, seenVerdicts } from './verdicts.ts'
import {
  DEFAULT_PATTERN_WINDOW, FOLD_THRESHOLD, SETTLE_DAYS,
  type AnchoredText, type Attribution, type CapabilityEntries, type Gear, type GearEntry,
  type OrgAnchor, type PatternWindow, type PremiseState,
} from './types.ts'

/**
 * 这一族攒到多少次裁决，「还需要你吗」才值得问一次.
 *
 * 五 —— 和会话决断条那条**条长即治理信号**的阈值同一个数。两处问的是同一件事的两个
 * 面：那里是「同时挂着五件待答」，这里是「这一类你已经答过五次」。
 */
const TWO_READ_MIN_VERDICTS = 5

/**
 * 私账能力 → 它的入口们 —— **入口不垄断律的执法机关** (v2.0 / PTD-21).
 *
 * #61 写着「凡只能在金库获得的能力即违规」，可那一直只是一句文字。**给自己立的法
 * 要有自己的执法机关**：这张表被断言⑳ 校验——任一能力的入口 < 2 即红，而**金库
 * 独占的那些必须自己标出来**（`vaultOnly`），且那个集合被冻在已知的两项上。
 *
 * 「最想合环的时刻在现场」——判断刚出炉、动机最热的那一刻在回执上，不在金库里。
 *
 * 每一条入口都是**说得出在哪儿的**，因为写下一个不存在的入口，比少写一个更坏：
 * 前者让执法机关自己开出假证明（说明文字占位同罪）。
 */
export const CAPABILITY_ENTRIES: readonly CapabilityEntries[] = [
  { capability: '开/关后视镜', entries: ['vault:模式行', 'receipt:就地合环行', 'tool:pledger_register'] },
  { capability: '换挡', entries: ['vault:换挡台', 'receipt:就地合环行', 'tail:条尾两读'] },
  { capability: '改归因', entries: ['vault:已对表行', 'selfdm:回执卡四格', 'tool:pledger_register'] },
  { capability: '立约 / 不立', entries: ['selfdm:邀约卡', 'vault:私语流'] },
  { capability: '重开邀约', entries: ['vault:邀约频率行', 'tool:pledger_register'] },
  /*
    下面两项**此刻只能在金库获得** —— 明标的缺口，不是通过的检查。

    两处同一个成因：它们真正的第二个家是检验点到期时自聊里的那一问（「结果怎么样
    了？」——那一刻最自然的两个答案就是补登事实与撤回），而**自聊在 P1 只出不进**
    （§9 押 P5 移动形态）。在那条运输落成之前给它们画一个入口，就是幽灵信号。

    说出来并冻住：断言⑳ 校验这个集合**恰好**是这两项。认下的欠账不会扩散；不写
    下来的欠账，半年后就成了「本来就这样」。
  */
  { capability: '补登事实', entries: ['vault:待对表行', 'vault:未对表行'], vaultOnly: true },
  { capability: '撤回预期', entries: ['vault:检验中行', 'vault:前提已变双出口'], vaultOnly: true },
]

/** One row of the private stream — 私语通道的两位新住客。 */
export interface PrivateRow {
  readonly kind: 'invite' | 'calibration'
  readonly id: string
  readonly at: number
  readonly seq: number
  readonly state: InviteState | CalibrationState
  readonly resolved: boolean
  /**
   * 静默沉降三态 (v2.0 / #62-B6)：`live` 展开 / `folded` 折进归并条 / `settled` 已沉降.
   *
   * 「未答不成欠账」此前只是文字：平铺堆积**会自己长出欠账感**——堆积是催办的被动
   * 形态。**三不变**：沉降不变红、不计数、不催，也不产生任何自聊未读。
   */
  readonly zone: 'live' | 'folded' | 'settled'
  readonly actions: readonly {
    readonly id: string
    readonly label: string
    readonly style?: string
    readonly needsInput: boolean
    readonly available: boolean
  }[]
  /**
   * 就地合环行 —— **`answered` 终态必带** (v2.0 / #62-B5 / 断言⑳).
   *
   * 判断刚出炉、动机最热的那一刻在这里，不在金库里。**金库是汇总处不是唯一入口**。
   */
  readonly loopback?: PledgerLoopback
}

/** 折叠归并条 —— **是门不是徽标**：它带一句话与一次跳转，不带数字角标。 */
export interface PrivateFold {
  readonly count: number
  readonly label: string
  /** 一跳金库（逐级兑付合规）。 */
  readonly to: 'vault'
}

/** 就地合环动词条。开镜 / 调档，都落 `entry: 'receipt'`。 */
export interface PledgerLoopback {
  readonly family: string
  readonly familyLabel: string
  readonly patternKey?: string
  readonly mirrorOn: boolean
  readonly gear: Gear
  readonly note: string
}

/** 后视镜条 —— **仅操作者桌面渲染层**，永不进文本通道 (接缝⑤). */
export interface MirrorStrip {
  readonly family: string
  readonly patternLabel: string
  readonly cases: readonly { readonly calibrationId: string; readonly thenText: string; readonly factText: string }[]
  readonly note: string
}

/** 条尾两读 —— 「这类确认还需要你吗›」(接缝④，零新入口). */
export interface TwoRead {
  readonly family: string
  readonly label: string
  readonly gear: Gear
  readonly evidence: readonly string[]
  readonly leaseAvailable: boolean
  readonly leaseNote?: string
  readonly note: string
}

/** 档位生效面 —— `weight` 的桌面形态 (§4). */
export interface GearEffect {
  readonly family: string
  readonly gear: Gear
  readonly preselect: boolean
  readonly quickAccept: boolean
  readonly spreadEvidence: boolean
}

/**
 * 证据面的一行 —— 金库右栏 (v2.1 = #61 澄清① × #62-A 接缝).
 *
 * 三层，顺序不能换：**摘要为主**（第一行永远是私账自存的照片）→ **锚为辅**
 * （一跳回 + 活性探测）→ **锚死显形**（`dead` 时快照原样在场 + 徽记；`unknown`
 * 不显形——认识论诚实同款）。
 *
 * 若这一行纯靠锚，「判例是空壳」就在显示层复发了。
 */
export interface EvidenceRow {
  /** **照片**——第一行永远是它。断了组织图零缺字。 */
  readonly text: string
  readonly at: string
  /** 回真身的坐标。**内容不来自它**。 */
  readonly anchor?: OrgAnchor
  readonly premise: PremiseState
  /** `changed` 时的徽记；`unknown` 时是 undefined（不显形）。 */
  readonly mark?: string
}

/** 证据面 —— 选中一行，右栏归集它的证据锚。 */
export interface EvidenceFace {
  readonly title: string
  readonly rows: readonly EvidenceRow[]
  /** 默认态说明：打开金库 = **人发起的回看时刻**，agent 此刻备料合法、不定案。 */
  readonly note: string
}

/**
 * 证据面的**渲染函数** —— 入参里**没有组织图 service**（PTD-17 / 断言㉖ 静态半）.
 *
 * 它拿到的只有两样：一串照片，和一个**只回状态不回内容**的探针。于是「锚失效不
 * 蒸发内容」不是一条要记得遵守的纪律——**这个函数根本没有取内容的通道**。
 *
 * 锚活着时的只读预览由 surface 另走一条路（调组织侧既有的对象面通道，viewer =
 * operator，操作者本来就看得见那些对象）。分层的意义在锚死那一刻显出来：预览消失，
 * 快照仍在，**对表继续**。
 */
export function evidenceRowsOf(
  rows: readonly AnchoredText[],
  probe: (anchor: OrgAnchor) => PremiseState,
): readonly EvidenceRow[] {
  return rows.map((one) => {
    const premise = one.anchor === undefined ? 'unknown' : probe(one.anchor)
    return {
      text: one.text,
      at: one.at,
      ...(one.anchor === undefined ? {} : { anchor: one.anchor }),
      premise,
      // `unknown` **不显形**：组织图不可达时说一句「真身已变」是编造。
      ...(premise === 'changed' ? { mark: '真身已变 / 已亡' } : {}),
    }
  })
}

/** 金库内检索的一条命中 (P1 搜索面形态，零接缝). */
export interface VaultHit {
  readonly zone: string
  readonly id: string
  readonly text: string
}

export interface PledgerDesk {
  readonly enabled: boolean
  readonly destroyPhrase: string
  /** 入口不垄断律的执法数据。断言⑳ 读它。 */
  readonly capabilities: readonly CapabilityEntries[]
  vault(window?: PatternWindow): VaultView | undefined
  privateRows(): readonly PrivateRow[]
  /** 折叠归并条：同类未答 ≥ 阈值时的那一行。没到阈值 = undefined。 */
  privateFold(): PrivateFold | undefined
  /** 证据面：选中一行，归集它的 `AnchoredText[]`。 */
  evidenceFor(kind: 'calibration' | 'expectation', id: string): EvidenceFace | undefined
  /** 默认态：待对表首项的证据备料。 */
  evidenceDefault(): EvidenceFace | undefined
  stripFor(cardKind: string): MirrorStrip | undefined
  twoReadFor(cardKind: string): TwoRead | undefined
  gearEffectFor(cardKind: string): GearEffect
  /** 金库内检索（P1 搜索面）。**仅本人可构造**——这个面上没有 viewer 参数。 */
  search(query: string): readonly VaultHit[]
  /** 取走：人可读的两份文件。**读操作，不写事件**。 */
  exportVault(): VaultExport | undefined
  act(kind: string, id: string, actionId: string, input?: string): Promise<{ receipt: string; outcome: string }>
  pledge(verdict: OrgAnchor, text: string): Promise<PledgeOutcome>
  decline(inviteId: string): Promise<string>
  withdraw(expectationId: string, reason: string): Promise<void>
  note(text: string, about: { kind: 'verdict'; verdict: AnchoredText } | { kind: 'expectation'; expectationId: string }): Promise<string>
  reattribute(calibrationId: string, attribution: Attribution): Promise<void>
  shift(family: string, gear: Gear, entry: GearEntry): Promise<void>
  mirror(family: string, patternKey: string, on: boolean, entry?: 'vault' | 'receipt'): Promise<void>
  reopenInvites(family: string): Promise<void>
  setQuota(quota: number): Promise<void>
  /** 照旧对表 —— 锚死显形的第二个出口。**什么都不写**（代撤即代产）。 */
  settleAnyway(): { readonly note: string }
  destroy(confirm: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Absent when `pledger.enabled` is false — every consumer degrades on that. */
    yzjPledgerDesk?: PledgerDesk
  }
}

/** 族的显示名。条上要写人读得懂的字，不是内部 key。 */
function familyLabelOf(family: string): string {
  return PROPOSAL_FAMILIES.find(spec => spec.family === family)?.label ?? family
}

export function createDesk(ctx: Context, bus: PledgerCards): PledgerDesk {
  const window = DEFAULT_PATTERN_WINDOW
  const operatorActor = (): { kind: 'operator'; openId?: string } => {
    const openId = ctx.get('yzjPledger')?.owner
    return { kind: 'operator', ...(openId === undefined ? {} : { openId }) }
  }
  /** 活性探测 —— 注入给投影层，返回状态不返回内容。 */
  const probe = (anchor: { kind: string; id: string }): PremiseState => isAlive(ctx, anchor)


  const loopbackFor = (family: string): PledgerLoopback => {
    const pledger = ctx.get('yzjPledger')
    const mine = pledger === undefined
      ? []
      : patternsIn(pledger, window).filter(one => one.family === family)
    const first = mine[0]
    const gear = (asString(asRecord(pledger?.object('gear', family)?.state)?.gear) ?? 'default') as Gear
    return {
      family,
      familyLabel: familyLabelOf(family),
      ...(first === undefined ? {} : { patternKey: first.patternKey }),
      mirrorOn: first?.mirror === true,
      gear,
      note: '判断刚出炉，合环就在这一行上——金库是汇总处，不是唯一入口。',
    }
  }

  return {
    get enabled() {
      return ctx.get('yzjPledger')?.ready === true
    },

    destroyPhrase: DESTROY_PHRASE,
    capabilities: CAPABILITY_ENTRIES,

    vault(requested?: PatternWindow): VaultView | undefined {
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) return undefined
      return vaultView(pledger, { window: requested ?? window, probe })
    },

    privateRows(): readonly PrivateRow[] {
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) return []
      const now = Date.now()
      const rows: PrivateRow[] = []
      for (const kind of ['invite', 'calibration'] as const) {
        const definition = kind === 'invite' ? inviteCard : calibrationCard
        for (const object of pledger.query(kind)) {
          const state = object.state as never
          const resolved = definition.isResolved(state)
          const age = now - object.updatedAt
          const record = asRecord(object.state)
          const family = asString(record?.family) ?? ''
          rows.push({
            kind,
            id: object.id,
            at: object.createdAt,
            seq: object.createdSeq,
            state: object.state as unknown as InviteState | CalibrationState,
            resolved,
            // 沉降：> 14 天未答就不再占私语流的位（但仍然可动）。
            zone: !resolved && age > SETTLE_DAYS * 24 * 60 * 60 * 1000 ? 'settled' : 'live',
            actions: definition.actions
              // **私账动词族明拒**：白名单 ∩ 转发族 = ∅（断言㉔）。
              .filter(action => !FORBIDDEN_VERBS.includes(action.id))
              .map(action => ({
                id: action.id,
                label: action.label,
                ...(action.style === undefined ? {} : { style: action.style }),
                needsInput: action.needsInput === true,
                available: action.available?.(state) ?? true,
              })),
            // 就地合环行：**`answered` 终态必带**。
            ...(kind === 'calibration' && resolved && family !== ''
              ? { loopback: loopbackFor(family) }
              : {}),
          })
        }
      }
      const sorted = rows.sort((left, right) => left.seq - right.seq)
      /*
        合环行只留在**最近答完的那一张**上 —— 「判断刚出炉、动机最热的那一刻」.

        少了这一条，答完的回执会带着合环动词一直堆在私语流里：一屏二十个「给这类卡
        开后视镜」，问的偏偏是「你要不要给自己立一条规则」——用重复二十遍的方式问，
        本身就是答案（与条尾两读同一条治理，§7.1）。

        **它同时是入口不垄断律的兑现点**：不在这里做这一刀，两个客户端就只能整片
        滤掉 answered 行，于是 `receipt:就地合环行` 会退回成一个写在注册表上、屏幕上
        找不到的入口——说明文字占位同罪。
      */
      const newestAnswered = sorted.filter(row => row.loopback !== undefined).at(-1)
      for (const [index, row] of sorted.entries()) {
        if (row.loopback === undefined || row === newestAnswered) continue
        const { loopback: _dropped, ...rest } = row
        sorted[index] = rest
      }
      /*
        **折叠归并**：同类未答 ≥ 阈值时，除最新一张外全部折进归并条.

        最新一张保持展开——**最近的语境不折叠**。折起来的那些不是被藏了：归并条
        是一扇门（一跳金库），不是一个数字徽标。
      */
      const open = sorted.filter(row => !row.resolved && row.zone === 'live')
      if (open.length < FOLD_THRESHOLD) return sorted
      const newest = open.at(-1)
      return sorted.map(row => (
        row.resolved || row.zone !== 'live' || row.id === newest?.id
          ? row
          : { ...row, zone: 'folded' as const }
      ))
    },

    privateFold(): PrivateFold | undefined {
      const folded = this.privateRows().filter(row => row.zone === 'folded')
      if (folded.length === 0) return undefined
      return {
        count: folded.length,
        // 归并条自己说清门后是什么——**是门不是徽标**。
        label: `${String(folded.length)} 张待对表 · 一起看 ›`,
        to: 'vault',
      }
    },

    evidenceFor(kind, id): EvidenceFace | undefined {
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) return undefined
      const object = pledger.object(kind, id)
      if (object === undefined) return undefined
      const state = asRecord(object.state)
      const rows: AnchoredText[] = []
      if (state?.verdict !== undefined) rows.push(anchoredOf(state.verdict))
      if (state?.fact !== undefined) rows.push(anchoredOf(state.fact))
      if (Array.isArray(state?.evidence)) rows.push(...state.evidence.map(anchoredOf))
      return {
        title: kind === 'calibration' ? '这条判例的证据' : '这条预期的出处',
        rows: evidenceRowsOf(rows, probe),
        /*
          **打开金库 = 人发起的回看时刻**（持镜人「人发起」的消费时刻定义）。

          agent 此刻聚合证据是合法的——**备料不定案**。归因那一格永远是人自己下的。
        */
        note: '摘要为主、锚为辅：这些字是当时定格的照片，断了组织图也读得出来。'
          + '备料不定案——归因那一格由你自己下。',
      }
    },

    evidenceDefault(): EvidenceFace | undefined {
      const view = this.vault()
      const first = view?.awaiting[0] ?? view?.testing[0]
      if (first === undefined) return undefined
      return this.evidenceFor('expectation', first.expectationId)
    },

    stripFor(cardKind: string): MirrorStrip | undefined {
      const pledger = ctx.get('yzjPledger')
      const family = familyOfCardKind(cardKind)?.family
      if (pledger === undefined || !pledger.ready || family === undefined) return undefined
      const on = patternsIn(pledger, window).filter(one => one.family === family && one.mirror)
      const cases = mirrorCases(pledger, family, window)
      if (cases.length === 0 || on.length === 0) return undefined
      return {
        family,
        patternLabel: on.map(one => one.label).join(' · '),
        cases: cases.map(one => ({
          calibrationId: one.calibrationId,
          thenText: one.thenText,
          factText: one.fact.text,
        })),
        note: '仅你可见 · 你在金库签发的负重显示（回喂环）——判断仍由你下',
      }
    },

    twoReadFor(cardKind: string): TwoRead | undefined {
      const pledger = ctx.get('yzjPledger')
      const spec = familyOfCardKind(cardKind)
      if (pledger === undefined || !pledger.ready || spec === undefined) return undefined
      /*
        **条长即治理信号** —— 这一问要等它值得问的时候才问 (§7.1).

        给这一族每一张答完的卡都挂一块，就是用重复二十遍的方式问「你被问烦了没有」
        ——那本身就是答案，而且是最难看的那种。
      */
      const verdicts = seenVerdicts(ctx).filter(one => one.family === spec.family)
      if (verdicts.length < TWO_READ_MIN_VERDICTS) return undefined
      const view = vaultView(pledger, { window, probe })
      const row = view.gears.find(one => one.family === spec.family)
      if (row === undefined) return undefined
      return {
        family: spec.family,
        label: spec.label,
        gear: row.gear,
        evidence: row.evidence.map(one => one.text),
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
          负重档 = 「你先拆，我再补」的显示形态。三件事一起改，缺一件就不是负重：
          **不预选**（预选就是替你先答了）、**无一键通过**（一键通过是把裁决压成
          一次手势）、**摆开证据**（否则「先手」没有材料）。
        */
        preselect: gear !== 'weight',
        quickAccept: gear !== 'weight',
        spreadEvidence: gear === 'weight',
      }
    },

    /**
     * 金库内检索 —— P1 的搜索面形态，**零组织侧接缝** (v2.0 / #62-D10).
     *
     * 主册 §7 目前没有跨会话的内容搜索面，所以这里不去注册一个并不存在的 provider
     * ——**不把不存在的面写成已存在的接缝**。检索跑在本地六区上，落点即金库行。
     *
     * 「仅 viewer=operator 可构造」由签名本身兑现：这个方法在 `PledgerDesk` 上，
     * 而 desk 只在 `enabled` 且身份就绪时被 provide；它没有 viewer 参数可传。
     */
    search(query: string): readonly VaultHit[] {
      const view = this.vault()
      const needle = query.trim().toLowerCase()
      if (view === undefined || needle === '') return []
      const hits: VaultHit[] = []
      const push = (zone: string, id: string, text: string): void => {
        if (text.toLowerCase().includes(needle)) hits.push({ zone, id, text })
      }
      for (const row of [...view.testing, ...view.awaiting, ...view.sunk, ...view.withdrawn]) {
        push('预期', row.expectationId, `${row.text} · ${row.verdict.text}`)
      }
      for (const row of view.settled) {
        push('判例', row.calibrationId, `${row.thenText} → ${row.fact.text}`)
      }
      for (const row of view.patterns) push('模式', row.patternKey, row.label)
      return hits
    },

    exportVault(): VaultExport | undefined {
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) return undefined
      // **读操作**：这里一个 append 都没有——读自己的账是自由。
      return vaultExport(pledger)
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
    mirror: async (family, patternKey, on, entry = 'vault') => {
      await toggleMirror(ctx, family, patternKey, on, entry)
    },
    reopenInvites: async family => { await reopenInvites(ctx, family) },
    setQuota: async quota => { await setDailyQuota(ctx, quota) },
    settleAnyway,

    /**
     * 销毁 —— **不可逆人签发终态同款门**：两段式，第二段要人把那句话打出来。
     */
    async destroy(confirm: string) {
      if (confirm !== DESTROY_PHRASE) {
        throw new Error(`销毁是不可逆的：请原样输入「${DESTROY_PHRASE}」以确认。`)
      }
      await ctx.get('yzjPledger')?.destroy()
    },
  }
}

/** 今天的邀约用量 —— 换挡台配额行读它。 */
export function quotaStatus(ctx: Context): { quota: number; usedToday: number } {
  return { quota: quotaOf(ctx), usedToday: invitesToday(ctx) }
}

/** 分布镜的桌面读法。返回类型无 string —— 判词在 API 上不可构造。 */
export function distributionFor(ctx: Context, window: PatternWindow = DEFAULT_PATTERN_WINDOW): ReturnType<typeof attributionDistribution> | undefined {
  const pledger = ctx.get('yzjPledger')
  return pledger === undefined || !pledger.ready
    ? undefined
    : attributionDistribution(pledger, window)
}
