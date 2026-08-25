/**
 * Handoff specs — the authorization chain, not the happy path.
 *
 * Sending to the wrong group is a disclosure incident, so every refusal here
 * has to degrade to "the agent drafts, the operator sends" rather than to a
 * best guess.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { approvalCard, approvalFamily } from '@yzj-next/objects'
import type { YzjRunResult } from '@yzj-next/bridge'
import { executeHandoff, openHandoffCard, prepareHandoff, type HandoffDeps } from '../src/handoff.ts'
import { YzjChannelClient } from '../src/client.ts'
import { ChannelState } from '../src/state.ts'
import { topicRouteFor, type YzjGroup, type YzjMessage } from '../src/protocol.ts'

const IDENTITY = { orgId: 'org-1', openId: 'op-1', name: '操作者' }
const SOURCE: YzjGroup = {
  groupId: 'g-1', groupName: 'dsh-2', groupType: 2,
  lastMsgId: 'm-1', lastMsgSendTime: '2026-08-18 10:00:00',
}

const GROUPS: YzjGroup[] = [
  SOURCE,
  { ...SOURCE, groupId: 'g-2', groupName: '研发群' },
  { ...SOURCE, groupId: 'g-3', groupName: '研发群备份' },
  { ...SOURCE, groupId: 'g-9', groupName: '不在白名单的群' },
]

function message(): YzjMessage {
  return {
    msgId: 'm-1', content: '@next 移交', fromOpenId: 'op-1',
    msgType: 'text', sendTime: '2026-08-18 10:00:00', param: {},
  }
}

const ROUTE = topicRouteFor(IDENTITY, SOURCE, message(), [], 'root-1')

let ctx: Context
let graph: YzjGraph
let sent: { command: readonly string[] }[]

function depsWith(allowed: string[]): HandoffDeps {
  sent = []
  const bridgeCtx = {
    yzjBridge: {
      run: async (command: readonly string[]): Promise<YzjRunResult> => {
        sent.push({ command })
        const json = command[1] === 'group'
          ? { list: GROUPS, more: false }
          : { msgId: 'sent-1', groupId: command[command.indexOf('--group-id') + 1] }
        return Promise.resolve({
          ok: true, exitCode: 0, stdout: JSON.stringify(json), stderr: '',
          json, truncated: false, timedOut: false, durationMs: 1,
        })
      },
    },
  } as unknown as Context
  const state = new ChannelState(join(tmpdir(), 'unused-handoff.json'))
  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- sync in tests
  void state.load()
  state.selectAccount('acct-1')
  return {
    ctx,
    client: new YzjChannelClient(bridgeCtx, state, 5_000),
    allowedGroupIds: new Set(allowed),
    // 「明确关掉」和「名单里没有」是两回事——夹具也得把两个集合摆开，
    // 合成一个的话，这个文件永远测不出被明确移出服务的那一格。
    deniedGroupIds: new Set<string>(),
    groupPages: 1,
  }
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-handoff-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(approvalFamily)
  await graph.selectAccount('acct-1')
  const cards = new YzjCards(ctx)
  cards.register(approvalCard)
})

describe('target resolution', () => {
  it('lists candidates instead of guessing when a name matches several groups', async () => {
    const prepared = await prepareHandoff(depsWith([]), ROUTE, '研发群', '接着做')
    expect(prepared.kind).toBe('ambiguous')
    if (prepared.kind !== 'ambiguous') return
    expect(prepared.candidates.map(group => group.groupId)).toEqual(['g-2', 'g-3'])
  })

  it('accepts an exact group id even when the name is ambiguous', async () => {
    /*
      名单里要有它 —— **空集 = 全关**（v3.15 裁决①）。

      这一条此前给的是空名单，靠的是「空集 = 到处都在岗」那条旧语义；它要锁的其实是
      「精确 group id 压过歧义名字」，和在不在岗无关。收窄之后夹具得把话说全，否则
      它测的会变成另一件事（而且会以「通过」的样子测错）。
    */
    const prepared = await prepareHandoff(depsWith(['g-2']), ROUTE, 'g-2', '')
    expect(prepared.kind).toBe('ready')
  })

  it('refuses an unknown conversation and hands back a draft to send by hand', async () => {
    const prepared = await prepareHandoff(depsWith([]), ROUTE, '不存在的群', '说明')
    expect(prepared.kind).toBe('refused')
    if (prepared.kind !== 'refused') return
    expect(prepared.draft).toContain('【移交】')
    expect(prepared.draft).toContain('私语未随包迁移')
  })

  it('refuses a target outside this instance allow-list', async () => {
    const prepared = await prepareHandoff(depsWith(['g-2']), ROUTE, 'g-9', '')
    expect(prepared.kind).toBe('refused')
    if (prepared.kind !== 'refused') return
    expect(prepared.reason).toContain('允许列表')
  })

  it('refuses to hand a topic off to the conversation it is already in', async () => {
    const prepared = await prepareHandoff(depsWith([]), ROUTE, 'g-1', '')
    expect(prepared.kind).toBe('refused')
  })
})

describe('the package', () => {
  it('carries the topic artifacts and never the private asides', async () => {
    await graph.append({
      type: 'lineage/produced',
      data: {
        topicKey: ROUTE.topicKey,
        artifact: { uri: 'yzj://doc/d1', placeKey: 'yzj-kb-1', title: '需求稿' },
        action: '新建文档',
      },
      actor: { kind: 'agent' },
    })
    const prepared = await prepareHandoff(depsWith(['g-2']), ROUTE, 'g-2', '接着做验收')
    expect(prepared.kind).toBe('ready')
    if (prepared.kind !== 'ready') return
    expect(prepared.plan.body).toContain('需求稿')
    expect(prepared.plan.body).toContain('接着做验收')
    expect(prepared.plan.body).toContain('私语未随包迁移')
    expect(prepared.plan.artifacts).toHaveLength(1)
  })
})

describe('confirmation and execution', () => {
  it('shows the resolved name AND id on the card before anything moves', async () => {
    const deps = depsWith(['g-2'])
    const prepared = await prepareHandoff(deps, ROUTE, 'g-2', '')
    if (prepared.kind !== 'ready') throw new Error('expected a ready plan')
    await openHandoffCard(deps, prepared.plan, 'op-1')

    const approval = asRecord(graph.rawObject('approval', prepared.plan.handoffId)?.state)
    expect(asString(approval?.reason)).toContain('研发群')
    expect(asString(approval?.reason)).toContain('g-2')
    // Nothing has been delivered — only the group listing was fetched.
    expect(sent.every(entry => entry.command[1] === 'group')).toBe(true)
  })

  it('delivers and records the crossing only once approved', async () => {
    const deps = depsWith(['g-2'])
    const prepared = await prepareHandoff(deps, ROUTE, 'g-2', '接着做')
    if (prepared.kind !== 'ready') throw new Error('expected a ready plan')
    await executeHandoff(deps, prepared.plan, 'op-1')

    expect(sent.some(entry => entry.command.includes('--group-id') && entry.command.includes('g-2')))
      .toBe(true)
    const crossings = graph.rawEvents(['crossing/recorded'])
    expect(crossings).toHaveLength(1)
    expect(asRecord(crossings[0]?.data)).toMatchObject({
      fromPlaceKey: ROUTE.placeKey,
      toPlaceKey: 'yzj-group-g-2',
      issuedBy: 'op-1',
    })
  })
})
