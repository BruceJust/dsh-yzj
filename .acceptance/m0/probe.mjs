import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.screenshot({ path: '.acceptance/m0/v12-probe.png' })
console.log('nav count:', await page.locator('nav[aria-label="收件箱"]').count())
console.log('buttons in nav:', await page.locator('nav[aria-label="收件箱"] button').count())
console.log('errors:', errors.slice(0, 5))
await browser.close()
