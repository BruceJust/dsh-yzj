/**
 * 移交话语在**两个包里各有一份**，这一组盯着它们一字不差。
 *
 * 为什么不合并：客户端包不 import 任何宿主包（那会把 node 的东西拖进浏览器），宿主也不
 * 该反过来依赖一个视图目录。所以这不是「忘了合并」，是一条被承认的边界。
 *
 * 而承认一条边界的代价是**必须有人守着**。一份靠人记得去同步的复制品，就是下一个「两处
 * 各说各话」——那时候的症状会是：从板上移交，对方收到的话里带着期限；agent 代发的那句
 * 不带，而谁都不会发现，因为两处各自都「工作正常」。
 *
 * 这里能同时 import 两边，因为用例跑在 node 里。这是这条边界唯一一处可以被检验的地方。
 */

import { describe, expect, it } from 'vitest'
import { handoffDraft as hostDraft, releaseNotice } from '@yzj-next/objects'
import { handoffDraft as clientDraft } from '../src/client/handoff.ts'

const CASES = [
  { what: '核对一版竞品定价', due: '下周三前', toName: '张锐', fromName: '李婷' },
  { what: '对账差异逐条列出', toName: '王五' },
  { what: '把三家定价页整理成对比表', due: '周三前', toName: '张锐', samePerson: true },
  { what: '只有事项', due: '明天' },
  { what: '换场所不换人', toName: '张锐', samePerson: true, fromName: '张锐' },
]

describe('两份拟稿必须一字不差', () => {
  for (const input of CASES) {
    it(`「${input.what}」${input.samePerson === true ? '（不换人）' : ''}`, () => {
      expect(clientDraft(input)).toBe(hostDraft(input))
    })
  }

  /*
    空输入也要一致：宿主那一份如果哪天给「没有名字」加了个默认称呼，而客户端没加，
    差异恰恰出现在最不容易被人工核对的那一格上。
  */
  it('什么都不给的时候也一样', () => {
    expect(clientDraft({ what: 'x' })).toBe(hostDraft({ what: 'x' }))
  })
})

/**
 * 解除告知 —— 旧场所那一帖。它是**旧边的终态回帖**，不是一条新机制：旧执行者本来就在
 * 那批听众里，所以这一帖就是告诉他。
 */
describe('解除告知', () => {
  it('说清是哪一条、转给了谁，以及历史留在原处', () => {
    const notice = releaseNotice({ what: '核对一版竞品定价', toName: '王五' })
    expect(notice).toContain('核对一版竞品定价')
    expect(notice).toContain('王五')
    // 「回执和轨迹留在原处」是这条吸收态的另一半：留档，不是删除。
    expect(notice).toContain('留在原处')
  })

  it('不知道转给谁时不编一个名字', () => {
    expect(releaseNotice({ what: '对账' })).toContain('别人')
  })
})
