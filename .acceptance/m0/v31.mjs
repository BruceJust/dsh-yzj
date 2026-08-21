/** v31 — 补挂的出口，并把实测建的目标清理干净。 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(9000)
await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(2000)
await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1200)

const shot = async () => page.evaluate(() => ({
  目标: [...document.querySelectorAll('[class*="_goalName"]')].map(e => e.textContent?.slice(0, 30)),
  无归属行: document.querySelectorAll('[class*="_pick"]').length,
  移出键: document.querySelectorAll('[class*="_unlink"]').length,
  作废键: document.querySelectorAll('[class*="_voidGoal"]').length,
}))
console.log('起点:', await shot())

// 出口①：把实测目标下的两条移出
for (let i = 0; i < 4; i += 1) {
  const clicked = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[class*="_goalBlock"]')]
    const target = blocks.find(b => b.querySelector('[class*="_goalName"]')?.textContent?.includes('实测目标'))
    const btn = target?.querySelector('[class*="_unlink"]')
    if (btn === null || btn === undefined) return false
    btn.click(); return true
  })
  if (!clicked) break
  await page.waitForTimeout(2500)
}
console.log('移出之后:', await shot())

// 出口②：作废实测目标本身
await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('[class*="_goalBlock"]')]
  const target = blocks.find(b => b.querySelector('[class*="_goalName"]')?.textContent?.includes('实测目标'))
  target?.querySelector('[class*="_voidGoal"]')?.click()
})
await page.waitForTimeout(3000)
console.log('作废之后:', await shot())
console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
