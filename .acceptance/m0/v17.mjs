import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.screenshot({ path: '.acceptance/m0/v17-sidebar.png' })
console.log('chevrons:', await page.getByRole('button', { name: /折叠|展开/ }).count())
// collapse the group and check the badge survives
const before = await page.locator('nav[aria-label="收件箱"] button').count()
await page.getByRole('button', { name: '折叠' }).first().click()
await page.waitForTimeout(900)
const after = await page.locator('nav[aria-label="收件箱"] button').count()
console.log('rows before/after collapse:', before, after)
await page.screenshot({ path: '.acceptance/m0/v17-collapsed.png' })
console.log('errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
