import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.screenshot({ path: '.acceptance/m0/v7-sidebar.png' })
console.log((await page.locator('nav[aria-label="收件箱"]').innerText()).split('\n').filter(Boolean).join(' | '))
console.log('console errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
