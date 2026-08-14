/** Diagnostic: dump the current conversation's rendered content. */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`))
page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[console.error] ${msg.text().slice(0, 300)}`) })

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

const body = await page.evaluate(() => document.body.innerText)
// Print the tail (the active conversation area) plus any yzj markers.
const lines = body.split('\n')
const idx = lines.findIndex(l => l.includes('缓存命中') || l.includes('tok/s'))
console.log('--- conversation tail ---')
console.log(lines.slice(Math.max(0, idx - 120), idx + 10).join('\n').slice(-4000))
console.log('--- markers ---')
for (const marker of ['需确认', '强确认', '发送消息', 'sent', '失败', '已取消', 'yzj_im_message_send', '确认', '正在执行']) {
  if (body.includes(marker)) console.log(`marker present: ${marker}`)
}
await browser.close()
