/**
 * v19e — 三个动词真的干活：重命名 / 分叉对话 / 归档对话。
 *
 * 分叉会真的多出一个会话，所以这个探针跑完把分叉出来的那个归档掉 ——
 * 顺便就把归档也验了，而且不留垃圾。
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

const titles = () => page.evaluate(() => (
  [...document.querySelectorAll('nav [class*="itemSub"]')]
    .filter(el => el.querySelector('button[aria-label="会话操作"]'))
    .map(el => el.querySelector('[class*="itemTitle"]')?.textContent ?? '')
))

const menu = async (index, id) => {
  const more = page.locator('nav button[aria-label="会话操作"]').nth(index)
  await more.evaluate(el => { el.click() })
  await page.waitForTimeout(400)
  await page.locator(`text=${id}`).last().evaluate(el => { el.click() })
  await page.waitForTimeout(600)
}

console.log('起点:', JSON.stringify(await titles()))

// ---- 重命名 ----
const before = (await titles())[0]
await menu(0, '重命名')
const stamp = `改过名字 ${String(Date.now()).slice(-4)}`
await page.locator('nav input').first().fill(stamp)
await page.locator('nav input').first().press('Enter')
await page.waitForTimeout(2500)
const after = await titles()
console.log('=== 重命名 ===')
console.log('  改之前:', before)
console.log('  改之后:', after[0])
console.log('  生效  :', after[0] === stamp)

// ---- 分叉 ----
const countBefore = (await titles()).length
await menu(0, '分叉对话')
await page.waitForTimeout(4000)
const afterFork = await titles()
console.log('=== 分叉对话 ===')
console.log('  会话数:', countBefore, '->', afterFork.length)
console.log('  列表  :', JSON.stringify(afterFork))

// ---- 归档：把分叉出来的那个收掉 ----
const forkIndex = afterFork.findIndex((t, i) => t !== (i === 0 ? stamp : undefined) && t.includes(stamp))
const target = forkIndex >= 0 ? forkIndex : afterFork.length - 1
console.log('=== 归档对话 ===')
console.log('  要归档的:', afterFork[target])
await menu(target, '归档对话')
const ask = await page.evaluate(() => (
  [...document.querySelectorAll('nav div')].map(el => el.innerText ?? '')
    .find(t => t.startsWith('归档后这里就找不到它了')) ?? '(没有确认条)'
))
console.log('  确认条  :', ask.replace(/\n/g, ' '))
await page.screenshot({ path: '.acceptance/m0/v19-archive-ask.png' })
await page.locator('nav button', { hasText: /^归档$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(3000)
const done = await titles()
console.log('  归档后  :', JSON.stringify(done))
console.log('  行消失  :', done.length === afterFork.length - 1)

console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
