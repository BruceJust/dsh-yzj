/**
 * Verify the drop-band fix + post-drop reminder UX:
 *  1. drop band renders in the HERO phase (brand-new session) — the bug fix
 *  2. synthetic drag of a yzj item mints a reference chip in the draft
 *  3. the reminder banner appears with the count + quick instructions
 *  4. a quick action fills the draft with instruction text
 *  5. the band persists in the composer phase (after sending)
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

const bandVisible = async () => {
  return page.evaluate(() => {
    // The band's text lives in a LEAF span (icon is a sibling) — matching
    // leaf elements avoids ancestor containers whose textContent includes
    // the whole conversation.
    const band = [...document.querySelectorAll('div,span')].find(el =>
      el.childElementCount === 0 && (el.textContent ?? '').includes('把云之家内容拖到这里'))
    if (!band) return false
    const rect = band.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
}

// ---- 1. hero phase: band must exist (the fix) ----
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)
ok('drop band visible in HERO phase (new session)', await bandVisible())

// ---- 2. open panel, synthetic drag, expect chip + reminder ----
const ball = page.getByLabel('云之家悬浮窗')
let opened = false
try { await ball.waitFor({ state: 'visible', timeout: 20000 }); opened = true } catch {}
ok('floating ball visible', opened)
await ball.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
try { await dialog.waitFor({ state: 'visible', timeout: 15000 }) } catch {}
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
const draggableCount = await dialog.locator('button[draggable="true"]').count()
ok('panel lists draggable items', draggableCount > 0, `${draggableCount} items`)

const dropResult = await page.evaluate(() => {
  const leaf = [...document.querySelectorAll('div,span')].find(el =>
    el.childElementCount === 0 && (el.textContent ?? '').includes('把云之家内容拖到这里'))
  if (!leaf) return { ok: false, reason: 'band missing at drop time' }
  // The drop band div is the leaf's closest draggable-registered ancestor.
  const band = leaf.parentElement ?? leaf
  const source = document.querySelector('button[draggable="true"]')
  if (!source) return { ok: false, reason: 'no draggable source' }
  const payload = JSON.stringify({
    kind: 'message', id: 'fake-msg-verify', title: '测试引用', sub: '验证', group: '',
  })
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', payload)
  const fire = (el, type) => {
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
  fire(source, 'dragstart')
  fire(band, 'dragenter')
  fire(band, 'dragover')
  fire(band, 'drop')
  fire(source, 'dragend')
  return { ok: true }
})
ok('synthetic drag dispatched', dropResult.ok, dropResult.reason ?? '')

await page.waitForTimeout(1200)
const chipCount = await page.locator('[data-decoration="chip"]').count()
const chipLabel = chipCount > 0
  ? await page.locator('[data-decoration="chip"]').first().getAttribute('title').catch(() => '')
  : ''
ok('reference chip rendered in draft', chipCount > 0, `${chipCount} chip(s), label="${chipLabel}"`)
ok('chip carries a yzj title', (chipLabel ?? '').startsWith('☁ ') && (chipLabel ?? '').length > 2, chipLabel ?? '')

const reminderText = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')].find(n =>
    (n.textContent ?? '').includes('已引用'))
  return el === undefined ? '' : el.textContent ?? ''
})
ok('reminder banner shows count', reminderText.includes('已引用 1 条云之家内容'), reminderText.slice(0, 60))

// ---- 3. quick action fills the draft ----
const quick = page.getByRole('button', { name: '让 agent 总结' })
let quickClicked = false
try { await quick.waitFor({ state: 'visible', timeout: 5000 }); await quick.click(); quickClicked = true } catch {}
ok('quick action clickable', quickClicked)
await page.waitForTimeout(800)
const draftText = await page.locator('textarea').first().inputValue().catch(() => '')
ok('quick action filled the draft', draftText.includes('请总结上面引用的云之家内容'), draftText.slice(0, 60))
ok('reminder dismissed after quick action', !(await page.evaluate(() =>
  [...document.querySelectorAll('[role="status"]')].some(n => (n.textContent ?? '').includes('已引用')))))

// ---- 4. composer phase: band persists after sending ----
await page.getByRole('button', { name: '发送消息' }).first().click().catch(() => {})
await page.waitForTimeout(5000)
ok('drop band visible in COMPOSER phase (after send)', await bandVisible())

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
