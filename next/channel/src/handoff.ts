/**
 * `/handoff` — cross-place transfer, and the first real producer of crossing
 * records.
 *
 * The design's ruling is that information crosses into another place through
 * exactly one legal channel: **a declassified package a human signed off on**.
 * So the command never sends anything by itself. It assembles a background
 * package (artifact links, acceptance criteria, decision summary), puts it on
 * a confirmation card, and only the operator's answer moves it. Private asides
 * do NOT travel — a handoff carries the work, not the conversation about it.
 *
 * The authorization chain exists because sending to the wrong group is not a
 * typo, it is a disclosure incident:
 *
 * 1. the resolved group NAME AND ID are shown on the card (an ambiguous name
 *    lists candidates instead of guessing);
 * 2. the target must be a conversation the operator is actually in;
 * 3. during the trial it must also be inside this instance's allow-list;
 * 4. any failure degrades to "the agent drafts it, the operator sends it" —
 *    the same declared fallback the on-behalf-of ban uses.
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import type { CardRef } from '@yzj-next/cards'
import { YZJ_TEXT_SURFACE } from '@yzj-next/objects'
import { placeKeyFor, type YzjGroup, type YzjTopicRoute } from './protocol.ts'
import type { YzjChannelClient } from './client.ts'
import { onDutyIn } from './poller.ts'

/** What the operator is being asked to release, and to whom. */
export interface HandoffPlan {
  readonly handoffId: string
  readonly fromRoute: YzjTopicRoute
  readonly targetGroupId: string
  readonly targetGroupName: string
  readonly note: string
  readonly body: string
  readonly artifacts: readonly { uri: string; placeKey: string; title?: string }[]
}

export type HandoffPreparation =
  | { readonly kind: 'ready'; readonly plan: HandoffPlan }
  /** The name matched several conversations; the operator picks one. */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly YzjGroup[] }
  /** Cannot send from here — the caller must fall back to draft-and-send. */
  | { readonly kind: 'refused'; readonly reason: string; readonly draft: string }

function handoffIdFor(topicKey: string, targetGroupId: string): string {
  const hash = createHash('sha256')
    .update('yzj-next-handoff-v1').update('\0')
    .update(topicKey).update('\0')
    .update(targetGroupId)
    .digest('hex')
    .slice(0, 20)
  return `hof-${hash}`
}

export interface HandoffDeps {
  readonly ctx: Context
  readonly client: YzjChannelClient
  /** Conversations this instance may act in; empty means unrestricted. */
  readonly allowedGroupIds: ReadonlySet<string>
  /** 被明确移出服务的群。移交过去等于往一个 agent 不在岗的地方递活。 */
  readonly deniedGroupIds: ReadonlySet<string>
  /** 部署层显式写下的「全量上岗」——和 `onDutyIn` 同一个谓词读它。 */
  readonly serveAll?: boolean
  readonly groupPages: number
}

/**
 * Assemble the package and resolve the target. Reads the graph for what this
 * topic actually produced — the package is a projection, not a retelling.
 */
export async function prepareHandoff(
  deps: HandoffDeps,
  route: YzjTopicRoute,
  target: string,
  note: string,
): Promise<HandoffPreparation> {
  const artifacts: { uri: string; placeKey: string; title?: string }[] = []
  for (const event of deps.ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    const data = asRecord(event.data)
    if (asString(data?.topicKey) !== route.topicKey) continue
    const artifact = asRecord(data?.artifact)
    const uri = asString(artifact?.uri)
    const placeKey = asString(artifact?.placeKey)
    if (uri === undefined || placeKey === undefined) continue
    const title = asString(artifact?.title)
    artifacts.push({ uri, placeKey, ...(title === undefined ? {} : { title }) })
  }

  const body = [
    `【移交】来自「${route.groupName}·${route.topicLabel}」`,
    note === '' ? '' : `说明：${note}`,
    ...(artifacts.length === 0 ? [] : ['相关工件：', ...artifacts.map(a => `· ${a.title ?? a.uri}\n  ${a.uri}`)]),
    '（私语未随包迁移；如需完整上下文请在此话题里 @ 我。）',
  ].filter(line => line !== '').join('\n')

  const groups = await deps.client.recentGroups(deps.groupPages)
  const normalized = target.trim().toLowerCase()
  const matches = groups.filter(group => (
    group.groupId === target
    || group.groupName.toLowerCase() === normalized
    || group.groupName.toLowerCase().includes(normalized)
  ))
  if (matches.length === 0) {
    return { kind: 'refused', reason: `找不到会话「${target}」（只能移交到你在的群）`, draft: body }
  }
  if (matches.length > 1 && !matches.some(group => group.groupId === target)) {
    return { kind: 'ambiguous', candidates: matches.slice(0, 5) }
  }
  const chosen = matches.find(group => group.groupId === target) ?? matches[0]
  if (chosen === undefined) {
    return { kind: 'refused', reason: `找不到会话「${target}」`, draft: body }
  }
  /*
    在不在岗**共用那一个谓词** (v3.15 裁决①).

    这里此前自己抄了一遍规则（`size > 0 && !has`）——于是「空集」在这条路上的含义
    与 `onDutyIn` 里的各是各的。收窄语义那天，两处只会改到一处，而没改的那一处
    正好是把话说进另一个群的那条路：移交到一个 agent 不在岗的群，那边没人接。
  */
  if (!onDutyIn({
    groupId: chosen.groupId,
    allowedGroupIds: deps.allowedGroupIds,
    deniedGroupIds: deps.deniedGroupIds,
    ...(deps.serveAll === undefined ? {} : { serveAll: deps.serveAll }),
  })) {
    return {
      kind: 'refused',
      reason: `「${chosen.groupName}」不在本实例的允许列表内（试运行期只对测试群开放）`,
      draft: body,
    }
  }
  if (chosen.groupId === route.groupId) {
    return { kind: 'refused', reason: '移交目标就是当前会话', draft: body }
  }

  return {
    kind: 'ready',
    plan: {
      handoffId: handoffIdFor(route.topicKey, chosen.groupId),
      fromRoute: route,
      targetGroupId: chosen.groupId,
      targetGroupName: chosen.groupName,
      note,
      body,
      artifacts,
    },
  }
}

/**
 * Put the handoff on a confirmation card. Reusing the approval object is
 * deliberate: "the confirmation card" is one object type, and a second
 * near-identical family would mean two state machines to keep honest.
 */
export async function openHandoffCard(
  deps: HandoffDeps,
  plan: HandoffPlan,
  decider: string,
): Promise<CardRef> {
  const cardRef: CardRef = { kind: 'approval', id: plan.handoffId }
  if (deps.ctx.yzjGraph.rawObject('approval', plan.handoffId) === undefined) {
    await deps.ctx.yzjGraph.append({
      type: 'approval/opened',
      data: {
        approvalId: plan.handoffId,
        toolName: '/handoff',
        // The resolved NAME AND ID both, so a mis-resolution is visible before
        // it is irreversible.
        reason: `移交到「${plan.targetGroupName}」(${plan.targetGroupId})`,
        level: 'standard',
        args: {
          目标群: `${plan.targetGroupName} (${plan.targetGroupId})`,
          说明: plan.note === '' ? '(无)' : plan.note,
          随包工件: plan.artifacts.map(artifact => artifact.title ?? artifact.uri).join('、') || '(无)',
        },
        argsDigest: plan.handoffId,
        decider,
        deadline: Date.now() + 30 * 60_000,
        topicKey: plan.fromRoute.topicKey,
        placeKey: plan.fromRoute.placeKey,
        audience: [],
      },
      actor: { kind: 'agent' },
    })
  }
  const channel = deps.ctx.get('yzjCardChannel')
  if (channel !== undefined) {
    const existing = deps.ctx.yzjCards.projectionsOf(cardRef)
      .filter(projection => projection.surface === YZJ_TEXT_SURFACE)
    if (existing.length === 0) await channel.deliverToOperator(cardRef)
  }
  return cardRef
}

/**
 * Execute an approved handoff: deliver the package and record the crossing.
 * The crossing edge is written whether or not anybody ever looks at it — it is
 * the audit half of "the only legal way across is a signed package".
 */
export async function executeHandoff(
  deps: HandoffDeps,
  plan: HandoffPlan,
  issuedBy: string,
): Promise<{ delivered: boolean }> {
  const sent = await deps.client.send({ groupId: plan.targetGroupId }, plan.body)
  await deps.ctx.yzjGraph.append({
    type: 'crossing/recorded',
    data: {
      fromPlaceKey: plan.fromRoute.placeKey,
      toPlaceKey: placeKeyFor('group', plan.targetGroupId),
      issuedBy,
      summary: plan.note === '' ? `移交自 ${plan.fromRoute.topicLabel}` : plan.note,
      artifacts: plan.artifacts.map(artifact => ({ ...artifact })),
      topicKey: plan.fromRoute.topicKey,
    },
    actor: { kind: 'operator', openId: issuedBy },
  })
  return { delivered: sent.msgId !== undefined }
}
