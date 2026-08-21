/** v42 — 话题列里引用行的两个门。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(11000)
// 进一个有引用的话题
for (const i of [0, 1, 2, 3, 4]) {
  await p.evaluate((n) => {
    const subs = [...document.querySelectorAll('nav button[class*="_itemSub"]')]
    subs[n]?.click()
  }, i)
  await p.waitForTimeout(7000)
  const state = await p.evaluate(() => ({
    标题: document.querySelector('[class*="_title"]')?.textContent?.slice(0, 18),
    消息行: document.querySelectorAll('[class*="_msg"]').length,
    锚点: document.querySelectorAll('[data-msg]').length,
    引用: document.querySelectorAll('[class*="_quoteRow"]').length,
  }))
  console.log(' 话题', i, state)
  if (state.引用 > 0) break
}
console.log(await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="_quoteRow"]')]
  return {
    引用行数: rows.length,
    可点跳转: rows.filter(r => r.querySelector('[class*="_quoteLink"]')).length,
    看整串按钮: rows.filter(r => r.querySelector('[class*="_quoteTopic"]')).length,
    锚点数: document.querySelectorAll('[data-msg]').length,
    第一行: rows[0]?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 46),
  }
}))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await b.close()
