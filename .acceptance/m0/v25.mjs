/**
 * v25 — 未接单的会话：可进、可发、@ 有出生故事（v4.8）。
 *
 * 只做两件事，都不会往群里发东西：
 *   ① 打开一个未接单的群 —— 名字、消息都要读得出来（人看人发不受 allow-list 限制）
 *   ② 在里面输入 @next —— 锚定条当场预告「没接单」，按发送则**什么都不发**，
 *      给出理由 + 场所合同入口 + 去掉 @ 的出口
 */
import { chromium } from 'playwright'

const B = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(B, { waitUntil: 'networkidle' })
await page.waitForTimeout(9_000)

// 第一条未接单的群行（在岗的那条是场所行，长得不一样）
const opened = await page.evaluate(() => {
  const tree = document.querySelector('nav [class*="_tree"]')
  const row = [...(tree?.querySelectorAll(':scope > div > button[class*="_item"]') ?? [])]
    .find(el => el.getAttribute('title')?.includes('未在此接单'))
  if (row === undefined) return null
  const name = row.querySelector('[class*="_itemTitle"]')?.textContent ?? ''
  row.click()
  return name
})
console.log('打开的未接单会话:', opened ?? '(没找到未接单的行)')
await page.waitForTimeout(4_000)

const room = await page.evaluate(() => ({
  title: document.querySelector('[class*="_title"]')?.textContent ?? '',
  messages: document.querySelectorAll('[class*="_bubble"]').length,
  stale: document.querySelector('[class*="_stale"]')?.textContent ?? '',
  composer: document.querySelector('textarea') !== null,
}))
console.log('=== 房间 ===')
console.log('标题:', room.title, '| 消息条数:', room.messages, '| 有输入框:', room.composer)
console.log('读取失败提示:', room.stale || '(无)')
await page.screenshot({ path: '.acceptance/m0/v25-room.png' })

// 输入 @next —— 只是输入，锚定条应当当场预告
await page.locator('textarea').first().fill('@next 这条不该发出去')
await page.waitForTimeout(400)
console.log('=== 锚定条预告 ===')
console.log(await page.evaluate(() => (
  document.querySelector('[class*="anchorCold"]')?.textContent
  ?? document.querySelector('[class*="anchorIgnite"]')?.textContent
  ?? '(没有预告)'
)))

// 按发送：应当什么都不发，只出现出生故事
await page.locator('button', { hasText: /^(发送并交给 agent|发到群里)$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(3_000)
const refusal = await page.evaluate(() => ({
  story: document.querySelector('[class*="notOnDuty"]')?.innerText.replace(/\n/g, ' ') ?? '(没有出生故事)',
  draft: document.querySelector('textarea')?.value ?? '',
  toast: document.querySelector('[class*="_toast"]')?.textContent ?? '',
}))
console.log('=== 按下发送之后 ===')
console.log('出生故事:', refusal.story)
console.log('草稿还在吗:', JSON.stringify(refusal.draft))
console.log('有没有「已发到群里」:', refusal.toast || '(没有 toast)')
await page.screenshot({ path: '.acceptance/m0/v25-refused.png' })

// 「去掉 @ 再发」只改草稿，不发送
await page.locator('button', { hasText: /^去掉 .* 再发$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(400)
console.log('去掉 @ 之后的草稿:', JSON.stringify(await page.evaluate(() => (
  document.querySelector('textarea')?.value ?? ''
))))

console.log('=== console 错误 ===')
console.log(errors.slice(0, 8).join('\n') || '  (none)')
await browser.close()
