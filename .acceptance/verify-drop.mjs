/**
 * Verify the drag-to-composer flow (full-viewport drop overlay):
 *  1. nothing visible at rest
 *  2. while a yzj drag is in flight, a full-screen overlay invites the drop
 *  3. dropping ANYWHERE (the overlay) mints a ☁ reference chip in the
 *     composer — same as an '@' pick
 *  4. no reminder card, no quick-action buttons
 *  5. a transient toast confirms the insert; the overlay hides on dragend
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

const overlayVisible = async () => page.evaluate(() =>
  [...document.querySelectorAll('div')].some(el =>
    (el.textContent ?? '').includes('松开以插入云之家引用') && el.getBoundingClientRect().width > 0))
const idleHints = async () => page.evaluate(() =>
  [...document.querySelectorAll('div,span')].some(el =>
    el.childElementCount === 0 && (el.textContent ?? '').includes('把云之家内容拖到这里')))

// ---- 1. at rest: clean ----
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)
ok('no idle hint at rest', !(await idleHints()))
ok('no overlay at rest', !(await overlayVisible()))

// ---- 2. open the panel (drag sources live here) ----
await page.getByLabel('云之家悬浮窗').click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)

// ---- 3. drag in flight → full-screen overlay ----
const drag = await page.evaluate(() => {
  const source = document.querySelector('button[draggable="true"]')
  if (!source) return { ok: false, reason: 'no draggable source' }
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', '{}')
  const fire = (el, type) => {
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
  fire(source, 'dragstart') // React handler fills the real payload
  document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return { ok: true }
})
ok('dragstart + window dragenter dispatched', drag.ok, drag.reason ?? '')
await page.waitForTimeout(400)
ok('full-screen overlay appears while dragging', await overlayVisible())

// ---- 4. drop on the OVERLAY (anywhere on screen) → chip ----
const dropped = await page.evaluate(() => {
  const overlay = [...document.querySelectorAll('div')].find(el =>
    (el.textContent ?? '').includes('松开以插入云之家引用') && String(el.className).includes('dropOverlay'))
  if (!overlay) return { ok: false, reason: 'overlay missing' }
  const source = document.querySelector('button[draggable="true"]')
  if (!source) return { ok: false, reason: 'no draggable source' }
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', '{}')
  const fire = (el, type) => {
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
  fire(source, 'dragstart')
  fire(overlay, 'drop') // drop in the middle of the chat panel — anywhere
  document.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return { ok: true }
})
ok('drop dispatched on the overlay', dropped.ok, dropped.reason ?? '')
await page.waitForTimeout(1200)

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

// ---- 6. toast confirms; overlay hides ----
const toastText = await dialog.innerText().catch(() => '')
ok('panel toast confirms the insert', toastText.includes('已插入'), toastText.slice(0, 60))
ok('overlay hidden after the drag ended', !(await overlayVisible()))

// ---- 7. the sent message renders the reference as a special @yzj tag ----
await page.getByRole('button', { name: '发送消息' }).first().click().catch(() => {})
await page.waitForTimeout(12000)
const chips = await page.locator('[data-ref-chip]').allInnerTexts().catch(() => [])
ok('sent message renders the @yzj reference tag', chips.some(text => text.trim() === '@yzj'), chips.join(',') || '(none)')

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
