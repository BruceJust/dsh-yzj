import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(9000)
const mem = async (label) => {
  await page.locator('button', { hasText: /^记忆/ }).last().evaluate(el => { el.click() })
  await page.waitForTimeout(500)
  const out = await page.evaluate(() => {
    const panel = document.querySelector('[data-slot="details"]')
    return {
      radius: panel?.querySelector('[class*="_radius"]')?.textContent ?? '',
      items: [...(panel?.querySelectorAll('[class*="_memCard"]') ?? [])].map(el => el.innerText.replace(/\n/g,' | ').slice(0,60)),
    }
  })
  console.log(`${label}: ${out.radius} -> ${out.items.join(' ‖ ') || '(空)'}`)
}
// 进 dsh-2 的一个话题
await page.evaluate(() => {
  for (const el of document.querySelectorAll('nav button[class*="_itemSub"]')) { el.click(); return }
})
await page.waitForTimeout(4000)
await mem('话题1')
// 换一个话题再回来
const subs = await page.evaluate(() => document.querySelectorAll('nav button[class*="_itemSub"]').length)
console.log('话题子行数:', subs)
await page.evaluate(() => {
  const all = document.querySelectorAll('nav button[class*="_itemSub"]')
  all[1]?.click()
})
await page.waitForTimeout(4000)
await mem('话题2')
// 进群视图（frame=place）——右栏跟不跟得上？
await page.evaluate(() => {
  for (const el of document.querySelectorAll('nav [class*="_rowBody"]')) {
    if (el.textContent?.includes('dsh-2')) { el.click(); return }
  }
})
await page.waitForTimeout(4000)
await mem('群视图')
// 再进一个本地会话
await page.evaluate(() => {
  const el = [...document.querySelectorAll('nav [class*="_itemSub"] button[class*="_rowBody"]')].at(-1)
  el?.click()
})
await page.waitForTimeout(4000)
await mem('本地会话')
await browser.close()
