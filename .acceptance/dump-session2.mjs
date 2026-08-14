/** Diagnostic v2: open the test conversation and dump its content. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

// Enter the test conversation by title.
await page.getByText('向群发送确认卡测试消息', { exact: false }).first().click()
await page.waitForTimeout(3000)

const body = await page.evaluate(() => document.body.innerText)
const lines = body.split('\n')
console.log('--- full body (tail 6000) ---')
console.log(lines.slice(-300).join('\n').slice(-6000))
await browser.close()
