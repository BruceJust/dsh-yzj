import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 1. open a topic, then the memory tab
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(3500)
await page.locator('button', { hasText: '记忆' }).first().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: '.acceptance/m0/v5-memory.png' })
console.log('memory panel:', (await page.locator('[class*="memCard"]').allInnerTexts()).join(' | ') || '(empty)')

// 2. the board
await page.locator('button', { hasText: '承诺板' }).first().click()
await page.waitForTimeout(2500)
await page.screenshot({ path: '.acceptance/m0/v5-board.png' })
console.log('board rows:', (await page.locator('[class*="board_row"], [class*="row"]').count()))
console.log('console errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
