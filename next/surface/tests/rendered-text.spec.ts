/**
 * 渲染文本的卫生 —— **注释里的强调不许漏进屏幕**.
 *
 * 这套代码的注释用 markdown 的 `**` 做强调，而 JSX 的文本节点**原样渲染**：同一个
 * 写法在注释里是加粗，在标签之间就是两颗星号糊在句子中间。
 *
 * 它为什么能活到被人看见：**每一条渲染断言都用 `toContain`**，而
 * `'空，而且**永远为空**：…'.includes('永远为空')` 是真的。星号对 jsdom 不可见，
 * 只对人可见——所以这一条断言不查语义，它查字面。
 *
 * 真的在浏览器面板里看一眼，第一屏就抓到了十处（v2.1 第四轮自审）。这个用例是那次
 * 的固化：**同类全集扫一遍，而不是把看见的那一处补掉**。
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 把注释挖空但**保留行数** —— 报出来的行号要能直接跳过去。 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => '\n'.repeat((match.match(/\n/g) ?? []).length))
    .replace(/\/\/.*$/gm, '')
}

describe('渲染文本：注释的强调不落到屏幕上', () => {
  it('客户端组件里没有一处字面 `**`', async () => {
    const dir = new URL('../src/client/', import.meta.url).pathname
    const offenders: string[] = []
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.tsx') && !name.endsWith('.ts')) continue
      const source = await readFile(join(dir, name), 'utf8')
      withoutComments(source).split('\n').forEach((line, index) => {
        if (line.includes('**')) offenders.push(`${name}:${String(index + 1)}`)
      })
    }
    /*
      要加粗就用 `<b>`；进不了标签的地方（`title` 这类纯字符串属性）**改措辞**
      ——把力气放进句子里，而不是放进两颗人眼看得见、渲染器看不见的星号。
    */
    expect(offenders).toEqual([])
  })
})
