/**
 * 模式 —— **纯派生查询，零存储** (§3 末 / PTD-5).
 *
 * 判例永续（日志全量在），模式滚动（窗口只在查询层）。滚动是**派生窗口**不是删除：
 * 窗外的判例仍然躺在日志里，只是不参与这一次计数。这是「金库照现在的你，不给你
 * 建档案」的机械保证——**没有累积存储就没有档案可建**。
 *
 * The window is a REQUIRED parameter on every function here. 「判断力得分」不是
 * 一个被禁止的查询，是一个**写不出来的**查询：没有不带窗口的重载 (断言⑤)。
 *
 * 派生规则本身刻意是**结构性**的：按（提案族 × 归因格）数你自己的判例，不做任何
 * 语义归纳。系统对你的判断不发表意见——它只把你自己下过的那些格子摆出来，每个
 * 数字是一扇门，推开是判例本身。
 */

import { asNumber, asRecord, asString } from '@yzj-next/graph'
import type { YzjPledger } from './service.ts'
import { familySpec } from './families.ts'
import { ATTRIBUTION_LABEL, type Attribution, type OrgAnchor, type PatternWindow } from './types.ts'
import type { Case } from './calibration.ts'

/** A pattern only exists once it has happened more than once. */
const MIN_OCCURRENCES = 2

/** 判例 —— `calibration/answered` 的留痕本身，读回来的样子。 */
export function casesIn(pledger: YzjPledger, window: PatternWindow, now = Date.now()): readonly Case[] {
  const since = now - window.days * 24 * 60 * 60 * 1000
  const out: Case[] = []
  for (const object of pledger.query('calibration')) {
    const state = asRecord(object.state)
    if (state === undefined) continue
    /*
      吸收态不入任何派生查询.

      「配对错了」说的是这条事实与那次裁决**无关**——把它算进模式，等于让一次
      正确的拒绝变成一条关于你的统计。宁空勿错在这里的意思就是这个。
    */
    if (asString(state.status) !== 'answered') continue
    if (object.updatedAt < since) continue
    const attribution = asString(state.attribution)
    if (attribution === undefined) continue
    const verdict = asRecord(state.verdictRef)
    out.push({
      calibrationId: object.id,
      attribution: attribution as Attribution,
      at: object.updatedAt,
      family: asString(state.family) ?? '',
      thenText: asString(state.thenText) ?? '',
      factText: asString(state.factText) ?? '',
      verdictRef: {
        kind: asString(verdict?.kind) ?? '',
        id: asString(verdict?.id) ?? '',
        ...(asNumber(verdict?.graphSeq) === undefined ? {} : { graphSeq: asNumber(verdict?.graphSeq) as number }),
        ...(asString(verdict?.label) === undefined ? {} : { label: asString(verdict?.label) as string }),
      } satisfies OrgAnchor,
    })
  }
  return out.sort((left, right) => right.at - left.at)
}

/** One rolling pattern. Every number is a door; the cases behind it are yours. */
export interface Pattern {
  /** `${family}:${attribution}` — the mirror's other half of its address. */
  readonly patternKey: string
  readonly family: string
  readonly attribution: Attribution
  readonly label: string
  readonly count: number
  /** 派生自哪些判例。数字点开就是它们——模式不可编造。 */
  readonly cases: readonly Case[]
  /** Whether the rear-view mirror is on for this one. */
  readonly mirror: boolean
}

/**
 * 滚动派生 —— the window is not optional and there is no total.
 *
 * Grouped by (proposal family × attribution cell). Nothing is scored, ranked,
 * or averaged: 金库五不做 —— 无分数、无排名、无画像、无建议倾向、无团队视图。
 */
export function patternsIn(
  pledger: YzjPledger,
  window: PatternWindow,
  now = Date.now(),
): readonly Pattern[] {
  const grouped = new Map<string, Case[]>()
  for (const one of casesIn(pledger, window, now)) {
    if (one.family === '') continue
    const key = `${one.family}:${one.attribution}`
    const bucket = grouped.get(key)
    if (bucket === undefined) grouped.set(key, [one])
    else bucket.push(one)
  }
  const out: Pattern[] = []
  for (const [patternKey, cases] of grouped) {
    if (cases.length < MIN_OCCURRENCES) continue
    const first = cases[0]
    if (first === undefined) continue
    out.push({
      patternKey,
      family: first.family,
      attribution: first.attribution,
      label: `${familySpec(first.family)?.label ?? first.family} · ${ATTRIBUTION_LABEL[first.attribution]}`,
      count: cases.length,
      cases,
      mirror: mirrorIsOn(pledger, first.family, patternKey),
    })
  }
  return out.sort((left, right) => right.count - left.count)
}

/** Whether the operator has signed a rear-view mirror for this pattern. */
export function mirrorIsOn(pledger: YzjPledger, family: string, patternKey: string): boolean {
  const object = pledger.object('mirror', `${family}:${patternKey}`)
  return asRecord(object?.state)?.on === true
}

/**
 * 后视镜要显示的那几条判例 —— 该族、该模式、窗口内，最近三条.
 *
 * 三条是**条尾的量级**，不是一个阈值：后视镜是长在别人卡片旁边的一条细线，不是
 * 第二个金库。要看全部，门就在那条线上（一跳回金库）。
 */
export function mirrorCases(
  pledger: YzjPledger,
  family: string,
  window: PatternWindow,
  now = Date.now(),
): readonly Case[] {
  const on = patternsIn(pledger, window, now).filter(
    pattern => pattern.family === family && pattern.mirror,
  )
  return on.flatMap(pattern => pattern.cases).slice(0, 3)
}
