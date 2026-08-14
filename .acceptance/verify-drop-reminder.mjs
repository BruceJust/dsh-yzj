/**
 * Verify the clean-composer changes:
 *  1. no persistent "拖到这里" hint strip at rest (hero + composer)
 *  2. floating ball removed; the sidebar 云之家 button still opens the panel
 *  3. the band appears only while a yzj drag is in flight (window dragenter)
 *  4. drop still mints a reference chip + reminder + quick actions work
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

const restHasHint = async () => page.evaluate(() =>
  [...document.querySelectorAll('div,span')].some(el =>
    el.childElementCount === 0 && (el.textContent ?? '').includes('把云之家内容拖到这里')))

const restHasBand = async () => page.evaluate(() =>
  [...document.querySelectorAll('div,span')].some(el =>
    el.childElementCount === 0 && (el.textContent ?? '').includes('松开以插入云之家引用')))

// ---- 1. hero: nothing at rest, no floating ball ----
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)
ok('no hint strip in HERO at rest', !(await restHasHint()))
ok('no band in HERO at rest', !(await restHasBand()))
ok('floating ball removed', (await page.getByLabel('云之家悬浮窗').count()) === 0)

// ---- 2. sidebar button still opens the panel ----
const side = page.getByRole('button', { name: '云之家' }).first()
let sideOpened = false
try { await side.waitFor({ state: 'visible', timeout: 15000 }); await side.click() } catch {}
const dialog = page.getByRole('dialog', { name: '云之家' })
try { await dialog.waitFor({ state: 'visible', timeout: 15000 }); sideOpened = true } catch {}
ok('sidebar 云之家 button opens the panel', sideOpened)
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
const draggableCount = await dialog.locator('button[draggable="true"]').count()
ok('panel lists draggable items', draggableCount > 0, `${draggableCount} items`)

// ---- 3. drag in flight → band appears; drop → chip + reminder ----
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
await page.waitForTimeout(500)
ok('band appears while drag is in flight', await restHasBand())

const drop = await page.evaluate(() => {
  const band = [...document.querySelectorAll('div,span')].find(el =>
    el.childElementCount === 0 && (el.textContent ?? '').includes('松开以插入云之家引用'))
  if (!band) return { ok: false, reason: 'band missing at drop time' }
  const source = document.querySelector('button[draggable="true"]')
  if (!source) return { ok: false, reason: 'no draggable source' }
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', '{}')
  const fire = (el, type) => {
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
  fire(source, 'dragstart')
  fire(band.parentElement ?? band, 'drop')
  window.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return { ok: true }
})
ok('drop dispatched on the revealed band', drop.ok, drop.reason ?? '')
await page.waitForTimeout(1200)

const chipCount = await page.locator('[data-decoration="chip"]').count()
const chipLabel = chipCount > 0
  ? await page.locator('[data-decoration="chip"]').first().getAttribute('title').catch(() => '')
  : ''
ok('reference chip rendered in draft', chipCount > 0, `${chipCount} chip(s), label="${chipLabel}"`)
ok('chip carries a yzj title', (chipLabel ?? '').startsWith('☁ '), chipLabel ?? '')

const reminderText = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')].find(n =>
    (n.textContent ?? '').includes('已引用'))
  return el === undefined ? '' : el.textContent ?? ''
})
ok('reminder banner shows count', reminderText.includes('已引用 1 条云之家内容'), reminderText.slice(0, 50))

// ---- 4. quick action + band gone at rest after drop ----
const quick = page.getByRole('button', { name: '让 agent 总结' })
let quickClicked = false
try { await quick.waitFor({ state: 'visible', timeout: 5000 }); await quick.click(); quickClicked = true } catch {}
ok('quick action clickable', quickClicked)
await page.waitForTimeout(800)
const draftText = await page.locator('textarea').first().inputValue().catch(() => '')
ok('quick action filled the draft', draftText.includes('请总结上面引用的云之家内容'), draftText.slice(0, 50))
ok('band hidden at rest after the drag ended', !(await restHasBand()))

// ---- 5. composer phase: still hidden at rest, appears on drag ----
await page.getByRole('button', { name: '发送消息' }).first().click().catch(() => {})
await page.waitForTimeout(5000)
ok('no hint strip in COMPOSER at rest', !(await restHasHint()))
ok('no band in COMPOSER at rest', !(await restHasBand()))
const composerDrag = await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', '{}')
  window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
void composerDrag
await page.waitForTimeout(400)
ok('band appears in COMPOSER while dragging', await restHasBand())

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
