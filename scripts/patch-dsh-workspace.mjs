import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.1.0-rc.6'
const BASE_SHA256 = '7579ea4578750df71309dcf4881cf588aced13cf8137273a2c308a29bceb6464'
const PATCHED_SHA256 = '453ebe888075bdbf27b0f573a7108a93f97148818e8c135fa0ad554fe99f7a56'
const patchFile = fileURLToPath(new URL(
  '../patches/dsh-client-ui-workspace-0.1.0-rc.6.patch', import.meta.url,
))

function defaultPackageRoot() {
  const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
  return join(
    npmRoot,
    '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace',
  )
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const packageRoot = process.argv[2] ?? defaultPackageRoot()
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
if (packageJson.version !== VERSION) {
  throw new Error(
    `Workspace hierarchy patch requires ${VERSION}; found ${String(packageJson.version)}`,
  )
}

const bundle = join(packageRoot, 'lib/client.js')
const before = sha256(bundle)
if (before === PATCHED_SHA256) {
  console.log(`Workspace hierarchy patch already applied: ${packageRoot}`)
  process.exit(0)
}
if (before !== BASE_SHA256) {
  throw new Error(
    `Refusing to patch unexpected lib/client.js (sha256 ${before}); expected ${BASE_SHA256}`,
  )
}

execFileSync('git', ['apply', '--check', '--whitespace=error-all', patchFile], {
  cwd: packageRoot,
  stdio: 'inherit',
})
execFileSync('git', ['apply', '--whitespace=error-all', patchFile], {
  cwd: packageRoot,
  stdio: 'inherit',
})

const after = sha256(bundle)
if (after !== PATCHED_SHA256) {
  throw new Error(
    `Patch applied but resulting hash ${after} does not match ${PATCHED_SHA256}`,
  )
}
console.log(`Workspace hierarchy patch applied: ${packageRoot}`)
