/** v45 — 接单开关：面板里的形态 + 端点真的改状态且跨重启存活。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(24000)

// 用 locator 点(带命中测试),进「金蝶最小DSH交流群」的群视图
await p.locator('nav button', { hasText: '金蝶最小DSH交流群' }).first().click()
await p.waitForTimeout(9000)
await p.locator('button', { hasText: /^场所合同$|^未接入 · 场所合同$/ }).first().click()
await p.waitForTimeout(2500)
console.log('=== 合同面板（已接单的场所）===', await p.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  return {
    打开: d !== null,
    接单标: d?.querySelector('[class*="_tag"]')?.textContent,
    开关: d?.querySelector('[class*="_serveBtn"]')?.textContent ?? '(无)',
    说明: d?.querySelector('[class*="_note"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60),
    会话列里有开关吗: document.querySelector('nav [class*="_serveBtn"]') !== null,
  }
}))
await p.locator('[class*="_serveBtn"]').first().click()
await p.waitForTimeout(800)
console.log('=== 按之前先说后果 ===', await p.evaluate(() => ({
  后果: document.querySelector('[class*="_confirmBody"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80),
  按钮: [...document.querySelectorAll('[class*="_confirmActs"] button')].map(e => e.textContent),
})))
// 取消,不真的改现网群
await p.locator('[class*="_confirmNo"]').first().click()
await p.waitForTimeout(500)
console.log('=== 取消之后 ===', await p.evaluate(() => ({
  确认框还在: document.querySelector('[class*="_confirmBody"]') !== null,
  开关回来了: document.querySelector('[class*="_serveBtn"]')?.textContent,
})))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await b.close()
