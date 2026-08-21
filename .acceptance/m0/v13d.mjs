import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.locator('nav[aria-label="收件箱"] button[title*="群视图"]').first().click()
await page.waitForTimeout(6000)
// Scroll deep, then click the topic WITHOUT letting Playwright scroll it into
// view first — auto-scroll would reset the very thing under test.
const pushed = await page.evaluate(() => {
  const body = [...document.querySelectorAll('div')]
    .filter(d => d.scrollHeight > d.clientHeight + 100)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  body.scrollTop = 900
  const strip = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('更早的话题'))
  strip?.click()
  return body.scrollTop
})
console.log('scroll before entering:', pushed)
await page.waitForTimeout(600)
await page.evaluate(() => {
  const card = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('🧵'))
  card?.click()
})
await page.waitForTimeout(5500)
console.log('back button:', await page.getByRole('button', { name: /‹ 返回/ }).count())
await page.evaluate(() => {
  const back = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('‹ 返回'))
  back?.click()
})
await page.waitForTimeout(4000)
console.log('probe:', JSON.stringify(await page.evaluate(() => globalThis.__yzjRestore)))
const restored = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')]
    .filter(d => d.scrollHeight > d.clientHeight + 100)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  return el ? el.scrollTop : -1
})
console.log('restored scroll:', restored)
await page.screenshot({ path: '.acceptance/m0/v13-back.png' })
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
