/**
 * Markdown preview specs.
 *
 * The converter runs on a file a colleague uploaded into a group, so the two
 * things worth locking are: it escapes BEFORE it transforms, and it produces
 * the constructs people actually write. It is not the security boundary — the
 * sandboxed frame is — but "escaped first" is what keeps a `.md` from silently
 * rendering as somebody's HTML.
 */

import { describe, expect, it } from 'vitest'
import { escapeHtml, markdownToHtml, previewDocument } from '../src/client/markdown.ts'

describe('先转义,再变形', () => {
  it('neutralises markup that came in the file', () => {
    const out = markdownToHtml('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('does not let an inline image or link smuggle a scheme in', () => {
    const out = markdownToHtml('[点我](javascript:alert(1))')
    // 链接只留文字与可见的目标——框里本来也导航不了,活的 href 只会是个假控件。
    expect(out).not.toContain('href')
    expect(out).toContain('点我')
  })

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml('a & "b" <c>')).toBe('a &amp; &quot;b&quot; &lt;c&gt;')
  })
})

describe('人真的会写的那些', () => {
  it('renders headings, emphasis and code', () => {
    const out = markdownToHtml('# 标题\n\n一段 **粗** 和 `代码`。')
    expect(out).toContain('<h1>标题</h1>')
    expect(out).toContain('<strong>粗</strong>')
    expect(out).toContain('<code>代码</code>')
  })

  it('renders both kinds of list', () => {
    expect(markdownToHtml('- 一\n- 二')).toContain('<ul>\n<li>一</li>\n<li>二</li>\n</ul>')
    expect(markdownToHtml('1. 一\n2. 二')).toContain('<ol>')
  })

  it('renders a fenced block without treating its contents as markdown', () => {
    const out = markdownToHtml('```\n# 这不是标题\n**也不是粗体**\n```')
    expect(out).toContain('<pre><code># 这不是标题')
    expect(out).not.toContain('<h1>')
    expect(out).not.toContain('<strong>')
  })

  it('renders a table', () => {
    const out = markdownToHtml('| 名 | 值 |\n| --- | --- |\n| a | 1 |')
    expect(out).toContain('<th>名</th>')
    expect(out).toContain('<td>a</td>')
    expect(out).toContain('</tbody></table>')
  })

  it('renders quotes and rules', () => {
    expect(markdownToHtml('> 引用')).toContain('<blockquote>引用</blockquote>')
    expect(markdownToHtml('---')).toContain('<hr>')
  })

  it('keeps an ordinary paragraph as one paragraph', () => {
    expect(markdownToHtml('第一行\n第二行')).toBe('<p>第一行 第二行</p>')
  })

  /* 一行一个 blockquote，左边那道线就断成一截一截（实测：一份接口文档的文档头）。 */
  it('连着的引用是一段引用，每行留着换行；「>」单独一行才分段', () => {
    expect(markdownToHtml('> 类型：接口梳理\n> 基线：`main`\n>\n> 范围：后端'))
      .toBe('<blockquote>类型：接口梳理<br>基线：<code>main</code></blockquote>\n<blockquote>范围：后端</blockquote>')
  })

  /* 目录里每一行后面挂一串「#1-总览」，读的人只看到乱码——它指的就是下面那个标题。 */
  it('文档内的锚点只留字；往外的链接照旧把去处写出来', () => {
    expect(markdownToHtml('1. [总览](#1-总览)')).toBe('<ol>\n<li>总览</li>\n</ol>')
    expect(markdownToHtml('[文档](https://a.example/x)')).toContain('文档 <span class="u">https://a.example/x</span>')
  })
})

describe('装进框里的那份文档', () => {
  it('is standalone, because the frame has no origin to load styles from', () => {
    const doc = previewDocument('<p>x</p>')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<style>')
    expect(doc).toContain('<p>x</p>')
  })

  it('表格在空行、代码块、标题处收口——不然后面的东西会被浏览器拽进表里', () => {
    const table = '| 名 | 值 |\n| --- | --- |\n| a | 1 |'
    for (const after of ['\n\n```\nx\n```', '\n# 下一节', '\n> 引用', '\n---']) {
      const out = markdownToHtml(table + after)
      const closed = out.indexOf('</tbody></table>')
      expect(closed).toBeGreaterThan(-1)
      expect(out.indexOf('<tr><td>a</td><td>1</td></tr>')).toBeLessThan(closed)
      expect(out.slice(closed)).toMatch(/<pre>|<h1>|<blockquote>|<hr>/u)
    }
    expect(markdownToHtml(table).endsWith('</tbody></table>')).toBe(true)
  })

  /* Chromium 不认 -apple-system：它排在前面，正文就落到苹方，连字符画成一道长横。 */
  it('字体先认 system-ui——「kwork-server」不被画成「kwork–server」', () => {
    const doc = previewDocument('<p>x</p>')
    const stack = /font: 13px\/1\.75 ([^;]+);/u.exec(doc)?.[1] ?? ''
    expect(stack.startsWith('system-ui')).toBe(true)
    expect(stack.indexOf('PingFang SC')).toBeGreaterThan(stack.indexOf('BlinkMacSystemFont'))
  })

  it('跟着宿主的明暗排版：暗色下是浅字、暗色方案，框底透明', () => {
    const light = previewDocument('<p>x</p>')
    const dark = previewDocument('<p>x</p>', true)
    expect(light).toContain('color-scheme: light')
    expect(dark).toContain('color-scheme: dark')
    expect(dark).toContain('color: #E6E8EB')
    expect(dark).not.toContain('#23262B')
    expect(dark).toContain('background: transparent')
  })
})
