/**
 * Acceptance v4: real '@' trigger menu + reference chips + context on send.
 */
import { chromium } from '/Users/guoxinshan/dev/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

let failures = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
  if (!cond) failures++
}

const browser = await chromium.launch({
  executablePath: '/Users/guoxinshan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 400)))

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)

// --- enter conversation view ---
await page.getByRole('button', { name: '新建会话' }).first().click()
await page.waitForTimeout(2500)
await page.locator('textarea').first().click()
await page.locator('textarea').first().fill('hello')
await page.getByRole('button', { name: '发送消息' }).first().click()
await page.waitForTimeout(3500)

const draft = page.locator('textarea').first()

// --- 1. typing '@' opens the yzj trigger menu ---
await draft.click()
await draft.pressSequentially('@', { delay: 80 })
await page.waitForTimeout(1200)
const listbox = page.locator('[role="listbox"]')
let menuOpen = false
try { await listbox.waitFor({ state: 'visible', timeout: 8000 }); menuOpen = true } catch {}
ok('@ opens the trigger menu', menuOpen)
if (menuOpen) {
  const yzjGroup = listbox.locator('[data-source="云之家"], [role="presentation"]', { hasText: '云之家' }).first()
  const groupVisible = await yzjGroup.count().then(n => n > 0)
  ok('menu has 云之家 group', groupVisible)
  const options = listbox.locator('[role="option"]')
  const optionTexts = []
  const count = await options.count()
  for (let i = 0; i < Math.min(count, 6); i++) optionTexts.push((await options.nth(i).innerText()).slice(0, 40))
  ok('menu lists yzj candidates', optionTexts.some(t => t.includes('知识库') || t.includes('会话') || t.includes('📚')), optionTexts.join(' | '))
  await page.screenshot({ path: '/Users/guoxinshan/dev/dsh-yzj/.acceptance/shots/v4-at-menu.png' })
  // pick the first 云之家 option (knowledge base row)
  const pickable = options.filter({ hasText: /知识库|📚/ }).first()
  await pickable.click().catch(() => options.first().click())
  await page.waitForTimeout(900)
}
// chip in the draft: U+FFFC placeholder or a rendered chip
const draftVal = await draft.inputValue().catch(() => '')
const hasPlaceholder = draftVal.includes('\uFFFC')
const chipDom = await page.locator('[class*="chip"], [class*="Chip"]').count().catch(() => 0)
ok('pick inserted a reference chip', hasPlaceholder || chipDom > 0, `U+FFFC=${hasPlaceholder} chipDOM=${chipDom} draft="${draftVal.slice(0, 60)}"`)
await page.screenshot({ path: '/Users/guoxinshan/dev/dsh-yzj/.acceptance/shots/v4-chip.png' })

// --- 2. drag from the panel inserts a second chip ---
const toggle = page.getByText('云之家', { exact: true }).first()
await toggle.click()
const dialog = page.getByRole('dialog', { name: '云之家' })
await dialog.waitFor({ state: 'visible', timeout: 15000 })
// wait for the panel list to actually render (body-wide text matches are
// unreliable: '文档' also appears in the @ menu and message stream)
const firstPanelItem = dialog.locator('button[class*="item"]').first()
await firstPanelItem.waitFor({ state: 'visible', timeout: 12000 })
const band = page.locator('text=把云之家内容拖到这里，以卡片插入上下文').first()
await band.waitFor({ state: 'visible', timeout: 8000 })
await page.evaluate(() => {
  const src = document.querySelector('[role="dialog"] button[class*="item"]')
  const dst = document.querySelector('[class*="dropBand"]')
  if (src === null || dst === null) return
  const dt = new DataTransfer()
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  dst.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await page.waitForTimeout(1200)
const draftVal2 = await draft.inputValue().catch(() => '')
const chipCount2 = (draftVal2.match(/\uFFFC/g) ?? []).length
ok('drag inserted a second chip', chipCount2 >= 2, `${chipCount2} chips in draft`)
await page.screenshot({ path: '/Users/guoxinshan/dev/dsh-yzj/.acceptance/shots/v4-drag-chip.png' })

// --- 3. send: message carries the context serialization ---
await page.getByRole('button', { name: '发送消息' }).first().click()
await page.waitForTimeout(4000)
const msgText = await page.locator('[data-kind="message"], [class*="message"]').last().innerText().catch(() => '')
const fullBody = await page.evaluate(() => document.body.innerText)
ok('sent message carries context', fullBody.includes('【云之家·知识库】') || fullBody.includes('【云之家·文档】'), fullBody.slice(-500).includes('知识库') ? 'context header found' : '')
await page.screenshot({ path: '/Users/guoxinshan/dev/dsh-yzj/.acceptance/shots/v4-sent.png' })

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
