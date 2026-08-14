/** Probe: is the float ball mounted? any page errors? panel auto-open? */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => existsSync(path))

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)) })

await page.goto('http://127.0.0.1:3090/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)

const state = await page.evaluate(() => {
  const ball = document.querySelector('[aria-label="云之家悬浮窗"]')
  const panel = document.querySelector('[role="dialog"][aria-label="云之家"]')
  const ballRect = ball === null ? null : ball.getBoundingClientRect()
  return {
    ballExists: ball !== null,
    ballVisible: ball !== null && ballRect.width > 0 && ballRect.height > 0,
    ballRect: ballRect === null ? null : { w: Math.round(ballRect.width), h: Math.round(ballRect.height) },
    panelOpen: panel !== null && panel.getBoundingClientRect().width > 0,
    storedPanel: window.localStorage.getItem('dsh.yzj.panel.v2')?.slice(0, 120) ?? '',
    storedIm: (window.localStorage.getItem('dsh.yzj.imcache.v1') ?? '').length,
  }
})
console.log(JSON.stringify(state, null, 1))
console.log('errors:', errors.length ? errors.join('\n') : '(none)')
await browser.close()
