/**
 * v22 — yzj 工具在工作块里也说人话（变更记录 #44 后半）。
 *
 * 在本地会话里让它调几个 yzj 只读工具（知识库列表 / 我是谁 / 查会话图），
 * 看工作块里的步骤是不是「知识库列表」「确认自己是谁」而不是 argsRaw。
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

await page.locator('textarea').first().fill(
  '只做只读的事：先确认你自己是谁，再列一下我有哪些知识库，最后查一下会话图里的承诺。不要写任何东西。',
)
await page.locator('button', { hasText: '发送' }).first().evaluate(el => { el.click() })

const read = async () => page.evaluate(() => ({
  heads: [...document.querySelectorAll('[class*="workHead"]')].map(h => h.innerText.replace(/\n/g, ' ')),
  running: document.querySelector('[class*="chipAgent"]')?.innerText.includes('运行中') ?? false,
}))

for (let i = 0; i < 90; i += 1) {
  await page.waitForTimeout(1000)
  const shot = await read()
  const head = shot.heads.at(-1) ?? ''
  if (head.includes('进行中')) console.log(`${i}s |`, head)
  if (!shot.running && i > 3) break
}

await page.evaluate(() => {
  for (const h of document.querySelectorAll('[class*="workHead"]')) h.click()
})
await page.waitForTimeout(600)
const steps = await page.evaluate(() => (
  [...document.querySelectorAll('[class*="steps"] > div')].map(s => s.innerText.replace(/\n/g, ' | '))
))
console.log('=== 步骤 ===')
console.log(steps.join('\n'))
console.log('=== 还有原始参数吗 ===')
const raw = steps.filter(s => s.includes('{"') || s.includes('":"'))
console.log(raw.length === 0 ? '  没有' : raw.join('\n'))
await page.screenshot({ path: '.acceptance/m0/v22-steps.png' })

console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
