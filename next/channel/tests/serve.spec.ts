/**
 * 接单留图史 (v3.15 裁决⑤)。
 *
 * 这里钉的是**顺序**，不是数据形状：一次改变触达面的动作，记不下就不发生。
 */

import { describe, expect, it } from 'vitest'
import { applyServe, serveRecordFor } from '../src/serve.ts'
import { onDutyIn } from '../src/poller.ts'

describe('接单/摘单', () => {
  it('记下的是动作本身：地点、方向，以及人认得出的名字', () => {
    expect(serveRecordFor('g1', true, '830 项目')).toEqual({
      placeKey: 'yzj-group-g1', served: true, groupName: '830 项目',
    })
    // 名录里没有就不写——**不猜**。带一个编造的名字进审计，比没有名字更坏。
    expect(serveRecordFor('g1', false)).toEqual({ placeKey: 'yzj-group-g1', served: false })
  })

  it('两个方向都留痕，且两个集合同时更新', async () => {
    const seen: unknown[] = []
    const saved: unknown[] = []
    const allowedGroupIds = new Set<string>()
    const deniedGroupIds = new Set<string>(['g1'])
    const call = async (on: boolean): Promise<void> => {
      await applyServe({
        groupId: 'g1',
        on,
        allowedGroupIds,
        deniedGroupIds,
        nameOf: () => '830 项目',
        record: async (record) => { seen.push(record) },
        persist: async (id, served) => { saved.push([id, served]) },
      })
    }

    await call(true)
    // 接单要撤掉那个明确的「不」——否则它仍在，而 `onDutyIn` 把「不」排在最前面。
    expect(deniedGroupIds.has('g1')).toBe(false)
    expect(onDutyIn({ groupId: 'g1', allowedGroupIds, deniedGroupIds })).toBe(true)

    await call(false)
    // 摘单落进 denied，而不是只从 allowed 里删掉：「明确说了不」不能退化成「从没提过」，
    // 后者会被部署默认接管。
    expect(deniedGroupIds.has('g1')).toBe(true)
    expect(onDutyIn({ groupId: 'g1', allowedGroupIds, deniedGroupIds, serveAll: true })).toBe(false)

    expect(seen).toEqual([
      { placeKey: 'yzj-group-g1', served: true, groupName: '830 项目' },
      { placeKey: 'yzj-group-g1', served: false, groupName: '830 项目' },
    ])
    expect(saved).toEqual([['g1', true], ['g1', false]])
  })

  it('记不下就不改触达', async () => {
    const allowedGroupIds = new Set<string>()
    const deniedGroupIds = new Set<string>()
    let persisted = false
    await expect(applyServe({
      groupId: 'g1',
      on: true,
      allowedGroupIds,
      deniedGroupIds,
      record: async () => { throw new Error('图写不进去') },
      persist: async () => { persisted = true },
    })).rejects.toThrow('图写不进去')

    // 触达面一动不动：没有出处的接单，比一次失败的接单更贵。
    expect(allowedGroupIds.size).toBe(0)
    expect(deniedGroupIds.size).toBe(0)
    expect(persisted).toBe(false)
    expect(onDutyIn({ groupId: 'g1', allowedGroupIds, deniedGroupIds })).toBe(false)
  })
})
