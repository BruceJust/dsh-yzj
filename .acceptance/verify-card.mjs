/**
 * Verify the redesigned conversation tool cards: the agent calls real yzj
 * tools from the chat; the rendered card shows the family title + 云之家
 * pill and NEVER leaks raw ids (groupId / msgId / openId / hex ids).
 */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

let failures = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
  if (!cond) failures++
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 250)}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)

/** The card's full text: smallest element whose class contains "card"
 *  and whose text includes every needle (conversation text excluded). */
async function cardText(needles) {
  return page.evaluate((ns) => {
    const els = [...document.querySelectorAll('[class*="card"]')].filter(el =>
      ns.every(n => (el.textContent ?? '').includes(n)))
    if (els.length === 0) return ''
    return els.sort((a, b) => a.textContent.length - b.textContent.length)[0].textContent ?? ''
  }, needles)
}

async function ask(prompt) {
  const draft = page.locator('textarea').first()
  await draft.click()
  await draft.fill(prompt)
  await page.getByRole('button', { name: '发送消息' }).first().click()
}

// ---- 1. yzj_im_group_recent card: clean rows, no ids ----
await ask('请调用 yzj_im_group_recent 工具查一下云之家最近会话，直接列出结果')
let text = ''
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000)
  text = await cardText(['最近会话', '云之家'])
  if (text !== '') break
}
ok('im group card renders (最近会话 + 云之家)', text.includes('最近会话') && text.includes('云之家'), text.slice(0, 60))
ok('im group card shows group names', /[一-龥]{2,}/.test(text), text.slice(0, 60))
ok('im group card leaks no raw ids', !/(groupId|msgId|openId|workId|[a-f0-9]{24})/.test(text), text.replace(/\s+/g, ' ').slice(0, 100))

// ---- 1b. card 查看 → floating panel jumps to that group ----
// Pick a row with unread (alert groups have real messages; 待办通知's
// message endpoint returns empty).
const jumpBtn = page.locator('[class*="card"] [class*="row"]:has-text("未读") button[class*="jump"]').first()
let jumpClicked = false
try {
  await jumpBtn.waitFor({ state: 'visible', timeout: 10000 })
  await jumpBtn.click()
  jumpClicked = true
} catch {}
ok('card has a 查看 jump button', jumpClicked)
if (jumpClicked) {
  const panel = page.getByRole('dialog', { name: '云之家' })
  let panelOpened = false
  try { await panel.waitFor({ state: 'visible', timeout: 15000 }); panelOpened = true } catch {}
  ok('jump opens the floating panel', panelOpened)
  await page.waitForTimeout(3000)
  const rightMessages = await panel.locator('[class*="paneRight"] [class*="msgRow"]').count()
  ok('panel lands on the group messages', rightMessages > 0, `${rightMessages} rows`)
  const activeRows = await panel.locator('button[class*="itemActive"]').count()
  ok('group highlighted in the left pane', activeRows >= 1, `${activeRows} active`)
  await panel.getByRole('button', { name: '关闭' }).click()
  await page.waitForTimeout(600)
}

// ---- 2. yzj_whoami card ----
await ask('请调用 yzj_whoami 查一下我的云之家信息')
text = ''
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000)
  text = await cardText(['我的信息', '云之家'])
  if (text !== '') break
}
ok('whoami card renders (我的信息 + 云之家)', text.includes('我的信息') && text.includes('云之家'), text.slice(0, 60))
ok('whoami card shows the user name', text.includes('单国鑫'), text.slice(0, 60))
ok('whoami card leaks no raw ids', !/(openId|oId|userId|[a-f0-9]{24})/.test(text), text.replace(/\s+/g, ' ').slice(0, 100))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
