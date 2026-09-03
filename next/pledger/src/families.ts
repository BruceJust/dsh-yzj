/** 裁决族（组织轴，§4.0）与 id 推导。行随 dogfood 增删；印证列缺位的族如实留空（PTD-31）。 */
import { createHash } from 'node:crypto'
import { anchorKey, type OrgAnchor } from './types.ts'

export interface VerdictFamilySpec {
  readonly family: string
  readonly label: string
  /** 裁决种类 → 是否同意提案。不在表里的种类不入私账。 */
  readonly kinds: Readonly<Record<string, (actionId: string) => boolean>>
  /** 换挡三句 P1 只接验收族；其余族回「这类还没接上」。 */
  readonly clauses: boolean
  /** 「不用再问我」= 租约出口，只对能被租约覆盖的写确认族开门。 */
  readonly leasable: boolean
}

export const FAMILIES: readonly VerdictFamilySpec[] = [
  {
    family: 'acceptance',
    label: '验收',
    kinds: { acceptance: () => true, rework: () => false },
    clauses: true,
    leasable: false,
  },
  {
    family: 'write-confirm',
    label: '标准写确认',
    kinds: { 'write-confirm': actionId => actionId === 'approve' },
    clauses: false,
    leasable: true,
  },
  {
    family: 'proposal',
    label: '目标提案',
    kinds: { delegation: () => true, 'proposal-rejected': () => false },
    clauses: false,
    leasable: false,
  },
  {
    family: 'assessment',
    label: '目标评估',
    kinds: { assessment: () => true },
    clauses: false,
    leasable: false,
  },
]

export function familyOfKind(kind: string): VerdictFamilySpec | undefined {
  return FAMILIES.find(spec => kind in spec.kinds)
}

export function familySpec(family: string): VerdictFamilySpec | undefined {
  return FAMILIES.find(spec => spec.family === family)
}

export function familyLabel(family: string): string {
  return familySpec(family)?.label ?? family
}

function digest(domain: string, ...parts: readonly string[]): string {
  const hash = createHash('sha256').update(domain)
  for (const part of parts) hash.update('\0').update(part)
  return hash.digest('hex').slice(0, 24)
}

export const verdictKeyFor = (anchor: OrgAnchor, actionId: string): string => (
  `${anchorKey(anchor)}#${actionId}`
)
export const expectationIdemKeyFor = (anchor: OrgAnchor): string => `expectation:${anchorKey(anchor)}`
export const expectationIdFor = (anchor: OrgAnchor): string => (
  `exp-${digest('yzj-pledger-expectation-v3', anchorKey(anchor))}`
)
export const calibrationIdemKeyFor = (anchor: OrgAnchor, factKey: string): string => (
  `calibration:${anchorKey(anchor)}|${factKey}`
)
export const calibrationIdFor = (anchor: OrgAnchor, factKey: string): string => (
  `cal-${digest('yzj-pledger-calibration-v3', anchorKey(anchor), factKey)}`
)
export const factIdFor = (about: string, text: string, at: number): string => (
  `fct-${digest('yzj-pledger-fact-v3', about, text, String(at))}`
)
export const clauseIdFor = (key: string, family?: string): string => (
  family === undefined ? key : `${key}:${family}`
)
