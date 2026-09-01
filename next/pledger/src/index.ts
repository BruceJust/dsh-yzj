/**
 * `@yzj-next/pledger` — 私账层（金库）: the P–agent–P′ loop as engineering.
 *
 * **组织的图记承诺的一生，金库记你的判断的一生——两本账，两种可见性，永不合流。**
 *
 * This package is the FIRST second storage domain in the system: a personal
 * ledger the organization cannot read, the audit export cannot reach, and the
 * person can take away or destroy whole. Everything about how it is wired
 * exists to make those sentences mechanical rather than aspirational:
 *
 * - **三不入.** 私账对象不进收件箱、不进决断条、不进任何可应答聚合徽标 —— by
 *   STORAGE SEPARATION, not by a filter (PTD-2). `pendingAnswerables()` runs on
 *   the organization store and folds only families registered there; a private
 *   card is not in its domain of definition.
 * - **单向耦合.** This package imports the graph, the cards contracts and the
 *   channel's outbound API. Nothing organization-side imports it — enforced by
 *   an import-ban lint (断言②) and by the organization event schemas carrying
 *   no private field (PTD-4).
 * - **持镜人.** The agent only consumes this ledger at moments the person
 *   started. The organization-side orchestration (proposal generation, routing,
 *   evaluation, delegation, receipts) **cannot reach it on the dependency
 *   graph** — 「agent 不因你的误判史改组织侧行为」不靠自律靠链接器 (PTD-3).
 * - **部署二值开关.** `enabled: false` builds no directory, registers no tool,
 *   renders no entrance, and provides no service — and there is **no** "enabled
 *   and organization-visible" middle setting. 明拒的构造性兑现：没有这个旋钮，
 *   就不会被拧到危险档 (断言⑩). Turning it off later does not delete anything —
 *   destroy is the only deletion path.
 * @module @yzj-next/pledger
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@yzj-next/graph'
import type {} from '@yzj-next/cards'
import { PledgerCards } from './bus.ts'
import { calibrationCard } from './calibration.ts'
import { createDesk } from './desk.ts'
import { inviteCard } from './invite.ts'
import { inviteOnVerdict, reflowOnGraphEvent, reflowOnNotedFact, startClock } from './ring.ts'
import { YzjPledger } from './service.ts'
import { applyPledgerTools } from './tools.ts'

export { YzjPledger } from './service.ts'
export { PledgerCards, type PledgerActResult, type PledgerCardDefinition } from './bus.ts'
export {
  CAPABILITY_ENTRIES, createDesk, distributionFor, evidenceRowsOf, quotaStatus,
  type EvidenceFace, type EvidenceRow, type GearEffect, type MirrorStrip, type PledgerDesk,
  type PledgerLoopback, type PrivateFold, type PrivateRow, type TwoRead, type VaultHit,
} from './desk.ts'
export { upgradeLegacy } from './compat.ts'
export { DESTROY_PHRASE } from './destroy.ts'
export { calibrationCard, ATTRIBUTION_NOTE, type CalibrationState, type Case } from './calibration.ts'
export {
  FATIGUE_LIMIT, checkpointOf, inviteCard, inviteFor, isFamilyQuiet, PLEDGE_DIMENSIONS,
  type InviteState,
} from './invite.ts'
export {
  calibrationIdFor, calibrationIdemKeyFor, expectationIdFor, expectationIdemKeyFor,
  factIdFor, familyOfCardKind, familySpec, inviteIdFor, inviteIdemKeyFor, mirrorIdFor,
  FAMILY_DELIVERY_ACCEPTANCE, FAMILY_GOAL_BREAKDOWN, FAMILY_WRITE_CONFIRM, PROPOSAL_FAMILIES,
} from './families.ts'
export { PledgerLog, decodePledgerEvent, type LoadedPledger } from './log.ts'
export { casebookOf, readmeOf, vaultExport, type VaultExport } from './export.ts'
export {
  anchoredOf, attributionDistribution, casesIn, mirrorCases, mirrorIsOn, patternsIn,
  type AttributionDistribution, type Pattern,
} from './patterns.ts'
export {
  calibrationBirth, evidenceFor, renderWhen, structuralFactFor, verdictSnapshot,
  watchedVerdicts, WHY_LABEL,
  type MatchedFact, type WhenInput,
} from './reflow.ts'
export {
  DEFAULT_DAILY_QUOTA, QUOTA_RANGE,
  inviteGate, inviteOnVerdict, inviteRender, invitesToday, openCalibration, quotaOf,
  reflowOnGraphEvent, reflowOnNotedFact, startClock, tickCheckpoints,
  type GateRefusal,
} from './ring.ts'
export { PLEDGER_TOOLS, applyPledgerTools, isOperatorTurn, pledgerDenial } from './tools.ts'
export {
  ATTRIBUTION_LABEL, DEFAULT_PATTERN_WINDOW, FOLD_THRESHOLD, SETTLE_DAYS,
  PLEDGER_ENVELOPE_VERSION, PLEDGER_FOLD_VERSION,
  anchorKey, anchoredJson, factKey, snapshot,
  type AnchoredText, type Attribution, type CapabilityEntries, type FactSource,
  type FamilySpec, type Gear, type GearEntry, type OrgAnchor, type PatternWindow,
  type PledgerViewer, type PremiseState, type ProposalFamily, type RollingWindow,
  type SettleZone, type StructuralWhy,
} from './types.ts'
export {
  CONTRACT_CHIPS, FORBIDDEN_VERBS, VAULT_REFUSALS, gearRow, vaultView,
  type VaultCaseRow, type VaultDistributionRow, type VaultExpectationRow, type VaultGearRow,
  type VaultInviteRow, type VaultPatternRow, type VaultQuotaRow, type VaultView,
} from './vault.ts'
export {
  declineInvite, noteFact, pledgeOnVerdict, reattribute, reopenInvites, setDailyQuota,
  settleAnyway, shiftGear, toggleMirror, withdrawExpectation,
  type PledgeOutcome, type PledgeRefusal,
} from './verbs.ts'
export {
  VERDICT_SPECTRUM, anchorFor, goalRefOf, isAlive, isPledgeable, labelOf, seenVerdicts,
  topicOf, verdictKindOf,
  type Pledgeability, type SeenVerdict, type VerdictKind,
} from './verdicts.ts'
export {
  PLEDGER_FAMILIES, PLEDGER_KINDS,
  calibrationFamily, expectationFamily, factFamily, gearFamily, inviteFamily, mirrorFamily,
} from './vocabulary.ts'

export const name = 'yzj-next-pledger'

/**
 * `yzjCards` and `yzjGraph` are read-only dependencies: the card registry
 * supplies the `verdict` declaration and the desktop actor, the graph supplies
 * the anchors. `tools` supplies the two model-facing tools' registration face.
 *
 * **This list has no organization-side write dependency, and that is the point**
 * — there is nothing in this package's reach that could put a private fact on
 * the organization's ledger.
 */
export const inject = ['yzjGraph', 'yzjCards', 'tools']

const defaultHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')

export interface Config {
  /**
   * 部署二值开关.
   *
   * There is **no** third value. 「启用且组织可见」的中间态在配置面上不存在——
   * 明拒要造得出来才算数：没有这个旋钮，就不会有人在某个周五把它拧过去。
   */
  enabled?: boolean
  /** Root directory. Each operator gets a self-contained directory beneath it. */
  root?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  root: z.string().default(join(defaultHome, 'yzj-next', 'pledger')),
})

/** How often the plugin re-checks whether the operator identity has arrived. */
const IDENTITY_POLL_MS = 2_000

export function apply(ctx: Context, config: Config): void {
  /*
    **关掉就是什么都不做** (断言⑩).

    不建目录、不注册工具、不订阅、不提供服务。六个接缝在组织侧全部回落：它们读的
    都是 `ctx.yzjPledgerDesk`，而这里根本没有 provide 过它。**已有目录原样保留**
    ——中途关闭不删数据，destroy 两段式是唯一删除路径 (v1.1)。
  */
  if (config.enabled !== true) return

  const root = config.root ?? join(defaultHome, 'yzj-next', 'pledger')
  const pledger = new YzjPledger(ctx, { root: isAbsolute(root) ? root : resolve(root) })
  const bus = new PledgerCards(ctx)
  bus.register(inviteCard)
  bus.register(calibrationCard)

  ctx.effect(() => {
    const disposers: (() => void)[] = []
    disposers.push(ctx.provide('yzjPledgerDesk', createDesk(ctx, bus)))

    /*
      归属键 = operatorOpenId，而身份由通道解析出来 —— 所以这里等它.

      轮询而不是订阅：通道没有「身份就绪」这个事件，而为私账加一个，就是在组织侧
      为私账开一个口子（接缝清单外的第七点）。一个两秒的轮询换一条不必新增的边，
      这笔交易是划算的。
    */
    let identityTimer: ReturnType<typeof setInterval> | undefined
    const openWhenKnown = (): void => {
      const openId = ctx.get('yzjCards')?.desktopActor().openId
        ?? ctx.get('yzjTurns')?.defaultBinding()?.accountOpenId
      if (openId === undefined || openId === '') return
      if (identityTimer !== undefined) {
        clearInterval(identityTimer)
        identityTimer = undefined
      }
      void pledger.open(openId).catch((error: unknown) => {
        console.error('[yzj-next-pledger] failed to open the private ledger', error)
      })
    }
    openWhenKnown()
    if (!pledger.ready) {
      identityTimer = setInterval(openWhenKnown, IDENTITY_POLL_MS)
      identityTimer.unref?.()
      disposers.push(() => { if (identityTimer !== undefined) clearInterval(identityTimer) })
    }

    /*
      自聊 DM 出站 —— **只出不进** (§1).

      P1 的私账对象在**桌面**上应答（私语面与金库）；DM 那一份是文本兜底，让手机上
      也看得见发生了什么。让 DM 也能答，需要通道的分诊认得出私账卡的 ref——而
      `channel` 在 import 禁令名单里。那条路要走，得先有一个通用的「回复解析器注册
      面」，那是 P5 移动形态的事 (§9)。
    */
    const deliver = async (text: string): Promise<void> => {
      const openId = pledger.owner
      const topics = ctx.get('yzjTopics')
      if (openId === undefined || topics === undefined) return
      try {
        await topics.sendToPerson(openId, text)
      } catch (error) {
        // 投不出去不该拖住账本：账在这儿，消息只是它的一次投影。
        console.error('[yzj-next-pledger] failed to deliver a private message', error)
      }
    }

    /*
      接缝① —— 组织侧发的是一条**通用**的 `verdict-settled`，它不知道有人在听
      (PTD-15)。这里决定要不要开口，而这个决定读的全是组织侧事实。
    */
    disposers.push(ctx.on('yzj-cards/verdict-settled', (payload) => {
      void (async () => {
        /*
          接缝① 现在携来**种类**与**标题原文**（v2.0）。

          `kind` 让谱（纯函数）判得出这一种裁决值不值得开口；`titleText` 是立此存照律
          的原料——组织侧是唯一知道标题的人，它不随事件走，下游就只能回头解析锚，而
          那正是「判例是空壳」的成因。
        */
        const inviteId = await inviteOnVerdict(ctx, payload)
        if (inviteId === undefined) return
        const rendered = bus.renderText({ kind: 'invite', id: inviteId })
        if (rendered !== undefined) await deliver(rendered.body)
      })().catch((error: unknown) => {
        console.error('[yzj-next-pledger] failed to open a pledge invite', error)
      })
    }))

    // 接缝③ —— 只读订阅组织图。组织侧零改动；这个 watcher 崩了也不影响它。
    disposers.push(ctx.on('yzj-graph/appended', (event) => {
      void reflowOnGraphEvent(ctx, event).catch((error: unknown) => {
        console.error('[yzj-next-pledger] fact reflow failed', error)
      })
    }))

    // 私账自己的追加：人工补登的事实在这里变成一张回执。
    disposers.push(ctx.on('yzj-pledger/appended', (event) => {
      void (async () => {
        if (event.type === 'fact/noted') await reflowOnNotedFact(ctx, event)
        if (event.type === 'calibration/opened') {
          const data = event.data as { calibrationId?: unknown }
          const id = typeof data.calibrationId === 'string' ? data.calibrationId : undefined
          if (id === undefined) return
          const rendered = bus.renderText({ kind: 'calibration', id })
          if (rendered !== undefined) await deliver(rendered.body)
        }
      })().catch((error: unknown) => {
        console.error('[yzj-next-pledger] failed to handle a private append', error)
      })
    }))

    // 自带时间轮 (PTD-14). `scheduler` 在 ban 名单里，定时器由这个插件自己扛。
    disposers.push(startClock(ctx, deliver))
    disposers.push(applyPledgerTools(ctx))

    return async () => {
      for (const dispose of disposers.reverse()) dispose()
      try {
        await pledger.flush()
      } catch (error) {
        console.error('[yzj-next-pledger] failed to flush the private ledger', error)
      }
    }
  })
}
