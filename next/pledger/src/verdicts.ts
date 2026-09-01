/**
 * 裁决的读法 —— read-only, off the organization graph, one direction only.
 *
 * The private ledger needs to know two things about the other ledger: **which
 * verdicts you have handed down**, and **what has happened since**. Both are
 * already on the graph — 原料图已天然生产 — so nothing is written to the
 * organization side to make this work.
 *
 * **组织图只读接口的三个用途** (§1 v2.0 精确化)，这个文件是它们的全部实现：
 * ① **导航** —— 把锚渲染成可点的一跳回（surface 层消费）；
 * ② **活性探测** —— {@link isAlive}，返回**状态不返回内容**；
 * ③ **幂等键** —— 锚作为 idemKey 的组成。
 *
 * **取内容一律非法**：{@link labelOf} 是唯一一处读文本的地方，而它只在**写入的那一
 * 刻**被调用来拍照（`AnchoredText.text`）；此后一切正文渲染只读照片，不再回图。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asObjectRef, asRecord, asString, type GraphObject } from '@yzj-next/graph'
import { familyOfCardKind } from './families.ts'
import type { OrgAnchor, PremiseState } from './types.ts'

/**
 * 一次人签发的裁决，私账看见的样子 (v2.0 接缝① payload 的私账侧形态).
 *
 * `kind` 是**组织侧用自己的话说出的裁决种类**（`acceptance` / `rework` / …）——组织侧
 * 不知道有人在听，更不含任何立约判据；判据（谱）在 pledger 侧，见 {@link isPledgeable}。
 */
export interface SeenVerdict {
  readonly anchor: OrgAnchor
  readonly kind: string
  readonly actionId: string
  readonly family: string
  readonly at: number
  readonly seq: number
  /** 组织侧携来的标题原文 —— **立此存照律的原料**（组织侧是唯一知道标题的人）。 */
  readonly titleText?: string
}

/**
 * 谱 —— 判据三段式的第一段 (v2.0 / #62-B4 / PTD-19).
 *
 * **纯函数：无 pgraph、无 IO、无 ctx。** 它只回答一个问题——这种裁决**值不值得**
 * 开口问一次立约。四判据：
 *
 * ① **有人签发的裁决留痕**（所有走到这里的都满足）；
 * ② **有可命名的检验点**（说得出「什么时候见分晓」）；
 * ③ **事实会自行回流**（图内结构性事实够得着，不必人天天记着）；
 * ④ **信息量否决位** —— 高频低信息的那些，判据①②③ 全过也一律否决。
 *
 * 第四条是这张表的骨头：标准写确认每天几十次、每次都「有留痕、有下一步、有回流」，
 * 可它承载的判断量近乎零——在那里问立约，邀约就退化成 nag，而**一个会 nag 的镜子
 * 没有人会再照第二次**。
 */
export type VerdictKind =
  /** 验收 —— 你说这份东西够好了。 */
  | 'acceptance'
  /** 打回·返工 —— 你说它还不够好，还要再来一轮。 */
  | 'rework'
  /** 差距简报验收 —— 对着标准逐条看完，你说这个目标成了。 */
  | 'assessment'
  /** 委派签发（含拆解落库）—— 你把一件事交出去了。 */
  | 'delegation'
  /** 租约签发 —— 你说这一类以后不必再问你。 */
  | 'lease-grant'
  /** 标准写确认 —— 高频低信息，判据④ 否决。 */
  | 'write-confirm'
  /** 目标签发 —— 跨季、回流慢，押证据门。 */
  | 'goal-issuance'
  /** 移交 / 作废 —— 检验点模糊、回流弱，押证据门。 */
  | 'disposal'

/** 谱表的三态。`gated` = 判据过得去但押证据门，P1 不问（明标，非遗漏）。 */
export type Pledgeability = 'yes' | 'no' | 'gated'

/**
 * 裁决面全集谱 (v2.0 §4.1 定谱，取代 v1.x 的两点枚举).
 *
 * 每一格都写出**为什么**——一张只有 ✓✗ 的表，下一个人加第九种裁决时无从判断。
 */
export const VERDICT_SPECTRUM: Readonly<Record<VerdictKind, {
  readonly verdict: Pledgeability
  readonly checkpoint: string
  readonly reflow: string
  readonly information: string
}>> = {
  acceptance: { verdict: 'yes', checkpoint: '使用场合/下一轮', reflow: '图内结构性', information: '高' },
  rework: { verdict: 'yes', checkpoint: '下一轮交付', reflow: '返工轮次对象', information: '高' },
  assessment: { verdict: 'yes', checkpoint: '下次评估', reflow: '图内结构性', information: '高' },
  delegation: { verdict: 'yes', checkpoint: 'due 既有两层', reflow: '交付/验收边（图内）', information: '高' },
  'lease-grant': { verdict: 'yes', checkpoint: '90 天到期', reflow: '重签卡期间摘要', information: '高' },
  'write-confirm': { verdict: 'no', checkpoint: '弱', reflow: '弱', information: '低（否决）' },
  'goal-issuance': { verdict: 'gated', checkpoint: '跨季', reflow: '慢', information: '高' },
  disposal: { verdict: 'gated', checkpoint: '模糊', reflow: '弱', information: '中' },
}

/**
 * 谱 —— 这种裁决该不该开口。**纯函数，签名里只有一个字符串。**
 *
 * 断言⑲ 断的就是这个签名：没有 ctx、没有 pgraph、没有 IO。判据留在私账侧，组织侧
 * 的发射点因此不含**任何**立约分支——它连有人在听都不知道。
 */
export function isPledgeable(kind: string): boolean {
  return VERDICT_SPECTRUM[kind as VerdictKind]?.verdict === 'yes'
}

/** Whether one organization card action is declared a verdict by its family. */
export function verdictKindOf(ctx: Context, kind: string, actionId: string): string | undefined {
  const definition = ctx.get('yzjCards')?.definitionOf(kind)
  return definition?.actions.find(action => action.id === actionId)?.verdict
}

/**
 * What one organization object is called **right now**.
 *
 * **只在写入的那一刻被调用** —— 拍照用。此后正文一律读照片（立此存照律）：这个函数
 * 出现在任何渲染路径上都是违规，断言⑯ 静态扫描渲染函数的入参类型。
 */
export function labelOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.what) ?? asString(state?.summary) ?? asString(state?.reason)
}

/** Resolve one organization ref into an anchor. **锚上不带文本** —— 文本在照片里。 */
export function anchorFor(ctx: Context, kind: string, id: string, graphSeq?: number): OrgAnchor {
  void ctx
  return { kind, id, ...(graphSeq === undefined ? {} : { graphSeq }) }
}

/**
 * 活性探测 —— **返回状态，不返回内容** (§1 三用途之②，锚死显形的唯一数据源).
 *
 * 三值而不是布尔，因为「答不出」和「已经死了」是两句不同的话：取走后的目录里、
 * 并存期切实例时，组织图根本不可达——那时候显形一句「前提已变」是**编造**。
 * `unknown` 不显形，是认识论诚实的同款落点。
 */
export function isAlive(ctx: Context, anchor: OrgAnchor): PremiseState {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined) return 'unknown'
  /*
    **目标没有自己的对象族** —— 它是一条 `state.goalRef` 等于这个 URI 的承诺.

    不认这一层，`rawObject('goal', uri)` 恒为 undefined，于是每一个目标锚都常年
    挂着「真身已变 / 已亡」——**而那个目标好好的**。这比少一块预览严重得多：
    少一块预览是没说话，一枚假徽记是**说了假话**，而它说的偏偏是这本账最要紧的
    那一句「你当时押的前提还在不在」。

    （surface 侧的只读预览里有一个同样的查找。两处各在各的层：这里只回状态，
    那里才取内容——**分层的代价就是这一点重复**，合并它就等于把取内容的通道
    递给了私账层。）
  */
  const object = anchor.kind === 'goal'
    ? goalObjectOf(ctx, anchor.id)
    : graph.rawObject(anchor.kind, anchor.id)
  if (object === undefined) return 'changed'
  const status = asString(asRecord(object.state)?.status)
  if (status === undefined) return 'live'
  return DEAD_STATUSES.has(status) ? 'changed' : 'live'
}

/** 一个目标 URI 背后的那条承诺。**事件收候选、状态定案**。 */
function goalObjectOf(ctx: Context, goalRef: string): GraphObject | undefined {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined) return undefined
  for (const event of graph.rawEvents(['commitment/opened', 'commitment/amended'])) {
    const data = asRecord(event.data)
    if (asString(data?.goalRef) !== goalRef) continue
    const id = asString(data?.commitmentId)
    if (id === undefined) continue
    const object = graph.rawObject('commitment', id)
    if (asString(asRecord(object?.state)?.goalRef) === goalRef) return object
  }
  return undefined
}

/**
 * 「前提已变」认哪些终态.
 *
 * `transferred` 在名单里（决策 #59）：这件事还在做，但**不在这条边上**——你当时
 * 押的那条边已经不是同一条了，那正是「前提已变」要说的事。
 */
const DEAD_STATUSES = new Set(['voided', 'transferred', 'merged', 'expired', 'superseded'])

/**
 * Every verdict on the organization graph, oldest first.
 *
 * Derived from `answer/recorded` — the organization bus's own trace of「有人
 * 答了」— intersected with the families' `verdict` declaration. Nothing is
 * stored on the private side to mirror it.
 */
export function seenVerdicts(ctx: Context): readonly SeenVerdict[] {
  const graph = ctx.get('yzjGraph')
  if (graph === undefined) return []
  const out: SeenVerdict[] = []
  for (const event of graph.rawEvents(['answer/recorded'])) {
    const data = asRecord(event.data)
    if (data === undefined || data.outcome !== 'applied') continue
    const ref = asObjectRef(data.cardRef)
    const actionId = asString(data.actionId)
    if (ref === undefined || actionId === undefined) continue
    const kind = verdictKindOf(ctx, ref.kind, actionId)
    if (kind === undefined) continue
    const family = familyOfCardKind(ref.kind)
    if (family === undefined) continue
    const titleText = labelOf(ctx, ref.kind, ref.id)
    out.push({
      anchor: anchorFor(ctx, ref.kind, ref.id, event.seq),
      kind,
      actionId,
      family: family.family,
      at: event.time,
      seq: event.seq,
      ...(titleText === undefined ? {} : { titleText }),
    })
  }
  return out
}

/**
 * The goal one verdicted object serves, when it serves one.
 *
 * Both structural fact rules hang off it: 「同 goalRef 的血缘新边」 and
 * 「同一目标上后来的差距简报」.
 */
export function goalRefOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.parentGoalRef) ?? asString(state?.goalRef)
}

/** The conversation one verdicted object lived in, for the lineage rule. */
export function topicOf(ctx: Context, kind: string, id: string): string | undefined {
  const state = asRecord(ctx.get('yzjGraph')?.rawObject(kind, id)?.state)
  return asString(state?.topicKey) ?? asString(asRecord(state?.executor)?.topicKey)
}
