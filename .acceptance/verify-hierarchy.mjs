import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const APP_URL = process.env.DSH_URL ?? 'http://127.0.0.1:3080/'
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find(existsSync)
const artifact = new URL('./artifacts/', import.meta.url).pathname

let failures = 0
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`)
  if (!condition) failures++
}

async function load(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
}

async function openWorkspace(page) {
  const row = page.getByRole('treeitem', { name: '云之家 Agent', exact: true })
  await row.waitFor({ state: 'visible' })
  if (await row.getAttribute('aria-expanded') === 'false') await row.click()
  await page.locator('.dshWorkspaceHierarchyBranch').first().waitFor({ state: 'visible' })
}

const browser = await chromium.launch({ executablePath: CHROME })
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const desktopErrors = []
desktop.on('pageerror', error => desktopErrors.push(String(error)))
await load(desktop)
await openWorkspace(desktop)

const branches = desktop.locator('.dshWorkspaceHierarchyBranch')
check('two real group branches render', await branches.count() === 2)
check('first branch is 830 group', (await branches.nth(0).innerText()).includes('830 项目【登顶计划】'))
check('second branch is DSH group', (await branches.nth(1).innerText()).includes('金蝶最小DSH交流群'))
for (let i = 0; i < await branches.count(); i++) {
  if (await branches.nth(i).getAttribute('aria-expanded') === 'false') await branches.nth(i).click()
}
const leaves = desktop.locator('.dshWorkspaceHierarchyChildren [role="treeitem"]')
check('three topic Session leaves render', await leaves.count() === 3)
const childCounts = []
for (let i = 0; i < await branches.count(); i++) {
  childCounts.push(await branches.nth(i).locator('xpath=following-sibling::*[1]')
    .locator('[role="treeitem"]').count())
}
check('group descendants are isolated 1 + 2', childCounts.join(',') === '1,2', childCounts.join(','))

const search = desktop.locator('input[placeholder="搜索会话…"]')
await search.fill('金蝶最小DSH交流群')
await desktop.waitForTimeout(250)
const searchRows = desktop.locator('[role="tree"] > [role="treeitem"]')
check('fold-independent group search returns two topics', await searchRows.count() === 2)
check('search shows hierarchy breadcrumb', (await searchRows.first().innerText())
  .includes('云之家 Agent / 金蝶最小DSH交流群'))
await search.fill('')
if (await branches.nth(1).getAttribute('aria-expanded') === 'true') await branches.nth(1).click()
await search.fill('@DSH-YZJ-TEST')
await desktop.waitForTimeout(250)
await desktop.locator('[role="tree"] > [role="treeitem"]').first().click()
await desktop.waitForTimeout(400)
await search.fill('')
await openWorkspace(desktop)
check('current topic auto-expands its folded branch',
  await desktop.locator('.dshWorkspaceHierarchyBranch').nth(1).getAttribute('aria-expanded') === 'true')

await desktop.getByLabel('视图选项').click()
await desktop.getByText('单列表', { exact: true }).click()
check('flat mode ignores hierarchy', await desktop.locator('.dshWorkspaceHierarchyBranch').count() === 0)
await desktop.evaluate(() => localStorage.removeItem('dsh.workspace.view.v6'))
await desktop.reload({ waitUntil: 'networkidle' })
await openWorkspace(desktop)

const beforeReload = desktop.locator('.dshWorkspaceHierarchyBranch')
if (await beforeReload.nth(0).getAttribute('aria-expanded') === 'true') await beforeReload.nth(0).click()
if (await beforeReload.nth(1).getAttribute('aria-expanded') === 'false') await beforeReload.nth(1).click()
await desktop.reload({ waitUntil: 'networkidle' })
await openWorkspace(desktop)
const persisted = await desktop.locator('.dshWorkspaceHierarchyBranch')
  .evaluateAll(rows => rows.map(row => row.getAttribute('aria-expanded')))
check('per-branch disclosure persists', persisted.join(',') === 'false,true', persisted.join(','))
check('desktop has no page errors', desktopErrors.length === 0, desktopErrors.join('; '))
await desktop.screenshot({ path: `${artifact}hierarchy-desktop.png`, fullPage: true })

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
const mobileErrors = []
mobile.on('pageerror', error => mobileErrors.push(String(error)))
await load(mobile)
const expand = mobile.getByLabel(/打开侧边栏|展开侧边栏/)
if (await expand.count()) await expand.click()
await mobile.waitForTimeout(500)
await openWorkspace(mobile)
await mobile.waitForTimeout(300)
const mobileBranches = mobile.locator('.dshWorkspaceHierarchyBranch')
const viewportWidth = mobile.viewportSize()?.width ?? 0
const boxes = await mobileBranches.evaluateAll(rows => rows.map(row => {
  const rect = row.getBoundingClientRect()
  const title = row.querySelector('.dshWorkspaceHierarchyBranchTitle')
  return {
    left: rect.left, right: rect.right, width: rect.width,
    titleClient: title?.clientWidth ?? 0, titleScroll: title?.scrollWidth ?? 0,
  }
}))
check('mobile renders both branches', boxes.length === 2)
check('mobile branch rows stay in viewport', boxes.every(box => box.left >= 0 && box.right <= viewportWidth),
  JSON.stringify(boxes))
check('mobile branch rows keep stable width', boxes.every(box => box.width > 180))
check('mobile has no page errors', mobileErrors.length === 0, mobileErrors.join('; '))
await mobile.screenshot({ path: `${artifact}hierarchy-mobile.png`, fullPage: true })

await browser.close()
if (failures > 0) {
  console.error(`\n${failures} hierarchy acceptance check(s) failed`)
  process.exit(1)
}
console.log('\nAll hierarchy acceptance checks passed')
