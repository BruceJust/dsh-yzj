/**
 * v1.x 账本的**读时升级** —— 立此存照律落地之前写下的那些行，怎么读回来.
 *
 * 立此存照律（v2.0 / #62-A）把 `verdictRef` / `factRef` / `factText` / `evidence:
 * string[]` 换成了 `AnchoredText`。规格换了，**已经躺在磁盘上的行不会跟着换**——
 * 私账是追加日志，改写历史在这本账上是明拒的（更正即追加，销毁是唯一抹除）。
 *
 * 于是只剩两条路，而它们的差别不是风格问题：
 *
 * - **迁移**：重写日志。这本账的宪法不允许——一本会自己改写过去的判断记录，正是
 *   它存在的理由的反面。
 * - **读时升级**：读的时候把旧形状认出来，折成照片。**本文件**。
 *
 * 这条路之所以走得通，是因为 v1.x 的那些行**本来就带着全部文本**：`verdictRef.label`
 * 是当时的标题、`factText` 是当时的事实、`evidence` 是当时那几句话。所以这不是
 * 「回图解析一个锚」——一次组织图读取都没有发生，**升级的输入全部来自这本账自己**。
 *
 * 不这么做的后果在实例上是看得见的：线上那本账的三条判例会渲染成三行「（这一段没有
 * 留下快照）」，而那句话在这里是**假的**——快照在，只是叫别的名字。一句错的诚实
 * 比一句对的沉默更伤：人会以为自己的判断记录丢了。
 */

import { asRecord, asString, type JsonValue } from '@yzj-next/graph'
import { snapshot, type AnchoredText, type OrgAnchor } from './types.ts'

/** 已经是照片就别动它。缺文本的不算——那正是要升级的那一种。 */
function isPhoto(value: JsonValue | undefined): boolean {
  const record = asRecord(value)
  return typeof record?.text === 'string' && record.text !== ''
}

/** v1.x 的 `{ kind, id, label, graphSeq? }` → 照片。`label` 就是当时的那句话。 */
function photoOfRef(value: JsonValue | undefined, at: number): AnchoredText | undefined {
  const record = asRecord(value)
  const kind = asString(record?.kind)
  const id = asString(record?.id)
  if (kind === undefined || id === undefined) return undefined
  const graphSeq = record?.graphSeq
  const anchor: OrgAnchor = {
    kind, id, ...(typeof graphSeq === 'number' ? { graphSeq } : {}),
  }
  return snapshot(asString(record?.label) ?? `${kind}:${id}`, anchor, at)
}

/** v1.x 的证据是**一串字符串**。它们本来就是「当时的话」，只是没带时刻。 */
function photosOfLines(value: JsonValue | undefined, at: number): AnchoredText[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length === 0) return []
  if (value.every(one => typeof one === 'string')) {
    return value.map(one => snapshot(one as string, undefined, at))
  }
  return undefined
}

/**
 * 把一条旧状态折成新形状。**纯函数**：进去什么、出来什么，没有 IO。
 *
 * 认不出来的原样返回——一个升级器最要紧的性质是**不认识的东西不要碰**：这本账里
 * 还会有别的年代的行，而猜错了的升级比读不出来更难查。
 */
export function upgradeLegacy(state: JsonValue | undefined, at: number): JsonValue | undefined {
  const record = asRecord(state)
  if (record === undefined) return state
  const patch: Record<string, JsonValue> = {}

  // 「当时」——立约邀约、预期、回执三处同一个旧字段名。
  if (!isPhoto(record.verdict)) {
    const verdict = photoOfRef(record.verdictRef, at)
    if (verdict !== undefined) patch.verdict = { ...verdict } as unknown as JsonValue
  }

  /*
    「后来」—— v1.x 把事实拆成两半：`factText` 是话，`factRef` 是它从哪儿来的。

    照片要的是那句话；`factRef` 里的锚（结构性事实那一支带 `anchor`）顺带收进照片，
    人工补登那一支本来就没有锚——那也正确，图外的事实本来就跳不回去。
  */
  if (!isPhoto(record.fact)) {
    const factText = asString(record.factText)
    if (factText !== undefined) {
      const ref = asRecord(record.factRef)
      const anchor = photoOfRef(ref?.anchor, at)?.anchor
      patch.fact = { ...snapshot(factText, anchor, at) } as unknown as JsonValue
    }
  }

  // 事实源三分：v1.x 记在 `factRef.source` 上。
  if (asRecord(record.factSource) === undefined) {
    const ref = asRecord(record.factRef)
    const source = asString(ref?.source)
    const factId = asString(ref?.factId)
    const why = asString(ref?.why)
    if (source === 'noted' && factId !== undefined) {
      patch.factSource = { kind: 'noted', factId }
    } else if (source === 'org' && why !== undefined) {
      patch.factSource = { kind: 'org', why }
    }
  }

  const evidence = photosOfLines(record.evidence, at)
    ?? (Array.isArray(record.evidenceRefs)
      ? record.evidenceRefs
        .map(one => photoOfRef(one as JsonValue, at))
        .filter((one): one is AnchoredText => one !== undefined)
      : undefined)
  if (evidence !== undefined && !(Array.isArray(record.evidence) && record.evidence.every(isPhoto))) {
    patch.evidence = evidence.map(one => ({ ...one })) as unknown as JsonValue
  }

  return Object.keys(patch).length === 0 ? state : { ...record, ...patch }
}
