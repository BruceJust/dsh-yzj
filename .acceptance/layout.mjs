/** Layout diagnostic: open the panel and dump tab/list geometry. */
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

const toggle = page.getByText('云之家', { exact: true }).first()
await toggle.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })

const info = await page.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="云之家"]')
  const overlay = document.querySelector('[data-shell-overlay="true"]')
  const dump = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return { left: r.left, top: r.top, width: r.width, height: r.height, pe: style.pointerEvents, z: style.zIndex, pos: style.position }
  }
  const tabs = [...document.querySelectorAll('[role="dialog"] button')].map(b => {
    const r = b.getBoundingClientRect()
    return { text: b.textContent.trim().slice(0, 10), left: r.left, top: r.top, w: r.width, h: r.height }
  })
  return { panel: dump(panel), overlay: dump(overlay), tabs }
})

console.log(JSON.stringify(info, null, 2))
await browser.close()
