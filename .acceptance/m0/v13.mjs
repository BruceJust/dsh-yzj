import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
// into the group view
await page.locator('nav[aria-label="收件箱"] button[title*="群视图"]').first().click()
await page.waitForTimeout(6000)
await page.screenshot({ path: '.acceptance/m0/v13-place.png' })
// expand a topic card in place
const peek = page.getByRole('button', { name: /展开看最后几条/ }).first()
console.log('peek buttons:', await peek.count())
if (await peek.count()) { await peek.click(); await page.waitForTimeout(2500) }
await page.screenshot({ path: '.acceptance/m0/v13-peek.png' })
// enter a topic, then Back
const card = page.getByRole('button', { name: /🧵/ }).first()
if (await card.count()) { await card.click(); await page.waitForTimeout(5000) }
console.log('back button:', await page.getByRole('button', { name: /‹ 返回/ }).count())
await page.screenshot({ path: '.acceptance/m0/v13-topic.png' })
await page.getByRole('button', { name: /‹ 返回/ }).first().click()
await page.waitForTimeout(3000)
await page.screenshot({ path: '.acceptance/m0/v13-back.png' })
console.log('errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
