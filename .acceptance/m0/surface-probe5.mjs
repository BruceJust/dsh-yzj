/**
 * The definitive check: make a session non-blank, then look for the view ring
 * and render our pane. The host hides title+tabs while a session is blank
 * (`hideChrome = blank && composerPhase === 'blank'`), so nothing can appear
 * until one message exists.
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const start = page.getByText('新会话', { exact: true }).first()
if (await start.count() > 0) { await start.click(); await page.waitForTimeout(2000) }

const editor = page.locator('[contenteditable="true"], textarea').first()
await editor.click()
await editor.type('hi')
await page.keyboard.press('Enter')
console.log('sent; waiting for the session to stop being blank…')
await page.waitForTimeout(9000)

for (const label of ['融合', '话题', '对话', '轨迹', 'Chat']) {
  console.log(`  ${await page.getByText(label, { exact: true }).count() > 0 ? 'FOUND  ' : 'absent '}${label}`)
}
await page.screenshot({ path: '.acceptance/m0/tabs-visible.png' })

const fused = page.getByText('融合', { exact: true }).first()
if (await fused.count() > 0) {
  await fused.click()
  await page.waitForTimeout(2500)
  console.log('--- fused pane text ---')
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 800))
  await page.screenshot({ path: '.acceptance/m0/fused-pane.png' })
}
console.log('--- errors ---')
console.log(errors.slice(0, 12).join('\n') || '  (none)')
await browser.close()
