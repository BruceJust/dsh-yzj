/**
 * 金库 —— 私账的对表面，also the ONLY new surface this whole design adds.
 *
 * It is a PROJECTION, like every other view in this product: nothing is stored
 * here, everything is read at request time from the private log. Four zones,
 * a gear bench, and a pattern list — and **每一行既可见又可动**.
 *
 * 金库行内动词族 (v1.1 §7 成文 —— #57「占位即全域不可达」的私账版):
 *
 * | 区 | 行内动词 | 为什么是这一个 |
 * |---|---|---|
 * | 检验中 | 撤回 | 前提消失时撤回是诚实，不是失败 |
 * | 待对表 | 补登事实 · 撤回 | 图外事实的唯一入口就在你看见它的地方 |
 * | 已对表 | 改归因 | 更正即追加，最新生效 |
 * | 已撤回 | —（只读） | 撤回是终态：诚实退出不悔棋 |
 * | 模式 | 后视镜开关 | 回喂环的合环阀 |
 * | 换挡台 | 三档 · 邀约频率 | 档位是你的私有设置 |
 *
 * 说明文字占位同罪：一个只能读不能动的金库，会把「回路」退化成「一个要打开的
 * app」——而那正是这个设计从头到尾在躲的死法。
 */

import { asNumber, asRecord, asString } from '@yzj-next/graph'
import type { YzjPledger } from './service.ts'
import { PROPOSAL_FAMILIES, familySpec } from './families.ts'
import { isFamilyQuiet } from './invite.ts'
import { casesIn, patternsIn } from './patterns.ts'
import { ATTRIBUTION_LABEL, DEFAULT_PATTERN_WINDOW, type Attribution, type Gear, type OrgAnchor, type PatternWindow } from './types.ts'

/**
 * 硬合同五条 (v4.25r) —— 每一条在工程上的兑现处，写在 chip 旁边.
 *
 * 它们出现在金库的 header 上，而不是某份文档里：一份人看不见的合同不是合同。
 */
export const CONTRACT_CHIPS: readonly { readonly label: string; readonly how: string }[] = [
  { label: '仅你可见', how: 'viewer 单态：这个账本的读取面上没有「别人」这个参数' },
  { label: '不入组织图', how: '单向引用：组织图的事件 schema 里没有任何私账字段' },
  { label: '组织不可导出 · 本人可取走', how: '目录自包含：拷走目录即取走全账；销毁 = 删掉这个目录' },
  { label: '永不绩效', how: '模式查询强制窗口参数——聚合评分在 API 上不可构造' },
  { label: '审计不可触及', how: '审计导出的重放过滤器根本不挂这个源' },
  { label: '耦合单向：图 → 金库', how: 'import 禁令 + schema 双保险' },
]

/**
 * 金库五不做 —— **明拒** (§7 footer).
 *
 * 明拒写在界面上，不只写在文档里：它们是这个面**故意没有**的东西，而故意没有的
 * 东西如果不说出来，看起来就只是还没做。
 */
export const VAULT_REFUSALS: readonly string[] = [
  '无分数',
  '无排名',
  '无画像',
  '无建议倾向',
  '无团队视图',
]

/** 一行检验中/已过检验点/已撤回的预期。 */
export interface VaultExpectationRow {
  readonly expectationId: string
  readonly text: string
  readonly checkpointText: string
  readonly checkpointTs?: number
  readonly verdictRef: OrgAnchor
  readonly bornAt: number
  /** 已过检验点、还没有事实回流。行上因此长出「补登事实」。 */
  readonly due: boolean
  /** agent 已经在私语通道问过一次结果了。问一次不再追（§9）。 */
  readonly asked: boolean
  readonly withdrawnReason?: string
  /** 这一行现在能做什么。空数组 = 只读，且那是一个有理由的终态。 */
  readonly verbs: readonly ('withdraw' | 'note-fact')[]
}

/** 一行已对表的判例。 */
export interface VaultCaseRow {
  readonly calibrationId: string
  readonly attribution: Attribution
  readonly attributionLabel: string
  readonly thenText: string
  readonly factText: string
  readonly verdictRef: OrgAnchor
  readonly at: number
  /** 改归因 —— 更正即追加，最新生效。 */
  readonly verbs: readonly 'reattribute'[]
}

/** 模式行。每个数字是门。 */
export interface VaultPatternRow {
  readonly patternKey: string
  readonly family: string
  readonly label: string
  readonly count: number
  readonly mirror: boolean
  readonly cases: readonly { readonly calibrationId: string; readonly thenText: string; readonly factText: string; readonly at: number }[]
  readonly verbs: readonly 'mirror'[]
}

/** 换挡台一行：一个提案族的三档与它的证据行。 */
export interface VaultGearRow {
  readonly family: string
  readonly label: string
  readonly what: string
  readonly gear: Gear
  /**
   * 证据行 —— 组织图派生的**本人行为事实**（近 90 天通过率 / 中位停留）。
   *
   * 采集与存储全在私账域，**永不进组织侧通道与任何模型调优管道** (§8 持镜人条款)。
   */
  readonly evidence: readonly string[]
  readonly entry: 'tail' | 'vault' | 'none'
  /** `lease` 档在 P1 不可达：组织侧租约本体还没有开门（见 `leaseNote`）。 */
  readonly leaseAvailable: boolean
  readonly leaseNote?: string
  readonly verbs: readonly 'shift'[]
}

/** 邀约频率行 —— 疲劳治理的恢复入口，只在这里。 */
export interface VaultInviteRow {
  readonly family: string
  readonly label: string
  readonly quiet: boolean
  readonly declinedInARow: number
  readonly verbs: readonly 'invite-reopen'[]
}

export interface VaultView {
  readonly owner?: string
  /** 取走的落点。说不出在哪儿的「可取走」不是可取走。 */
  readonly directory?: string
  readonly contract: typeof CONTRACT_CHIPS
  readonly refusals: readonly string[]
  readonly window: PatternWindow
  readonly testing: readonly VaultExpectationRow[]
  readonly settled: readonly VaultCaseRow[]
  readonly withdrawn: readonly VaultExpectationRow[]
  readonly patterns: readonly VaultPatternRow[]
  readonly gears: readonly VaultGearRow[]
  readonly invites: readonly VaultInviteRow[]
  /**
   * 空账的样本 —— 每一类空状态都要有它自己的那句话（样本纪律）。
   *
   * 「还没有」和「不可能有」是两句不同的话：预期不可回填，所以一个从没在图上签发过
   * 裁决的人，他的金库是空的**且那是对的**——空状态得如实解释这件事，否则它读起来
   * 像功能坏了。
   */
  readonly emptyBecause?: string
}

/** The whole vault, read at request time. */
export function vaultView(
  pledger: YzjPledger,
  options: { readonly window?: PatternWindow; readonly now?: number } = {},
): VaultView {
  const window = options.window ?? DEFAULT_PATTERN_WINDOW
  const now = options.now ?? Date.now()
  const testing: VaultExpectationRow[] = []
  const withdrawn: VaultExpectationRow[] = []

  for (const object of pledger.query('expectation')) {
    const state = asRecord(object.state)
    if (state === undefined) continue
    const status = asString(state.status) ?? 'testing'
    const checkpoint = asRecord(state.checkpoint)
    const checkpointTs = asNumber(checkpoint?.ts)
    const verdict = anchorOf(state.verdictRef)
    const settledAlready = status === 'settled'
    if (settledAlready) continue
    /*
      已过检验点 —— 一个**派生**的第三态，不是一次状态迁移。

      有戳才谈得上：解析不出时间的检验点不会因此逾期，它只是不参与时间轮。含糊的
      期限永远不算逾期，这条纪律在两本账上是同一条。
    */
    const due = status === 'testing'
      && checkpointTs !== undefined
      && checkpointTs <= now
    const row: VaultExpectationRow = {
      expectationId: object.id,
      text: asString(state.text) ?? '',
      checkpointText: asString(checkpoint?.text) ?? '',
      ...(checkpointTs === undefined ? {} : { checkpointTs }),
      verdictRef: verdict,
      bornAt: object.createdAt,
      due,
      asked: state.asked === true,
      ...(asString(state.reason) === undefined ? {} : { withdrawnReason: asString(state.reason) as string }),
      // 已撤回是**终态**：诚实退出不悔棋，所以这一行一个动词都不长。
      verbs: status === 'withdrawn' ? [] : due ? ['note-fact', 'withdraw'] : ['withdraw'],
    }
    if (status === 'withdrawn') withdrawn.push(row)
    else testing.push(row)
  }

  const settled: VaultCaseRow[] = casesIn(pledger, window, now).map(one => ({
    calibrationId: one.calibrationId,
    attribution: one.attribution,
    attributionLabel: ATTRIBUTION_LABEL[one.attribution],
    thenText: one.thenText,
    factText: one.factText,
    verdictRef: one.verdictRef,
    at: one.at,
    verbs: ['reattribute'],
  }))

  const patterns: VaultPatternRow[] = patternsIn(pledger, window, now).map(pattern => ({
    patternKey: pattern.patternKey,
    family: pattern.family,
    label: pattern.label,
    count: pattern.count,
    mirror: pattern.mirror,
    cases: pattern.cases.map(one => ({
      calibrationId: one.calibrationId,
      thenText: one.thenText,
      factText: one.factText,
      at: one.at,
    })),
    verbs: ['mirror'],
  }))

  const inviteEvents = pledger.events(['invite/declined', 'invite/reopened', 'expectation/opened'])
  const gears = PROPOSAL_FAMILIES.map(spec => gearRow(pledger, spec.family, window, now))
  const invites: VaultInviteRow[] = PROPOSAL_FAMILIES.map(spec => ({
    family: spec.family,
    label: spec.label,
    quiet: isFamilyQuiet(inviteEvents, spec.family),
    declinedInARow: declinedInARow(inviteEvents, spec.family),
    verbs: ['invite-reopen'],
  }))

  const nothing = testing.length === 0 && settled.length === 0 && withdrawn.length === 0
  return {
    ...(pledger.owner === undefined ? {} : { owner: pledger.owner }),
    ...(pledger.directory === undefined ? {} : { directory: pledger.directory }),
    contract: CONTRACT_CHIPS,
    refusals: VAULT_REFUSALS,
    window,
    testing,
    settled,
    withdrawn,
    patterns,
    gears,
    invites,
    ...(nothing
      ? {
        emptyBecause: '空。预期在裁决时刻出生，**不可回填**——这里永远不会出现事后补写的行。'
          + '下一次在图里签发、验收时，私语通道会给你一次开口的机会；'
          + '不立也没关系，裁决本身就是隐式预期，回执照样会来。',
      }
      : {}),
  }
}

/** One gear-bench row, with the behaviour evidence that belongs to you alone. */
export function gearRow(
  pledger: YzjPledger,
  family: string,
  window: PatternWindow,
  now: number,
): VaultGearRow {
  const spec = familySpec(family)
  const state = asRecord(pledger.object('gear', family)?.state)
  const gear = (asString(state?.gear) ?? 'default') as Gear
  const entry = (asString(state?.entry) ?? 'none') as 'tail' | 'vault' | 'none'
  const evidence = asString(state?.evidenceSnapshot)
  const cases = casesIn(pledger, window, now).filter(one => one.family === family)
  return {
    family,
    label: spec?.label ?? family,
    what: spec?.what ?? '',
    gear,
    entry,
    evidence: [
      ...(evidence === undefined ? [] : [`换挡时在档：${evidence}`]),
      `近 ${String(window.days)} 天这一族的判例：${String(cases.length)} 条`,
      '这些是**你自己的行为事实**：采集与存储全在私账域，永不进组织侧通道与任何模型调优',
    ],
    /*
      **`lease` 档在 P1 不可达，而且说出来** (§4 档位生效面).

      「设为租约」的租约本体是组织侧的 `lease/granted`，创建走既有强确认流程——而那
      一族在这套系统里还没有开门（合同面板上写着 `leasesAvailable: false`）。私账
      这一侧只记「你换过挡」，绝不代替组织侧发一份并不存在的授权：免确认是组织侧行为，
      它的审计必须留在组织侧 (PTD-7)。所以这里不画一扇打不开的门，改画一句实话。
    */
    leaseAvailable: false,
    leaseNote: '租约本体在组织侧（授权租约族尚未开门）——私账只记换挡史，不代发授权。',
    verbs: ['shift'],
  }
}

function declinedInARow(
  events: readonly { readonly type: string; readonly data: unknown }[],
  family: string,
): number {
  let consecutive = 0
  for (const event of events) {
    const data = event.data as { family?: unknown } | null
    if (typeof data !== 'object' || data === null || data.family !== family) continue
    if (event.type === 'invite/declined') consecutive += 1
    if (event.type === 'invite/reopened' || event.type === 'expectation/opened') consecutive = 0
  }
  return consecutive
}

function anchorOf(value: unknown): OrgAnchor {
  const record = asRecord(value as never)
  const graphSeq = asNumber(record?.graphSeq)
  const label = asString(record?.label)
  return {
    kind: asString(record?.kind) ?? '',
    id: asString(record?.id) ?? '',
    ...(graphSeq === undefined ? {} : { graphSeq }),
    ...(label === undefined ? {} : { label }),
  }
}
