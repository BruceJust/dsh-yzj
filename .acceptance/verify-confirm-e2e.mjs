/**
 * End-to-end confirmation-card acceptance with a REAL logged-in agent:
 * the model calls yzj_im_message_send into the 830 项目【登顶计划】 group,
 * the confirmation card appears with the full message, the user clicks 确认,
 * the tool really sends, and the card settles. The user explicitly authorized
 * sending this test message.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots-e2e')
mkdirSync(OUT, { recursive: true })
const shot = (name) => join(OUT, name)

const GROUP_ID = '6a605c7ce4b0772a6279295e'
const GROUP_NAME = '830 项目【登顶计划】'
const MESSAGE = '【确认卡端到端测试】这条消息由 dsh + yzj 插件在真实确认卡流程中发出 ✓'

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

// --- 1. open/start a conversation ---
await page.getByRole('button', { name: '新建会话' }).first().click().catch(async () => {
  // Fallback: click the first sidebar session row if 新建会话 is absent.
  await page.locator('aside [class*="item"], aside [class*="row"]').first().click().catch(() => {})
})
await page.waitForTimeout(3000)
const draft = page.locator('textarea').first()
await draft.waitFor({ state: 'visible', timeout: 15000 })
await draft.click()
await draft.fill(`请给群「${GROUP_NAME}」（groupId ${GROUP_ID}）发送一条文本消息，内容为：${MESSAGE}`)
await page.screenshot({ path: shot('1-prompt.png') })
await page.getByRole('button', { name: '发送消息' }).first().click()
console.log('INFO  prompt sent, waiting for the model to call yzj_im_message_send…')

// --- 2. wait for the confirmation card (pending) ---
let cardSeen = false
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(3000)
  const body = await page.evaluate(() => document.body.innerText)
  if (body.includes('需确认') || body.includes('强确认')) {
    cardSeen = true
    break
  }
  if (body.includes('失败') || body.includes('error')) {
    // keep waiting — a tool error may still be transient
  }
}
ok('confirmation card appears (pending)', cardSeen)
await page.screenshot({ path: shot('2-card-pending.png') })
const cardText = await page.evaluate(() => document.body.innerText)
const cardOk = cardText.includes('发送消息') && cardText.includes(GROUP_ID)
ok('card shows the target group and title', cardOk, cardText.split('需确认')[0].slice(-80).replace(/\n/g, ' '))
ok('card shows the full message body', cardText.includes(MESSAGE.slice(0, 20)))

// --- 3. click 确认 and watch the settle ---
if (cardSeen) {
  const confirm = page.locator('button', { hasText: /^确认$/ }).first()
  await confirm.click().catch(() => {})
  console.log('INFO  确认 clicked, waiting for the tool to really send…')
  let settled = false
  let finalText = ''
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(3000)
    finalText = await page.evaluate(() => document.body.innerText)
    if (finalText.includes('sent') || finalText.includes('已发送') || finalText.includes('(m') || finalText.includes('m-')) {
      settled = true
      break
    }
    if (finalText.includes('已取消')) break
  }
  ok('tool settled after confirmation', settled, finalText.split('确认')[0].slice(-60).replace(/\n/g, ' '))
  await page.screenshot({ path: shot('3-card-settled.png') })
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
