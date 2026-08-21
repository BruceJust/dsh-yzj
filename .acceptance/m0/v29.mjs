/** v29 — 这一轮五条（不发任何消息）。 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('static.yunzhijia')) errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(9000)

// 自聊里有图片消息（实测过的那条 richText）
await page.evaluate(() => {
  for (const el of document.querySelectorAll('nav [class*="_item"]')) {
    if (el.textContent?.includes('代少兵')) { el.click(); return }
  }
})
await page.waitForTimeout(5000)
console.log('=== ② 图片 / 文件 ===')
console.log(await page.evaluate(() => ({
  图片: document.querySelectorAll('[class*="_thumb"] img').length,
  文件卡: document.querySelectorAll('[class*="_file"]').length,
})))

// dsh-2 有文件消息
await page.evaluate(() => {
  for (const el of document.querySelectorAll('nav [class*="_rowBody"]')) {
    if (el.textContent?.includes('dsh-2')) { el.click(); return }
  }
})
await page.waitForTimeout(5000)
console.log('dsh-2:', await page.evaluate(() => ({
  图片: document.querySelectorAll('[class*="_thumb"] img').length,
  文件卡: document.querySelectorAll('a[class*="_file"]').length,
  可点引用: document.querySelectorAll('[class*="quoteLink"]').length,
})))

console.log('=== ③ 点引用跳转 ===')
console.log(await page.evaluate(() => {
  const link = document.querySelector('[class*="quoteLink"]')
  if (link === null) return '(这一屏没有带引用的消息)'
  link.click()
  return '已点击'
}))
await page.waitForTimeout(1200)
console.log('高亮:', await page.evaluate(() => document.querySelectorAll('[class*="_flash"]').length))

console.log('=== ⑤ ⚡ 之后点回复 ===')
console.log(await page.evaluate(() => {
  const zap = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('⚡ @agent'))
  zap?.click()
  return ''
}))
await page.waitForTimeout(600)
console.log('⚡ 之后草稿:', JSON.stringify(await page.evaluate(() => document.querySelector('textarea')?.value ?? '')))
await page.waitForTimeout(400)
// React 会把点击里的 setState 批到事件之后才刷，所以同步读到的是刷之前的值
await page.evaluate(() => {
  const back = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('↩ 回复'))
  back?.click()
})
await page.waitForTimeout(600)
console.log('点回复之后:', JSON.stringify(await page.evaluate(() => document.querySelector('textarea')?.value ?? '')))

console.log('=== ④ 转发面板 ===')
await page.evaluate(() => {
  const f = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('↗ 转发'))
  f?.click()
})
await page.waitForTimeout(1500)
console.log(await page.evaluate(() => {
  const p = document.querySelector('[role="dialog"][aria-label="转发到"]')
  return {
    行数: p?.querySelectorAll('[class*="_row"]').length ?? 0,
    有头像: (p?.querySelectorAll('[class*="_rowFace"]').length ?? 0) > 0,
    有时间: [...(p?.querySelectorAll('[class*="_rowNote"]') ?? [])].some(el => (el.textContent ?? '') !== ''),
    有未接单标: (p?.querySelectorAll('[class*="_rowOff"]').length ?? 0) > 0,
  }
}))
await page.screenshot({ path: '.acceptance/m0/v29-forward.png' })
console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
