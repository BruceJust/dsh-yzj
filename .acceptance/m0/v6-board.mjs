import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('button', { hasText: '承诺板' }).first().click()
await page.waitForTimeout(3000)
await page.screenshot({ path: '.acceptance/m0/v6-board.png' })
const rows = await page.locator('[class*="board_row"]').allInnerTexts()
console.log(rows.map(r => r.replace(/\s+/g, ' ')).join('\n'))
console.log('console errors:', errors.length ? errors.slice(0,2) : 'none')
await browser.close()
