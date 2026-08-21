/** v50 — 私语域的 agent 回答，有没有一扇通往群里的门。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(24000)
// 那个话题：830 项目群里「@next他发的是什么东西」
// 830 的话题不在侧栏可见列里,从群视图进
await p.locator('nav button', { hasText: '830 项目' }).first().click()
await p.waitForTimeout(9000)
const cards = await p.evaluate(() => [...document.querySelectorAll('[class*="_topicCard"], [class*="_card"]')]
  .map(e => (e.textContent ?? '').slice(0, 30)).slice(0, 8))
console.log('=== 群视图里的话题卡 ===', cards)
await p.evaluate(() => {
  const card = [...document.querySelectorAll('button')].find(e => (e.textContent ?? '').includes('yapi_export'))
  card?.click()
})
await p.waitForTimeout(13000)
console.log(await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="_msg"]')]
  const pub = [...document.querySelectorAll('button')].filter(e => (e.textContent ?? '').trim() === '↗ 发到群里')
  return {
    行数: rows.length,
    发到群里按钮: pub.length,
    所有气泡: [...document.querySelectorAll('[class*="_bubble"]')]
      .map(e => (e.textContent ?? '').slice(0, 34)),
    动词条: [...document.querySelectorAll('[class*="_verb"]')].map(e => (e.textContent ?? '').trim()).slice(0, 10),
  }
}))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await p.screenshot({ path: '.acceptance/m0/v50-publish.png' })
await b.close()
