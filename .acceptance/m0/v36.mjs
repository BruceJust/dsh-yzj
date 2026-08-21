/**
 * v36 — 完成度评估闭环：板上「评估」传送门 → 私语域出简报卡 → 板上逐条证据
 * 与「变委派」出口。
 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(10000)

const board = async () => {
  await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
  await page.waitForTimeout(2000)
  await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
  await page.waitForTimeout(1500)
}
await board()

console.log('=== 评估传送门 ===')
await page.evaluate(() => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')]
    .find(b => b.textContent?.includes('v34目标-'))
  mine?.querySelector('[class*="_assess"]')?.click()
})
await page.waitForTimeout(900)
console.log(await page.evaluate(() => ({
  标题: document.querySelector('[role="dialog"] [class*="_sheetTitle"]')?.textContent,
  理由: document.querySelector('[role="dialog"] [class*="_sheetNote"]')?.textContent
    ?.replace(/\s+/g, ' ').trim().slice(0, 90),
})))

await page.evaluate(() => { document.querySelector('[role="dialog"] button[class*="_room"]')?.click() })
await page.waitForTimeout(9000)

console.log('=== 落地：私语域 + 预置提示词 ===')
console.log(await page.evaluate(() => ({
  语态: [...document.querySelectorAll('[class*="_voiceBtn"]')]
    .filter(e => e.className.includes('voiceOn')).map(e => e.textContent?.slice(0, 10)),
  chip: document.querySelector('[class*="_goalChip"]') === null ? '无(评估不装载语境)' : '有',
  草稿开头: document.querySelector('textarea[class*="_input"]')?.value?.slice(0, 30),
})))

await page.locator('button[class*="_send"]').first().evaluate(el => { el.click() })
for (let round = 0; round < 15; round += 1) {
  await page.waitForTimeout(10000)
  const seen = await page.evaluate(() => document.querySelector('[class*="_assessment"]') !== null)
  if (seen) break
  process.stdout.write('.')
}
console.log('')
console.log('=== 简报卡 ===')
console.log(await page.evaluate(() => {
  const card = document.querySelector('[class*="_assessment"]')
  if (card === null) return { 卡: '没等到' }
  return {
    域标: card.querySelector('[class*="_domain"]')?.textContent,
    目标: card.querySelector('[class*="_title"]')?.textContent,
    结论: card.querySelector('[class*="_reportBody"]')?.textContent?.slice(0, 60),
    逐条: [...card.querySelectorAll('[class*="_item"]')]
      .map(e => e.textContent?.replace(/\s+/g, ' ').trim().slice(0, 50)).slice(0, 6),
    出口: [...card.querySelectorAll('[class*="_actions"] button')].map(e => e.textContent),
    脚注: card.querySelector('[class*="_foot"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60),
  }
}))

await board()
console.log('=== 板上：简报抽屉与「变委派」出口 ===')
await page.evaluate(() => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')]
    .find(b => b.textContent?.includes('v34目标-'))
  const heads = [...(mine?.querySelectorAll('[class*="_drawerHead"]') ?? [])]
  heads.find(h => h.textContent?.includes('差距简报'))?.click()
})
await page.waitForTimeout(1200)
console.log(await page.evaluate(() => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')]
    .find(b => b.textContent?.includes('v34目标-'))
  return {
    抽屉头: [...(mine?.querySelectorAll('[class*="_drawerHead"]') ?? [])]
      .map(e => e.textContent?.replace(/\s+/g, ' ').trim().slice(0, 40)),
    结论: mine?.querySelector('[class*="_reportSummary"]')?.textContent?.slice(0, 50),
    逐条: [...(mine?.querySelectorAll('[class*="_reportLine"]') ?? [])]
      .map(e => e.textContent?.replace(/\s+/g, ' ').trim().slice(0, 56)),
    变委派按钮: (mine?.querySelectorAll('[class*="_gapDelegate"]') ?? []).length,
  }
}))

console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 6))
await page.screenshot({ path: '.acceptance/m0/v36-assess.png', fullPage: false })
await browser.close()
