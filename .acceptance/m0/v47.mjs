/** v47 — 重启之后，操作者的接单决定还在。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(24000)
console.log(await p.evaluate(() => {
  const rows = [...document.querySelectorAll('nav button[class*="_item"]')]
  const row = rows.find(r => (r.textContent ?? '').includes('830 项目'))
  return {
    '830 状态': row === undefined ? '(没找到)' : (row.querySelector('[class*="_offDuty"]') ? '未接入' : '已接入'),
    会话行数: rows.length,
    未接入总数: rows.filter(r => r.querySelector('[class*="_offDuty"]')).length,
  }
}))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await b.close()
