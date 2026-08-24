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
  assessAsk, breakdownAsk, goalQuestionSeed, rebaseAsk,
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

describe('问这个目标只起个头', () => {
  /*
    和上面三句正相反。问题是提问的人自己的，按钮只把主语摆好——所以这一句**不完整
    也不该完整**：它以冒号收尾，等人接着写。
  */
  it('是一句没说完的话，不是一条指令', () => {
    const seed = goalQuestionSeed(NAME)
    expect(seed).toContain(NAME)
    expect(seed.endsWith('：')).toBe(true)
  })
})
