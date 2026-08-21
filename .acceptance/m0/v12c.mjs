import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.goto('http://127.0.0.1:3090/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
const buttons = page.locator('nav[aria-label="收件箱"] button')
// pick the first topic row (they carry a place-name preview under the title)
for (let i = 0; i < await buttons.count(); i += 1) {
  const text = await buttons.nth(i).innerText()
  if (text.includes('李婷刚说初稿') || text.includes('季度复盘')) { await buttons.nth(i).click(); break }
}
await page.waitForTimeout(6000)
await page.screenshot({ path: '.acceptance/m0/v12-topic.png' })
const anchor = await page.getByText('落点', { exact: false }).first().innerText().catch(() => 'missing')
console.log('anchor bar:', anchor.replace(/\n/g, ' '))
const verb = page.getByRole('button', { name: /@agent/ }).first()
console.log('hover verbs present:', await verb.count())
if (await verb.count()) {
  await verb.click({ force: true })
  await page.waitForTimeout(900)
  console.log('after ⚡ anchor:', (await page.getByText('落点', { exact: false }).first().innerText()).replace(/\n/g, ' '))
  console.log('draft:', await page.locator('textarea').first().inputValue())
  await page.screenshot({ path: '.acceptance/m0/v12-anchor.png' })
}
await page.getByRole('button', { name: /完整轨迹/ }).first().click()
await page.waitForTimeout(1800)
await page.screenshot({ path: '.acceptance/m0/v12-trace.png' })
console.log('errors:', errors.length ? errors.slice(0,3) : 'none')
await browser.close()
