/**
 * `@yzj-next/pledger` — 私账层：自知（决策 #64 / 分册 v3.1）。零新场所、零 IM 消息、模型无写入工具。
 * 部署二值开关：`enabled: false` 不建目录、不注册工具、不订阅、不提供服务；关不删数据。
 * @module @yzj-next/pledger
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { asRecord, asString } from '@yzj-next/graph'
import type {} from '@yzj-next/cards'
import { createDesk } from './desk.ts'
import { familySpec } from './families.ts'
import { recordLeaseClause } from './pledge.ts'
import { reflowOnGraphEvent, reflowOnNotedFact, startClock } from './reflow.ts'
import { YzjPledger } from './service.ts'
import { applyPledgerTools } from './tools.ts'
import { fileVerdict } from './verdicts.ts'

export { YzjPledger } from './service.ts'
export { createDesk, evidenceRowsOf, type EvidenceFace, type EvidenceRow, type PledgerDesk } from './desk.ts'
export { judgView, receiptRows, pledgeRows, type FamilyHead, type JudgGroup, type JudgView, type PledgeRow, type ReceiptRow } from './judg.ts'
export { stripsFor, familyOfCard, type Strip } from './strips.ts'
export { casebookOf, readmeOf, indicators, judgContract, DESTROY_PHRASE, HARD_TERMS, type JudgContract } from './export.ts'
export {
  activeClauses, attribute, clauseOn, clearClause, dismiss, markSeen, noteFact, parsePrivateSay, pledge,
  recordLeaseClause, setClause, withdraw, type PrivateSay,
} from './pledge.ts'
export { openReceipt, pairFact, receiptOf, reflowOnGraphEvent, reflowOnNotedFact, startClock, tickCheckpoints, type PairedFact } from './reflow.ts'
export { checkpointFor, fileVerdict, filedVerdicts, isAlive, latestVerdictIn, type FiledVerdict, type VerdictSettled } from './verdicts.ts'
export { FAMILIES, familyLabel, familyOfKind, familySpec, type VerdictFamilySpec } from './families.ts'
export { PLEDGER_TOOLS, applyPledgerTools, isOperatorTurn, pledgerDenial } from './tools.ts'
export { PledgerLog, decodePledgerEvent, type LoadedPledger } from './log.ts'
export { PLEDGER_FAMILIES, PLEDGER_KINDS } from './vocabulary.ts'
export {
  ATTRIBUTION_LABEL, ATTRIBUTION_NOTE, CLAUSE_TEXT, DEFAULT_WINDOW, PLEDGER_ENVELOPE_VERSION, PLEDGER_FOLD_VERSION,
  RECEIPT_TYPE_LABEL, anchorKey, anchoredJson, anchoredOf, snapshot,
  type AnchoredText, type Attribution, type ClauseKey, type JudgWindow, type OrgAnchor, type PledgerViewer,
  type PremiseState, type ReceiptType,
} from './types.ts'

export const name = 'yzj-next-pledger'
/** 只读依赖：卡注册表（裁决声明）、组织图（锚）、工具注册面。没有任何组织侧写依赖。 */
export const inject = ['yzjGraph', 'yzjCards', 'tools']

const defaultHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')

export interface Config {
  enabled?: boolean
  root?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  root: z.string().default(join(defaultHome, 'yzj-next', 'pledger')),
})

const IDENTITY_POLL_MS = 2_000

export function apply(ctx: Context, config: Config): void {
  if (config.enabled !== true) return
  const root = config.root ?? join(defaultHome, 'yzj-next', 'pledger')
  const pledger = new YzjPledger(ctx, { root: isAbsolute(root) ? root : resolve(root) })

  ctx.effect(() => {
    const disposers: (() => void)[] = []
    disposers.push(ctx.provide('yzjPledgerDesk', createDesk(ctx)))

    // 归属键 = operatorOpenId，由通道解析；轮询等它，不为私账在组织侧开事件。
    let identityTimer: ReturnType<typeof setInterval> | undefined
    const openWhenKnown = (): void => {
      const openId = ctx.get('yzjCards')?.desktopActor().openId ?? ctx.get('yzjTurns')?.defaultBinding()?.accountOpenId
      if (openId === undefined || openId === '') return
      if (identityTimer !== undefined) { clearInterval(identityTimer); identityTimer = undefined }
      void pledger.open(openId).catch((error: unknown) => { console.error('[yzj-next-pledger] failed to open the private ledger', error) })
    }
    openWhenKnown()
    if (!pledger.ready) {
      identityTimer = setInterval(openWhenKnown, IDENTITY_POLL_MS)
      identityTimer.unref?.()
      disposers.push(() => { if (identityTimer !== undefined) clearInterval(identityTimer) })
    }

    // 接缝①：通用裁决广播 → 裁决归档（族 / 同意与否 / 两分母）。不触发任何邀约。
    disposers.push(ctx.on('yzj-cards/verdict-settled', (payload) => {
      void fileVerdict(ctx, payload).catch((error: unknown) => { console.error('[yzj-next-pledger] failed to file a verdict', error) })
    }))

    // 接缝③：组织图只读订阅 → 回流配对；`lease/granted` → 私记 clause{lease}（组织图零字段）。
    disposers.push(ctx.on('yzj-graph/appended', (event) => {
      void (async () => {
        await reflowOnGraphEvent(ctx, event)
        if (event.type !== 'lease/granted') return
        const data = asRecord(event.data)
        const grantedBy = asString(data?.grantedBy)
        if (grantedBy !== undefined && grantedBy !== pledger.owner) return
        const leaseId = asString(data?.leaseId)
        const toolClass = asString(asRecord(data?.scope)?.toolClass) ?? ''
        const family = asString(data?.family) ?? 'write-confirm'
        if (leaseId === undefined || familySpec(family) === undefined) return
        await recordLeaseClause(ctx, { leaseRef: leaseId, family, text: `不用再问我：${toolClass} 一类的写入，${asString(data?.periodText) ?? '这一期'}` })
      })().catch((error: unknown) => { console.error('[yzj-next-pledger] fact reflow failed', error) })
    }))

    // 私账自己的追加：补登的事实变成回执的「后来」。
    disposers.push(ctx.on('yzj-pledger/appended', (event) => {
      void reflowOnNotedFact(ctx, event).catch((error: unknown) => { console.error('[yzj-next-pledger] noted-fact reflow failed', error) })
    }))

    disposers.push(startClock(ctx))
    disposers.push(applyPledgerTools(ctx))
    return async () => {
      for (const dispose of disposers.reverse()) dispose()
      await pledger.flush().catch((error: unknown) => { console.error('[yzj-next-pledger] failed to flush the private ledger', error) })
    }
  })
}
