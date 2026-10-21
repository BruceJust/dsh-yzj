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
