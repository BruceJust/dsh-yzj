/**
 * v19c — 回合正在跑的时候，中栏说得出来。
 *
 * 在一个本地会话里发一句必然要调工具的话，然后每秒采一次样：
 * 「等待模型 / 正在思考 / 正在回答」的活动行，工作块头的 进行中+脉冲+当前工具+
 * 计时，收尾之后的 ✓已完成+用时。
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

// 本地会话（云之家工作夹下的 hi），不是话题：不会往群里发东西
const row = page.locator('nav [class*="itemSub"] button[class*="rowBody"]').last()
await row.evaluate(el => { el.click() })
await page.waitForTimeout(2500)

const box = page.locator('textarea').first()
await box.fill('列出当前工作目录下的文件，只要文件名')
await page.locator('button', { hasText: '发送' }).first().evaluate(el => { el.click() })

const sample = async (label) => {
  const shot = await page.evaluate(() => ({
    live: document.querySelector('[class*="liveMark"]')?.innerText.replace(/\n/g, ' ') ?? '',
    thinking: document.querySelector('[class*="thinking"]')?.innerText.slice(0, 70) ?? '',
    heads: [...document.querySelectorAll('[class*="workHead"]')]
      .map(h => h.innerText.replace(/\n/g, ' ')),
    chip: document.querySelector('[class*="chipAgent"]')?.innerText.replace(/\n/g, ' ') ?? '',
  }))
  console.log(`--- ${label} ---`)
  console.log('agent chip :', shot.chip)
  console.log('活动行     :', shot.live || '(无)', shot.thinking ? `· ${shot.thinking}` : '')
  console.log('工作块     :', shot.heads.at(-1) ?? '(无)')
  return shot
}

for (const t of [1, 2, 3, 5, 8, 12, 18, 26]) {
  await page.waitForTimeout(t === 1 ? 900 : 1000 * (t - (t === 2 ? 1 : 0)) - 0)
  await sample(`${t}s 左右`)
  if (t === 3) await page.screenshot({ path: '.acceptance/m0/v19-running.png' })
}
await page.screenshot({ path: '.acceptance/m0/v19-settled.png' })

console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
