/** Probe: docs tab — workspaces, docs list, doc preview errors. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 250)))
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 250)) })

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.getByLabel('云之家悬浮窗').click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '知识库' }).first().click()
await page.waitForTimeout(4000)

const wsCount = await dialog.locator('[class*="paneLeft"] button[class*="item"]').count()
console.log('workspaces:', wsCount)
if (wsCount > 0) {
  const firstWs = await dialog.locator('[class*="paneLeft"] button[class*="item"]').first().innerText()
  console.log('first workspace:', firstWs.replace(/\s+/g, ' ').slice(0, 40))
  await dialog.locator('[class*="paneLeft"] button[class*="item"]').first().click()
  await page.waitForTimeout(4000)
  const rightText = await dialog.locator('[class*="paneRight"]').innerText().catch(() => '')
  console.log('right pane:', rightText.replace(/\s+/g, ' ').slice(0, 100))
  const docs = await dialog.locator('[class*="paneRight"] button[class*="item"]').count()
  console.log('docs:', docs)
  if (docs > 0) {
    const firstDoc = await dialog.locator('[class*="paneRight"] button[class*="item"]').first().innerText()
    console.log('first doc:', firstDoc.replace(/\s+/g, ' ').slice(0, 50))
    await dialog.locator('[class*="paneRight"] button[class*="item"]').first().click()
    await page.waitForTimeout(5000)
    const preview = await dialog.locator('[class*="docBody"]').count()
    const bodyText = preview > 0 ? await dialog.locator('[class*="docBody"]').innerText().catch(() => '') : ''
    console.log('preview rendered:', preview, '| body:', bodyText.replace(/\s+/g, ' ').slice(0, 80))
  }
}
await browser.close()
