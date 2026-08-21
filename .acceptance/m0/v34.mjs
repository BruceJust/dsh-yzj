/**
 * v34 — 端到端：语境装载（发出去才算数）+ 拆解提案卡的逐条裁决面。
 *
 * 群里只发一句显式标注的探针文本，不带触发词——装载走的是「发送」这条路，
 * 不需要惊动 agent；拆解提案则在私语域驱动，卡片投到自己的会话里。
 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(10000)

// ---- 立一个本轮专用目标 ----
const stamp = `v34目标-${String(Date.now()).slice(-5)}`
const url = `https://www.yunzhijia.com/doc/v34-${String(Date.now()).slice(-5)}`
await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1500)
await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1000)
await page.locator('button', { hasText: '＋ 立目标' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(600)
await page.locator('[role="dialog"] input').nth(0).fill(stamp)
await page.locator('[role="dialog"] input').nth(1).fill(url)
await page.locator('[role="dialog"] textarea').fill('探针目标：验证语境装载与拆解提案')
await page.locator('[role="dialog"] button', { hasText: /^立目标$/ }).evaluate(el => { el.click() })
await page.waitForTimeout(3000)

// ---- 传送门 → 跳进一个话题 ----
await page.evaluate((name) => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')]
    .find(b => b.textContent?.includes(name))
  mine?.querySelector('[class*="_delegate"]')?.click()
}, stamp)
await page.waitForTimeout(900)
const room = await page.evaluate(() => {
  const first = document.querySelector('[role="dialog"] button[class*="_room"]')
  const label = first?.textContent ?? ''
  first?.click()
  return label
})
console.log('=== 跳进 ===', room.slice(0, 24))
await page.waitForTimeout(9000)

console.log('=== 发送前：chip 是「待装载」 ===')
console.log(await page.evaluate(() => ({
  标签: document.querySelector('[class*="_goalChipTag"]')?.textContent,
  虚线: (document.querySelector('[class*="_goalChip"]')?.className ?? '').includes('goalArmed')
    ? '实线(已装载)' : '虚线(待装载)',
})))

// ---- 发一句探针文本（不带触发词，不惊动 agent） ----
const probe = `[自动化探针 v34] 语境装载验证，忽略即可 · ${String(Date.now()).slice(-5)}`
await page.locator('textarea[class*="_input"]').fill(probe)
await page.waitForTimeout(300)
await page.locator('button[class*="_send"]').first().evaluate(el => { el.click() })
await page.waitForTimeout(12000)

console.log('=== 发送后：chip 应变成「本话题的目标」 ===')
console.log(await page.evaluate(() => {
  const chip = document.querySelector('[class*="_goalChip"]')
  return {
    标签: chip?.querySelector('[class*="_goalChipTag"]')?.textContent,
    目标: chip?.querySelector('[class*="_goalChipName"]')?.textContent,
    说明: chip?.querySelector('[class*="_goalChipNote"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    形态: (chip?.className ?? '').includes('goalArmed') ? '实线(已装载)' : '虚线(待装载)',
    发送后语态: [...document.querySelectorAll('[class*="_voiceBtn"]')]
      .filter(e => e.className.includes('voiceOn')).map(e => e.textContent?.slice(0, 10)),
  }
}))

// ---- 私语域驱动拆解提案 ----
console.log('=== 请 agent 拆解（私语域）===')
await page.evaluate(() => {
  const priv = [...document.querySelectorAll('[class*="_voiceBtn"]')]
    .find(e => e.textContent?.includes('对 Agent'))
  priv?.click()
})
await page.waitForTimeout(500)
await page.locator('textarea[class*="_input"]').fill(
  `帮我把目标「${stamp}」拆成两条子承诺提案：一条「整理探针清单」给我自己，一条「核对结果」也给我自己，都不要指定场所。只调用 goal_breakdown，不要做别的。目标引用是 ${url}`,
)
await page.locator('button[class*="_send"]').first().evaluate(el => { el.click() })

for (let round = 0; round < 12; round += 1) {
  await page.waitForTimeout(10000)
  const seen = await page.evaluate(() => document.querySelector('[class*="_proposal"]') !== null)
  if (seen) break
  process.stdout.write('.')
}
console.log('')
console.log(await page.evaluate(() => {
  const card = document.querySelector('[class*="_proposal"]')
  if (card === null) return { 提案卡: '没等到' }
  return {
    域标: card.querySelector('[class*="_domain"]')?.textContent,
    标题: card.querySelector('[class*="_title"]')?.textContent,
    条目: [...card.querySelectorAll('[class*="_item"]')].map(e => e.textContent?.replace(/\s+/g, ' ').trim().slice(0, 44)),
    每条按钮: [...(card.querySelector('[class*="_itemActs"]')?.querySelectorAll('button') ?? [])]
      .map(e => e.textContent),
    脚注: card.querySelector('[class*="_foot"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 70),
  }
}))

console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 6))
await page.screenshot({ path: '.acceptance/m0/v34-proposal.png', fullPage: false })
await browser.close()
