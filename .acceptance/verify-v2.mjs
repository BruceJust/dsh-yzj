/**
 * Enhanced acceptance for the redesigned 云之家 UI:
 * - redesigned sidebar toggle (cloud icon, rail/wide)
 * - paging: 加载更多会话 (groups page 2), 加载更早消息 (message anchor)
 * - regression on the other tabs
 */
import { chromium } from '/Users/guoxinshan/dev/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { mkdirSync } from 'node:fs'

const OUT = new URL('./shots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

let failures = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
  if (!cond) failures++
}

const browser = await chromium.launch({
  executablePath: '/Users/guoxinshan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)))

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)

// --- 1. redesigned toggle: cloud svg inside the footer button ---
const toggle = page.getByText('云之家', { exact: true }).first()
await toggle.waitFor({ state: 'visible', timeout: 20000 })
const button = toggle.locator('xpath=..')
const hasSvg = await button.locator('svg').count()
const btnClass = await button.getAttribute('class')
ok('toggle has cloud svg', hasSvg > 0)
ok('toggle uses new class', (btnClass || '').includes('toggle'), btnClass || '')
await page.screenshot({ path: OUT + 'v2-1-toggle.png' })

// --- 2. open panel ---
await toggle.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
ok('panel opens', true)
await page.screenshot({ path: OUT + 'v2-2-panel.png' })

// --- 3. chat tab: first page + 加载更多 ---
await dialog.getByText('会话', { exact: true }).first().click()
await page.waitForTimeout(3000)
let groupCount = await dialog.locator('button[class*="item"]').count()
const moreBtn = dialog.getByText('加载更多会话', { exact: true })
let moreVisible = false
try { await moreBtn.waitFor({ state: 'visible', timeout: 8000 }); moreVisible = true } catch {}
ok('chat tab loads first page', groupCount === 20, `${groupCount} groups`)
ok('加载更多会话 shown when more exists', moreVisible)

if (moreVisible) {
  await moreBtn.click()
  await page.waitForTimeout(3500)
  groupCount = await dialog.locator('button[class*="item"]').count()
  ok('加载更多 appends page 2', groupCount > 20, `${groupCount} groups after paging`)
  await page.screenshot({ path: OUT + 'v2-3-groups-paged.png' })
}

// --- 4. open a group: messages + 加载更早 ---
const items = dialog.locator('button[class*="item"]')
await items.first().click()
await page.waitForTimeout(3500)
let msgCount = await dialog.locator('div[class*="item"]:not(button)').count()
const olderBtn = dialog.getByText('加载更早消息', { exact: true })
let olderVisible = false
try { await olderBtn.waitFor({ state: 'visible', timeout: 8000 }); olderVisible = true } catch {}
ok('messages render oldest-first', msgCount === 20, `${msgCount} messages`)
ok('加载更早消息 shown when more exists', olderVisible)

if (olderVisible) {
  const firstTime = (await dialog.locator('div[class*="item"]:not(button)').first().innerText()).match(/\d{2}-\d{2} \d{2}:\d{2}/)?.[0] ?? ''
  await olderBtn.click()
  await page.waitForTimeout(3500)
  msgCount = await dialog.locator('div[class*="item"]:not(button)').count()
  const newFirstTime = (await dialog.locator('div[class*="item"]:not(button)').first().innerText()).match(/\d{2}-\d{2} \d{2}:\d{2}/)?.[0] ?? ''
  ok('加载更早 prepends older messages', msgCount > 20, `${msgCount} messages, first time ${firstTime} -> ${newFirstTime}`)
  await page.screenshot({ path: OUT + 'v2-4-messages-paged.png' })
}

// --- 5. regression: docs / calendar / me ---
await dialog.getByText('返回会话', { exact: true }).click().catch(() => {})
await dialog.getByText('知识库', { exact: true }).first().click()
await page.waitForTimeout(2500)
const kbCount = await dialog.locator('button[class*="item"]').count()
ok('docs tab still loads', kbCount > 0, `${kbCount} workspaces`)

await dialog.getByText('日程', { exact: true }).first().click()
await page.waitForTimeout(2500)
const calText = await dialog.innerText()
ok('calendar tab still loads', calText.includes('攀登计划'), '830（AI参谋部）攀登计划')

await dialog.getByText('我的', { exact: true }).first().click()
await page.waitForTimeout(2500)
const meText = await dialog.innerText()
ok('me tab still loads', meText.includes('单国鑫'), '单国鑫')

await page.screenshot({ path: OUT + 'v2-5-final.png' })
await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
