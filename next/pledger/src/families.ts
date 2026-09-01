/**
 * 提案族注册表与 id 推导.
 *
 * **每个提案族都有三档** (§4 换挡台). P1 ships three, and the registry is open:
 * a new family declares itself here and the gear bench, the mirror and the
 * fatigue governor all pick it up without any of them learning a new type —
 * the same「模式有限，场景实例开放」discipline the card system runs on.
 *
 * Every id in this file is derived from its anchors rather than generated.
 * That is what makes the idempotency anchors real: 同一裁决至多一张邀约、
 * 至多一个预期，同一（裁决,事实）至多一张回执——**幂等锚计算铁律**，永远算在
 * 状态机里，绝不由模型传进来。
 */

import { createHash } from 'node:crypto'
import {
  anchorKey, factKey,
  type AnchoredText, type FactSource, type FamilySpec, type OrgAnchor,
} from './types.ts'

/** Standard write confirmations — the highest-volume, lowest-information family. */
export const FAMILY_WRITE_CONFIRM = 'write-confirm'
/** Goal breakdown proposals — where 生成侧萎缩 bites hardest. */
export const FAMILY_GOAL_BREAKDOWN = 'goal-breakdown'
/**
 * 交付验收 —— agent 把一份被主张的交付摆到你面前，请你判它行不行.
 *
 * **分册 §9 把这一族叫「交付前自检【多操作者期执行者侧】」**，而 P1 只有操作者一端：
 * 同一个时刻的两头——执行者那头是交付前自己看一遍，验收者这头是判它够不够好。名字
 * 取的是**这个部署里真的会发生的那一头**，因为换挡台上这一行的证据说的全是你的验收
 * 裁决；挂一个「交付前自检」的标题在上面，屏幕就在说一句不成立的话。多操作者期
 * 执行者侧的自检是同一族的第二个入口，那时这个名字仍然对。
 */
export const FAMILY_DELIVERY_ACCEPTANCE = 'delivery-acceptance'

/**
 * P1 的三族 (§9 提案族三族起步).
 *
 * `cardKinds` is how a verdict finds its family. It reads organization card
 * kinds and nothing else — the private ledger classifies ITS OWN rows by
 * looking at the organization side, never the reverse.
 */
export const PROPOSAL_FAMILIES: readonly FamilySpec[] = [
  {
    family: FAMILY_WRITE_CONFIRM,
    label: '标准写确认',
    what: 'sheet / doc 一类的写入确认卡',
    cardKinds: ['approval'],
  },
  {
    family: FAMILY_GOAL_BREAKDOWN,
    label: '目标拆解提案',
    what: 'agent 把一个目标拆成几条活的提案',
    cardKinds: ['proposal', 'assessment'],
  },
  {
    family: FAMILY_DELIVERY_ACCEPTANCE,
    label: '交付验收',
    what: '别人主张交付了，请你判它行不行',
    cardKinds: ['commitment'],
  },
]

/** The family one organization card kind belongs to, when it belongs to one. */
export function familyOfCardKind(kind: string): FamilySpec | undefined {
  return PROPOSAL_FAMILIES.find(spec => spec.cardKinds.includes(kind))
}

export function familySpec(family: string): FamilySpec | undefined {
  return PROPOSAL_FAMILIES.find(spec => spec.family === family)
}

/** Short stable digest. Same construction as the organization families use. */
function digest(domain: string, ...parts: readonly string[]): string {
  const hash = createHash('sha256').update(domain)
  for (const part of parts) hash.update('\0').update(part)
  return hash.digest('hex').slice(0, 24)
}

/**
 * 幂等锚 —— 一次裁决至多一张邀约.
 *
 * Derived from the verdict anchor alone, so a re-delivered verdict event, a
 * replay, or a second subscriber can never mint a second invite for the same
 * decision.
 */
export function inviteIdemKeyFor(verdict: OrgAnchor): string {
  return `invite:${anchorKey(verdict)}`
}

export function inviteIdFor(verdict: OrgAnchor): string {
  return `inv-${digest('yzj-pledger-invite-v1', anchorKey(verdict))}`
}

/**
 * 幂等锚 = verdictRef —— 同一裁决至多一次 `expectation/opened` (断言③).
 *
 * The withdrawal case rides on the same anchor: after `expectation/withdrawn`
 * the object still exists under this key, so a second `opened` collapses onto
 * it and folds to a no-op. 改赌注 = 撤回 + 不可再立, enforced by the anchor
 * rather than by a check somebody could forget.
 */
export function expectationIdemKeyFor(verdict: OrgAnchor): string {
  return `expectation:${anchorKey(verdict)}`
}

export function expectationIdFor(verdict: OrgAnchor): string {
  return `exp-${digest('yzj-pledger-expectation-v1', anchorKey(verdict))}`
}

/** 幂等锚 =（裁决边, 事实边）—— 同一事实多次回流不重复出执 (断言④). */
export function calibrationIdemKeyFor(
  verdict: OrgAnchor, fact: AnchoredText, source: FactSource,
): string {
  return `calibration:${anchorKey(verdict)}|${factKey(fact, source)}`
}

export function calibrationIdFor(
  verdict: OrgAnchor, fact: AnchoredText, source: FactSource,
): string {
  return `cal-${digest('yzj-pledger-calibration-v1', anchorKey(verdict), factKey(fact, source))}`
}

/** One manually noted fact's id. Derived from its own text and target. */
export function factIdFor(about: string, text: string, at: number): string {
  return `fct-${digest('yzj-pledger-fact-v1', about, text, String(at))}`
}

/** `${family}:${patternKey}` — the mirror's idempotent address. */
export function mirrorIdFor(family: string, patternKey: string): string {
  return `${family}:${patternKey}`
}
