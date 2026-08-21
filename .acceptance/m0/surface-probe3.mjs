/** What is the home screen actually waiting for? */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3090'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('pageerror:', e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const picker = page.getByText('选择工作区', { exact: true }).first()
if (await picker.count() > 0) {
  await picker.click()
  await page.waitForTimeout(1800)
  console.log('--- workspace picker ---')
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1500))
  await page.screenshot({ path: '.acceptance/m0/workspace-picker.png' })
}

// Ask the host directly what workspaces it knows about.
const ws = await page.evaluate(async () => {
  const call = async (method, payload) => {
    const response = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `probe-${String(Math.random())}`, method, payload }),
    })
    return response.json()
  }
  const out = {}
  for (const method of ['workspace.list', 'workspaces.list', 'session.list']) {
    try {
      out[method] = await call(method, { args: {} })
    } catch (error) {
      out[method] = String(error)
    }
  }
  return out
})
console.log('--- host answers ---')
console.log(JSON.stringify(ws, null, 1).slice(0, 2000))

await browser.close()
