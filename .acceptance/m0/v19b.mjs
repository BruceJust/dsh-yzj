/**
 * v19b — ＋打开本地文件夹 走宿主自己的目录对话框（dsh 原方案）。
 *
 * 断言：点一下之后 (a) 我们自己的弹窗没有出现，(b) 按钮进入「系统对话框已弹出」
 * 状态。宿主的 native picker 用 osascript `choose folder`，所以确认完就把它关掉，
 * 不在用户屏幕上留一个对话框。
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const B = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(B, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const add = page.locator('nav button', { hasText: '打开本地文件夹' }).first()
console.log('按钮存在:', await add.count() > 0)
await add.evaluate(el => { el.click() })
await page.waitForTimeout(1200)

const state = await page.evaluate(() => ({
  ownDialog: document.querySelector('[role="dialog"][aria-label="选择本地工作目录"]') !== null,
  button: document.querySelector('nav [class*="addDir"]')?.innerText ?? '',
  note: [...document.querySelectorAll('nav div')]
    .map(el => el.innerText ?? '')
    .find(t => t.startsWith('文件夹对话框开在')) ?? '',
}))
console.log('=== 点击之后 ===')
console.log('我们自己的弹窗出现了吗:', state.ownDialog)
console.log('按钮:', state.button)
console.log('说明:', state.note)
await page.screenshot({ path: '.acceptance/m0/v19-native.png' })

// 把宿主弹出的系统对话框关掉
try { execFileSync('pkill', ['-f', 'osascript']) } catch { /* 没开起来就算了 */ }
await page.waitForTimeout(1500)
console.log('=== 关掉之后 ===')
console.log((await page.evaluate(() => document.querySelector('nav [class*="addDir"]')?.innerText ?? '')))

console.log('=== console 错误 ===')
console.log(errors.slice(0, 6).join('\n') || '  (none)')
await browser.close()
