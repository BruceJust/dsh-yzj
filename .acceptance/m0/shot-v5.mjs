import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:3090/'
const out = process.argv[3] ?? '.acceptance/m0/v5'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.screenshot({ path: `${out}-home.png`, fullPage: false })

// Open the first topic in the place tree, if there is one.
const topic = page.locator('nav[aria-label="收件箱"] button').filter({ hasText: /./ })
const count = await topic.count()
console.log('sidebar buttons:', count)
const texts = []
for (let i = 0; i < Math.min(count, 30); i += 1) texts.push((await topic.nth(i).innerText()).replace(/\n/g, ' | '))
console.log(JSON.stringify(texts, null, 1))
await browser.close()
console.log('console errors:', errors.length ? errors : 'none')
