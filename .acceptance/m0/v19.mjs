/**
 * v19 — 变更记录 #40/#41/#42.
 *
 * 1. 工作块看得出在跑还是跑完了（进行中脉冲 / ✓已完成+用时 / ⚠失败）
 * 2. ＋打开本地文件夹 直接开宿主的系统目录对话框，不再先弹自己的框
 * 3. 本地会话行有时间和 ⋯ 菜单（重命名/分叉对话/归档对话）
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

const text = () => page.evaluate(() => document.body.innerText)

console.log('=== 侧栏 ===')
console.log((await text()).slice(0, 800))
await page.screenshot({ path: '.acceptance/m0/v19-sidebar.png' })

// ---- 会话行：时间 + ⋯ 菜单 ----
const rows = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('nav [class*="itemSub"]')) {
    const more = el.querySelector('button[aria-label="会话操作"]')
    out.push({
      text: el.innerText.replace(/\n/g, ' | '),
      hasMore: more !== null,
    })
  }
  return out
})
console.log('=== 子行 ===')
console.log(JSON.stringify(rows, null, 1))

// hover a local session row and open its menu
const more = page.locator('nav button[aria-label="会话操作"]').first()
if (await more.count() > 0) {
  await more.evaluate(el => { el.click() })
  await page.waitForTimeout(400)
  const menu = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('body > div, body > *')]
      .map(el => el.innerText ?? '')
      .filter(t => t.includes('重命名'))
    return cards[0] ?? '(菜单没出来)'
  })
  console.log('=== ⋯ 菜单 ===')
  console.log(menu.replace(/\n/g, ' / '))
  await page.screenshot({ path: '.acceptance/m0/v19-menu.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
} else {
  console.log('=== ⋯ 菜单 === (没有本地会话行)')
}

// ---- 打开一个话题，看工作块 ----
const topic = page.locator('nav [class*="itemSub"] button').first()
if (await topic.count() > 0) {
  await topic.evaluate(el => { el.click() })
  await page.waitForTimeout(3000)
}
const work = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('[class*="workHead"]')]
  return heads.map(h => h.innerText.replace(/\n/g, ' '))
})
console.log('=== 工作块头 ===')
console.log(work.length === 0 ? '(这个会话没有工作块)' : work.join('\n'))
await page.screenshot({ path: '.acceptance/m0/v19-work.png' })

// expand the first work block for the per-step durations
const head = page.locator('[class*="workHead"]').first()
if (await head.count() > 0) {
  await head.evaluate(el => { el.click() })
  await page.waitForTimeout(500)
  const steps = await page.evaluate(() => (
    [...document.querySelectorAll('[class*="steps"] [class*="step"]')]
      .map(s => s.innerText.replace(/\n/g, ' ').slice(0, 90))
      .filter(t => t.trim() !== '')
      .slice(0, 8)
  ))
  console.log('=== 步骤 ===')
  console.log(steps.join('\n'))
  await page.screenshot({ path: '.acceptance/m0/v19-steps.png' })
}

console.log('=== console 错误 ===')
console.log(errors.slice(0, 8).join('\n') || '  (none)')
await browser.close()
