/** v40 — 浏览器半边对抗审查的修复回归（不发任何群消息）。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(11000)

// ---- #5 传送门不能吞掉没发完的草稿 ----
await p.evaluate(() => { document.querySelector('nav button[class*="_itemSub"]')?.click() })
await p.waitForTimeout(8000)
const half = '半写的一段话，别弄丢我'
await p.locator('textarea[class*="_input"]').fill(half)
await p.waitForTimeout(300)
await p.locator('nav button', { hasText: '承诺板' }).first().evaluate(e => { e.click() })
await p.waitForTimeout(2000)
await p.locator('button', { hasText: /^按目标$/ }).first().evaluate(e => { e.click() })
await p.waitForTimeout(1200)
await p.evaluate(() => {
  const g = [...document.querySelectorAll('[class*="_goalBlock"]')].find(x => x.querySelector('[class*="_assess"]'))
  g?.querySelector('[class*="_assess"]')?.click()
})
await p.waitForTimeout(900)
await p.evaluate(() => { document.querySelector('[role="dialog"] button[class*="_room"]')?.click() })
await p.waitForTimeout(7000)
console.log('=== #5 草稿 ===', await p.evaluate((h) => ({
  草稿还在: document.querySelector('textarea[class*="_input"]')?.value === h,
  当前值: document.querySelector('textarea[class*="_input"]')?.value?.slice(0, 24),
  提示: document.querySelector('[class*="_toast"]')?.textContent?.slice(0, 30) ?? '(无)',
}), half))

// ---- #6 立目标被拒时表单不该消失 ----
await p.locator('nav button', { hasText: '承诺板' }).first().evaluate(e => { e.click() })
await p.waitForTimeout(2000)
await p.locator('button', { hasText: /^按目标$/ }).first().evaluate(e => { e.click() })
await p.waitForTimeout(1200)
const existing = await p.evaluate(() => document.querySelector('[class*="_goalLink"]')?.getAttribute('href') ?? '')
await p.locator('button', { hasText: '＋ 立目标' }).first().evaluate(e => { e.click() })
await p.waitForTimeout(600)
await p.locator('[role="dialog"] input').nth(0).fill('会被拒的目标')
await p.locator('[role="dialog"] input').nth(1).fill(existing)
await p.locator('[role="dialog"] textarea').fill('这三行成功标准不该被吞掉')
await p.locator('[role="dialog"] button', { hasText: /^立目标$/ }).evaluate(e => { e.click() })
await p.waitForTimeout(2500)
console.log('=== #6 被拒之后 ===', await p.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  return {
    表单还开着: d !== null,
    拒绝理由就地显示: d?.querySelector('[class*="_refusal"]')?.textContent?.slice(0, 34) ?? '(无)',
    成功标准还在: d?.querySelector('textarea')?.value ?? '(丢了)',
  }
}))

console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 5))
await b.close()
