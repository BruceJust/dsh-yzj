/** Quick check: floating ball appears, opens the panel, unread badge shows. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

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

const ball = page.getByLabel('云之家悬浮窗')
let ballVisible = false
try { await ball.waitFor({ state: 'visible', timeout: 20000 }); ballVisible = true } catch {}
ok('floating ball visible', ballVisible)

// Wait for the unread poll to fill the badge (real CLI data).
await page.waitForTimeout(4000)
const badge = await page.locator('[aria-label="云之家悬浮窗"] span').first().innerText().catch(() => '')
ok('floating ball shows an unread badge', badge !== '', `badge="${badge}"`)

await ball.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
let opened = false
try { await dialog.waitFor({ state: 'visible', timeout: 15000 }); opened = true } catch {}
ok('clicking the ball opens the panel', opened)
const ballHidden = await page.getByLabel('云之家悬浮窗').isVisible().catch(() => false)
ok('ball hides while the panel is open', !ballHidden)

// Regression: tabs still work.
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
const groupCount = await dialog.locator('button[class*="item"]').count()
ok('chat tab still lists real groups', groupCount > 0, `${groupCount} groups`)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
