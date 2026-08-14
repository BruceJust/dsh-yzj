/**
 * Verify the wide two-pane redesign:
 *  1. panel is wide (list left, content right)
 *  2. chat: left groups, right messages
 *  3. calendar: month grid + day events + event detail
 *  4. docs: left workspaces, right docs list → doc preview
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
await page.getByLabel('云之家悬浮窗').click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })

// ---- 1. wide two-pane shell ----
const panelBox = await dialog.boundingBox()
ok('panel is wide (>700px)', panelBox !== null && panelBox.width > 700, `width=${Math.round(panelBox?.width ?? 0)}`)
const panes = await dialog.locator('[class*="paneLeft"], [class*="paneRight"]').count()
ok('two-pane shell renders', panes === 2, `${panes} panes`)

// ---- 2. chat tab: left groups + right messages ----
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
const leftGroups = await dialog.locator('[class*="paneLeft"] button[class*="item"]').count()
ok('left pane lists groups', leftGroups > 0, `${leftGroups} groups`)
await dialog.locator('[class*="paneLeft"] button[class*="item"]').filter({ hasText: '灵基Chat' }).first().click()
await page.waitForTimeout(3500)
const rightMessages = await dialog.locator('[class*="paneRight"] [class*="msgRow"]').count()
ok('right pane shows messages', rightMessages > 0, `${rightMessages} messages`)
const composerInRight = await dialog.locator('[class*="paneRight"] textarea[class*="composerInput"]').count()
ok('composer sits in the right pane', composerInRight === 1)

// ---- 3. calendar tab: month grid, day events, event detail ----
await dialog.locator('nav button').filter({ hasText: '日程' }).first().click()
await page.waitForTimeout(4000)
const calCells = await dialog.locator('button[class*="calCell"]').count()
ok('month grid renders day cells', calCells >= 28, `${calCells} cells`)
const calNav = await dialog.locator('button[class*="calNav"]').count()
ok('month navigation buttons render', calNav === 2)
// click today's cell (label is today's date)
const today = new Date()
const pad = (n) => String(n).padStart(2, '0')
const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
const todayCell = dialog.locator(`button[class*="calCell"][aria-label="${todayKey}"]`)
let todayClicked = false
try { await todayCell.click(); todayClicked = true } catch {}
ok('today cell is clickable', todayClicked)
await page.waitForTimeout(1200)
const dayEvents = await dialog.locator('[class*="paneRight"] button[class*="item"]').count()
const emptyText = await dialog.locator('[class*="paneRight"]').innerText().catch(() => '')
ok('right pane shows the day (events or empty)', dayEvents > 0 || emptyText.includes('暂无日程'), `${dayEvents} events`)
if (dayEvents > 0) {
  await dialog.locator('[class*="paneRight"] button[class*="item"]').first().click()
  await page.waitForTimeout(1200)
  const detail = await dialog.locator('[class*="eventDetail"]').count()
  ok('event detail card renders', detail >= 1)
}
// prev month navigation
await dialog.getByRole('button', { name: '上个月' }).click()
await page.waitForTimeout(2000)
const title = await dialog.locator('[class*="calTitle"]').innerText().catch(() => '')
const expected = `${today.getFullYear()}年${today.getMonth() === 0 ? 12 : today.getMonth()}月`
ok('prev month navigation updates the grid', title === expected, title)

// ---- 4. docs tab: workspaces left, docs right, preview ----
await dialog.locator('nav button').filter({ hasText: '知识库' }).first().click()
await page.waitForTimeout(4000)
const leftWorkspaces = await dialog.locator('[class*="paneLeft"] button[class*="item"]').count()
ok('left pane lists workspaces', leftWorkspaces > 0, `${leftWorkspaces} workspaces`)
await dialog.locator('[class*="paneLeft"] button[class*="item"]').first().click()
await page.waitForTimeout(3500)
const rightDocs = await dialog.locator('[class*="paneRight"] button[class*="item"]').count()
ok('right pane lists the workspace docs', rightDocs > 0, `${rightDocs} docs`)
const firstDocTitle = rightDocs > 0
  ? await dialog.locator('[class*="paneRight"] button[class*="item"]').first().innerText().catch(() => '')
  : ''
await dialog.locator('[class*="paneRight"] button[class*="item"]').first().click().catch(() => {})
await page.waitForTimeout(3500)
const docBody = await dialog.locator('[class*="docBody"]').count()
ok('doc preview renders in the right pane', docBody === 1, firstDocTitle.replace(/\n/g, ' ').slice(0, 30))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
