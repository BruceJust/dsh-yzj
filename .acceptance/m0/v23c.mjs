/**
 * v23c — 场所记忆只在它的场所里读得出来（闭环实测）。
 *
 * 在 dsh-2 的一个话题里用「对 Agent 说 · 私」让它记一条场所惯例（私语态，
 * 不往群里发任何东西），然后：
 *   在这个话题的 记忆 tab 里能看到 → 切到本地会话 看不到 → 用 × 忘掉，收尾不留痕。
 */
import { chromium } from 'playwright'

const B = process.env.BASE ?? 'http://127.0.0.1:3090'
const MARK = `实测标记-${String(Date.now()).slice(-5)}`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(B, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const memory = async () => {
  await page.locator('button', { hasText: /^记忆/ }).last().evaluate(el => { el.click() })
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const panel = document.querySelector('[data-slot="details"]')
    return {
      radius: panel?.querySelector('[class*="_radius"]')?.textContent ?? '',
      items: [...(panel?.querySelectorAll('[class*="_memCard"]') ?? [])]
        .map(el => el.innerText.replace(/\n/g, ' | ')),
    }
  })
}

// 一个 dsh-2 话题，私语态（默认就是「对 Agent 说 · 私」）
await page.locator('nav button[class*="itemSub"]').first().evaluate(el => { el.click() })
await page.waitForTimeout(2500)
console.log('写之前：', JSON.stringify(await memory()))

await page.locator('textarea').first().fill(
  `用 memory_note 记一条本场所（place 轴）惯例，原话是：「${MARK}：这个群里的实测消息一律不发到群里。」不要往群里发任何东西。`,
)
await page.locator('button', { hasText: '发送' }).first().evaluate(el => { el.click() })

for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1000)
  const running = await page.evaluate(() => (
    document.querySelector('[class*="chipAgent"]')?.innerText.includes('运行中') ?? false
  ))
  if (!running && i > 3) break
}
await page.waitForTimeout(7000)

const inPlace = await memory()
console.log('=== 话题里 ===')
console.log('半径:', inPlace.radius)
console.log('条目:', inPlace.items.join('\n      ') || '(空)')
await page.screenshot({ path: '.acceptance/m0/v23-memory-place.png' })

// 本地会话：同一条 place 记忆必须读不出来
await page.locator('nav [class*="itemSub"] button[class*="rowBody"]').last()
  .evaluate(el => { el.click() })
await page.waitForTimeout(3000)
const inLocal = await memory()
console.log('=== 本地会话里 ===')
console.log('半径:', inLocal.radius)
console.log('条目:', inLocal.items.join('\n      ') || '(空)')

console.log('=== 判定 ===')
console.log('话题里看得到实测标记:', inPlace.items.some(t => t.includes(MARK)))
console.log('本地会话看不到    :', !inLocal.items.some(t => t.includes(MARK)))

// 收尾：回到话题把它忘掉，不留测试数据
await page.locator('nav button[class*="itemSub"]').first().evaluate(el => { el.click() })
await page.waitForTimeout(2500)
await memory()
await page.evaluate((mark) => {
  const panel = document.querySelector('[data-slot="details"]')
  for (const card of panel?.querySelectorAll('[class*="_memCard"]') ?? []) {
    if (card.innerText.includes(mark)) card.querySelector('button')?.click()
  }
}, MARK)
await page.waitForTimeout(2500)
const after = await memory()
console.log('收尾后还在吗:', after.items.some(t => t.includes(MARK)))

console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
