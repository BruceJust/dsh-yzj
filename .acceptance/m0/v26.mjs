/**
 * v26 — 对抗性评审修掉的两个 UI 缺陷（都不发送任何东西）。
 *   ① 锚定条按**别名**判受话，不是「有没有 @」：`@张三` 是跟同事说话
 *   ② 切换房间要重挂载：草稿/挂链/拒绝条都不能跟着漂到另一个房间
 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(9000)

const rooms = await page.evaluate(() => {
  const tree = document.querySelector('nav [class*="_tree"]')
  return [...(tree?.querySelectorAll(':scope > div > button[class*="_item"]') ?? [])]
    .slice(0, 2).map(el => el.querySelector('[class*="_itemTitle"]')?.textContent ?? '')
})
const enter = async (name) => {
  await page.evaluate((target) => {
    const tree = document.querySelector('nav [class*="_tree"]')
    for (const el of tree?.querySelectorAll(':scope > div > button[class*="_item"]') ?? []) {
      if (el.querySelector('[class*="_itemTitle"]')?.textContent === target) el.click()
    }
  }, name)
  await page.waitForTimeout(3500)
}

await enter(rooms[0])
const bar = async () => page.evaluate(() => ({
  cold: document.querySelector('[class*="anchorCold"]')?.textContent ?? '',
  ignite: document.querySelector('[class*="anchorIgnite"]')?.textContent ?? '',
  send: [...document.querySelectorAll('button')].map(b => b.textContent).find(t => t === '发到群里' || t === '发送并交给 agent') ?? '',
}))

await page.locator('textarea').first().fill('@张三 明天有空吗')
await page.waitForTimeout(400)
console.log('=== @同事（不是别名）===')
console.log(JSON.stringify(await bar()))

await page.locator('textarea').first().fill('@next 帮我看看')
await page.waitForTimeout(400)
console.log('=== @别名 ===')
console.log(JSON.stringify(await bar()))

// 切房间：草稿绝不能跟过去
await enter(rooms[1])
console.log('=== 切到另一个房间 ===')
console.log('房间:', await page.evaluate(() => document.querySelector('[class*="_title"]')?.textContent))
console.log('草稿:', JSON.stringify(await page.evaluate(() => document.querySelector('textarea')?.value ?? '')))
console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
