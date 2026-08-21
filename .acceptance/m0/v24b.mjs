import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
await page.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await page.waitForTimeout(8000)
// 收起在岗那个群的话题子行，好让轻量会话行进入视野
await page.evaluate(() => {
  document.querySelector('nav [class*="_placeRow"] button[class*="_chev"]')?.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
  const tree = document.querySelector('nav [class*="_tree"]')
  if (tree !== null) tree.scrollTop = 0
})
await page.screenshot({ path: '.acceptance/m0/v24-rows.png' })
// 真正的行数：只数顶层会话行
console.log(await page.evaluate(() => {
  const tree = document.querySelector('nav [class*="_tree"]')
  const rows = [...(tree?.querySelectorAll(':scope > div > button[class*="_item"], :scope > div > div[class*="_placeRow"]') ?? [])]
  return {
    top: rows.length,
    sample: rows.slice(0, 14).map(el => el.innerText.replace(/\n/g, ' | ').slice(0, 56)),
  }
}))
await browser.close()
