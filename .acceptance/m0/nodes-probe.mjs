import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(5000)
// Reach into the React tree is hard; instead read what the column rendered.
const kinds = await page.evaluate(() => {
  const out = []
  document.querySelectorAll('[class*="msg"]').forEach(el => {
    out.push((el.textContent || '').slice(0, 60).replace(/\s+/g, ' '))
  })
  return out
})
console.log(JSON.stringify(kinds, null, 1))
await browser.close()
