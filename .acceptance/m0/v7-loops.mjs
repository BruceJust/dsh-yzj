import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

// 1. did the IM 打回 land on the desktop?
const side = await page.locator('nav[aria-label="收件箱"]').innerText()
console.log('CHIPS:', side.split('\n').filter(l => /待确认|待验收|运行中/.test(l)).join(' / '))
console.log('REWORK ROW:', side.split('\n').filter(l => l.includes('返工') || l.includes('运行中：')).join(' | ') || '(none)')

// 2. open that topic and read the acceptance bar
await page.locator('nav[aria-label="收件箱"] button').filter({ hasText: '帮我看下我有哪些知识库' }).first().click()
await page.waitForTimeout(4000)
await page.screenshot({ path: '.acceptance/m0/v7-rework.png' })
const bars = await page.locator('[class*="card_accept"]').allInnerTexts()
console.log('ACCEPT BAR:', bars.map(b => b.replace(/\s+/g, ' ')).join(' | ') || '(none)')

// 3. desktop memory forget
await page.locator('button', { hasText: '记忆' }).first().click()
await page.waitForTimeout(1200)
const before = await page.locator('[class*="memCard"]').count()
if (before > 0) {
  await page.locator('[class*="memDel"]').first().click()
  await page.waitForTimeout(2500)
}
const after = await page.locator('[class*="memCard"]').count()
console.log(`MEMORY: ${before} -> ${after}`)
console.log('console errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
