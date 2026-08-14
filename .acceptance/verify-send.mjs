/**
 * Verify the real-IM composer on the dsh测试 group:
 *  1. text send (button + Enter)
 *  2. image send (upload → richText [图片]) — shown inline + server-confirmed
 *  3. file send (upload → file chip)
 *  4. reply flow (hover 回复 → reply bar → send → quote shown)
 * All messages land in dsh测试 (the user's designated test group).
 */
import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const GROUP_ID = '6a7f37b4e4b0e6211b1c5b87' // dsh测试
const GROUP_NAME = 'dsh测试'
const FIXTURE = join(HERE, 'fixture.png')
const FIXTURE_TXT = join(HERE, 'fixture.txt')
// 1x1 red PNG
writeFileSync(FIXTURE, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
writeFileSync(FIXTURE_TXT, 'yzj panel file-send fixture\n')

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

await page.getByLabel('云之家悬浮窗').click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
await dialog.locator('nav button').filter({ hasText: '会话' }).first().click()
await page.waitForTimeout(3000)
await dialog.locator('button[class*="item"]').filter({ hasText: GROUP_NAME }).first().click()
await page.waitForTimeout(3500)

const composer = dialog.locator('textarea[class*="composerInput"]')
let composerVisible = false
try { await composer.waitFor({ state: 'visible', timeout: 5000 }); composerVisible = true } catch {}
ok('composer visible inside the group view', composerVisible)

// ---- 1. text send via button ----
const MARK = `【面板文本测试】${Date.now()}`
const sendBtn = dialog.locator('button[class*="composerSend"]')
await composer.fill(MARK)
await sendBtn.click()
await page.waitForTimeout(4000)
ok('text message appears in the panel', (await dialog.innerText()).includes(MARK), MARK.slice(0, 30))

// ---- 2. image send (upload → richText) ----
const imageInput = dialog.locator('input[type="file"][accept^="image"]')
await imageInput.setInputFiles(FIXTURE)
await page.waitForTimeout(8000)
const inlineImages = await dialog.locator('img[class*="msgImage"]').count()
ok('sent image renders inline via proxy', inlineImages >= 1, `${inlineImages} images`)
ok('uploading status cleared', !(await dialog.innerText()).includes('上传中'))

// ---- 3. file send (upload → file chip; png files preview inline instead) ----
const fileInput = dialog.locator('input[type="file"]:not([accept])')
await fileInput.setInputFiles(FIXTURE_TXT)
await page.waitForTimeout(8000)
const fileChips = await dialog.locator('button[class*="msgFile"]').count()
ok('sent file renders a download chip', fileChips >= 1, `${fileChips} chips`)
ok('file chip shows the fixture name', (await dialog.innerText()).includes('fixture.txt'))

// ---- 4. reply flow (on our own text message; system rows have no 回复) ----
const targetRow = dialog.locator('[class*="msgRow"]').filter({ hasText: MARK }).first()
await targetRow.hover()
await page.waitForTimeout(300)
await targetRow.locator('button[class*="msgReply"]').click()
await page.waitForTimeout(300)
const replyBar = dialog.locator('[class*="replyBar"]')
ok('reply bar appears after 回复', await replyBar.isVisible().catch(() => false))
await composer.fill(`【面板回复测试】${Date.now()}`)
await page.keyboard.press('Enter')
await page.waitForTimeout(4000)
const quotes = await dialog.locator('[class*="msgQuote"]').count()
ok('reply message shows the quote line', quotes >= 1, `${quotes} quotes`)

// ---- 5. server-side confirmation (CLI) ----
const entry = 'C:\\Users\\rocks\\AppData\\Roaming\\npm\\node_modules\\@yunzhijia\\cli'
const list = await new Promise((resolve) => {
  execFile('node', [entry + '\\scripts\\run.js', 'im', 'message', 'list', '--group-id', GROUP_ID, '--limit', '20'], { timeout: 60000 }, (err, stdout) => {
    resolve(err === null ? stdout : '')
  })
})
ok('text confirmed on the server', list.includes(MARK), MARK.slice(0, 30))
ok('richText image message confirmed on the server', list.includes('[图片]'))
ok('file message confirmed on the server', list.includes('fixture.txt'))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
