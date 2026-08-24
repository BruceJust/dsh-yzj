/**
 * CTA 说出去的那句话 (§5.3 A6.1 ①).
 *
 * 这几条不是在测字符串长什么样——它们锁的是**这句话到了 agent 那头还能不能干活**。
 * 按钮提交等价于人在私语里打出这一句，所以这句话里缺什么，agent 那头就缺什么：
 * 少了目标引用，备料第一步「读真身正文与成功标准」就只能靠名字碰运气；少了「逐条」，
 * 换回来的是一段没法一条条裁决的散文。
 *
 * 都能红：把 `goalRef` 从任何一句里拿掉，对应那条立刻失败。
 */

import { describe, expect, it } from 'vitest'
import {
  assessAsk, breakdownAsk, delegateSeed, eventPrepSeed, gapSeed,
  goalCraftSeed, goalQuestionSeed, rebaseAsk,
} from '../src/client/commission.ts'

const NAME = 'Q3 把对账周期压到 3 天内'
const REF = 'https://yzj.example.com/doc/q3'

describe('三句委托都带得上目标引用', () => {
  /*
    **哪一份文档**是 agent 唯一推导不出来的东西 (4h②)。

    成功标准住在云之家那份正文里，而图上只记一个引用。名字不够：两个目标重名时，
    靠名字找到的那一份是碰运气找到的——而评估恰恰是最不该对着错的那份正文下判断的
    时刻。
  */
  it.each([
    ['拆解', breakdownAsk(NAME, REF)],
    ['评估', assessAsk(NAME, REF)],
    ['重估', rebaseAsk(NAME, REF)],
  ])('%s 这一句里有目标名，也有目标引用', (_label, said) => {
    expect(said).toContain(NAME)
    expect(said).toContain(REF)
  })
})

describe('每一句问的都是它那颗按钮的事', () => {
  it('拆解要的是逐条可裁决的清单，不是一段散文', () => {
    const said = breakdownAsk(NAME, REF)
    // 提案卡是**逐条**定生死的；一句笼统的「帮我拆一下」换回来的东西对不上这张卡。
    expect(said).toContain('逐条')
    expect(said).toContain('谁做')
    expect(said).toContain('什么时候前')
  })

  it('评估要的是逐条对着成功标准的证据（真身证据，不是自报数）', () => {
    const said = assessAsk(NAME, REF)
    expect(said).toContain('成功标准')
    expect(said).toContain('证据')
  })

  /*
    重估只在真身改过之后才出现，它存在的全部理由就是**换基准**。

    不明说「现在这版」，agent 完全可能照着手上那份副本再算一遍——那正是这颗按钮
    要修的毛病（过期的结论比没有结论更危险，它看起来仍然成立）。
  */
  it('重估必须明说以现在这版标准为准', () => {
    const said = rebaseAsk(NAME, REF)
    expect(said).toContain('现在这版')
    expect(said).toContain('重新评估')
  })
})

describe('起头那一类，故意不说完', () => {
  /*
    和上面三句正相反。这几句里都有一块是**人的**——他要问什么、派什么活、会前补
    哪一刀——所以按钮只摆主语，以冒号收尾等人接着写。

    把起头做成完整句，就是替人把话说了；那正是「场所人选不推导」这条纪律在句子
    层面的同一件事。
  */
  it.each([
    ['问这个目标', goalQuestionSeed(NAME)],
    ['委派', delegateSeed(NAME)],
    ['为此会准备', eventPrepSeed('周四产品评审')],
    ['磨目标（还没起名字）', goalCraftSeed('  ')],
  ])('%s 以冒号收尾——话没说完', (_label, seed) => {
    expect(seed.endsWith('：')).toBe(true)
  })

  /*
    **不替人把触发词塞进句子里**。

    登记是 agent 在那个场所观察到的，而改写别人要发出去的话是越权——composer 上
    另有一颗「叫上」的键，goal chip 也会提醒。拟稿里预埋一个 @，等于替他决定了这
    句话是说给谁听的。
  */
  it.each([
    ['委派', delegateSeed(NAME)],
    ['为此会准备', eventPrepSeed('周四产品评审')],
    ['差距变委派', gapSeed(NAME, 'T+3 出报表')],
  ])('%s 不预埋 @ 触发词', (_label, seed) => {
    expect(seed).not.toContain('@')
  })
})

describe('磨目标：磨点在可验收，签发权在人', () => {
  it('把方向摆好——追问怎么算完成，磨完递提案', () => {
    const seed = goalCraftSeed('把对账周期压到 3 天')
    expect(seed).toContain('把对账周期压到 3 天')
    expect(seed).toContain('怎么算完成')
    // 「递提案给我签发」这半句不能省：agent 只有提议权，含糊的说法是在请它越权。
    expect(seed).toContain('提案')
    expect(seed).toContain('签发')
  })
})

describe('两级缩放说同一句话', () => {
  /*
    板和目标页是同一份查询的两级缩放。差距→委派曾经各写各的——一边带着目标名与
    「还缺的这块」，另一边只丢出一条光秃秃的标准原文——而两级各说各话，正是目标页
    存在时最先长出来的那种裂缝。一份实现是这条纪律的物理形态。
  */
  it('差距变委派带得上目标与那一条标准', () => {
    const seed = gapSeed(NAME, 'T+3 出报表')
    expect(seed).toContain(NAME)
    expect(seed).toContain('T+3 出报表')
  })
})
