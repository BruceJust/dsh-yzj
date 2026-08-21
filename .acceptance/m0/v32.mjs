/** v32 — review 修复后的回归：侧栏重建是否忠实 + 板子四个写端点的护栏。 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(10000)

console.log('=== 侧栏结构 ===')
console.log(await page.evaluate(() => {
  const tree = document.querySelector('nav [class*="_tree"]')
  return {
    分栏: [...(tree?.querySelectorAll('button[class*="_sec"]') ?? [])].map(e => e.textContent?.slice(0, 14)),
    分组标签: [...(tree?.querySelectorAll('[class*="_groupLabel"]') ?? [])].map(e => e.textContent?.slice(0, 10)),
    场所行: tree?.querySelectorAll('[class*="_placeRow"]').length ?? 0,
    话题子行: tree?.querySelectorAll('button[class*="_itemSub"]').length ?? 0,
    未读徽标: tree?.querySelectorAll('[class*="_unread"]').length ?? 0,
    过滤框: tree?.querySelector('input[class*="_filter"]') !== null,
  }
}))

// 板子：重复立同一个真身必须被拒
await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(2000)
await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1200)
const declare = async (name, url) => {
  await page.locator('button', { hasText: '＋ 立目标' }).first().evaluate(el => { el.click() })
  await page.waitForTimeout(500)
  await page.locator('[role="dialog"] input').nth(0).fill(name)
  await page.locator('[role="dialog"] input').nth(1).fill(url)
  await page.locator('[role="dialog"] button', { hasText: /^立目标$/ }).evaluate(el => { el.click() })
  await page.waitForTimeout(2500)
  return page.evaluate(() => document.querySelector('[class*="_toast"]')?.textContent ?? '(无 toast)')
}
const stamp = `护栏实测-${String(Date.now()).slice(-5)}`
console.log('=== 第一次立 ===', await declare(stamp, 'https://www.yunzhijia.com/doc/guard-probe'))
console.log('=== 同一真身再立 ===', await declare(`${stamp}-改名`, 'https://www.yunzhijia.com/doc/guard-probe'))

// 非链接的引用不能渲染成 href
console.log('=== 引用不是链接时 ===')
console.log(await page.evaluate(() => ({
  不安全提示: document.querySelectorAll('[class*="_goalUnsafe"]').length,
  真链接: [...document.querySelectorAll('a[class*="_goalLink"]')].map(a => a.getAttribute('href')?.slice(0, 32)),
})))
await page.screenshot({ path: '.acceptance/m0/v32-board.png' })
console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
