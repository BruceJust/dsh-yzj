/** Diagnose the synthetic drop: does the band arm, does bail insert, any errors? */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 400)}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`[console.error] ${msg.text().slice(0, 400)}`)
})

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.getByRole('button', { name: '新建会话' }).first().click().catch(() => {})
await page.waitForTimeout(2500)

// Where is the band? dump ancestor chain classes
const bandInfo = await page.evaluate(() => {
  const band = [...document.querySelectorAll('div')].find(el =>
    (el.textContent ?? '').includes('把云之家内容拖到这里'))
  if (!band) return { found: false }
  const chain = []
  let node = band
  for (let i = 0; i < 6 && node; i++) {
    chain.push({ tag: node.tagName, cls: typeof node.className === 'string' ? node.className.slice(0, 120) : '', text: (node.textContent ?? '').slice(0, 60) })
    node = node.parentElement
  }
  return { found: true, chain }
})
console.log('band info:', JSON.stringify(bandInfo, null, 1))

// instrument window for bail visibility
await page.evaluate(() => {
  window.__yzjDebug = { dragstart: 0, dragenter: 0, drop: 0, armedText: '', chips: 0 }
  const src = new EventTarget()
  const proto = Object.getPrototypeOf(DataTransfer)
  console.log('DataTransfer proto keys:', Object.getOwnPropertyNames(proto).join(','))
})

const result = await page.evaluate(() => {
  const band = [...document.querySelectorAll('div')].find(el =>
    (el.textContent ?? '').includes('把云之家内容拖到这里'))
  if (!band) return { ok: false, reason: 'band missing' }
  const source = document.querySelector('button[draggable="true"]')
  if (!source) return { ok: false, reason: 'no source' }
  const payload = JSON.stringify({ kind: 'message', id: 'fake-msg-verify', title: '测试引用', sub: '验证', group: '' })
  const dt = new DataTransfer()
  dt.setData('application/x-dsh-yzj-ref', payload)
  dt.setData('text/plain', '测试引用')
  const fire = (el, type) => {
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
    const dispatched = el.dispatchEvent(ev)
    return { type, defaultPrevented: ev.defaultPrevented, dispatched }
  }
  const out = []
  out.push(['dragstart on source', fire(source, 'dragstart')])
  out.push(['dragenter on band', fire(band, 'dragenter')])
  out.push(['dragover on band', fire(band, 'dragover')])
  out.push(['drop on band', fire(band, 'drop')])
  out.push(['dragend on source', fire(source, 'dragend')])
  return { ok: true, events: out, bandTextAfter: band.textContent.slice(0, 80) }
})
console.log('drop result:', JSON.stringify(result, null, 1))
await page.waitForTimeout(1500)

const state = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('[data-decoration="chip"]')].map(c => ({
    title: c.getAttribute('title'), text: c.textContent,
  }))
  const reminders = [...document.querySelectorAll('[role="status"]')].map(n => n.textContent)
  const band = [...document.querySelectorAll('div')].find(el =>
    (el.textContent ?? '').includes('把云之家内容拖到这里'))
  return { chips, reminders, bandText: band ? band.textContent.slice(0, 80) : '' }
})
console.log('after drop:', JSON.stringify(state, null, 1))
await browser.close()
