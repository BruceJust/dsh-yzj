/** v30 — 承诺板 v4.8：GOALS 视图 / 立目标 / 无归属 / 批量补挂（全程不发消息）。 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(9000)

await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(2500)
console.log('=== 全部视图 ===')
console.log(await page.evaluate(() => document.querySelector('[class*="_sub"]')?.textContent ?? ''))

await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1200)
const shot = async () => page.evaluate(() => {
  const body = document.querySelector('[class*="board_body"], [class*="_body"]')
  return {
    目标数: document.querySelector('[class*="_goalsCount"]')?.textContent ?? '',
    无归属: document.querySelector('[class*="_unattachedNote"]')?.textContent?.replace(/\s+/g, '') ?? '',
    无归属行: document.querySelectorAll('[class*="_pick"]').length,
    立目标键: [...document.querySelectorAll('button')].some(b => b.textContent?.includes('立目标')),
    人工验收药丸: document.querySelectorAll('[class*="_manual"]').length,
  }
})
console.log('=== 按目标视图 ===')
console.log(await shot())

// 立目标
await page.locator('button', { hasText: '＋ 立目标' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(600)
const stamp = `实测目标-${String(Date.now()).slice(-5)}`
await page.locator('[role="dialog"] input').nth(0).fill(stamp)
await page.locator('[role="dialog"] input').nth(1).fill('https://www.yunzhijia.com/doc/goal-probe')
await page.locator('[role="dialog"] button', { hasText: /^立目标$/ }).evaluate(el => { el.click() })
await page.waitForTimeout(3000)
console.log('=== 立目标之后 ===')
console.log(await shot())
console.log('目标行:', await page.evaluate(() => (
  [...document.querySelectorAll('[class*="_goalName"]')].map(el => el.textContent).join(' | ')
)))

// 批量补挂
const picks = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('[class*="_pick"]')].slice(0, 2)
  for (const b of boxes) b.click()
  return boxes.length
})
await page.waitForTimeout(600)
console.log('=== 选中', picks, '条 ===')
console.log(await page.evaluate(() => document.querySelector('[class*="_batchCount"]')?.textContent ?? '(没有批量条)'))
// 真的挂过去，确认它们从无归属移进目标下
await page.evaluate((mark) => {
  const btn = [...document.querySelectorAll('[class*="_batchBtn"]')].find(b => b.textContent?.includes(mark))
  btn?.click()
}, stamp)
await page.waitForTimeout(3500)
console.log('=== 补挂之后 ===')
console.log(await shot())
console.log('挂接来路:', await page.evaluate(() => (
  [...document.querySelectorAll('[class*="_via"]')].map(el => el.textContent).join(' | ') || '(无)'
)))
await page.screenshot({ path: '.acceptance/m0/v30-goals.png' })
console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
