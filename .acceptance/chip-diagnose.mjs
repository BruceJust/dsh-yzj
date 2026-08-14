/** Diagnose: drag a message chip into the composer, dump the DOM around it. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`))
page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[console.error] ${msg.text().slice(0, 250)}`) })

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

// Ensure a conversation is open (composer visible).
await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)

// Open the panel → chat tab → first group → drag the first message to the drop band.
await page.getByLabel('云之家悬浮窗').click().catch(async () => { await page.getByText('云之家', { exact: true }).first().click() })
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
await dialog.locator('button[class*="item"]').first().click()
await page.waitForTimeout(3000)

const band = page.locator('text=把云之家内容拖到这里').first()
await band.waitFor({ state: 'visible', timeout: 8000 })
const msgItem = dialog.locator('div[class*="msgItem"]').first()
await msgItem.waitFor({ state: 'visible', timeout: 8000 })

await page.evaluate(() => {
  const src = document.querySelector('[role="dialog"] div[class*="msgItem"]')
  const dst = document.querySelector('[class*="dropBand"]')
  if (!src || !dst) return
  const dt = new DataTransfer()
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  dst.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await page.waitForTimeout(1500)

// Dump the composer region HTML to see what the chip became.
const report = await page.evaluate(() => {
  const textarea = document.querySelector('textarea')
  const composer = textarea?.closest('[class*="composer"], [data-phase]')?.parentElement ?? textarea?.parentElement
  const draft = (textarea && 'value' in textarea) ? textarea.value : ''
  const chipEls = document.querySelectorAll('[class*="chip" i], [class*="reference" i], [class*="mention" i], [class*="reminder" i]')
  return {
    draft: draft.slice(0, 200),
    chipCount: chipEls.length,
    chipSamples: [...chipEls].slice(0, 5).map(el => `${el.tagName}.${String(el.className).slice(0, 70)} text=${(el.textContent || '').slice(0, 40)}`),
    composerHtml: composer ? composer.outerHTML.slice(0, 1200) : '(no composer)',
  }
})
console.log(JSON.stringify(report, null, 2))
await browser.close()
