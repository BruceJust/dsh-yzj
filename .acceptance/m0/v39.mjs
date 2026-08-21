/** v39 — 自查修复的实测：立目标的出生血缘 + 侧栏「该评估」信号。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(11000)

console.log('=== 侧栏承诺板按钮 ===')
console.log(await p.evaluate(() => {
  const btn = [...document.querySelectorAll('nav button')].find(e => e.textContent?.includes('承诺板'))
  return {
    文本: btn?.textContent?.replace(/\s+/g, ' ').trim(),
    该评估徽标: btn?.querySelector('[class*="_boardAssess"]')?.textContent ?? '(无)',
  }
}))

// 先进一个话题（磨稿会话），再从那儿开板立目标
await p.evaluate(() => {
  const sub = document.querySelector('nav button[class*="_itemSub"]')
  sub?.click()
})
await p.waitForTimeout(8000)
const stamp = `v39目标-${String(Date.now()).slice(-5)}`
const url = `https://www.yunzhijia.com/doc/v39-${String(Date.now()).slice(-5)}`
await p.locator('nav button', { hasText: '承诺板' }).first().evaluate(e => { e.click() })
await p.waitForTimeout(2000)
await p.locator('button', { hasText: /^按目标$/ }).first().evaluate(e => { e.click() })
await p.waitForTimeout(1200)
await p.locator('button', { hasText: '＋ 立目标' }).first().evaluate(e => { e.click() })
await p.waitForTimeout(600)
await p.locator('[role="dialog"] input').nth(0).fill(stamp)
await p.locator('[role="dialog"] input').nth(1).fill(url)
await p.locator('[role="dialog"] textarea').fill('自查：血缘应指向磨稿会话')
await p.locator('[role="dialog"] button', { hasText: /^立目标$/ }).evaluate(e => { e.click() })
await p.waitForTimeout(3000)
console.log('=== 立了 ===', stamp)
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 5))
await b.close()
