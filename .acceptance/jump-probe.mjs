/** Probe: does the card 查看 button change the panel store? */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 300)) })

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
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
  const storedBefore = await page.evaluate(() => window.localStorage.getItem('dsh.yzj.panel.v3') ?? '')
  await page.locator('[class*="card"] button[class*="jump"]').first().click()
  await page.waitForTimeout(1500)
  const storedAfter = await page.evaluate(() => window.localStorage.getItem('dsh.yzj.panel.v3') ?? '')
  const dialogs = await page.getByRole('dialog', { name: '云之家' }).count()
  console.log('after:', storedAfter.slice(0, 80))
  console.log('dialogs:', dialogs)
  // Is the ball still visible? (it hides while the panel store is open)
  const ballCount = await page.getByLabel('云之家悬浮窗').count()
  const ballVisible = ballCount > 0 ? await page.getByLabel('云之家悬浮窗').isVisible().catch(() => false) : false
  console.log('ball after jump: count', ballCount, 'visible', ballVisible)
  if (ballVisible) {
    await page.getByLabel('云之家悬浮窗').click()
    await page.waitForTimeout(1500)
    console.log('dialogs after ball click:', await page.getByRole('dialog', { name: '云之家' }).count())
  }
  const panel = page.getByRole('dialog', { name: '云之家' })
  if (await panel.count() > 0) {
    await page.waitForTimeout(3500)
    const rightText = await panel.locator('[class*="paneRight"]').innerText().catch(() => '')
    console.log('right pane text:', rightText.replace(/\s+/g, ' ').slice(0, 120))
    const rows = await panel.locator('[class*="paneRight"] [class*="msgRow"]').count()
    console.log('msgRows:', rows)
    const store = await page.evaluate(() => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem('dsh.yzj.panel.v3') ?? '{}')
        return { groupId: parsed.groupId, messages: (parsed.messages ?? []).length, groups: (parsed.groups ?? []).length }
      } catch { return { groupId: '', messages: -1, groups: -1 } }
    })
    console.log('store:', JSON.stringify(store))
  }
  const dump = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('[class*="panel"]')].filter(el => String(el.className).includes('panel') && el.getBoundingClientRect().width > 0)
    const aria = [...document.querySelectorAll('[aria-label="云之家"]')].map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 40), rect: Math.round(el.getBoundingClientRect().width) }))
    const overlay = [...document.querySelectorAll('[class*="overlay"]')].map(el => String(el.className).slice(0, 40))
    return { panelEls: panel.length, aria, overlays: overlay.slice(0, 5) }
  })
  console.log('dump:', JSON.stringify(dump, null, 1))
}
await browser.close()
