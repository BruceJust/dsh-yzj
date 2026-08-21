/**
 * v24 — v4.8 左栏基座：完整的 IM 面。
 *
 * 断言：☁ 分栏里列的是**全部会话**（群/私聊/助手号三段），未在岗的会话也在；
 * 未读徽标、真头像、最近活动序；本地名字过滤能用；助手号默认收起且不计总徽标。
 */
import { chromium } from 'playwright'

const B = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(B, { waitUntil: 'networkidle' })
// 名录是轮询攒出来的：给它几轮
await page.waitForTimeout(12_000)

const shape = () => page.evaluate(() => {
  const nav = document.querySelector('nav')
  const tree = nav?.querySelector('[class*="_tree"]')
  const labels = [...(tree?.querySelectorAll('[class*="_groupLabel"]') ?? [])]
    .map(el => el.innerText.replace(/\n/g, ' '))
  const rows = [...(tree?.querySelectorAll('[class*="_item"], [class*="_placeRow"]') ?? [])]
    .filter(el => !el.className.includes('itemSub'))
    .map(el => ({
      text: el.innerText.replace(/\n/g, ' | ').slice(0, 70),
      unread: el.querySelector('[class*="_unread"]')?.textContent ?? '',
      photo: el.querySelector('img') !== null,
      place: el.className.includes('placeRow'),
    }))
  return {
    sections: [...(tree?.querySelectorAll('button[class*="_sec"]') ?? [])]
      .map(el => el.innerText.replace(/\n/g, ' · ')),
    labels,
    rows,
    filter: tree?.querySelector('[class*="_filter"]') !== null,
  }
})

const first = await shape()
console.log('=== 分栏头 ===')
console.log(first.sections.join('\n'))
console.log('=== 分组标签 ===')
console.log(first.labels.join('\n') || '(无)')
console.log('=== 行数 ===', first.rows.length, '| 其中场所行', first.rows.filter(r => r.place).length)
console.log('=== 前 12 行 ===')
console.log(first.rows.slice(0, 12).map(r => `${r.place ? '▣' : '·'} ${r.text}${r.unread ? `  [${r.unread}]` : ''}${r.photo ? '  📷' : ''}`).join('\n'))
console.log('=== 有真头像的行 ===', first.rows.filter(r => r.photo).length)
console.log('=== 过滤框在吗 ===', first.filter)
await page.screenshot({ path: '.acceptance/m0/v24-sidebar.png' })

// 本地名字过滤
if (first.filter) {
  const probe = first.rows.find(r => !r.place)?.text.split(' | ')[0]?.slice(0, 2) ?? ''
  await page.locator('nav input[class*="_filter"]').fill(probe)
  await page.waitForTimeout(500)
  const filtered = await shape()
  console.log('=== 过滤 ===')
  console.log(`「${probe}」 → ${String(filtered.rows.length)} 行（原 ${String(first.rows.length)}）`)
  await page.screenshot({ path: '.acceptance/m0/v24-filter.png' })
  await page.locator('nav input[class*="_filter"]').fill('')
  await page.waitForTimeout(400)
}

// 助手与通知：默认收起
console.log('=== 助手段 ===')
console.log(await page.evaluate(() => {
  const label = [...document.querySelectorAll('nav [class*="_groupLabel"]')]
    .find(el => el.innerText.includes('助手'))
  if (label === undefined) return '(没有助手段)'
  const chev = label.querySelector('[class*="_chev"]')
  return `${label.innerText.replace(/\n/g, ' ')} | 收起态: ${String(chev?.className.includes('chevClosed'))}`
}))

console.log('=== console 错误 ===')
console.log(errors.slice(0, 8).join('\n') || '  (none)')
await browser.close()
