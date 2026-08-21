/**
 * Open a session and look at the view tab bar. This is the question the whole
 * segment turns on: does 「融合」 appear beside Chat, and does it render.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// Start a session so the session-scoped slots have something to attach to.
const newChat = page.getByText('新会话', { exact: true }).first()
if (await newChat.count() > 0) {
  await newChat.click()
  await page.waitForTimeout(2500)
}

console.log('--- after 新会话 ---')
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1200))

for (const label of ['融合', '话题', 'Chat', '对话', '轨迹']) {
  const count = await page.getByText(label, { exact: true }).count()
  console.log(`  ${count > 0 ? 'FOUND  ' : 'absent '}${label} (${count})`)
}

// Click the fused tab if it is there and see what the pane renders.
const fused = page.getByText('融合', { exact: true }).first()
if (await fused.count() > 0) {
  await fused.click()
  await page.waitForTimeout(2000)
  console.log('--- fused pane ---')
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1200))
}

await page.screenshot({ path: '.acceptance/m0/surface-session.png' })
console.log('--- console errors ---')
for (const line of errors.slice(0, 20)) console.log(' ', line)
if (errors.length === 0) console.log('  (none)')
await browser.close()
