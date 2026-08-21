/** v44 — 接单开关：在场所合同面板里,按之前先说后果,跨重启存活。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(26000)

// 找一个「未接入」的会话进去
const opened = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('nav button[class*="_item"]')]
  const off = rows.find(r => r.querySelector('[class*="_offDuty"]'))
  const name = off?.querySelector('[class*="_itemTitle"]')?.textContent?.replace(/\s+/g, ' ').trim()
  off?.click()
  return { name, 行数: rows.length, 带标: rows.filter(r => r.querySelector('[class*="_offDuty"]')).length }
})
console.log('=== 进了一个未接入的会话 ===', opened)
await p.waitForTimeout(8000)
// 打开场所合同
// 未接入会话 → 群视图 → 「看这个场所的合同」
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(e => (e.textContent ?? '').includes('看这个场所的合同'))
  btn?.click()
})
await p.waitForTimeout(2500)
console.log('=== 合同面板 ===', await p.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  return {
    打开了: d !== null,
    接单状态: d?.querySelector('[class*="_tag"]')?.textContent,
    开关: d?.querySelector('[class*="_serveBtn"]')?.textContent ?? '(无)',
    列里有开关吗: document.querySelector('nav [class*="_serveBtn"]') !== null,
  }
}))
// 按开关 → 先出后果确认
await p.evaluate(() => { document.querySelector('[class*="_serveBtn"]')?.click() })
await p.waitForTimeout(700)
console.log('=== 按之前先说后果 ===', await p.evaluate(() => ({
  后果: document.querySelector('[class*="_confirmBody"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 76),
  按钮: [...document.querySelectorAll('[class*="_confirmActs"] button')].map(e => e.textContent),
})))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await b.close()
