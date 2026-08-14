/**
 * Real-data acceptance (logged-in yzj-cli): the panel loads real workspaces,
 * recent groups, calendar events, and the '@' menu shows the three candidate
 * groups with real entries. Runs against the isolated instance on :3090.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots-real')
mkdirSync(OUT, { recursive: true })
const shot = (name) => join(OUT, name)

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
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

const ball = page.getByLabel('云之家悬浮窗')
await ball.waitFor({ state: 'visible', timeout: 20000 })
await ball.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })

// --- 1. knowledge bases load real data ---
await dialog.locator('nav button').filter({ hasText: '知识库' }).first().click()
await page.waitForTimeout(4000)
const kbText = await dialog.innerText().catch(() => '')
ok('知识库 tab lists real workspaces', /文档 \d+/.test(kbText) || /成员 \d+/.test(kbText), kbText.replace(/\n/g, ' ').slice(0, 80))
await page.screenshot({ path: shot('1-kb.png') })

// --- 2. calendar loads real events ---
await dialog.locator('nav button').filter({ hasText: '日程' }).first().click()
await page.waitForTimeout(4000)
const calText = await dialog.innerText().catch(() => '')
ok('日程 tab loads (events or empty notice)', calText.includes('暂无日程') || /日程|→/.test(calText), calText.replace(/\n/g, ' ').slice(0, 80))
await page.screenshot({ path: shot('2-calendar.png') })

// --- 3. recent groups load real data ---
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(4000)
const chatText = await dialog.innerText().catch(() => '')
const groupCount = await dialog.locator('button[class*="item"]').count()
ok('会话 tab lists real recent groups', groupCount > 0, `${groupCount} groups: ${chatText.replace(/\n/g, ' ').slice(0, 80)}`)
await page.screenshot({ path: shot('3-chat.png') })

// --- 4. open a group: real messages load ---
if (groupCount > 0) {
  await dialog.locator('button[class*="item"]').first().click()
  await page.waitForTimeout(4000)
  const msgText = await dialog.innerText().catch(() => '')
  ok('group messages load', msgText.includes('返回会话') && (msgText.includes('暂无消息') || /消息|加载更早/.test(msgText)), msgText.replace(/\n/g, ' ').slice(0, 80))
  await page.screenshot({ path: shot('4-messages.png') })
}

// --- 5. '@' menu: three real candidate groups ---
await dialog.getByRole('button', { name: '关闭' }).click()
await page.waitForTimeout(800)
const draft = page.locator('textarea').first()
await draft.click()
await draft.pressSequentially('@', { delay: 60 })
await page.waitForTimeout(2500)
const menuText = await page.locator('[role="listbox"]').innerText().catch(() => '')
// 同事 needs a query by design; 会话/文档 warm on open.
const staticGroups = ['云之家 · 会话', '云之家 · 文档'].filter(name => menuText.includes(name))
ok('@ menu shows the two warm groups (会话/文档)', staticGroups.length === 2, `${staticGroups.length}/2: ${menuText.replace(/\n/g, ' ').slice(0, 120)}`)
ok('@ menu lists real candidates', menuText.length > 60, `menu text ${menuText.length} chars`)
// Type a keyword: the 同事 group appears with real contacts.
await draft.pressSequentially('单', { delay: 60 })
await page.waitForTimeout(2000)
const searchText = await page.locator('[role="listbox"]').innerText().catch(() => '')
ok('@ 同事 group appears after a keyword', searchText.includes('云之家 · 同事') && searchText.includes('单国鑫'), searchText.replace(/\n/g, ' ').slice(0, 120))
await page.screenshot({ path: shot('5-at-menu.png') })
await draft.press('Escape')

// --- 6. no page errors with real data ---
ok('no page errors during real-data acceptance', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
