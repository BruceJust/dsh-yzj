import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.locator('nav[aria-label="收件箱"] button[title*="群视图"]').first().click()
await page.waitForTimeout(6000)
// scroll deep, so Back has something to restore
const scrolled = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')]
    .filter(d => d.scrollHeight > d.clientHeight + 100)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  if (!el) return 0
  el.scrollTop = 600
  return el.scrollTop
})
console.log('scrolled to:', scrolled)
// open a topic from 更早的话题
await page.getByRole('button', { name: /更早的话题/ }).first().click()
await page.waitForTimeout(800)
await page.locator('button').filter({ hasText: '🧵' }).first().click()
await page.waitForTimeout(5500)
console.log('back button count:', await page.getByRole('button', { name: /返回/ }).count())
await page.screenshot({ path: '.acceptance/m0/v13-topic.png' })
await page.getByRole('button', { name: /‹ 返回/ }).first().click()
await page.waitForTimeout(3500)
const restored = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')]
    .filter(d => d.scrollHeight > d.clientHeight + 100)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  return el ? el.scrollTop : -1
})
console.log('restored scroll:', restored)
await page.screenshot({ path: '.acceptance/m0/v13-back.png' })
console.log('probe:', JSON.stringify(await page.evaluate(() => globalThis.__yzjRestore)))
console.log('errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
