/** Probe: do group rows render unread badges at all? */
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

// mirror verify-im: open 灵基Chat, back, open 金蝶集团桌游协会, back
await dialog.locator('button[class*="item"]').filter({ hasText: '灵基Chat' }).first().click()
await page.waitForTimeout(4000)
await dialog.getByRole('button', { name: '返回会话' }).click()
await page.waitForTimeout(600)
await dialog.locator('button[class*="item"]').filter({ hasText: '金蝶集团桌游协会' }).first().click()
await page.waitForTimeout(2500)
await dialog.getByRole('button', { name: '返回会话' }).click()
await page.waitForTimeout(600)

const rows = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button')) {
    const cls = String(el.className)
    if (!cls.includes('item')) continue
    const hasBadge = el.querySelector('[class*="badge"]') !== null
    out.push({ text: (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 36), hasBadge })
  }
  return out
})
const filterCount = await dialog.locator('button[class*="item"]').filter({ has: dialog.locator('[class*="badge"]') }).count()
console.log('playwright filter count:', filterCount)
const badgeLocCount = await dialog.locator('button[class*="item"] [class*="badge"]').count()
console.log('descendant badge count:', badgeLocCount)
await browser.close()
