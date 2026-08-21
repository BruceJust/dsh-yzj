/** v48 — 附件真身：图片内联缩略图 + 文件点开预览。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3090', { waitUntil: 'networkidle' })
await p.waitForTimeout(24000)

// 自聊里有真实图片消息（2025-05 那两条）
await p.locator('nav button', { hasText: '代少兵' }).first().click()
await p.waitForTimeout(11000)
await p.evaluate(() => { document.querySelector('[class*="_thumb"]')?.scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(18000)
console.log('=== 图片 ===', await p.evaluate(() => {
  const thumbs = [...document.querySelectorAll('[class*="_thumb"]')]
  const imgs = thumbs.map(t => t.querySelector('img'))
  return {
    缩略图槽: thumbs.length,
    已取到字节: imgs.filter(i => (i?.src ?? '').startsWith('data:image')).length,
    未取到的原因: [...document.querySelectorAll('[class*="_pending"]')].map(e => e.textContent),
    尺寸: imgs.filter(Boolean).map(i => `${i.naturalWidth}×${i.naturalHeight}`),
    第一张尺寸: imgs[0] === null || imgs[0] === undefined
      ? '(无)' : `${imgs[0].naturalWidth}×${imgs[0].naturalHeight}`,
  }
}))

// dsh-2 里有 r29-summary.md
await p.locator('nav button', { hasText: 'dsh-2' }).first().click()
await p.waitForTimeout(11000)
await p.locator('[class*="_file"]').first().click()
await p.waitForTimeout(6000)
console.log('=== 文件预览 ===', await p.evaluate(() => ({
  预览开了: document.querySelector('[class*="_preview"]') !== null,
  文件名: document.querySelector('[class*="_previewName"]')?.textContent,
  正文: document.querySelector('[class*="_previewText"]')?.textContent?.slice(0, 40),
  说明: document.querySelector('[class*="_previewFoot"]')?.textContent?.slice(0, 40),
})))
console.log('=== console 错误 ===', errors.length === 0 ? '无' : errors.slice(0, 4))
await p.screenshot({ path: '.acceptance/m0/v48-preview.png' })
await b.close()
