/**
 * Verify the panel message composer:
 *  1. composer visible inside a group view
 *  2. typing + 发送 posts a real message (verified via the CLI)
 *  3. the sent message appears in the list with the sender's name
 *  4. Enter sends too; empty draft disables the button
 */
import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

const GROUP_ID = '6a7f37b4e4b0e6211b1c5b87' // dsh测试 (user's designated test group)
const GROUP_NAME = 'dsh测试'
const MARK = `【面板发消息测试】${Date.now()}`

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

// ---- 1. open the test group ----
await dialog.locator('button[class*="item"]').filter({ hasText: GROUP_NAME }).first().click()
await page.waitForTimeout(3500)

// ---- 2. composer present; empty draft disables send ----
const composer = dialog.locator('input[class*="composerInput"]')
let composerVisible = false
try { await composer.waitFor({ state: 'visible', timeout: 5000 }); composerVisible = true } catch {}
ok('composer visible inside the group view', composerVisible)
const sendBtn = dialog.locator('button[class*="composerSend"]')
ok('send disabled on empty draft', await sendBtn.isDisabled().catch(() => false))

// ---- 3. type and send via button ----
await composer.fill(MARK)
await page.waitForTimeout(200)
ok('send enabled after typing', !(await sendBtn.isDisabled().catch(() => true)))
await sendBtn.click()
await page.waitForTimeout(4000)

// The message appears in the panel list (sender = the login user).
const panelText = await dialog.innerText().catch(() => '')
ok('sent message appears in the panel list', panelText.includes(MARK), MARK.slice(0, 40))
const senderShown = await dialog.locator('[class*="msgSender"]').allInnerTexts().catch(() => [])
ok('sender name shown for the sent message', senderShown.some(text => text === '单国鑫'), senderShown.slice(-3).join(','))

// ---- 4. verified server-side via the CLI ----
const entry = 'C:\\Users\\rocks\\AppData\\Roaming\\npm\\node_modules\\@yunzhijia\\cli'
const list = await new Promise((resolve) => {
  execFile('node', [entry + '\\scripts\\run.js', 'im', 'message', 'list', '--group-id', GROUP_ID, '--limit', '5'], { timeout: 60000 }, (err, stdout) => {
    resolve(err === null ? stdout : '')
  })
})
ok('message confirmed on the server (CLI list)', list.includes(MARK), MARK.slice(0, 40))

// ---- 5. Enter sends the second message ----
const MARK2 = `【面板回车测试】${Date.now()}`
await composer.fill(MARK2)
await page.keyboard.press('Enter')
await page.waitForTimeout(4000)
const panelText2 = await dialog.innerText().catch(() => '')
ok('Enter sends the second message', panelText2.includes(MARK2))

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
