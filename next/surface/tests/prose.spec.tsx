// @vitest-environment jsdom
/**
 * 云小助的话按它写的样子排 (律一).
 *
 * 锁两件事：常用写法排得出来（不然人读到的是 `**` 和 `|---|`），以及**没有一个字节
 * 会变成标签**——这里只产出 React 元素，链接只认 http(s)。
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { blocksOf, Prose } from '../src/client/Prose.tsx'

async function render(text: string): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<Prose text={text} />) })
  return host
}

describe('排得出来', () => {
  it('段落、标题、列表、引用、分隔线、代码块各归各的块', () => {
    const kinds = blocksOf([
      '## 结论', '先说结果。', '第二行同一段。', '', '- 一', '- 二', '1. 甲', '2. 乙',
      '> 原话', '---', '```', 'ls -a', '```',
    ].join('\n')).map(block => block.kind)
    expect(kinds).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'hr', 'code'])
  })

  it('表格：表头、分隔行、数据行', async () => {
    const host = await render('| 成功标准 | 判定 |\n|---|---|\n| 签发时抄下的旧标准 | **未达成** |')
    expect(host.querySelectorAll('th')).toHaveLength(2)
    expect(host.querySelector('td strong')?.textContent).toBe('未达成')
    expect(host.textContent).not.toContain('|')
  })

  it('行内：加粗、代码、链接；代码里的星号不当记号', async () => {
    const host = await render('**总体：** 用 `a**b` 查，见 [文档](https://example.com/x)')
    expect(host.querySelector('strong')?.textContent).toBe('总体：')
    expect(host.querySelector('code')?.textContent).toBe('a**b')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/x')
    expect(host.textContent).not.toContain('**总体')
  })
})

describe('没有一个字节变成标签', () => {
  it('尖括号原样是字；非 http 的链接不成链接', async () => {
    const host = await render('<img src=x onerror=alert(1)> [点我](javascript:alert(1))')
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
