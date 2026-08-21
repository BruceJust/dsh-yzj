/**
 * v23 — 右栏三个 tab 跟着会话变（变更记录 #45）。
 *
 * Bruce：「我在不同话题、本地对话下，右边的资源怎么都是一样的呢」。
 * 断言：在不同话题 / 本地会话之间切换时，半径说明与 资源/记忆 的内容都要变。
 */
import { chromium } from 'playwright'

const B = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(B, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const face = async () => {
  const out = {}
  for (const tab of ['当前', '记忆', '资源']) {
    await page.locator('button', { hasText: new RegExp(`^${tab}`) }).last()
      .evaluate(el => { el.click() })
    await page.waitForTimeout(350)
    // CSS Modules 把类名哈希成 `hf2blq_item` 这种,所以按后缀匹配,并把查询
    // 限制在右栏面板里（`_item` 在侧栏也有）。
    out[tab] = await page.evaluate(() => {
      const panel = document.querySelector('[data-slot="details"]')
      return {
        radius: panel?.querySelector('[class*="_radius"]')?.textContent ?? '(无)',
        items: [...(panel?.querySelectorAll('a[class*="_item"], [class*="_memCard"]') ?? [])]
          .map(el => el.innerText.replace(/\n/g, ' | ').slice(0, 70)),
        calm: panel?.querySelector('[class*="_calm"]')?.textContent?.trim().slice(0, 40) ?? '',
      }
    })
  }
  return out
}

const show = (label, data) => {
  console.log(`=== ${label} ===`)
  for (const [tab, value] of Object.entries(data)) {
    console.log(` ${tab}  半径: ${value.radius}`)
    console.log(`      内容: ${value.items.length === 0 ? `(空) ${value.calm}` : value.items.join(' ‖ ')}`)
  }
}

// 话题 A（dsh-2 里的第一个）
const topics = page.locator('nav button[class*="itemSub"]')
await topics.first().evaluate(el => { el.click() })
await page.waitForTimeout(2500)
const titleOf = () => page.evaluate(() => document.querySelector('[class*="column_title"]')?.textContent ?? '')
const a = await face()
show(`话题：${(await titleOf()).slice(0, 20)}`, a)
await page.screenshot({ path: '.acceptance/m0/v23-topic.png' })

// 本地会话
await page.locator('nav [class*="itemSub"] button[class*="rowBody"]').last()
  .evaluate(el => { el.click() })
await page.waitForTimeout(2500)
const b = await face()
show('本地会话', b)
await page.screenshot({ path: '.acceptance/m0/v23-local.png' })

console.log('=== 判定 ===')
for (const tab of ['当前', '记忆', '资源']) {
  console.log(`${tab} 半径变了吗:`, a[tab].radius !== b[tab].radius)
}
console.log('资源内容变了吗:', JSON.stringify(a['资源'].items) !== JSON.stringify(b['资源'].items))

console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
