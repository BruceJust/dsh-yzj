/**
 * 立目标：owner 是**一个可核对的人**，不是一串字。
 *
 * 这一组存在的理由是一条实测里抓到的谎：「欠我的」透镜第一屏九行全是**我自己立的
 * 目标**，而真正的应收（李婷、张锐那几条）一条都不在。病根不在透镜——透镜读的是
 * `direction`，`direction` 读的是执行者的 openId，而立目标那一步把执行者写成了一个
 * 凭空的 `'op-1'`：界面上写着「留空 = 我」，账上记的是一个陌生人。
 *
 * 所以这里钉的不是字段形状，是**方向轴的结论**：我留空立的目标，必须落在「我欠的」。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, type GraphActor } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import { createCommitmentCard, commitmentFamily, goalCommitmentIdFor } from '@yzj-next/objects'
import { applySurfaceRpc, boardFrame } from '../src/rpc.ts'

const ME: GraphActor = { kind: 'operator', openId: 'op-me' }
const GOAL = 'https://yzj.example.com/doc/q3'

type Handler = (endpoint: string, payload: unknown) => Promise<
  { ok: true; value: unknown } | { ok: false; error: { message: string } }
>

let ctx: Context
let graph: YzjGraph
let cards: YzjCards
let call: Handler

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-declare-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  graph.defineFamily(commitmentFamily)
  await graph.selectAccount('acct-1')
  ctx.provide('yzjTopics', {
    tree: () => [],
    topicOf: () => undefined,
    aliases: () => ['@next'],
    conversations: () => [],
  })
  cards = new YzjCards(ctx)
  cards.register(createCommitmentCard(ctx))
  // 通道拿到身份时给的两样东西：我是谁，以及我叫什么。
  cards.setDesktopActor(ME, '代少兵')
  let captured: Handler | undefined
  ctx.provide('connection', {
    rpc: { handle: (_path: string, fn: Handler) => { captured = fn } },
  })
  applySurfaceRpc(ctx, 40)
  await new Promise(resolve => { setTimeout(resolve, 1) })
  if (captured === undefined) throw new Error('RPC handler 没有被注册')
  call = captured
})

const declare = async (extra: Record<string, unknown> = {}): Promise<
  { ok: true; value: unknown } | { ok: false; error: { message: string } }
> => call('declare-goal', { what: 'Q3 对账', goalRef: GOAL, ...extra })

const goalRow = (): { who: string; direction: string } | undefined => {
  const row = boardFrame(ctx).rows.find(one => one.isGoal === GOAL)
  return row === undefined ? undefined : { who: row.who, direction: row.direction }
}

describe('立目标的 owner', () => {
  /*
    **这一条就是那次实测的复现。**

    留空 = 我。此前记下的执行者是 `'op-1'`，于是方向轴判成「别人欠我的」——我自己
    立的目标，出现在应收账簿里。
  */
  it('留空 = 我：执行者是我本人，落在「我欠的」', async () => {
    expect(await declare()).toMatchObject({ ok: true })
    const object = graph.rawObject('commitment', goalCommitmentIdFor(GOAL))
    expect((object?.state as { executor?: { openId?: string; name?: string } })?.executor)
      .toEqual({ kind: 'human', openId: 'op-me', name: '代少兵' })
    expect(goalRow()).toEqual({ who: '代少兵', direction: 'mine' })
  })

  it('选中的人才算指定：openId 是通讯录里那个人的', async () => {
    expect(await declare({ ownerOpenId: 'u-li', ownerName: '李婷' })).toMatchObject({ ok: true })
    // 交出去的目标确实是「别人欠我的」——这一格现在名副其实。
    expect(goalRow()).toEqual({ who: '李婷', direction: 'owed-to-me' })
  })

  /*
    **名字不能当 id。** 通讯录里有五位李婷，在「名字即 openId」的记法里她们是同一个人，
    而这条承诺日后归谁、谁看得见、谁能修，全靠这个 id。
  */
  it('只给名字、没有选中的人：拒绝，且什么都没写', async () => {
    const result = await declare({ ownerName: '李婷' })
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: { message: string } }).error.message).toContain('李婷')
    expect(graph.rawObject('commitment', goalCommitmentIdFor(GOAL))).toBeUndefined()
  })

  /*
    身份未知时「留空 = 我」这句话没有指称：我是谁还没有答案。宁可这一刻立不了，也不
    往账本里写一个占位符——上一版就是这么写下 `'op-1'` 的。
  */
  it('还不知道我是谁：拒绝，而不是编一个 id', async () => {
    cards.setDesktopActor({ kind: 'operator' })
    const result = await declare()
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: { message: string } }).error.message).toContain('身份')
    expect(graph.rawObject('commitment', goalCommitmentIdFor(GOAL))).toBeUndefined()
  })
})
