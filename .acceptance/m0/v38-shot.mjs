/** v38 — 最终形态截图：目标行 + 成功标准 + 子承诺 + 产出 + 差距简报（全部展开）。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(11000)
await p.locator('nav button', { hasText: '承诺板' }).first().evaluate(e => { e.click() })
await p.waitForTimeout(2000)
await p.locator('button', { hasText: /^按目标$/ }).first().evaluate(e => { e.click() })
await p.waitForTimeout(1500)
await p.evaluate(() => {
  const mine = [...document.querySelectorAll('[class*="_goalBlock"]')]
    .find(x => x.textContent?.includes('v34目标-'))
  ;[...(mine?.querySelectorAll('[class*="_drawerHead"]') ?? [])].forEach(h => { h.click() })
})
await p.waitForTimeout(1200)
await p.screenshot({ path: '.acceptance/m0/v38-board.png' })
await b.close()
