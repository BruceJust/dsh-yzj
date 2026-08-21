import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
page.on('response', async (r) => {
  if (r.status() >= 400) {
    console.log('HTTP', r.status(), r.url())
    try { console.log((await r.text()).slice(0, 600)) } catch {}
  }
})
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(6000)
await browser.close()
