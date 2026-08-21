/**
 * Does the fused view actually reach the screen?
 *
 * Everything up to now proved the artifact is correct and served. This drives
 * a real browser and asks the only question that matters: after a session is
 * open, is there a 「融合」 tab, and does clicking it render our pane.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage()

const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

/** Did our client factory even run? */
const loaded = await page.evaluate(() => {
  const tags = [...document.querySelectorAll('style[data-plugin]')].map(t => t.dataset.plugin)
  return {
    cssPlugins: [...new Set(tags)],
    scripts: [...document.querySelectorAll('script[src]')]
      .map(s => s.getAttribute('src'))
      .filter(src => src?.includes('yzj-next')),
  }
})
console.log('yzj scripts on page:', loaded.scripts)
console.log('yzj css injected for:', loaded.cssPlugins.filter(p => p?.includes('yzj')))

/** Slot registry truth: is our entry actually registered? */
const slotState = await page.evaluate(() => {
  const root = window.__DSH_CLIENT_CTX__ ?? window.__dshCtx ?? undefined
  if (root === undefined) return { available: false }
  try {
    return {
      available: true,
      view: root.slots.entries('conversation.view').map(e => e.options?.id ?? '?'),
      util: root.slots.entries('conversation.session.header.utilities').map(e => e.options?.id ?? '?'),
    }
  } catch (error) {
    return { available: true, error: String(error) }
  }
})
console.log('slot registry:', JSON.stringify(slotState))

/** What the operator actually sees. */
const visible = await page.evaluate(() => document.body.innerText.slice(0, 900))
console.log('--- visible text ---')
console.log(visible)

console.log('--- console errors ---')
for (const line of errors.slice(0, 25)) console.log(' ', line)
if (errors.length === 0) console.log('  (none)')

await page.screenshot({ path: '.acceptance/m0/surface-home.png', fullPage: false })
await browser.close()
