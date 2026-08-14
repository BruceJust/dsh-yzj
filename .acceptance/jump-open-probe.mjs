/** Probe: card 查看 jump with the panel ALREADY OPEN (user's typical state). */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)) })

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)

// Open the panel FIRST (like the user's persistent open state)
await page.getByLabel('云之家悬浮窗').click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
// Open a group so the panel sits in a deep state
await dialog.locator('[class*="paneLeft"] button[class*="item"]').filter({ hasText: '灵基Chat' }).first().click()
await page.waitForTimeout(3000)
console.log('panel open with 灵基Chat; msgRows:', await dialog.locator('[class*="msgRow"]').count())
// Close the panel but keep the deep store state (chat tab + 灵基Chat)
await dialog.getByRole('button', { name: '关闭' }).click()
await page.waitForTimeout(800)

// Now trigger an agent tool call
const draft = page.locator('textarea').first()
await draft.click()
await draft.fill('请调用 yzj_im_group_recent 工具查一下云之家最近会话')
await page.getByRole('button', { name: '发送消息' }).first().click()

let found = false
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000)
  const count = await page.locator('[class*="card"] button[class*="jump"]').count()
  if (count > 0) { found = true; break }
}
console.log('jump buttons found:', found)
if (found) {
  const jump = page.locator('[class*="card"] [class*="row"]:has-text("未读"):not(:has-text("待办通知")) button[class*="jump"]').first()
  await jump.click()
  await page.waitForTimeout(3000)
  const dialogs = await page.getByRole('dialog', { name: '云之家' }).count()
  const ball = await page.getByLabel('云之家悬浮窗').count()
  const rows = dialogs > 0 ? await page.getByRole('dialog', { name: '云之家' }).locator('[class*="msgRow"]').count() : 0
  const rightText = dialogs > 0 ? await page.getByRole('dialog', { name: '云之家' }).locator('[class*="paneRight"]').innerText().catch(() => '') : ''
  console.log('after jump: dialogs', dialogs, '| ball', ball, '| msgRows', rows, '| right:', rightText.replace(/\s+/g, ' ').slice(0, 70))
}
await browser.close()
