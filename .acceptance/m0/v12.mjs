import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
// open a topic with real messages
await page.locator('nav[aria-label="收件箱"] button').filter({ hasText: '李婷刚说初稿' }).first().click()
await page.waitForTimeout(5000)
console.log('anchor bar:', (await page.locator('[class*="anchorBar"]').innerText().catch(() => 'missing')).replace(/\n/g, ' '))
// hover a public message and use ⚡@agent
const msg = page.locator('[class*="column_msg"]').first()
await msg.hover()
await page.waitForTimeout(400)
await page.screenshot({ path: '.acceptance/m0/v12-hover.png' })
const verb = page.locator('button', { hasText: '⚡ @agent' }).first()
if (await verb.count()) {
  await verb.click()
  await page.waitForTimeout(800)
  console.log('after ⚡:', (await page.locator('[class*="anchorBar"]').innerText()).replace(/\n/g, ' '))
  console.log('draft:', await page.locator('textarea').first().inputValue())
}
await page.screenshot({ path: '.acceptance/m0/v12-anchor.png' })
// trace panel
await page.locator('button', { hasText: '完整轨迹' }).first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: '.acceptance/m0/v12-trace.png' })
console.log('trace rows:', await page.locator('[class*="trace_rowHead"]').count())
console.log('errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
