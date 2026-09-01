/**
 * 金库 —— 私账的对表面，also the ONLY new surface this whole design adds.
 *
 * 组织的图记承诺的一生，金库记**你的判断**的一生。它是一次查询的投影：这里没有第二
 * 本账要维护，而 v2.0 的三个新态（锚死显形 / 静默沉降 / 归因分布）**同样零事件**
 * ——能派生就不落账，是模式滚动律的推广（落账即档案）。
 *
 * 金库行内动词族 (§7 —— #57「占位即全域不可达」的私账版):
 *
 * | 区 | 行内动词 | 为什么是这一个 |
 * |---|---|---|
 * | 检验中 | 撤回（+ 前提已变时的「照旧对表」） | 前提消失时撤回是诚实，不是失败 |
 * | 待对表 | 补登事实 · 撤回 | 图外事实的唯一入口就在你看见它的地方 |
 * | 已对表 | 改归因 · **就地合环** | 更正即追加；判断刚出炉、动机最热 |
 * | **未对表（沉降）** | 补登事实 · 撤回 | **沉降不剥夺可动性**——只是不再打扰 |
 * | 已撤回 | —（只读） | 撤回是终态：诚实退出不悔棋 |
 * | 模式 | 后视镜开关 | 回喂环的合环阀 |
 * | 分布镜 | 四格各自的判例门 | 陈列是镜子，解读是教练 |
 * | 换挡台 | 三档 · 频率 · **配额** | 档位与治理都是你的私有设置 |
 *
 * **每行既可见又可动**；说明文字占位同罪。
 */

import { asNumber, asRecord, asString } from '@yzj-next/graph'
import type { YzjPledger } from './service.ts'
import { PROPOSAL_FAMILIES, familySpec } from './families.ts'
import { DESTROY_PHRASE } from './destroy.ts'
import { isFamilyQuiet } from './invite.ts'
import { anchoredOf, attributionDistribution, casesIn, patternsIn } from './patterns.ts'
import {
  ATTRIBUTION_LABEL, DEFAULT_PATTERN_WINDOW, FOLD_THRESHOLD, SETTLE_DAYS,
  type AnchoredText, type Attribution, type Gear, type PatternWindow, type PremiseState,
} from './types.ts'

/**
 * 硬合同五条 (v4.25r) —— 每一条在工程上的兑现处，写在 chip 旁边.
 *
 * v2.1：chips 是**私账合同面板的入口摘要**（信号即门）。「说明文字占位同罪」对
 * chips 自身适用——点得开，才不是一句挂在墙上的标语。
 */
export const CONTRACT_CHIPS: readonly {
  readonly label: string
  /** 它**为什么改不了** —— 陈列的是机械保证，不是「请勿修改」。 */
  readonly how: string
}[] = [
  { label: '仅你可见', how: 'viewer 单态：这个账本的读取面上没有「别人」这个参数' },
  { label: '不入组织图', how: '单向引用：组织图的事件 schema 里没有任何私账字段' },
  { label: '组织不可导出 · 本人可取走', how: '目录自包含 + 判例册导出：拷走目录即取走全账' },
  { label: '永不绩效', how: '模式与分布查询强制窗口参数，且返回类型无文本——评分与判词在 API 上不可构造' },
  { label: '审计不可触及', how: '审计导出的重放过滤器根本不挂这个源' },
  { label: '耦合单向：图 → 金库', how: 'import 禁令 + schema 双保险' },
  { label: '金库 ≠ 记忆', how: '蒸馏器输入面无 pgraph；pledger 依赖面无 memory 服务（反向同禁）' },
  { label: '持镜人', how: '门读账、笔不读账：生成器的签名里没有 pgraph 句柄' },
]

/** 金库五不做 —— **明拒**：故意没有的东西不说出来，看起来就只是还没做。 */
export const VAULT_REFUSALS: readonly string[] = [
  '无分数', '无排名', '无画像', '无建议倾向', '无团队视图',
]

/**
 * 私账动词族明拒 (v2.0 / #62-D9 / PTD-24).
 *
 * 私账卡与金库行的动词白名单 ∩ 这一集 = ∅。**不给动词就不会误用**——#57 占位律的
 * 反向应用：此处的不可达是特性。人自己复制粘贴是人的自由，**系统不递刀**。
 */
export const FORBIDDEN_VERBS: readonly string[] = ['forward', 'quote', 'share', 'cite', 'mention']

/** 一行预期（检验中 / 待对表 / 未对表 / 已撤回）。 */
export interface VaultExpectationRow {
  readonly expectationId: string
  readonly text: string
  readonly checkpointText: string
  readonly checkpointTs?: number
  /** 当时那次裁决的**照片**——断了组织图也读得出来。 */
  readonly verdict: AnchoredText
  readonly bornAt: number
  readonly due: boolean
  readonly asked: boolean
  readonly withdrawnReason?: string
  /**
   * 前提还在不在 —— **派生态，零事件** (v2.0 / #62-A3 / PTD-18).
   *
   * `changed` = 所锚对象进了终态/墓碑/移交。这一行因此显形，并给出**双出口**
   * （撤回 / 照旧对表）。`unknown` **不显形**：组织图不可达时说一句「前提已变」
   * 是编造。
   */
  readonly premise: PremiseState
  /** 沉降三态：还在流里 / 折进归并条 / 已沉降。**沉降不变红、不计数、不催**。 */
  readonly zone: 'live' | 'settled'
  readonly verbs: readonly ('withdraw' | 'note-fact' | 'settle-anyway')[]
}

/** 一行已对表的判例。 */
export interface VaultCaseRow {
  readonly calibrationId: string
  readonly attribution: Attribution
  readonly attributionLabel: string
  readonly thenText: string
  readonly fact: AnchoredText
  readonly verdict: AnchoredText
  readonly family: string
  readonly at: number
  /** 改归因 + **就地合环**（开镜/调档就在这一行上）。 */
  readonly verbs: readonly ('reattribute' | 'loopback')[]
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

/** 归因分布镜的一行。**四个数字，零判词**。 */
export interface VaultDistributionRow {
  readonly q1: number
  readonly q2: number
  readonly q3: number
  readonly q4: number
  readonly cases: Readonly<Record<Attribution, readonly string[]>>
  readonly labels: Readonly<Record<Attribution, string>>
  readonly verbs: readonly 'open-cell'[]
}

/** 换挡台一行。 */
export interface VaultGearRow {
  readonly family: string
  readonly label: string
  readonly what: string
  readonly gear: Gear
  readonly evidence: readonly AnchoredText[]
  readonly entry: 'tail' | 'vault' | 'receipt' | 'none'
  readonly leaseAvailable: boolean
  readonly leaseNote?: string
  readonly verbs: readonly 'shift'[]
}

/** 邀约频率行 —— 疲劳治理的恢复入口。 */
export interface VaultInviteRow {
  readonly family: string
  readonly label: string
  readonly quiet: boolean
  readonly declinedInARow: number
  readonly verbs: readonly 'invite-reopen'[]
}

/** 全局日配额行 —— **扩触发面的对偶**，软合同的可调项。 */
export interface VaultQuotaRow {
  readonly quota: number
  readonly usedToday: number
  readonly range: { readonly min: number; readonly max: number }
  readonly verbs: readonly 'set-quota'[]
}

export interface VaultView {
  readonly owner?: string
  readonly destroyPhrase: string
  readonly directory?: string
  readonly contract: typeof CONTRACT_CHIPS
  readonly refusals: readonly string[]
  readonly window: PatternWindow
  /** 六区之一：还在检验中（含「前提已变」显形）。 */
  readonly testing: readonly VaultExpectationRow[]
  /** 六区之二：过了检验点、还没对表。 */
  readonly awaiting: readonly VaultExpectationRow[]
  /** 六区之三：已对表的判例。 */
  readonly settled: readonly VaultCaseRow[]
  /** 六区之四：**未对表（沉降）**——沉了不代表不可动。 */
  readonly sunk: readonly VaultExpectationRow[]
  /** 六区之五：已撤回（只读）。 */
  readonly withdrawn: readonly VaultExpectationRow[]
  /** 六区之六：模式（滚动派生）。 */
  readonly patterns: readonly VaultPatternRow[]
  readonly distribution: VaultDistributionRow
  readonly gears: readonly VaultGearRow[]
  readonly invites: readonly VaultInviteRow[]
  readonly quota: VaultQuotaRow
  /** 沉降参数，摆在界面上——**参数入 dogfood 观测项**（沉太快=藏事，太慢=堆积）。 */
  readonly settleDays: number
  readonly foldThreshold: number
  readonly emptyBecause?: string
}

/** The whole vault, read at request time. */
export function vaultView(
  pledger: YzjPledger,
  options: {
    readonly window?: PatternWindow
    readonly now?: number
    /** 活性探测器。**注入而不是内建** —— 见 {@link VaultExpectationRow.premise}。 */
    readonly probe?: (anchor: { kind: string; id: string }) => PremiseState
  } = {},
): VaultView {
  const window = options.window ?? DEFAULT_PATTERN_WINDOW
  const now = options.now ?? Date.now()
  const probe = options.probe
  const testing: VaultExpectationRow[] = []
  const awaiting: VaultExpectationRow[] = []
  const sunk: VaultExpectationRow[] = []
  const withdrawn: VaultExpectationRow[] = []

  for (const object of pledger.query('expectation')) {
    const state = asRecord(object.state)
    if (state === undefined) continue
    const status = asString(state.status) ?? 'testing'
    if (status === 'settled') continue
    const checkpoint = asRecord(state.checkpoint)
    const checkpointTs = asNumber(checkpoint?.ts)
    const verdict = anchoredOf(state.verdict)
    /*
      已过检验点 —— 一个**派生**的第三态，不是一次状态迁移。

      有戳才谈得上：解析不出时间的检验点不会因此逾期。含糊的期限永远不算逾期，
      这条纪律在两本账上是同一条。
    */
    const due = status === 'testing' && checkpointTs !== undefined && checkpointTs <= now
    /*
      **静默沉降** (v2.0 / #62-B6)：过了检验点还 14 天没对表，就从「待对表」沉进
      「未对表」区，私语流不再保留它的位。

      「未答不成欠账」此前只是一句文字：平铺堆积的回执与邀约**会自己长出欠账感**
      ——堆积是催办的被动形态。沉降不变红、不计数、不催，也不产生任何未读；而它的
      行**仍然可动**，只是不再打扰。
    */
    const sinceDue = checkpointTs === undefined ? 0 : now - checkpointTs
    const hasSunk = due && sinceDue > SETTLE_DAYS * 24 * 60 * 60 * 1000
    /*
      **锚死显形，且只显形** (PTD-18)。

      三条纪律：①不自动写 `withdrawn`——撤回是人的诚实动作，**代撤即代产**；
      ②零事件——这是查询层产物；③组织图不可达时退化为 `unknown` 并不显形。
    */
    const premise: PremiseState = probe === undefined || verdict.anchor === undefined
      ? 'unknown'
      : probe(verdict.anchor)
    const row: VaultExpectationRow = {
      expectationId: object.id,
      text: asString(state.text) ?? '',
      checkpointText: asString(checkpoint?.text) ?? '',
      ...(checkpointTs === undefined ? {} : { checkpointTs }),
      verdict,
      bornAt: object.createdAt,
      due,
      asked: state.asked === true,
      premise,
      zone: hasSunk ? 'settled' : 'live',
      ...(asString(state.reason) === undefined ? {} : { withdrawnReason: asString(state.reason) as string }),
      // 已撤回是**终态**：诚实退出不悔棋，所以这一行一个动词都不长。
      verbs: status === 'withdrawn'
        ? []
        : premise === 'changed'
          // 前提已变 → **双出口**：撤回（诚实）或照旧对表（你说了算）。
          ? ['withdraw', 'settle-anyway', 'note-fact']
          : due
            ? ['note-fact', 'withdraw']
            : ['withdraw'],
    }
    if (status === 'withdrawn') withdrawn.push(row)
    else if (hasSunk) sunk.push(row)
    else if (due) awaiting.push(row)
    else testing.push(row)
  }

  const settled: VaultCaseRow[] = casesIn(pledger, window, now).map(one => ({
    calibrationId: one.calibrationId,
    attribution: one.attribution,
    attributionLabel: ATTRIBUTION_LABEL[one.attribution],
    thenText: one.thenText,
    fact: one.fact,
    verdict: one.verdict,
    family: one.family,
    at: one.at,
    // 就地合环：判断刚出炉、动机最热，合环动词就近（入口不垄断律）。
    verbs: ['reattribute', 'loopback'],
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
      factText: one.fact.text,
      at: one.at,
    })),
    verbs: ['mirror'],
  }))

  const distributionCounts = attributionDistribution(pledger, window, now)
  const inviteEvents = pledger.events(['invite/declined', 'invite/reopened', 'expectation/opened'])
  const gears = PROPOSAL_FAMILIES.map(spec => gearRow(pledger, spec.family, window, now))
  const invites: VaultInviteRow[] = PROPOSAL_FAMILIES.map(spec => ({
    family: spec.family,
    label: spec.label,
    quiet: isFamilyQuiet(inviteEvents, spec.family),
    declinedInARow: declinedInARow(inviteEvents, spec.family),
    verbs: ['invite-reopen'],
  }))

  const quotaEvents = pledger.events(['invite/quota-set'])
  const lastQuota = asNumber(asRecord(quotaEvents.at(-1)?.data)?.quota)
  const today = new Date(now).toDateString()
  const usedToday = pledger.events(['invite/opened'])
    .filter(event => new Date(event.time).toDateString() === today).length

  const nothing = testing.length === 0 && awaiting.length === 0 && settled.length === 0
    && sunk.length === 0 && withdrawn.length === 0
  return {
    ...(pledger.owner === undefined ? {} : { owner: pledger.owner }),
    ...(pledger.directory === undefined ? {} : { directory: pledger.directory }),
    destroyPhrase: DESTROY_PHRASE,
    contract: CONTRACT_CHIPS,
    refusals: VAULT_REFUSALS,
    window,
    testing,
    awaiting,
    settled,
    sunk,
    withdrawn,
    patterns,
    distribution: {
      ...distributionCounts,
      // 文案取自**静态常量表**，不经模型——分布镜无判词的另一半保证。
      labels: ATTRIBUTION_LABEL,
      verbs: ['open-cell'],
    },
    gears,
    invites,
    quota: {
      quota: lastQuota ?? 2,
      usedToday,
      range: { min: 0, max: 3 },
      verbs: ['set-quota'],
    },
    settleDays: SETTLE_DAYS,
    foldThreshold: FOLD_THRESHOLD,
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
  const entry = (asString(state?.entry) ?? 'none') as VaultGearRow['entry']
  const shot = state?.evidenceSnapshot
  const stored = Array.isArray(shot) ? shot.map(anchoredOf) : []
  const cases = casesIn(pledger, window, now).filter(one => one.family === family)
  return {
    family,
    label: spec?.label ?? family,
    what: spec?.what ?? '',
    gear,
    evidence: [
      ...stored,
      {
        text: `近 ${String(window.days)} 天这一族的判例：${String(cases.length)} 条`,
        at: new Date(now).toISOString(),
      },
      {
        text: '这些是**你自己的行为事实**：采集与存储全在私账域，永不进组织侧通道与任何模型调优',
        at: new Date(now).toISOString(),
      },
    ],
    entry,
    /*
      **`lease` 档在 P1 不可达，而且说出来** (§4 档位生效面).

      租约本体是组织侧的 `lease/granted`，创建走既有强确认流程——而那一族在这套
      系统里还没有开门。私账这一侧只记「你换过挡」，绝不代替组织侧发一份并不存在
      的授权：免确认是组织侧行为，它的审计必须留在组织侧 (PTD-7)。
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
