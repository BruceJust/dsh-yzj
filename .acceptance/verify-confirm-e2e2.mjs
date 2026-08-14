/**
 * Confirmation-card E2E v2: the enhanced skill is installed, and the prompt
 * explicitly routes through the yzj_im_message_send TOOL. Expected flow:
 * tool call → approval gate → confirmation card (pending) → 确认 click →
 * real send → settled card. User authorized sending to the 830 group.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots-e2e2')
mkdirSync(OUT, { recursive: true })
const shot = (name) => join(OUT, name)

const GROUP_ID = '6a605c7ce4b0772a6279295e'
const GROUP_NAME = '830 项目【登顶计划】'
const MESSAGE = '【确认卡端到端测试·第二次】走 yzj_im_message_send 工具 + 确认卡流程 ✓'

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
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(3000)
const draft = page.locator('textarea').first()
await draft.waitFor({ state: 'visible', timeout: 15000 })
const prompt = `请使用 yzj_im_message_send 工具（必须走工具调用，不要用 pwsh/bash 直调 yzj-cli）给群「${GROUP_NAME}」（groupId ${GROUP_ID}）发送一条 text 类型消息，内容为：${MESSAGE}`
await draft.click()
await draft.fill(prompt)
await page.screenshot({ path: shot('1-prompt.png') })
await page.getByRole('button', { name: '发送消息' }).first().click()
console.log('INFO  prompt sent; waiting for the confirmation card…')

// --- wait for the pending confirmation card ---
let cardSeen = false
let sawPwsh = false
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(3000)
  const text = await page.evaluate(() => document.body.innerText)
  if (text.includes('需确认') || text.includes('强确认')) { cardSeen = true; break }
  if (text.includes('Pwsh') || text.includes('bash')) sawPwsh = true
  if (text.includes('已发送') || text.includes('sent (')) break
}
ok('confirmation card appears (pending)', cardSeen)
ok('model did NOT fall back to shell', !sawPwsh || cardSeen, sawPwsh ? 'shell seen but card also appeared' : 'no shell calls')

if (!cardSeen) {
  const body = await page.evaluate(() => document.body.innerText)
  console.log('--- body tail ---')
  console.log(body.split('\n').slice(-120).join('\n').slice(-3500))
  await page.screenshot({ path: shot('2-no-card.png') })
  await browser.close()
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

await page.screenshot({ path: shot('2-card-pending.png') })
const cardText = await page.evaluate(() => document.body.innerText)
ok('card shows 发送消息 title', cardText.includes('发送消息'))
ok('card shows the target group id', cardText.includes(GROUP_ID))
ok('card shows the full message body', cardText.includes(MESSAGE.slice(0, 20)))
ok('card offers 确认/取消/查看上下文', cardText.includes('确认') && cardText.includes('取消') && cardText.includes('查看上下文'))

// --- click 确认 ---
const confirm = page.locator('button', { hasText: /^确认$/ }).first()
await confirm.click()
console.log('INFO  确认 clicked; waiting for the tool to really send…')
let settled = false
let finalText = ''
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(3000)
  finalText = await page.evaluate(() => document.body.innerText)
  if (/sent \(|已发送|msgId|m-\d|6a7f/.test(finalText) || finalText.includes('已取消')) { settled = true; break }
}
ok('tool settled after confirmation', settled, finalText.split('需确认')[0].slice(-80).replace(/\n/g, ' '))
await page.screenshot({ path: shot('3-card-settled.png') })

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
