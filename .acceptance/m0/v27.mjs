/**
 * v27 — 这一轮七条的实测（全程不往任何群发消息）。
 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(9000)

// 进 dsh-2 的群视图
await page.evaluate(() => {
  for (const el of document.querySelectorAll('nav [class*="_rowBody"]')) {
    if (el.textContent?.includes('dsh-2')) { el.click(); return }
  }
})
await page.waitForTimeout(4000)

console.log('=== ① 日期分隔 ===')
console.log(await page.evaluate(() => (
  [...document.querySelectorAll('[class*="_day"]')].map(el => el.textContent).join(' | ') || '(没有)'
)))

console.log('=== ⑦ 打开后停在哪 ===')
console.log(await page.evaluate(() => {
  const body = [...document.querySelectorAll('[class*="_body"]')].find(el => el.scrollHeight > el.clientHeight) ?? null
  if (body === null) return '(没有 body)'
  const gap = body.scrollHeight - body.scrollTop - body.clientHeight
  return `距底 ${String(Math.round(gap))}px（scrollHeight ${String(body.scrollHeight)}）`
}))

console.log('=== ② 点回复之后光标在哪 ===')
await page.evaluate(() => {
  const verb = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('↩ 回复'))
  verb?.click()
})
await page.waitForTimeout(500)
console.log('focus:', await page.evaluate(() => document.activeElement?.tagName ?? '(none)'))

console.log('=== ③ 输入法组字时的回车 ===')
console.log(await page.evaluate(() => {
  const box = document.querySelector('textarea')
  if (box === null) return '(没有输入框)'
  box.focus()
  const before = box.value
  box.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  Object.defineProperty(composing, 'isComposing', { get: () => true })
  box.dispatchEvent(composing)
  return `组字回车被拦截: ${String(!composing.defaultPrevented)}（草稿仍是 ${JSON.stringify(before)}）`
}))

console.log('=== ④⑤ 新增控件 ===')
console.log(await page.evaluate(() => {
  const labels = [...document.querySelectorAll('button')].map(b => (b.textContent ?? '').trim())
  return {
    叫上: labels.find(t => t.startsWith('⚡ 叫上')) ?? '(无)',
    表情: labels.includes('☺'),
    复制: labels.some(t => t.includes('复制')),
    转发: labels.some(t => t.includes('转发')),
  }
}))
await page.screenshot({ path: '.acceptance/m0/v27-place.png' })
console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
