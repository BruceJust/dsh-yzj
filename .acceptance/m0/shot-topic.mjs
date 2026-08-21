import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
// open the first triage item
const item = page.locator('nav[aria-label="收件箱"] button').nth(5)
console.log('clicking:', (await item.innerText()).replace(/\n/g, ' | '))
await item.click()
await page.waitForTimeout(5000)
await page.screenshot({ path: '.acceptance/m0/v5-topic.png' })
// rails present?
const rails = await page.locator('text=/^公$|^私$/').count()
console.log('rail tags:', rails)
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')
await browser.close()
