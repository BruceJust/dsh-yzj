/**
 * v33 — v4.9/v4.10 目标动线实测：
 * 立目标带成功标准 → 目标行三看与两个传送门 → 选场所跳进会话 → 目标 chip 与语境装载。
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
  await page.waitForTimeout(1500)
  await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
  await page.waitForTimeout(1200)
}
await board()

// ---- 1. 立目标：成功标准字段 ----
const stamp = `v33目标-${String(Date.now()).slice(-5)}`
const url = `https://www.yunzhijia.com/doc/v33-${String(Date.now()).slice(-5)}`
await page.locator('button', { hasText: '＋ 立目标' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(600)
console.log('=== 立目标表单 ===')
console.log(await page.evaluate(() => ({
  字段: [...document.querySelectorAll('[role="dialog"] [class*="_fieldLabel"]')].map(e => e.textContent),
  成功标准框: document.querySelector('[role="dialog"] textarea') !== null,
  提示: document.querySelector('[role="dialog"] [class*="_fieldHint"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60),
})))
await page.locator('[role="dialog"] input').nth(0).fill(stamp)
await page.locator('[role="dialog"] input').nth(1).fill(url)
await page.locator('[role="dialog"] textarea').fill('T+3 出报表；差异条目 < 5')
await page.locator('[role="dialog"] button', { hasText: /^立目标$/ }).evaluate(el => { el.click() })
await page.waitForTimeout(3000)

console.log('=== 目标行 ===')
console.log(await page.evaluate((name) => {
  const blocks = [...document.querySelectorAll('[class*="_goalBlock"]')]
  const mine = blocks.find(b => b.textContent?.includes(name))
  return {
    找到: mine !== undefined,
    成功标准: mine?.querySelector('[class*="_criteria"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    信号: mine?.querySelector('[class*="_goalSig"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    终态药丸: mine?.querySelector('[class*="_manual"]')?.textContent,
    委派CTA: mine?.querySelector('[class*="_delegate"]')?.textContent,
    评估CTA: mine?.querySelector('[class*="_assess"]')?.textContent,
    看真身: mine?.querySelector('[class*="_goalLink"]')?.getAttribute('href'),
  }
}, stamp))

// ---- 2. 传送门：只问「在哪儿说」 ----
await page.evaluate((name) => {
  const blocks = [...document.querySelectorAll('[class*="_goalBlock"]')]
  const mine = blocks.find(b => b.textContent?.includes(name))
  mine?.querySelector('[class*="_delegate"]')?.click()
}, stamp)
await page.waitForTimeout(900)
console.log('=== 传送门选场所 ===')
const portal = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  return {
    标题: dialog?.querySelector('[class*="_sheetTitle"]')?.textContent,
    理由: dialog?.querySelector('[class*="_sheetNote"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80),
    场所分组: [...(dialog?.querySelectorAll('[class*="_roomPlace"]') ?? [])].map(e => e.textContent),
    可选话题: [...(dialog?.querySelectorAll('button[class*="_room"]') ?? [])].map(e => e.textContent?.slice(0, 20)),
    有分配表单: dialog?.querySelector('input[placeholder*="执行者"]') !== null,
  }
})
console.log(portal)

// ---- 3. 跳进会话：目标 chip ----
if ((portal.可选话题?.length ?? 0) > 0) {
  await page.evaluate(() => {
    document.querySelector('[role="dialog"] button[class*="_room"]')?.click()
  })
  await page.waitForTimeout(9000)
  console.log('=== 跳进会话之后 ===')
  console.log(await page.evaluate(() => {
    const chip = document.querySelector('[class*="_goalChip"]')
    const seg = [...document.querySelectorAll('[class*="_voiceBtn"]')]
    return {
      chip: chip?.querySelector('[class*="_goalChipTag"]')?.textContent,
      目标名: chip?.querySelector('[class*="_goalChipName"]')?.textContent,
      说明: chip?.querySelector('[class*="_goalChipNote"]')?.textContent?.replace(/\s+/g, ' ').trim(),
      触发词提醒: chip?.querySelector('[class*="_goalChipWarn"]')?.textContent?.replace(/\s+/g, ' ').trim(),
      语态: seg.map(e => `${e.textContent?.slice(0, 8)}${e.className.includes('voiceOn') ? '←选中' : ''}`),
      锚定条: document.querySelector('[class*="_anchorWhere"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    }
  }))
} else {
  console.log('=== 跳进会话之后 === (没有可跳的话题,跳过)')
}

console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 6))
await page.screenshot({ path: '.acceptance/m0/v33-portal.png', fullPage: false })
await browser.close()
