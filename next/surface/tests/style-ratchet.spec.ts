/**
 * 样式棘轮 —— 界面重设计 §6 / §10 P0 的验收门。
 *
 * 「静为常态，色为例外」只有在颜色**不能随手写**的时候才守得住：370 处写死的颜色就是
 * 这样一处一处长出来的，每一处单看都合理。这里把规矩写成断言：
 *
 * - 颜色只在 `tokens.module.css` 里出现，其余样式只引用语义名；
 * - 字号只有六档，圆角只有四档，都走变量；
 * - 引用的变量必须有定义——`--line`、`--ink-soft` 这种写错了也不报错的名字，正是暗色
 *   失效、颜色悄悄退回浏览器默认值的来路。
 *
 * 新组件只要照着 token 写，这些断言永远是绿的；哪天它红了，说的是「这里又长出了一块
 * 不跟主题走的颜色」。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SURFACE = join(ROOT, 'surface/src/client')
const CARDS = join(ROOT, 'cards/src/client')

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
const list = (dir: string, pattern: RegExp): string[] => readdirSync(dir).filter(name => pattern.test(name))

/** 去掉注释：注释里讲道理时提到的 `#FFF` 不是颜色。 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '')

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/u

interface Sheet { dir: string; file: string; body: string }

function sheets(): Sheet[] {
  return [SURFACE, CARDS].flatMap(dir => list(dir, /\.module\.css$/u)
    .filter(file => file !== 'tokens.module.css')
    .map(file => ({ dir, file, body: stripComments(read(dir, file)) })))
}

function defined(dir: string): Set<string> {
  const body = stripComments(read(dir, 'tokens.module.css'))
  return new Set([...body.matchAll(/(--yzj-[a-z0-9-]+)\s*:/gu)].map(match => match[1] ?? ''))
}

describe('样式棘轮', () => {
  it('颜色只写在 tokens 里', () => {
    const offenders = sheets().flatMap(({ file, body }) => (
      body.split('\n').filter(line => COLOR.test(line)).map(line => `${file}: ${line.trim()}`)
    ))
    expect(offenders).toEqual([])
  })

  it('字号只有六档，都走变量', () => {
    const offenders = sheets().flatMap(({ file, body }) => (
      [...body.matchAll(/font-size\s*:\s*([^;}]+)/gu)]
        .map(match => (match[1] ?? '').trim())
        .filter(value => !/^var\(--yzj-fs-(xs|sm|md|lg|xl|2xl)\)$/u.test(value) && value !== 'inherit')
        .map(value => `${file}: font-size: ${value}`)
    ))
    expect(offenders).toEqual([])
    const scale = [...stripComments(read(SURFACE, 'tokens.module.css')).matchAll(/--yzj-fs-[a-z0-9]+\s*:\s*([\d.]+)px/gu)]
      .map(match => Number(match[1]))
    expect(scale).toEqual([12, 13, 14, 16, 20, 24])
  })

  it('字重只有三档：400 / 500 / 600', () => {
    const offenders = sheets().flatMap(({ file, body }) => (
      [...body.matchAll(/font-weight\s*:\s*([^;}]+)/gu)]
        .map(match => (match[1] ?? '').trim())
        .filter(value => !/^(400|500|600|inherit|normal)$/u.test(value))
        .map(value => `${file}: font-weight: ${value}`)
    ))
    expect(offenders).toEqual([])
  })

  it('行高只有两档：正文 1.55、标题 1.4（外加图标用的 1 / 0）', () => {
    const offenders = sheets().flatMap(({ file, body }) => (
      [...body.matchAll(/line-height\s*:\s*([^;}]+)/gu)]
        .map(match => (match[1] ?? '').trim())
        .filter(value => !/^(0|1|1\.4|1\.55|inherit|normal)$/u.test(value))
        .map(value => `${file}: line-height: ${value}`)
    ))
    expect(offenders).toEqual([])
  })

  /*
    不做入场动画 (§6)：东西出现就是出现了。动画只给三件事——进度在转、回到出处那一闪、
    骨架在读。新写一个 popin / slidein，这里就红。
  */
  it('动画只有转圈、闪一下、骨架、拦下时的一抖', () => {
    const offenders = sheets().flatMap(({ file, body }) => (
      [...body.matchAll(/@keyframes\s+([A-Za-z-]+)/gu)]
        .map(match => match[1] ?? '')
        .filter(name => !['spin', 'flash', 'breathe', 'shake'].includes(name))
        .map(name => `${file}: @keyframes ${name}`)
    ))
    expect(offenders).toEqual([])
  })

  it('圆角只有四档', () => {
    const offenders = sheets().flatMap(({ file, body }) => (
      [...body.matchAll(/border-radius\s*:\s*([^;}]+)/gu)]
        .map(match => (match[1] ?? '').trim())
        .filter(value => value.split(/\s+/u).some(part => (
          !/^(0|50%|inherit|var\(--yzj-r-(sm|md|lg|pill)\))$/u.test(part)
        )))
        .map(value => `${file}: border-radius: ${value}`)
    ))
    expect(offenders).toEqual([])
  })

  it('引用的变量都有定义', () => {
    const known = { [SURFACE]: defined(SURFACE), [CARDS]: defined(CARDS) }
    const offenders = sheets().flatMap(({ dir, file, body }) => (
      [...body.matchAll(/var\((--[a-zA-Z0-9-]+)/gu)]
        .map(match => match[1] ?? '')
        // 宿主的别名 token 只该在 tokens 里接，组件不直接认宿主。
        .filter(name => !(known[dir]?.has(name) ?? false))
        .map(name => `${file}: ${name}`)
    ))
    expect([...new Set(offenders)]).toEqual([])
  })

  it('组件代码里不写颜色', () => {
    /*
      唯一的例外是 markdown 预览：它是一份进了 iframe 的独立文档，够不着这一侧的变量，
      只能自带一套——它自己负责跟宿主的深浅（见 `markdown.ts`）。
    */
    const ALLOWED = new Set(['markdown.ts'])
    const offenders = [SURFACE, CARDS].flatMap(dir => list(dir, /\.tsx?$/u)
      .filter(file => !ALLOWED.has(file))
      .flatMap(file => read(dir, file).split('\n')
        .filter(line => /['"`]#[0-9a-fA-F]{3,8}['"`]/u.test(line) || /\brgba?\(\d/u.test(line))
        .map(line => `${file}: ${line.trim()}`)))
    expect(offenders).toEqual([])
  })

  it('宿主暗色有一套对应的值', () => {
    const body = stripComments(read(SURFACE, 'tokens.module.css'))
    expect(body).toContain(':global(body[data-ds-dark-theme]) .tokens')
    // 第三档墨色要过 AA：浅色底 4.5:1，这一档是我们自己定的，不跟宿主（宿主那一档约 3.8:1）。
    expect(body).toMatch(/--yzj-ink-3:\s*#697180/u)
  })
})
