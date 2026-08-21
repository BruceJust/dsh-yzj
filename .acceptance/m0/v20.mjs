/**
 * v20 — 侧栏第三轮（变更记录 #43）：
 *   ① 顶层大分栏 ☁云之家 / ⌂本地，可整界收起（收起即全收）
 *   ② 折叠彻底收起子行；含当前会话的收起组用场所行左缘示位线
 *   ③ chrome：SVG 细笔画箭头、场所/标签行 hover 现身、收起态常显、分栏头常显
 */
import { chromium } from 'playwright'

const B = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(B, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 打开一个话题（话题子行本身就是 button，本地会话子行是 div 套 button——
// 上一版探针误点了后者，于是「含当前会话」这条根本没被测到）
await page.locator('nav button[class*="itemSub"]').first().evaluate(el => { el.click() })
await page.waitForTimeout(2000)

const shape = () => page.evaluate(() => {
  const nav = document.querySelector('nav')
  const tree = nav.querySelector('[class*="tree"]')
  return {
    sections: [...tree.querySelectorAll('[class*="sec"]')]
      .filter(el => el.tagName === 'BUTTON')
      .map(el => el.innerText.replace(/\n/g, ' · ')),
    places: [...tree.querySelectorAll('[class*="placeRow"]')]
      .map(el => ({
        name: el.querySelector('[class*="itemTitle"]')?.textContent ?? '',
        holds: getComputedStyle(el).boxShadow.includes('inset'),
      })),
    subs: tree.querySelectorAll('[class*="itemSub"]').length,
    addDir: tree.querySelector('[class*="addDir"]') !== null,
    // 箭头是画出来的，不是打出来的
    svgChevs: tree.querySelectorAll('[class*="chev"] svg').length,
    textChevs: [...tree.querySelectorAll('[class*="chev"]')]
      .filter(el => (el.textContent ?? '').trim() !== '').length,
  }
})

console.log('=== 起始 ===')
console.log(JSON.stringify(await shape(), null, 1))
await page.screenshot({ path: '.acceptance/m0/v20-sidebar.png' })

// 箭头可见性：场所行的箭头默认藏着，hover 现身
const chevOpacity = async (label) => page.evaluate((name) => {
  const row = [...document.querySelectorAll('nav [class*="placeRow"]')]
    .find(el => el.querySelector('[class*="itemTitle"]')?.textContent === name)
  return getComputedStyle(row.querySelector('[class*="chev"]')).opacity
}, label)
const firstPlace = (await shape()).places[0]?.name
console.log('=== 箭头 ===')
console.log(`${firstPlace} 默认 opacity:`, await chevOpacity(firstPlace))
await page.locator('nav [class*="placeRow"]').first().hover()
await page.waitForTimeout(300)
console.log(`${firstPlace} hover opacity:`, await chevOpacity(firstPlace))
console.log('分栏头 opacity:', await page.evaluate(() => (
  getComputedStyle(document.querySelector('nav button[class*="sec"] [class*="chev"]')).opacity
)))

// 收起那个含当前会话的组：子行必须全没，示位线必须出现，箭头必须常显
await page.locator('nav [class*="placeRow"] button[class*="chev"]').first()
  .evaluate(el => { el.click() })
await page.waitForTimeout(500)
const closed = await shape()
console.log('=== 收起第一个场所 ===')
console.log('子行数 :', closed.subs, '（收起前 ' + (await shape()).subs + ' 是同一次读数）')
console.log('场所行 :', JSON.stringify(closed.places))
console.log('箭头收起态 opacity:', await chevOpacity(firstPlace))
await page.screenshot({ path: '.acceptance/m0/v20-collapsed.png' })

// 整界收起：场所行也没了，示位线得递归到分栏头
await page.locator('nav button[class*="sec"]').first().evaluate(el => { el.click() })
await page.waitForTimeout(400)
console.log('=== 收起云之家整界 ===')
console.log(JSON.stringify(await shape(), null, 1))
console.log('分栏头示位线:', await page.evaluate(() => (
  [...document.querySelectorAll('nav button[class*="sec"]')].map(el => ({
    head: el.innerText.replace(/\n/g, ' · '),
    holds: getComputedStyle(el).boxShadow.includes('inset'),
  }))
)))
await page.screenshot({ path: '.acceptance/m0/v20-sec-collapsed.png' })

console.log('=== console 错误 ===')
console.log(errors.slice(0, 8).join('\n') || '  (none)')
await browser.close()
