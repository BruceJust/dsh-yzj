import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(5000)
const dump = await page.evaluate(() => {
  const nodes = globalThis.__yzjNodes ?? []
  return {
    kinds: nodes.map(n => n.kind),
    assistant: nodes.filter(n => n.kind === 'assistant').slice(0, 2).map(n => JSON.parse(JSON.stringify({ blocks: n.blocks, time: n.time }))),
    user: nodes.filter(n => n.kind !== 'assistant' && n.kind !== 'tool-result').slice(0, 3),
    tool: nodes.filter(n => n.kind === 'tool-result').slice(0, 1).map(n => ({ call: n.call, meta: n.meta, callView: n.callView })),
  }
})
console.log(JSON.stringify(dump, null, 1).slice(0, 4000))
await browser.close()
