import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 群视图
await page.locator('nav[aria-label="收件箱"] button[title*="群视图"]').first().click()
await page.waitForTimeout(4000)
await page.screenshot({ path: '.acceptance/m0/v6-place.png' })
console.log('topic cards:', await page.locator('text=/热卡|冷卡/').count())

// 场所合同
await page.locator('button', { hasText: '返回会话' }).first().click()
await page.waitForTimeout(800)
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(4000)
await page.locator('button[title*="被允许做什么"]').first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: '.acceptance/m0/v6-contract.png' })
console.log('contract dialog:', await page.locator('[role="dialog"]').count())
console.log('console errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
