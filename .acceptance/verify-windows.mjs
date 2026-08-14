/**
 * Windows acceptance for the yzj plugin inside a real dsh web instance
 * (http://127.0.0.1:3090, web profile with the yzj bundle installed).
 * Verifies: plugin mount (云之家 toggle), panel open + four tabs, graceful
 * error degradation without a yzj-cli login, and the '@' menu structure.
 * Uses the system Chrome; no bundled browser download needed.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots-win')
mkdirSync(OUT, { recursive: true })
const shot = (name) => join(OUT, name)

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

if (CHROME === undefined) {
  console.error('no system Chrome/Edge found; cannot run browser acceptance')
  process.exit(2)
}

let failures = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
  if (!cond) failures++
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

// --- 1. plugin mount: the 云之家 toggle in the sidebar footer ---
const toggle = page.getByText('云之家', { exact: true }).first()
let toggleVisible = false
try { await toggle.waitFor({ state: 'visible', timeout: 20000 }); toggleVisible = true } catch {}
ok('yzj plugin mounted: 云之家 toggle visible', toggleVisible)
await page.screenshot({ path: shot('1-mounted.png') })

// --- 2. open the panel: four tabs ---
await toggle.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
let dialogVisible = false
try { await dialog.waitFor({ state: 'visible', timeout: 15000 }); dialogVisible = true } catch {}
ok('panel opens', dialogVisible)
await page.screenshot({ path: shot('2-panel.png') })
const bodyText = await dialog.innerText().catch(() => '')
ok('panel has four tabs', ['知识库', '日程', '会话', '我的'].every(tab => bodyText.includes(tab)), bodyText.slice(0, 120).replace(/\n/g, ' '))

// --- 3. tab loads: graceful degradation without yzj-cli ---
for (const tab of ['知识库', '日程', '会话', '我的']) {
  await dialog.locator('nav button').filter({ hasText: tab }).first().click()
  await page.waitForTimeout(2500)
  const text = await dialog.innerText().catch(() => '')
  // Without a logged-in yzj-cli the bridge fails; the panel must show an
  // error banner or an empty state — never a crash.
  const crashed = pageErrors.length > 0
  ok(`tab ${tab} degrades gracefully`, !crashed, text.includes('加载') ? 'loading/error state shown' : text.slice(0, 60).replace(/\n/g, ' '))
}
await page.screenshot({ path: shot('3-tabs.png') })

// --- 4. '@' menu structure (groups may be empty without a CLI) ---
// The open overlay panel covers the composer by design; close it first.
await page.getByText('云之家', { exact: true }).first().click()
await page.waitForTimeout(800)
const draft = page.locator('textarea').first()
await draft.click()
await draft.pressSequentially('@', { delay: 60 })
await page.waitForTimeout(1500)
const menuText = await page.locator('[role="listbox"]').innerText().catch(() => '')
ok('@ menu opens without crashing', pageErrors.length === 0, menuText.slice(0, 80).replace(/\n/g, ' '))
const hasGroups = ['同事', '会话', '文档'].filter(name => menuText.includes(name))
console.log(`INFO  @ menu groups visible: ${hasGroups.length}/3 (${hasGroups.join(', ') || 'none'})`)
await page.screenshot({ path: shot('4-at-menu.png') })
await draft.press('Escape')

// --- 5. no page errors through the whole session ---
ok('no page errors during acceptance', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
