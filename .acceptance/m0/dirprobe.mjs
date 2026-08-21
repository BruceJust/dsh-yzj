import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const logs = []
page.on('console', m => logs.push(m.type() + ': ' + m.text()))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const btn = page.locator('button[title*="打开一个本地工作目录"]')
console.log('button count:', await btn.count(), 'disabled:', await btn.first().isDisabled())
await btn.first().click()
await page.waitForTimeout(4000)
console.log('after click, label:', await btn.first().innerText())
console.log('logs:', logs.filter(l => l.startsWith('error')).slice(0,3))
await browser.close()
