/** v41 — 文件消息不再重复文件名 + 文件名两行 + 引用行的「打开话题」。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(11000)

// dsh-2 群视图：那里有 [文件]:r29-summary.md
await p.evaluate(() => {
  const row = [...document.querySelectorAll('nav button')].find(e => e.textContent?.includes('dsh-2'))
  row?.click()
})
await p.waitForTimeout(9000)
console.log('=== 文件消息 ===')
console.log(await p.evaluate(() => {
  const cards = [...document.querySelectorAll('[class*="_file"]')]
    .filter(e => e.tagName === 'A')
  const first = cards[0]
  const name = first?.querySelector('[class*="_fileName"]')
  const bubbleTexts = [...document.querySelectorAll('[class*="_bubble"]')]
    .map(e => e.textContent ?? '').filter(t => t.startsWith('[文件]'))
  const cs = name === null || name === undefined ? null : getComputedStyle(name)
  return {
    文件卡数: cards.length,
    卡上文件名: name?.textContent,
    还在正文里重复出现的占位符: bubbleTexts,
    文件名样式: cs === null ? '(无)' : { 行数上限: cs.webkitLineClamp, 断词: cs.overflowWrap },
  }
}))

console.log('=== 引用行 ===')
console.log(await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="_quoteRow"]')]
  return {
    引用行数: rows.length,
    第一行: rows[0]?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 50),
    打开话题按钮: rows.map(r => r.querySelector('[class*="_quoteTopic"]')?.textContent).filter(Boolean),
  }
}))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 5))
await p.screenshot({ path: '.acceptance/m0/v41-place.png' })
await b.close()
