/** Full console + error capture while opening a conversation. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text().slice(0, 400)}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 600)}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(4000)

const report = await page.evaluate(() => {
  const ta = document.querySelector('textarea')
  const composer = ta?.closest('[data-phase]')?.parentElement
  return {
    textarea: ta !== null,
    composerChildren: composer ? [...composer.children].map(c => `${c.tagName}.${String(c.className).slice(0, 60)}`) : [],
  }
})
console.log(JSON.stringify(report, null, 2))
console.log('--- logs ---')
for (const line of logs.slice(0, 40)) console.log(line)
await browser.close()
