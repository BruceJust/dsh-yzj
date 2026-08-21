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
})

describe('装进框里的那份文档', () => {
  it('is standalone, because the frame has no origin to load styles from', () => {
    const doc = previewDocument('<p>x</p>')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<style>')
    expect(doc).toContain('<p>x</p>')
  })
})
