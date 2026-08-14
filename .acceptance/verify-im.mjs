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
ok('message times formatted (HH:mm / 昨天 HH:mm / MM-DD HH:mm)', timeTexts.length > 0 && timeTexts.every(t => /^\d{2}:\d{2}$|^昨天 \d{2}:\d{2}$|^\d{2}-\d{2} \d{2}:\d{2}$/.test(t.trim())), timeTexts.slice(0, 3).join(', '))

// ---- 2b. the chat header (返回会话) is pinned above the scrollable list ----
const backBtn = dialog.getByRole('button', { name: '返回会话' })
const boxBefore = await backBtn.boundingBox().catch(() => null)
await dialog.locator('div[class*="list"]').last().evaluate(el => { el.scrollTop = el.scrollHeight }).catch(() => {})
await page.waitForTimeout(300)
const boxAfter = await backBtn.boundingBox().catch(() => null)
ok('back button stays pinned while the list scrolls',
  boxBefore !== null && boxAfter !== null && Math.abs(boxBefore.y - boxAfter.y) < 1,
  `y ${boxBefore?.y ?? '?'} → ${boxAfter?.y ?? '?'}`)
// The CLI returns messages oldest-first; the chat must read top-down
// chronologically (today's HH:mm sorts after any MM-DD day).
const timeToNum = (t) => {
  const m = t.trim().match(/^(?:(\d{2})-(\d{2}) )?(\d{2}):(\d{2})$/)
  if (m) {
    const day = m[1] !== undefined ? Number(m[1]) * 100 + Number(m[2]) : 999
    return day * 10000 + Number(m[3]) * 100 + Number(m[4])
  }
  if (t.trim().startsWith('昨天')) {
    const hm = t.trim().match(/(\d{2}):(\d{2})$/)
    return hm ? 998 * 10000 + Number(hm[1]) * 100 + Number(hm[2]) : 9980000
  }
  return 0
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
const otherMessages = await dialog.locator('[class*="msgRow"]').count()
ok('second group loads messages', otherMessages > 0, `${otherMessages} messages`)
await dialog.getByRole('button', { name: '返回会话' }).click()
await page.waitForTimeout(400)
await groupButtons.filter({ hasText: '灵基Chat' }).first().click()
await page.waitForTimeout(800)
const cachedMessages = await dialog.locator('[class*="msgRow"]').count()
ok('revisit reuses the cached window (instant render)', cachedMessages > 0, `${cachedMessages} messages`)

// ---- 6. reference-style IM layout: meta lines, avatars, dividers, chips ----
const metaLines = await dialog.locator('[class*="msgMetaLine"]').count()
ok('messages render name · time meta lines', metaLines > 0, `${metaLines} lines`)
const avatars = await dialog.locator('[class*="msgAvatar"]').count()
ok('sender avatars render', avatars > 0, `${avatars} avatars`)
const dividers = await dialog.locator('[class*="dayDivider"]').count()
ok('day dividers separate dates', dividers > 0, `${dividers} dividers`)
const chips = await dialog.locator('button[class*="groupChip"]').count()
ok('group chips row enables quick switching', chips > 0, `${chips} chips`)
const activeChips = await dialog.locator('button[class*="groupChipActive"]').count()
ok('current group chip is active', activeChips >= 1, `${activeChips} active`)
const imText = await dialog.innerText().catch(() => '')
ok('bracket emoticons render as emoji ([握手]/[机智] gone)', !imText.includes('[握手]') && !imText.includes('[机智]'), 'no raw [token] text')

// ---- 7. opening a group marks it read locally (real unread numbers) ----
await dialog.getByRole('button', { name: '返回会话' }).click()
await page.waitForTimeout(600)
// Pick the first group that currently shows an unread badge (real data).
const unreadRow = dialog.locator('button[class*="item"]:has([class*="badge"])').first()
const badgeBefore = await unreadRow.locator('[class*="badge"]').count().catch(() => 0)
const unreadName = (await unreadRow.innerText().catch(() => '')).split('\n')[0]
if (unreadName !== '') {
  await unreadRow.click()
  await page.waitForTimeout(2500)
  await dialog.getByRole('button', { name: '返回会话' }).click()
  await page.waitForTimeout(600)
  const badgeAfter = await dialog.locator('button[class*="item"]').filter({ hasText: unreadName }).first()
    .locator('[class*="badge"]').count().catch(() => 0)
  ok(`opening "${unreadName}" clears its unread badge locally`, badgeAfter === 0, `badge rows → ${badgeAfter}`)
} else {
  ok('opening a group clears its unread badge locally (no unread groups found)', true, 'nothing to clear')
}

// ---- 8. 全部已读: clears every badge at once ----
const readAll = dialog.locator('button[class*="readAll"]')
let readAllVisible = false
try { await readAll.waitFor({ state: 'visible', timeout: 5000 }); readAllVisible = true } catch {}
ok('全部已读 button visible in the group list', readAllVisible)
await readAll.click().catch(() => {})
await page.waitForTimeout(800)
const badgesAfterAll = await dialog.locator('button[class*="item"]:has([class*="badge"])').count().catch(() => 0)
ok('全部已读 clears every badge', badgesAfterAll === 0, `${badgesAfterAll} badge rows left`)

// ---- 9. persistence: a page reload keeps the read state (no 99+ again) ----
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const dialog2 = page.getByRole('dialog', { name: '云之家' })
let panelUp = false
try { await dialog2.waitFor({ state: 'visible', timeout: 5000 }); panelUp = true } catch {}
if (!panelUp) {
  await page.getByLabel('云之家悬浮窗').waitFor({ state: 'visible', timeout: 20000 })
  await page.getByLabel('云之家悬浮窗').click()
  await dialog2.waitFor({ state: 'visible', timeout: 15000 })
}
await dialog2.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(4000)
const badgesAfterReload = await dialog2.locator('button[class*="item"]:has([class*="badge"])').count().catch(() => 0)
ok('read state persists across a reload (badges stay cleared)', badgesAfterReload === 0, `${badgesAfterReload} badge rows after reload`)
const stored = await page.evaluate(() => (window.localStorage.getItem('dsh.yzj.imcache.v1') ?? '').slice(0, 80))
ok('im cache persisted to localStorage', stored !== '', stored)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
