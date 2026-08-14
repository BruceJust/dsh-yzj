/**
 * Verify the drop-to-composer flow (user: "拖到 chat panel 中间就带到
 * composer，和 @ 出来类似，不要卡片不要按钮"):
 *  1. drop band hidden at rest (hero + composer); appears during a yzj drag
 *  2. dropping ANYWHERE on the yzj panel mints a ☁ reference chip in the
 *     composer — same as an '@' pick
 *  3. NO reminder card ('已引用…' gone) and NO quick-action buttons
 *  4. a transient toast confirms the insert
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

const bandVisible = async () => page.evaluate(() =>
  [...document.querySelectorAll('div,span')].some(el =>
    el.childElementCount === 0 && (el.textContent ?? '').includes('松开以插入云之家引用')))
const hintAtRest = async () => page.evaluate(() =>
  [...document.querySelectorAll('div,span')].some(el =>
    el.childElementCount === 0 && (el.textContent ?? '').includes('把云之家内容拖到这里')))

// ---- 1. at rest: clean hero, no strip/band ----
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)
ok('no hint strip at rest (hero)', !(await hintAtRest()))
ok('no band at rest (hero)', !(await bandVisible()))

// ---- 2. open the panel on the chat tab (real messages) ----
await page.getByLabel('云之家悬浮窗').click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)

// ---- 3. drag over the window (band reveals) then DROP ON THE PANEL ----
const drag = await page.evaluate(() => {
  const source = document.querySelector('button[draggable="true"]')
  if (!source) return { ok: false, reason: 'no draggable source' }
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', '{}')
  const fire = (el, type) => {
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
  fire(source, 'dragstart') // React handler fills the real payload
  window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return { ok: true }
})
ok('dragstart + window dragenter dispatched', drag.ok, drag.reason ?? '')
await page.waitForTimeout(400)
ok('band appears while drag is in flight', await bandVisible())

const dropped = await page.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="云之家"]')
  if (!panel) return { ok: false, reason: 'panel missing' }
  const source = document.querySelector('button[draggable="true"]')
  if (!source) return { ok: false, reason: 'no draggable source' }
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', '{}')
  const fire = (el, type) => {
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
  fire(source, 'dragstart')
  fire(panel, 'drop') // drop in the MIDDLE of the chat panel
  window.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return { ok: true }
})
ok('drop dispatched on the panel itself', dropped.ok, dropped.reason ?? '')
await page.waitForTimeout(1200)

// ---- 4. chip in the composer, like '@' ----
const chipCount = await page.locator('[data-decoration="chip"]').count()
const chipLabel = chipCount > 0
  ? await page.locator('[data-decoration="chip"]').first().getAttribute('title').catch(() => '')
  : ''
ok('reference chip minted in the composer', chipCount > 0, `${chipCount} chip(s), label="${chipLabel}"`)
ok('chip carries a yzj title', (chipLabel ?? '').startsWith('☁ '), chipLabel ?? '')

// ---- 5. no reminder card, no quick-action buttons ----
const pageText = await page.evaluate(() => document.body.innerText)
ok('no reminder card ("已引用…" gone)', !pageText.includes('已引用'))
ok('no quick-action buttons (让 agent 总结 gone)', !pageText.includes('让 agent 总结'))
ok('no quick-action buttons (起草回复 gone)', !pageText.includes('起草回复'))

// ---- 6. transient toast confirms the insert ----
const toastText = await dialog.innerText().catch(() => '')
ok('panel toast confirms the insert', toastText.includes('已插入'), toastText.slice(0, 60))

// ---- 7. band hidden again at rest (hero + composer) ----
await dialog.getByRole('button', { name: '关闭' }).click()
await page.waitForTimeout(500)
ok('band hidden at rest after the drag ended', !(await bandVisible()))
await page.getByRole('button', { name: '发送消息' }).first().click().catch(() => {})
await page.waitForTimeout(5000)
ok('no band in COMPOSER at rest', !(await bandVisible()))
const composerDrag = await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', '{}')
  window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
void composerDrag
await page.waitForTimeout(400)
ok('band appears in COMPOSER while dragging', await bandVisible())

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
