/** Hit-test diagnostic: what element sits at the 会话 tab's click point? */
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
await page.getByText('云之家', { exact: true }).first().click()
await page.getByRole('dialog', { name: '云之家' }).waitFor({ state: 'visible', timeout: 15000 })
await page.waitForTimeout(2000)

const report = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes('会话'))
  if (!tab) return { error: 'no tab' }
  const r = tab.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  const at = document.elementFromPoint(x, y)
  const chain = []
  let el = at
  while (el && chain.length < 8) {
    const cls = typeof el.className === 'string' ? el.className : ''
    chain.push(`${el.tagName}.${cls.slice(0, 60)}`)
    el = el.parentElement
  }
  return { tabRect: { left: r.left, top: r.top, w: r.width, h: r.height }, at: at ? { tag: at.tagName, cls: String(at.className).slice(0, 80), text: (at.textContent || '').slice(0, 30) } : null, chain }
})
console.log(JSON.stringify(report, null, 2))
await browser.close()
