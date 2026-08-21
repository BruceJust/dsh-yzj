import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.locator('button[title*="打开一个本地工作目录"]').first().click()
await page.waitForTimeout(2500)
await page.screenshot({ path: '.acceptance/m0/v11-picker.png' })
// register a real directory by typing its absolute path
await page.locator('input[placeholder="/Users/you/project"]').fill('/Users/Apple/Documents/project/dsh-yzj')
await page.locator('button', { hasText: '用这个目录' }).click()
await page.waitForTimeout(6000)
await page.screenshot({ path: '.acceptance/m0/v11-after.png' })
const local = await page.locator('[class*="sidebar_itemTitle"]').allInnerTexts()
console.log('sidebar titles:', JSON.stringify(local.slice(-6)))
console.log('errors:', errors.length ? errors.slice(0,2) : 'none')
await browser.close()
