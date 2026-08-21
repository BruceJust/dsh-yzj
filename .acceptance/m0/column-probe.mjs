import { chromium } from 'playwright'
const B = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 920 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(B, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
console.log('--- no-session state ---')
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 700))
await page.screenshot({ path: '.acceptance/m0/column-hero.png' })

// open an existing session from the place tree / inbox if any, else create one
const first = page.locator('button', { hasText: 'hi' }).first()
if (await first.count() > 0) { await first.click(); await page.waitForTimeout(2500) }
console.log('--- session state ---')
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 900))
await page.screenshot({ path: '.acceptance/m0/column-session.png' })
console.log('--- errors ---')
console.log(errors.slice(0, 10).join('\n') || '  (none)')
await browser.close()
