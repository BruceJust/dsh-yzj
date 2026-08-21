/**
 * v21 — 工作块里的步骤说人话（变更记录 #44）。
 *
 * 断言：步骤行显示的是工具自己声明的 render intent（bash 是它的 description，
 * 不是 command），不是 argsRaw；参数只在完整轨迹里。
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
await page.locator('nav [class*="itemSub"] button[class*="rowBody"]').last()
  .evaluate(el => { el.click() })
await page.waitForTimeout(2500)

// 一句必然要调好几个不同工具的话
await page.locator('textarea').first().fill(
  '按顺序做三件事：1) 用 bash 跑 `ls -a` 看看有什么；2) 读一下 CONVENTIONS.md；3) 用一句话总结。',
)
await page.locator('button', { hasText: '发送' }).first().evaluate(el => { el.click() })

const read = async () => page.evaluate(() => {
  const heads = [...document.querySelectorAll('[class*="workHead"]')]
  return {
    heads: heads.map(h => h.innerText.replace(/\n/g, ' ')),
    steps: [...document.querySelectorAll('[class*="steps"] > div')]
      .map(s => s.innerText.replace(/\n/g, ' | ')),
  }
})

let sawRunning = false
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1000)
  const shot = await read()
  const head = shot.heads.at(-1) ?? ''
  if (head.includes('进行中')) {
    if (!sawRunning) {
      sawRunning = true
      console.log('=== 进行中的块头 ===')
      console.log(head)
      await page.locator('[class*="workHead"]').last().evaluate(el => { el.click() })
      await page.screenshot({ path: '.acceptance/m0/v21-running.png' })
    }
  } else if (sawRunning && !head.includes('进行中')) {
    console.log('=== 收尾的块头 ===')
    console.log(head)
    break
  }
}

// 展开所有工作块，看每一步的措辞
await page.evaluate(() => {
  for (const h of document.querySelectorAll('[class*="workHead"]')) h.click()
})
await page.waitForTimeout(600)
const final = await read()
console.log('=== 所有块头 ===')
console.log(final.heads.join('\n'))
console.log('=== 所有步骤 ===')
console.log(final.steps.join('\n'))
console.log('=== 还有原始 JSON 参数吗 ===')
const raw = final.steps.filter(s => s.includes('{"') || s.includes('timeoutMs'))
console.log(raw.length === 0 ? '  没有' : raw.join('\n'))
await page.screenshot({ path: '.acceptance/m0/v21-steps.png' })

// 完整轨迹里参数必须还在
await page.locator('button', { hasText: '完整轨迹' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(800)
const trace = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[role="dialog"] [class*="rowHead"]')]
  const call = rows.find(r => r.innerText.includes('调用'))
  call?.click()
  return {
    count: rows.length,
    call: call?.innerText.replace(/\n/g, ' ') ?? '(没有调用行)',
  }
})
await page.waitForTimeout(300)
console.log('=== 完整轨迹 ===')
console.log('节点数:', trace.count, '|', trace.call)
console.log('展开后的参数:', await page.evaluate(() => (
  document.querySelector('[role="dialog"] pre')?.textContent?.replace(/\s+/g, ' ').slice(0, 160) ?? '(无)'
)))
await page.screenshot({ path: '.acceptance/m0/v21-trace.png' })

console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
