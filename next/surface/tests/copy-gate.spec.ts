/**
 * 文案门 (界面重设计 P1 · §7 · 律一) —— 屏上只说人话。
 *
 * 设计文档里的概念名不变，变的是屏幕上的字。这道门扫的是**会上屏的字**：客户端源码与
 * surface 服务端（它的报错、提示、标签都会原样显示）里，去掉注释之后的中文字面量与 JSX
 * 文本。注释里照旧可以写「真身」「场所合同」——那是给读代码的人看的。
 *
 * 只许降不许升：§7 换掉的旧词出现一次就红；agent 在屏上一律叫配置里的名字。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SOURCES = [
  ...listed(join(ROOT, 'surface/src/client')),
  ...listed(join(ROOT, 'cards/src/client')),
  join(ROOT, 'surface/src/rpc.ts'),
]

function listed(dir: string): string[] {
  return readdirSync(dir).filter(name => /\.tsx?$/u.test(name)).map(name => join(dir, name))
}

/** §7 左列：屏上不该再出现的旧说法。 */
const RETIRED = [
  '收件箱', '需要我的在上', '待确认', '待验收', '待裁决', '承诺板', '跨执行者', '我裁决的',
  '只到 agent', '不落在群里', '对 Agent 说', '轻问', '主楼', '场所合同', '授权租约', '设为租约',
  '对象面', '流沉淀为物', '跟会话走', '真身', '修理', '催一下', '（去说）', '无信号', '最后动静',
  '有证据', '话语回执', '终态', '人工验收', '怎么算完成', '成功标准', '差距简报', '立目标',
  '委派 ↗', '完整轨迹', '不是云之家话题', '热卡', '冷卡', '归档索引', '推断待核',
]

/**
 * 不上屏的字面量。每一条写清为什么。
 *
 * - `[轻问]`：消息里的协议标记，`stream.ts` 认出来就剥掉，从不显示。
 */
const NOT_ON_SCREEN = ["'[轻问]'"]

function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1')
}

/** 会上屏的字：带中文的字符串字面量（模板里的 `${…}` 去掉）与 JSX 文本。 */
function screenText(source: string): string[] {
  let code = withoutComments(source)
  for (const literal of NOT_ON_SCREEN) code = code.split(literal).join("''")
  const out: string[] = []
  for (const match of code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/gu)) {
    const text = match[0].replace(/\$\{[^}]*\}/gu, '')
    if (/[一-鿿]/u.test(text)) out.push(text)
  }
  for (const match of code.matchAll(/>([^<>{}]*[一-鿿][^<>{}]*)</gu)) out.push(match[1] ?? '')
  return out
}

describe('文案门', () => {
  it('§7 换掉的旧说法不再上屏', () => {
    const offenders = SOURCES.flatMap(file => screenText(readFileSync(file, 'utf8')).flatMap(text => (
      RETIRED.filter(word => text.includes(word)).map(word => `${file.slice(ROOT.length)}: [${word}] ${text.slice(0, 80)}`)
    )))
    expect(offenders).toEqual([])
  })

  it('agent 在屏上一律叫它的名字', () => {
    const offenders = SOURCES.flatMap(file => screenText(readFileSync(file, 'utf8'))
      .filter(text => /\bagent\b/iu.test(text))
      .map(text => `${file.slice(ROOT.length)}: ${text.slice(0, 80)}`))
    expect(offenders).toEqual([])
  })

  it('门本身是活的：注释里的旧词不算，字面量里的算', () => {
    expect(screenText("// 真身\nconst a = '真身'").join()).toContain('真身')
    expect(screenText('/* 场所合同 */ const b = 1').join()).not.toContain('场所合同')
    expect(screenText('<span>交给 agent 做</span>').join()).toContain('agent')
    expect(screenText("const c = `${kind === 'agent' ? '' : who}说交了`").join()).not.toContain('agent')
  })
})
