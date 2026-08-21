import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(5000)
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 50 && d.className.includes('stream'))
  if (el) el.scrollTop = 0
})
await page.waitForTimeout(600)
await page.screenshot({ path: '.acceptance/m0/v5-top.png' })
// expand a work block
const work = page.locator('button', { hasText: 'Agent 工作过程' }).first()
if (await work.count()) { await work.click(); await page.waitForTimeout(500) }
await page.screenshot({ path: '.acceptance/m0/v5-work.png' })
await browser.close()
