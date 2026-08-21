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
console.log('composer present:', await page.locator('textarea').count())
console.log('anchor:', (await page.getByText('落点').first().innerText().catch(()=>'missing')))
// hover a message to reveal the verbs
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => b.textContent?.includes('↩ 回复'))
  return btns.length
}).then(n => console.log('↩ 回复 buttons in DOM:', n))
await page.screenshot({ path: '.acceptance/m0/v14-place.png' })
// plain message to the main thread
await page.locator('textarea').first().fill('大家好，我在桌面这边试一下群里发言。')
await page.getByRole('button', { name: /发到群里/ }).first().click()
await page.waitForTimeout(6000)
console.log('after plain send, toast:', await page.locator('[class*="toast"]').innerText().catch(()=>'none'))
await page.screenshot({ path: '.acceptance/m0/v14-sent.png' })
console.log('errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
