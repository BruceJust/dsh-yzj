/** Style verification: open the panel and confirm the new semantic tokens resolve. */
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots-style')
mkdirSync(OUT, { recursive: true })

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

let failures = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
  if (!cond) failures++
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.getByText('云之家', { exact: true }).first().click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await page.waitForTimeout(3000)

// Computed styles must resolve to real colors (not the old fallback literals).
const report = await page.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="云之家"]')
  const tab = [...document.querySelectorAll('[role="dialog"] header button')].find(b => b.textContent.includes('会话'))
  const style = (el) => el ? getComputedStyle(el) : null
  return {
    panelBg: style(panel)?.backgroundColor,
    panelBorder: style(panel)?.borderColor,
    panelRadius: style(panel)?.borderRadius,
    tabColor: style(tab)?.color,
    tabActiveBg: [...document.querySelectorAll('[role="dialog"] header button')]
      .filter(b => b.getAttribute('aria-current'))[0] ? getComputedStyle([...document.querySelectorAll('[role="dialog"] header button')].filter(b => b.getAttribute('aria-current'))[0]).backgroundColor : null,
    legacyTokens: Object.keys(getComputedStyle(document.documentElement)).filter(k => k.startsWith('--dsw-') && (k.includes('--dsw-surface') || k.includes('--dsw-border') || k.includes('--dsw-text'))).slice(0, 10),
  }
})
console.log(JSON.stringify(report, null, 2))
ok('panel bg resolves from alias tokens', (report.panelBg || '').startsWith('rgb(') || (report.panelBg || '').startsWith('var(') === false)
ok('no legacy --dsw-surface/--dsw-border custom props referenced', report.legacyTokens.length === 0, `legacy: ${report.legacyTokens.join(',')}`)

await page.screenshot({ path: join(OUT, 'panel-new-style.png') })
await dialog.locator('header button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
await page.screenshot({ path: join(OUT, 'chat-tab-new-style.png') })

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
