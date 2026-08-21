/** v43 — 830 项目群接入 + 未接入会话的可见标记。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(14000)
console.log(await p.evaluate(() => {
  const rows = [...document.querySelectorAll('nav button[class*="_item"]')]
  const named = rows.map(r => ({
    名: r.querySelector('[class*="_itemTitle"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 24),
    未接入: r.querySelector('[class*="_offDuty"]') !== null,
  })).filter(x => x.名 !== undefined && x.名 !== '')
  return {
    会话行数: named.length,
    带未接入标: named.filter(x => x.未接入).length,
    '830 那行': named.find(x => x.名?.includes('830')),
    前八行: named.slice(0, 8),
  }
}))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await b.close()
