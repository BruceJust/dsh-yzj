/** v49 — md 渲染 + 真的能下载。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(24000)
await p.locator('nav button', { hasText: 'dsh-2' }).first().click()
await p.waitForTimeout(11000)
await p.locator('[class*="_file"]').first().click()
await p.waitForTimeout(6000)
console.log('=== md 预览 ===', await p.evaluate(() => {
  const frame = document.querySelector('iframe[class*="_previewFrame"]')
  return {
    用了沙箱框: frame !== null,
    sandbox属性: frame?.getAttribute('sandbox'),
    还是裸文本吗: document.querySelector('[class*="_previewText"]') !== null,
    下载按钮: document.querySelector('[class*="_previewSave"]')?.textContent,
  }
}))
// 框里到底渲出了什么
const f = p.frames().find(x => x !== p.mainFrame())
if (f !== undefined) {
  console.log('=== 框内渲染 ===', await f.evaluate(() => ({
    标题: document.querySelector('h1')?.textContent,
    段落: document.querySelector('p')?.textContent?.slice(0, 30),
    有脚本吗: document.scripts.length,
  })))
}
await p.locator('[class*="_previewSave"]').first().click()
await p.waitForTimeout(6000)
console.log('=== 下载 ===', await p.evaluate(() => document.querySelector('[class*="_previewSaved"]')?.textContent))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await p.screenshot({ path: '.acceptance/m0/v49-md.png' })
await b.close()
