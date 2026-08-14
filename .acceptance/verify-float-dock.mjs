/**
 * Verify the floating ball's basic features:
 *  1. ball visible with unread badge (poll works)
 *  2. hover expands the quick-dock with one shortcut per tab
 *  3. dock hides when the mouse leaves
 *  4. a dock shortcut opens the panel directly on that tab
 *  5. ball hides while the panel is open
 */
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
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 250)}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

const ball = page.getByLabel('云之家悬浮窗')
let ballVisible = false
try { await ball.waitFor({ state: 'visible', timeout: 20000 }); ballVisible = true } catch {}
ok('floating ball visible', ballVisible)

// ---- 1. unread badge fills from the poll (real CLI data) ----
await page.waitForTimeout(8000)
const badgeText = await ball.locator('span').first().innerText().catch(() => '')
ok('unread badge filled by poll', badgeText !== '', `badge="${badgeText}"`)

// ---- 2. hover → quick-dock ----
await ball.hover()
await page.waitForTimeout(500)
const dock = page.getByRole('group', { name: '云之家快捷入口' })
let dockVisible = false
try { await dock.waitFor({ state: 'visible', timeout: 5000 }); dockVisible = true } catch {}
ok('hover expands the quick-dock', dockVisible)
const dockItems = await dock.locator('button').count()
ok('dock has 4 tab shortcuts', dockItems === 4, `${dockItems} items`)
const dockLabels = await dock.locator('button').allInnerTexts()
ok('dock labels are 会话/日程/知识库/我的', ['会话', '日程', '知识库', '我的'].every(label => dockLabels.some(text => text.includes(label))), dockLabels.join(','))

// ---- 3. leaving hides the dock ----
await page.mouse.move(10, 10)
await page.waitForTimeout(500)
let dockGone = true
try { await dock.waitFor({ state: 'hidden', timeout: 3000 }) } catch { dockGone = false }
ok('dock hides when the mouse leaves', dockGone)

// ---- 4. dock shortcut opens the panel on that tab ----
await ball.hover()
await page.waitForTimeout(400)
await dock.getByRole('button', { name: '会话' }).click()
const dialog = page.getByRole('dialog', { name: '云之家' })
let opened = false
try { await dialog.waitFor({ state: 'visible', timeout: 15000 }); opened = true } catch {}
ok('dock shortcut opens the panel', opened)
const activeTab = await dialog.locator('nav button[class*="tabActive"]').innerText().catch(() => '')
ok('panel opened directly on 会话 tab', activeTab.includes('会话'), `active="${activeTab}"`)
const ballHidden = await ball.isVisible().catch(() => false)
ok('ball hides while the panel is open', !ballHidden)

// ---- 5. close returns the ball ----
await dialog.getByRole('button', { name: '关闭' }).click()
await page.waitForTimeout(600)
ok('ball returns after closing the panel', await ball.isVisible().catch(() => false))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
