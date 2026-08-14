/** Verify: after sending one message (leaving hero), the drop band appears. */
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
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)

const draft = page.locator('textarea').first()
await draft.click()
await draft.fill('你好')
await page.getByRole('button', { name: '发送消息' }).first().click()
await page.waitForTimeout(4000)

const hasDock = await page.evaluate(() => document.body.innerText.includes('把云之家内容拖到这里'))
console.log(`drop band after one message: ${hasDock}`)
await browser.close()
