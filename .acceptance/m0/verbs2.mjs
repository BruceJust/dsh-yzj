import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 催一下 on the board
await page.locator('button', { hasText: '承诺板' }).first().click()
await page.waitForTimeout(2000)
const remind = page.locator('button', { hasText: '催一下' }).first()
await remind.click()
await page.waitForTimeout(4000)
const toast = await page.locator('[class*="toast"]').allInnerTexts()
console.log('remind toast:', toast.join(' | ') || '(none)')
await page.screenshot({ path: '.acceptance/m0/v5-remind.png' })

// 作废 a zombie terminal task
await page.locator('button', { hasText: '返回会话' }).first().click()
await page.waitForTimeout(1200)
await page.locator('nav[aria-label="收件箱"] button').nth(5).click()
await page.waitForTimeout(4000)
const reason = page.locator('input[placeholder="打回/作废的原因"]').first()
if (await reason.count()) {
  await reason.fill('模型连不上，这一轮没有产出')
  await page.locator('button', { hasText: '作废' }).first().click()
  await page.waitForTimeout(4000)
  console.log('void toast:', (await page.locator('[class*="toast"]').allInnerTexts()).join(' | ') || '(none)')
}
await page.screenshot({ path: '.acceptance/m0/v5-void.png' })
console.log('console errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
