import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(5000)
const dump = await page.evaluate(() => {
  const nodes = globalThis.__yzjNodes ?? []
  return nodes.map(n => ({ keys: Object.keys(n), kind: n.kind, dataKeys: n.data ? Object.keys(n.data) : null }))
})
console.log(JSON.stringify(dump, null, 1).slice(0, 3000))
await browser.close()
