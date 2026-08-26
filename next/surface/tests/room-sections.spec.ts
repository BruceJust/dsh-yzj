/**
 * 委派第②维的分节 —— **三段各自正确的过滤，合起来最会撒谎**。
 *
 * 这一组是被自己写出来的一个组合缺陷逼出来的：「按这个人分节」与「只留群」两段过滤
 * 叠在一起，把**所有私聊一个不剩地筛没了**——而催一条承诺最常见的落点恰恰是私聊。
 * 它不报错，只是那一类屋子从此选不着；而这种缺陷只有把逻辑摊成纯函数才钉得住。
 *
 * 分节本身承载三条设计法则，所以它们各有一条用例：
 * - **事实可以缩小选项集，装作知道不行**：「他在这个群里有过登记」是图上的事实，
 *   「他在不在这个群」平台答不了（群成员列表无 API），所以其余的群照摆，只是说清
 *   我们答不了；
 * - **不接单的群不藏起来，明标**：那儿仍然可以说话，只是这句话在那儿不会有回音；
 * - **读不到 ≠ 没有**：接单与否缺席时算在岗那一档，否则「没查到」会显示成「没接单」。
 */

import { describe, expect, it } from 'vitest'
import { roomSections } from '../src/client/RoomPicker.tsx'
import type { DelegateRoomWire } from '../src/client/rpc.ts'

const room = (over: Partial<DelegateRoomWire> & { name: string }): DelegateRoomWire => ({
  placeKey: `pk-${over.name}`,
  kind: 'group',
  known: false,
  theirDm: false,
  topics: [],
  ...over,
})

const ROOMS: DelegateRoomWire[] = [
  room({ name: '财务群', known: true, onDuty: true }),
  room({ name: '产品讨论群', onDuty: false }),
  room({ name: '去年的项目群' }), // onDuty 读不到
  room({ name: '张锐', kind: 'direct', theirDm: true, onDuty: true }),
  room({ name: '李婷', kind: 'direct', onDuty: true }),
]

const ZHANG = { kind: 'person' as const, person: { openId: 'u-zhang', name: '张锐' } }

describe('派给一个人', () => {
  it('三节：他的私聊 / 他有过登记的群 / 其余的群', () => {
    const cut = roomSections(ROOMS, '', ZHANG)
    expect(cut.theirDm.map(one => one.name)).toEqual(['张锐'])
    expect(cut.withHim.map(one => one.name)).toEqual(['财务群'])
    expect(cut.others.map(one => one.name)).toEqual(['产品讨论群', '去年的项目群'])
    expect(cut.places.map(one => one.name))
      .toEqual(['张锐', '财务群', '产品讨论群', '去年的项目群'])
  })

  /*
    **不藏其余的群。** 他很可能就在一个还没登记过任何东西的群里；藏起来就是拿「我们
    不知道」冒充「他不在」。
  */
  it('没有任何登记事实时，群一个都不少 —— 只是一节都进不去 withHim', () => {
    // `known`/`theirDm` 是端点针对**被问到的那个人**算出来的，所以「没有事实」的样子
    // 就是这两格全是 false —— 不是换一个人去问同一份数据。
    const blank = ROOMS.map(one => ({ ...one, known: false, theirDm: false }))
    const cut = roomSections(blank, '', { kind: 'person', person: { openId: 'u-x', name: '谁' } })
    expect(cut.withHim).toEqual([])
    expect(cut.others).toHaveLength(3)
    // 私聊那一节也空了，于是「开一个新私聊」那一格就是这时候该出现的东西。
    expect(cut.theirDm).toEqual([])
  })

  /*
    **别人的私聊不该出现。** 在我和李婷的私聊里说「张锐负责 X」，听众里没有张锐——
    最小听众不变量（听众 ⊇ {owner, executor}）当场就破了。
  */
  it('别人的私聊不在选项集里', () => {
    expect(roomSections(ROOMS, '', ZHANG).places.some(one => one.name === '李婷')).toBe(false)
  })
})

describe('派给 agent', () => {
  it('只有群，接单的在前、没接单的在后且成节', () => {
    const cut = roomSections(ROOMS, '', { kind: 'agent' })
    expect(cut.places.map(one => one.name)).toEqual(['财务群', '去年的项目群', '产品讨论群'])
    expect(cut.offDuty.map(one => one.name)).toEqual(['产品讨论群'])
    // 私聊里没有它——那间屋子里一句话发过去谁都不会应。
    expect(cut.places.some(one => one.kind === 'direct')).toBe(false)
  })

  /*
    **读不到 ≠ 没接单。** 只从图上话题拼出来的那一行没有接单与否可读；把它算成没接单，
    界面上就会长出一句「这个群 agent 没接单」的断言，而那是一次「查不到」被渲染成了
    「查到了没有」。
  */
  it('接单与否读不到的，算在岗那一档，不进「没接单」节', () => {
    const cut = roomSections(ROOMS, '', { kind: 'agent' })
    expect(cut.onDuty.map(one => one.name)).toContain('去年的项目群')
    expect(cut.offDuty.map(one => one.name)).not.toContain('去年的项目群')
  })
})

/**
 * **这一条就是那个组合缺陷的复现。**
 *
 * 催、移交这些传送门不问「谁来做」（那一格早就定了），此前它们照搬按人分节的切法，
 * 于是剩下的只有群——所有私聊消失。而催一条承诺最常见的落点恰恰是私聊。
 */
describe('没问「谁来做」的传送门（催、移交）', () => {
  it('屋子全摆出来，私聊一个不少', () => {
    const cut = roomSections(ROOMS, '', undefined)
    expect(cut.places.map(one => one.name)).toEqual(ROOMS.map(one => one.name))
    expect(cut.places.filter(one => one.kind === 'direct')).toHaveLength(2)
  })

  it('不知道要说给谁听时，没有任何事实可以拿来分节', () => {
    const cut = roomSections(ROOMS, '', undefined)
    expect([cut.theirDm, cut.withHim, cut.others, cut.onDuty, cut.offDuty]).toEqual([[], [], [], [], []])
  })
})

describe('过滤', () => {
  it('按场所名字过滤', () => {
    expect(roomSections(ROOMS, '群', undefined).places.map(one => one.name))
      .toEqual(['财务群', '产品讨论群', '去年的项目群'])
  })

  /*
    话题名也算数：人记得住的常常是「那个统一模板的话题」，而不是它在哪个群。
  */
  it('按底下的话题名字也过滤得到', () => {
    const rooms = [room({ name: '财务群', topics: [{ sessionId: 's1', label: '统一模板' }] })]
    expect(roomSections(rooms, '统一', undefined).places).toHaveLength(1)
    expect(roomSections(rooms, '走访', undefined).places).toHaveLength(0)
  })
})
