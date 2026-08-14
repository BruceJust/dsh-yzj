/** Debug: click a proxy image, dump what happens. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.getByLabel('云之家悬浮窗').click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
await dialog.locator('button[class*="item"]').filter({ hasText: '灵基Chat' }).first().click()
await page.waitForTimeout(4000)

// mirror verify-im's preceding reads
const senderTexts = await dialog.locator('[class*="msgSender"]').allInnerTexts().catch(() => [])
console.log('senders:', senderTexts.length)
const imageCount = await dialog.locator('img[class*="msgImage"]').count()
console.log('msgImage count:', imageCount)
if (imageCount > 0) {
  const first = dialog.locator('img[class*="msgImage"]').first()
  console.log('clicking first msgImage')
  await first.click()
  await page.waitForTimeout(400)
  const lightbox = page.locator('[class*="lightbox"]')
  const cnt = await lightbox.count()
  console.log('lightbox count after click:', cnt)
  if (cnt > 0) {
    const vis = await lightbox.first().isVisible()
    console.log('lightbox visible:', vis)
    const cls = await lightbox.first().getAttribute('class').catch(() => '?')
    console.log('lightbox class:', cls)
    const imgSrc = await lightbox.locator('img').first().getAttribute('src').catch(() => '?')
    console.log('lightbox img src prefix:', String(imgSrc).slice(0, 30))
  }
}
await browser.close()
