/**
 * 选完之后这一句话会**写下什么** —— 传送门与图之间的那道翻译。
 *
 * 这一格决定的不是文案，是图：先验漏了，一次委派退化成一句普通消息（话在群里、板上不长
 * 行）；先验带错，一条活会挂到不相干的人或不相干的父承诺底下。两种错都不报错。
 *
 * 三条先验在这里分岔，而它们要写的图完全不同：
 * - **登记**（选了人）——一条新的活出生；
 * - **移交**（决策 #59）——一条已有的活换边：旧边转吸收态，新边从这句话出生；
 * - **转包**（同上）——一条新的活出生，但挂在我那条底下（责任链加深，不是转移）。
 */

import { describe, expect, it } from 'vitest'
import { errandFor, portalChoice, type Portal } from '../src/client/RoomPicker.tsx'

const BASE: Portal = {
  subject: 'goal',
  goalRef: 'https://yzj.example.com/doc/q3',
  goalName: 'Q3 对账',
  voice: 'place',
  pick: 'executor',
  title: 't',
  note: 'n',
}

const ZHANG = { kind: 'person' as const, person: { openId: 'u-zhang', name: '张锐' } }
const LI = { kind: 'person' as const, person: { openId: 'u-li', name: '李婷' } }

const MOVE: Portal = {
  ...BASE,
  handoff: {
    fromCommitmentId: 'c1',
    what: '统一模板',
    due: '下周三前',
    executor: { openId: 'u-li', name: '李婷' },
    placeKey: 'yzj-group-g1',
  },
}

describe('还没选人', () => {
  it('什么先验都不给 —— 没选之前不该有任何分类', () => {
    expect(portalChoice(BASE, undefined)).toBeUndefined()
  })
})

describe('委派：登记先验', () => {
  it('选了人 = 这句话在登记他的承诺', () => {
    const choice = portalChoice(BASE, ZHANG)
    expect(choice?.register).toEqual({ openId: 'u-zhang', name: '张锐' })
    expect(choice?.handoff).toBeUndefined()
    expect(choice?.call).toBe(true)
  })

  /*
    **agent 那一支不带登记先验**：它不是在登记别人的承诺，是在给 agent 派活。带上的话，
    板上会长出一条挂在「agent」名下的人类承诺。
  */
  it('选了 agent：只有受话，没有登记先验', () => {
    const choice = portalChoice(BASE, { kind: 'agent' })
    expect(choice).toEqual({ call: true })
  })
})

/**
 * **可转包不可脱责**（决策 #59）。血缘是这一格的全部：不带它，转出去的活就成了一条和我
 * 无关的平行承诺——那正是脱责。
 */
describe('转包：血缘', () => {
  it('拆出来的那条挂在我那条底下', () => {
    const choice = portalChoice({ ...BASE, subCommitmentOf: 'c-mine' }, ZHANG)
    expect(choice?.register?.parentCommitmentId).toBe('c-mine')
  })

  it('普通委派不凭空给一条活安一个父亲', () => {
    expect(portalChoice(BASE, ZHANG).register?.parentCommitmentId).toBeUndefined()
  })
})

/**
 * 移交 = 这条边的重新签发（决策 #59）。
 *
 * **移交不发明内容**：事项与期限继承旧边，不靠解析这句话得来——它重新签发的是同一件事。
 */
describe('移交：重新签发的先验', () => {
  it('带的是移交先验，不是登记先验 —— 两者要写的图完全不同', () => {
    const choice = portalChoice(MOVE, ZHANG)
    expect(choice?.handoff).toEqual({
      fromCommitmentId: 'c1', openId: 'u-zhang', name: '张锐',
    })
    expect(choice?.register).toBeUndefined()
  })

  it('拟稿继承旧边的事项与**原话**期限，并说得出原来是谁的', () => {
    const seed = portalChoice(MOVE, ZHANG)?.seed ?? ''
    expect(seed).toContain('统一模板')
    expect(seed).toContain('下周三前')
    expect(seed).toContain('李婷')
    expect(seed).toContain('张锐')
  })

  /*
    **换场所不换人也是移交**（/handoff 本义：听众变更）。但它是另一句话——用「转给你了」
    去说，收到的人会以为自己刚接了一件新活。
  */
  it('不换人时说的是另一句话', () => {
    const seed = portalChoice(MOVE, LI)?.seed ?? ''
    expect(seed).not.toContain('转给你了')
    expect(seed).toContain('在这边跟')
    // 先验照发：换场所不换人仍然是一次重新签发。
    expect(portalChoice(MOVE, LI)?.handoff?.openId).toBe('u-li')
  })

  /*
    旧边是 agent 执行的时候没有可预选的现任。那时拟稿里不该凭空冒出一个「原来是谁的」
    ——宁可少一句，不可编一个。
  */
  it('旧边没有可读的现任：不编一个「原来是谁的」', () => {
    const noCurrent: Portal = {
      ...MOVE,
      handoff: { fromCommitmentId: 'c1', what: '统一模板', placeKey: 'yzj-group-g1' },
    }
    expect(portalChoice(noCurrent, ZHANG)?.seed ?? '').not.toContain('原来是')
  })

  /*
    **移交给 agent 走不到这条先验**：这个动词换的是人。选了 agent 就退回普通的委派骨架
    ——那是重新委派，不是这条边的重新签发。
  */
  it('选了 agent：不构成移交', () => {
    expect(portalChoice(MOVE, { kind: 'agent' })?.handoff).toBeUndefined()
  })
})

/**
 * **最小听众不变量**（v4.24 决策 #58）—— 承诺边的听众 ≥ {owner, executor}。
 *
 * 更大是特性（公开是施压与透明），更小则这条边从出生起就不完整：群里其他人以为这事说
 * 好了，而当事人一个字都没听见。平台不给群成员名单，「他在不在」答不了；答得了的是
 * 「他在这儿有过登记吗」——而这个事实**选场所那一屏刚算过**。算完不带走，它就只是一句
 * 分节标题；设计要的是**代发前警示**，也就是要活到发送键跟前。
 */
describe('最小听众：算过的事实要活到发送键跟前', () => {
  it('他没在这个群里有过登记 —— 警示跟着这一句走', () => {
    const choice = portalChoice(BASE, ZHANG, { known: false, kind: 'group' })
    expect(choice?.audienceRisk).toContain('张锐')
    expect(choice?.audienceRisk).toContain('答不了')
  })

  it('他在这儿有过登记：不无中生有一句警告', () => {
    expect(portalChoice(BASE, ZHANG, { known: true, kind: 'group' })?.audienceRisk)
      .toBeUndefined()
  })

  /*
    **私聊不问这一句**：听众是确定的（就你和他）。在那儿摆一句「他在不在答不了」，是把
    一个不存在的疑问塞给人。
  */
  it('私聊不问「他在不在」 —— 那间屋子的听众是确定的', () => {
    expect(portalChoice(BASE, ZHANG, { known: false, kind: 'direct' })?.audienceRisk)
      .toBeUndefined()
  })

  /*
    **agent 不问这一句**：它的在与不在是「接单」，另有说法（不接单的群里 @ 不会被应答，
    那句话在选场所那一屏就说过了）。
  */
  it('派给 agent 时不问 —— 它的在不在叫接单', () => {
    expect(portalChoice(BASE, { kind: 'agent' }, { known: false, kind: 'group' })?.audienceRisk)
      .toBeUndefined()
  })

  it('移交也带这句 —— 新执行者同样可能不在那间屋子里', () => {
    expect(portalChoice(MOVE, ZHANG, { known: false, kind: 'group' })?.audienceRisk)
      .toContain('张锐')
  })
})

describe('先验要真的跟着差事走完全程', () => {
  /*
    翻译对了、差事没带上，等于没翻译。这一跳此前只带 `register`——移交先验加进来的那一刻，
    它就是最容易被漏掉的那一格（漏了不报错：话照发，图上什么都没转手）。
  */
  it('移交先验进 errand', () => {
    const errand = errandFor(MOVE, portalChoice(MOVE, ZHANG))
    expect(errand.handoff).toEqual({ fromCommitmentId: 'c1', openId: 'u-zhang', name: '张锐' })
    expect(errand.seed).toContain('统一模板')
  })

  it('最小听众的警示进 errand —— 算完不带走等于没算', () => {
    const errand = errandFor(BASE, portalChoice(BASE, ZHANG, { known: false, kind: 'group' }))
    expect(errand.audienceRisk).toContain('张锐')
  })

  it('转包的血缘进 errand', () => {
    const portal = { ...BASE, subCommitmentOf: 'c-mine' }
    expect(errandFor(portal, portalChoice(portal, ZHANG)).register?.parentCommitmentId)
      .toBe('c-mine')
  })
})
