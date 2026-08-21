import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.locator('nav[aria-label="收件箱"] button[title*="群视图"]').first().click()
await page.waitForTimeout(6000)
const info = await page.evaluate(() => {
  const scrollers = [...document.querySelectorAll('div')]
    .filter(d => d.scrollHeight > d.clientHeight + 50)
    .map(d => ({ cls: d.className, h: d.scrollHeight, c: d.clientHeight }))
  return scrollers
})
console.log(JSON.stringify(info, null, 1).slice(0, 900))
await browser.close()
