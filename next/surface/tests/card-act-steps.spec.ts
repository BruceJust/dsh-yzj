/**
 * 一窗多笔，一次请求 (律七 · 撤回窗)。
 *
 * 页面在撤回窗里关掉时，`pagehide` 只来得及发出一个请求。此前一窗多笔是一笔一请求、
 * 等上一笔回来再发下一笔——关页面那一下，只有第一笔走得出去，人按下去的「定下这 3 处」
 * 只落了 1 处。现在几笔一次请求，服务端按顺序落，遇到第一笔没生效就停。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { approvalCard, approvalFamily } from '@yzj-next/objects'
import { applySurfaceRpc } from '../src/rpc.ts'

type Handler = (endpoint: string, payload: unknown) => Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }>

let graph: YzjGraph
let call: Handler

beforeEach(async () => {
  const ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-steps-')) })
  graph.defineFamily(approvalFamily)
  await graph.selectAccount('acct-1')
  const cards = new YzjCards(ctx)
  cards.register(approvalCard)
  cards.setDesktopActor({ kind: 'operator', openId: 'op-1' })
  let captured: Handler | undefined
  ctx.provide('connection', { rpc: { handle: (_path: string, fn: Handler) => { captured = fn } } })
  applySurfaceRpc(ctx, 40)
  await new Promise(resolve => { setTimeout(resolve, 1) })
  if (captured === undefined) throw new Error('RPC handler 没有被注册')
  call = captured
  await graph.append({
    type: 'approval/opened',
    data: {
      approvalId: 'ap-1', toolName: 'yzj_sheet_record_create', reason: '写入', level: 'standard',
      args: {}, argsDigest: 'd', decider: 'op-1', deadline: Date.now() + 600_000,
      sessionAnchor: 'session-local',
    },
    actor: { kind: 'agent' },
  })
})

describe('card-act-steps', () => {
  it('落下每一笔，遇到第一笔没生效就停', async () => {
    const result = await call('card-act-steps', {
      kind: 'approval', id: 'ap-1',
      steps: [{ actionId: 'approve' }, { actionId: 'reject' }, { actionId: 'approve' }],
    })
    expect(result.ok).toBe(true)
    const outcomes = (result as { value: { outcome: string }[] }).value.map(one => one.outcome)
    // 第一笔放行；第二笔对一张已经答过的卡不生效，于是停在那里，第三笔不发。
    expect(outcomes[0]).toBe('applied')
    expect(outcomes).toHaveLength(2)
    expect(outcomes[1]).not.toBe('applied')
  })

  it('没有 steps 就拒绝，不猜', async () => {
    expect((await call('card-act-steps', { kind: 'approval', id: 'ap-1', steps: [] })).ok).toBe(false)
  })
})
