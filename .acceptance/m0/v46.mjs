/** v46 — 接单开关真的改状态、且跨重启存活。先移出(不读任何东西)再接回,净效果为零。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(24000)

const badge = async () => p.evaluate(() => {
  const row = [...document.querySelectorAll('nav button[class*="_item"]')]
    .find(r => (r.textContent ?? '').includes('830 项目'))
  return row === undefined ? '(没找到这一行)' : (row.querySelector('[class*="_offDuty"]') ? '未接入' : '已接入')
})
console.log('=== 初始 ===', await badge())

const toggle = async (label) => {
  await p.locator('nav button', { hasText: '830 项目' }).first().click()
  await p.waitForTimeout(7000)
  await p.locator('button', { hasText: /场所合同$/ }).first().click()
  await p.waitForTimeout(2000)
  await p.locator('[class*="_serveBtn"]').first().click()
  await p.waitForTimeout(700)
  await p.locator('[class*="_confirmGo"]').first().click()
  await p.waitForTimeout(3000)
  const tag = await p.evaluate(() => document.querySelector('[role="dialog"] [class*="_tag"]')?.textContent)
  console.log(`=== ${label} 之后，合同面板说 ===`, tag)
  await p.keyboard.press('Escape')
  await p.evaluate(() => { document.querySelector('[class*="_mask"]')?.click() })
  await p.waitForTimeout(4000)
}

await toggle('移出')
console.log('=== 侧栏 ===', await badge())
await toggle('接回')
console.log('=== 侧栏 ===', await badge())
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await b.close()
