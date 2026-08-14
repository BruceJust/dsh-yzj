/** Minimal probe: what does the composer area render? */
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
await page.waitForTimeout(3000)

const report = await page.evaluate(() => {
  const ta = document.querySelector('textarea')
  const all = document.body.innerText
  return {
    hasTextarea: ta !== null,
    hasDropBand: !!document.querySelector('[class*="dropBand"]'),
    hasDock: all.includes('把云之家内容拖到这里'),
    composerText: all.split('\n').filter(l => l.includes('拖到') || l.includes('composer') || l.includes('描述你想要')).slice(0, 5),
  }
})
console.log(JSON.stringify(report, null, 2))
await browser.close()
