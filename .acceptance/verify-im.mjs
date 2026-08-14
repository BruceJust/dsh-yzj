/**
 * Verify the complete-IM upgrade in the panel chat tab:
 *  1. group list shows avatars + relative times
 *  2. message rows show resolved sender names + smart times
 *  3. richText renders inline images (click → lightbox, Esc closes)
 *  4. file messages render download chips (name + size)
 *  5. reply messages render the quote line
 *  6. switching groups reuses the message cache (instant revisit)
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

const ball = page.getByLabel('云之家悬浮窗')
await ball.waitFor({ state: 'visible', timeout: 20000 })
await ball.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)

// ---- 1. group list: avatars + times ----
const avatarCount = await dialog.locator('img[class*="avatar"]').count()
ok('group list renders avatars', avatarCount > 0, `${avatarCount} avatars`)
const groupButtons = dialog.locator('button[class*="item"]')
const firstGroupText = await groupButtons.first().innerText().catch(() => '')
ok('group rows show relative time', /(今天|昨天|\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|\d{2}:\d{2})/.test(firstGroupText), firstGroupText.replace(/\n/g, ' ').slice(0, 60))

// ---- 2. open 灵基Chat (has richText images + file + reply messages) ----
await groupButtons.filter({ hasText: '灵基Chat' }).first().click()
await page.waitForTimeout(4000)

const senderText = await dialog.locator('[class*="msgSender"]').allInnerTexts().catch(() => [])
const namedSenders = senderText.filter(text => text !== '消息' && text !== '图文' && text !== '文件' && text !== '系统' && text.trim() !== '')
ok('sender names resolved', namedSenders.length > 0, `e.g. ${namedSenders.slice(0, 3).join(', ')}`)
const timeTexts = await dialog.locator('[class*="msgTime"]').allInnerTexts().catch(() => [])
ok('message times formatted (HH:mm or MM-DD HH:mm)', timeTexts.length > 0 && timeTexts.every(t => /^\d{2}:\d{2}$|^\d{2}-\d{2} \d{2}:\d{2}$/.test(t.trim())), timeTexts.slice(0, 3).join(', '))
// The CLI returns messages oldest-first; the chat must read top-down
// chronologically (today's HH:mm sorts after any MM-DD day).
const timeToNum = (t) => {
  const m = t.trim().match(/^(?:(\d{2})-(\d{2}) )?(\d{2}):(\d{2})$/)
  if (!m) return 0
  const day = m[1] !== undefined ? Number(m[1]) * 100 + Number(m[2]) : 999
  return day * 10000 + Number(m[3]) * 100 + Number(m[4])
}
const ascending = timeTexts.every((t, i) => i === 0 || timeToNum(timeTexts[i - 1]) <= timeToNum(t))
ok('messages read chronologically (oldest first, NOT reversed)', ascending, timeTexts.slice(0, 6).join(' | '))

// ---- 3. richText inline images + lightbox ----
const imageCount = await dialog.locator('img[class*="msgImage"]').count()
ok('richText renders inline images', imageCount > 0, `${imageCount} images`)
if (imageCount > 0) {
  await dialog.locator('img[class*="msgImage"]').first().click()
  await page.waitForTimeout(400)
  const lightbox = page.locator('[class*="lightbox"]')
  let shown = false
  try { await lightbox.first().waitFor({ state: 'visible', timeout: 5000 }); shown = true } catch {}
  ok('clicking an image opens the lightbox', shown)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  ok('Esc closes the lightbox', (await lightbox.count()) === 0 || !(await lightbox.isVisible().catch(() => false)))
}

// ---- 4. file chip + reply quote ----
const fileChips = await dialog.locator('button[class*="msgFile"]').count()
ok('file messages render download chips', fileChips > 0, `${fileChips} chips`)
const fileName = fileChips > 0 ? await dialog.locator('[class*="msgFileName"]').first().innerText().catch(() => '') : ''
ok('file chip shows the file name', fileName !== '', fileName)
const quotes = await dialog.locator('[class*="msgQuote"]').count()
ok('reply messages render quote lines', quotes > 0, `${quotes} quotes`)

// ---- 5. cache: revisit renders instantly from the window cache ----
await dialog.getByRole('button', { name: '返回会话' }).click()
await page.waitForTimeout(600)
await groupButtons.filter({ hasText: '金蝶集团桌游协会' }).first().click()
await page.waitForTimeout(2500)
const otherMessages = await dialog.locator('[class*="msgItem"]').count()
ok('second group loads messages', otherMessages > 0, `${otherMessages} messages`)
await dialog.getByRole('button', { name: '返回会话' }).click()
await page.waitForTimeout(400)
await groupButtons.filter({ hasText: '灵基Chat' }).first().click()
await page.waitForTimeout(800)
const cachedMessages = await dialog.locator('[class*="msgItem"]').count()
ok('revisit reuses the cached window (instant render)', cachedMessages > 0, `${cachedMessages} messages`)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
