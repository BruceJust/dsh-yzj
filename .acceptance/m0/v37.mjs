/**
 * v37 — 对抗审查修复之后的回归：拆解仍然跑得通，而且
 *  ①「确认两次」不再二次铸造/二次投递；②挂起之后仍然改得回来。
 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(10000)

const tail = String(Date.now()).slice(-5)
const stamp = `v37目标-${tail}`
const url = `https://www.yunzhijia.com/doc/v37-${tail}`
// 群话题里目标正文不可见,卡上显示的是 URI——按尾号找,而不是按名字
const mark = `v37-${tail}`
await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1800)
await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(1200)
await page.locator('button', { hasText: '＋ 立目标' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(600)
await page.locator('[role="dialog"] input').nth(0).fill(stamp)
await page.locator('[role="dialog"] input').nth(1).fill(url)
await page.locator('[role="dialog"] textarea').fill('回归探针：确认幂等 + 挂起可逆')
await page.locator('[role="dialog"] button', { hasText: /^立目标$/ }).evaluate(el => { el.click() })
await page.waitForTimeout(3000)

await page.evaluate((name) => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')]
    .find(b => b.textContent?.includes(name))
  mine?.querySelector('[class*="_delegate"]')?.click()
}, stamp)
await page.waitForTimeout(900)
await page.evaluate(() => { document.querySelector('[role="dialog"] button[class*="_room"]')?.click() })
await page.waitForTimeout(9000)

// 私语域拆解
await page.evaluate(() => {
  [...document.querySelectorAll('[class*="_voiceBtn"]')]
    .find(e => e.textContent?.includes('对 Agent'))?.click()
})
await page.waitForTimeout(500)
await page.locator('textarea[class*="_input"]').fill(
  `帮我把目标「${stamp}」拆成两条子承诺提案：一条「回归项 A」给我自己，一条「回归项 B」也给我自己，都不指定场所。只调用 goal_breakdown。目标引用 ${url}`,
)
await page.locator('button[class*="_send"]').first().evaluate(el => { el.click() })
for (let round = 0; round < 15; round += 1) {
  await page.waitForTimeout(10000)
  const seen = await page.evaluate(t => [...document.querySelectorAll('[class*="_proposal"]')]
    .some(c => c.textContent?.includes(t)), stamp)
  if (seen) break
  process.stdout.write('.')
}
console.log('')

const card = async () => page.evaluate((t) => {
  const c = [...document.querySelectorAll('[class*="_proposal"]')].find(e => e.textContent?.includes(t))
  if (c === undefined) return { 卡: '没等到' }
  return {
    标记: [...c.querySelectorAll('[class*="_itemMark"]')].map(e => e.textContent),
    每条按钮: [...c.querySelectorAll('[class*="_itemActs"]')]
      .map(g => [...g.querySelectorAll('button')].map(b => b.textContent).join('/')),
    场所: [...c.querySelectorAll('[class*="_item"]')]
      .map(e => (/登记发到「([^」]+)」/u.exec(e.textContent ?? '') ?? [])[1])
      .filter(Boolean),
  }
}, mark)
console.log('=== 提案卡（初始）===', await card())

const press = async (itemIndex, label) => {
  await page.evaluate(({ t, i, l }) => {
    const c = [...document.querySelectorAll('[class*="_proposal"]')].find(e => e.textContent?.includes(t))
    const groups = [...(c?.querySelectorAll('[class*="_itemActs"]') ?? [])]
    const btn = [...(groups[i]?.querySelectorAll('button') ?? [])].find(b => b.textContent === l)
    btn?.click()
  }, { t: mark, i: itemIndex, l: label })
  await page.waitForTimeout(9000)
}

// 第 1 条确认
await press(0, '确认')
console.log('=== 确认第 1 条 ===', await card())
// 第 2 条挂起，然后改主意
await press(0, '挂起')
console.log('=== 挂起第 2 条（列表里现在只剩它有按钮）===', await card())
await press(0, '确认')
console.log('=== 挂起之后仍能确认 ===', await card())

await page.locator('nav button', { hasText: '承诺板' }).first().evaluate(el => { el.click() })
await page.waitForTimeout(2500)
await page.locator('button', { hasText: /^按目标$/ }).first().evaluate(el => { el.click() })
await page.waitForTimeout(2000)
console.log('=== 板上 ===', await page.evaluate((t) => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')].find(b => b.textContent?.includes(t))
  return {
    信号: mine?.querySelector('[class*="_goalSig"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    子承诺: [...(mine?.querySelectorAll('[class*="_goalChildren"] [class*="_row"]') ?? [])]
      .map(r => `${r.querySelector('[class*="_what"]')?.textContent} | ${
        r.querySelector('[class*="_unnotified"]')?.textContent ?? '已通知'}`),
  }
}, stamp))

console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 6))
await browser.close()
