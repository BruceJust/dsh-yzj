/**
 * 署名协议 (决策 #63 §8 B5②)：对人 = 归因，对同侪实例 = 互认凭据。
 *
 * 这里锁的是**认与不认**的边界：认自己写出去的形状，不认人引用后的、不认别的公名的。
 * 失效方向要安全——认错了最坏是错误让位（无人接单），永不是双写。
 */

import { describe, expect, it } from 'vitest'
import { readSignature, SIGNATURE_AGENT, signOutbound, signatureLine, stripSignature } from '../src/signature.ts'

describe('署名', () => {
  it('落款在最后一行，空一行隔开正文', () => {
    const signed = signOutbound('已登记承诺。\n[card#commitment:cmt-1]', 'Bruce')
    expect(signed).toBe('已登记承诺。\n[card#commitment:cmt-1]\n\n—— 云小助（Bruce）')
    expect(readSignature(signed)).toEqual({ agent: SIGNATURE_AGENT, operator: 'Bruce' })
    expect(stripSignature(signed)).toBe('已登记承诺。\n[card#commitment:cmt-1]')
  })

  it('签过的不再签；没签的 strip 原样返回', () => {
    const once = signOutbound('x', 'Bruce')
    expect(signOutbound(once, 'Bruce')).toBe(once)
    expect(stripSignature('没有落款')).toBe('没有落款')
  })

  it('人引用一条署名消息之后再说自己的话，落款不在末尾——那是人的话', () => {
    const quoted = `他刚才说：\n${signatureLine('张三')}\n我觉得不对`
    expect(readSignature(quoted)).toBeUndefined()
  })

  it('别的公名不算本协议的落款', () => {
    expect(readSignature('好的\n\n—— 小助手（张三）')).toBeUndefined()
  })

  it('名字空着也要签——不签是唯一不允许的', () => {
    expect(readSignature(signOutbound('x', ''))).toEqual({ agent: SIGNATURE_AGENT, operator: '未署名' })
  })
})
