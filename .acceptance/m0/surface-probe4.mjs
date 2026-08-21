/** Where did the view tabs go? Dump every interactive control in the session. */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
page.on('pageerror', e => console.log('pageerror:', e.message))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const start = page.getByText('新会话', { exact: true }).first()
if (await start.count() > 0) { await start.click(); await page.waitForTimeout(2500) }

const controls = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button,[role="tab"],[role="button"],a')) {
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
    if (text === '' && label === '') continue
    out.push({ tag: el.tagName.toLowerCase(), text, label: label.slice(0, 40) })
  }
  return out
})
console.log('--- controls ---')
for (const c of controls) console.log(` ${c.tag} "${c.text}"${c.label ? ` [${c.label}]` : ''}`)
console.log('--- yzj css present:', await page.evaluate(() =>
  [...document.querySelectorAll('style[data-plugin]')].map(t => t.dataset.plugin).filter(p => p?.includes('yzj'))))
await page.screenshot({ path: '.acceptance/m0/surface-session.png' })
await browser.close()
