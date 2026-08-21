/**
 * v19d — 让工具跑满 6 秒，把「进行中 · 工具名 · 计时」和分隔号的边界看清楚。
 * 之前一次实测抓到了 `bash ·` 后面空着的悬挂分隔号（调用比 tick 年轻，
 * 时长算出来是 0，而 durationOf 不肯印 0）。
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

await page.locator('textarea').first().fill('用 bash 跑一句 `sleep 6 && echo done`，把输出给我')
await page.locator('button', { hasText: '发送' }).first().evaluate(el => { el.click() })

let sawRunning = false
let shotDone = false
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(1000)
  const shot = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('[class*="workHead"]')]
    const last = heads.at(-1)
    return {
      head: last?.innerText.replace(/\n/g, ' ') ?? '',
      live: document.querySelector('[class*="liveMark"]')?.innerText.replace(/\n/g, ' ') ?? '',
      steps: [...document.querySelectorAll('[class*="steps"] > div')]
        .map(s => s.innerText.replace(/\n/g, ' ')),
    }
  })
  const running = shot.head.includes('进行中')
  if (running || i < 3) console.log(`${i}s`, '|', shot.head || '(无工作块)', '|', shot.live || '-')
  if (running && !sawRunning) {
    sawRunning = true
    await page.locator('[class*="workHead"]').last().evaluate(el => { el.click() })
  }
  if (running && !shotDone) {
    await page.screenshot({ path: '.acceptance/m0/v19-running.png' })
    shotDone = true
  }
  if (running) console.log('   步骤:', shot.steps.join(' ‖ ') || '(未展开)')
  if (!running && sawRunning) {
    console.log(`${i}s 收尾 |`, shot.head)
    await page.screenshot({ path: '.acceptance/m0/v19-settled.png' })
    break
  }
}
console.log('抓到进行中:', sawRunning)
console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
