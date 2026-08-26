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
  goalCraftSeed, goalQuestionSeed, rebaseAsk, registerSeed,
} from '../src/client/commission.ts'
import { handoffDraft } from '../src/client/RepairVerbs.tsx'

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

describe('登记句式是骨架，不是稿子', () => {
  /*
    规格把这条单独钉出来过：「预填**话语骨架**（受话人 + 登记句式模板——**任务内容
    由人说，agent 不发明委派内容**；demo 为演示流畅预填了示例内容，**实现勿照抄**）」。

    所以这里只锁两件事：那个人的名字在，而要做什么和什么时候前**是两个空**。一句
    像样的示例会被原样发出去，而那句话是我们编的，落库之后却挂在他名下。
  */
  it('带上那个人的名字，把「做什么」和「什么时候」留成空', () => {
    const seed = registerSeed('张三')
    expect(seed).toContain('张三负责')
    expect(seed).toContain('〔要做什么〕')
    expect(seed).toContain('〔什么时候前〕')
  })

  it('骨架里不预埋触发词——受话由 composer 那一头补，因为只有它知道 agent 叫什么', () => {
    expect(registerSeed('张三')).not.toContain('@')
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

/**
 * **预填出处律**（v4.24 决策 #58）：预填的每个字都要有出生故事。
 *
 * 有语境出处就预填（差距变委派 = 差距项原文；为此会准备 = 这场会的标题），**空白委派
 * 无出处即无内容**——系统不知道你要委派什么，也就无从示例。demo 为了演示流畅预填了完整
 * 剧本，那是演示装置；照抄进产品的后果是**发出一条系统发明的承诺**，比空白更糟。
 */
describe('预填出处律', () => {
  /** 一句拟稿里，除了出处给的那几样，不该出现任何具体的任务内容。 */
  const invented = ['核对', '整理', '拉数据', '写一版', '周五前', '下周']

  it('空白委派只给受话人和句式骨架，不发明任务内容', () => {
    const seed = registerSeed('张锐')
    expect(seed).toContain('张锐')
    // 占位符是**留白**，不是内容：人一眼看得出这里要他自己写。
    expect(seed).toContain('〔要做什么〕')
    expect(seed).toContain('〔什么时候前〕')
    for (const word of invented) expect(seed).not.toContain(word)
  })

  it('目标委派的起头只摆语境，内容留空', () => {
    const seed = delegateSeed('Q3 对账')
    expect(seed).toContain('Q3 对账')
    for (const word of invented) expect(seed).not.toContain(word)
  })

  /*
    有出处的那两条**必须**把出处带上：差距项与会议标题都是人自己说过或系统读出来的
    事实，不带它才是浪费——那时人得回头再打一遍已经存在的东西。
  */
  it('差距变委派带着差距原文 —— 那是它的出生故事', () => {
    expect(gapSeed('Q3 对账', '差异条目 < 5')).toContain('差异条目 < 5')
  })

  it('为此会准备带着这场会的标题', () => {
    expect(eventPrepSeed('攀登计划周会')).toContain('攀登计划周会')
  })
})

/**
 * 移交升传送门那一句（v4.24 决策 #58）。
 *
 * 移交此前只改图 + 一句「记得去说一声」——把最要紧的一半**派回给人的记性**。而这句话
 * 最容易退化成一句「已移交」：收到的人得回头翻记录才知道说的是哪件事，而那份翻找正是
 * 这个产品要消掉的东西。
 */
describe('移交拟稿', () => {
  it('带上是谁、哪一条、以及**原话**期限', () => {
    const draft = handoffDraft({ what: '核对一版竞品定价', due: { text: '下周三前' } }, '张锐')
    expect(draft).toContain('张锐')
    expect(draft).toContain('核对一版竞品定价')
    // 原话，不是解析出来的日期——改写他说过的话，是拿我们的解析冒充他的承诺。
    expect(draft).toContain('下周三前')
  })

  it('没记下期限就不编一个', () => {
    const draft = handoffDraft({ what: '核对一版竞品定价' }, '张锐')
    expect(draft).not.toContain('原定')
  })

  it('名字不知道时不留一个空称呼', () => {
    expect(handoffDraft({ what: '核对定价' }, '')).not.toContain('，「')
  })
})
