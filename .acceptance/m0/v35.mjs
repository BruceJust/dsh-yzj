/**
 * v35 — 确认即签发的机械后果：逐条确认一条,看它是否真的被铸成承诺、
 * 是否真的被投到执行者所在的会话（落库即代发 / 幽灵承诺禁令）。
 *
 * 只确认一条。剩下的留在卡上,用来证明「确认一条不等于确认一批」。
 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(10000)

// 回到上一轮那个话题：板 → 目标 → 委派 → 第一个话题（同一个房间）
await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1500)
await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1200)
const goalName = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('[class*="_goalBlock"]')]
  const mine = blocks.find(b => b.textContent?.includes('v34目标-'))
  mine?.querySelector('[class*="_delegate"]')?.click()
  return mine?.querySelector('[class*="_goalName"]')?.textContent ?? '(未找到)'
})
console.log('=== 目标 ===', goalName)
await page.waitForTimeout(900)
await page.evaluate(() => { document.querySelector('[role="dialog"] button[class*="_room"]')?.click() })
await page.waitForTimeout(9000)

console.log('=== 确认前 ===')
console.log(await page.evaluate(() => {
  const card = document.querySelector('[class*="_proposal"]')
  return {
    卡在: card !== null,
    已裁决标记: [...(card?.querySelectorAll('[class*="_itemMark"]') ?? [])].map(e => e.textContent),
  }
}))

// 只按第一条的「确认」
await page.evaluate(() => {
  const card = document.querySelector('[class*="_proposal"]')
  const firstItem = card?.querySelector('[class*="_item"]')
  const confirm = [...(firstItem?.querySelectorAll('button') ?? [])]
    .find(b => b.textContent === '确认')
  confirm?.click()
})
await page.waitForTimeout(15000)

console.log('=== 确认后：卡上 ===')
console.log(await page.evaluate(() => {
  const card = document.querySelector('[class*="_proposal"]')
  return {
    裁决标记: [...(card?.querySelectorAll('[class*="_itemMark"]') ?? [])].map(e => e.textContent),
    还剩按钮: [...(card?.querySelectorAll('[class*="_itemActs"]') ?? [])].length,
  }
}))

// 板上：铸出来的那条子承诺
await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(2500)
await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(2000)
console.log('=== 确认后：板上 ===')
console.log(await page.evaluate(() => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')]
    .find(b => b.textContent?.includes('v34目标-'))
  const rows = [...(mine?.querySelectorAll('[class*="_goalChildren"] [class*="_row"]') ?? [])]
  return {
    信号: mine?.querySelector('[class*="_goalSig"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    子承诺: rows.map(r => ({
      文本: r.querySelector('[class*="_what"]')?.textContent,
      出处: r.querySelector('[class*="_via"]')?.textContent,
      未通知: r.querySelector('[class*="_unnotified"]')?.textContent ?? '(无——说明发出去了)',
      一跳: r.querySelector('[class*="_open"]')?.textContent,
    })),
  }
}))

console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 6))
await page.screenshot({ path: '.acceptance/m0/v35-confirm.png', fullPage: false })
await browser.close()
