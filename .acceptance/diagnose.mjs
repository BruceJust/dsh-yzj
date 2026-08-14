/** Diagnostic: load the test instance and dump console/page errors. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleLogs = []
page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`))
page.on('pageerror', (e) => consoleLogs.push(`[pageerror] ${String(e).slice(0, 500)}`))
page.on('requestfailed', (req) => consoleLogs.push(`[reqfail] ${req.url()} :: ${req.failure()?.errorText}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)

const toggleCount = await page.getByText('云之家', { exact: true }).count()
console.log(`toggle count: ${toggleCount}`)
const sidebarText = await page.locator('aside, [class*="sidebar"]').first().innerText().catch(() => '(no sidebar)')
console.log(`sidebar text: ${sidebarText.slice(0, 200).replace(/\n/g, ' | ')}`)
console.log('--- console/page errors ---')
for (const line of consoleLogs.slice(0, 30)) console.log(line)
await browser.close()
