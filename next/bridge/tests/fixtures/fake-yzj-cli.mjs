#!/usr/bin/env node
/**
 * Fake yzj-cli binary for bridge tests. Behavior is driven by argv:
 * - `boom`   → exit 7 with a stderr line
 * - `slow`   → delay 10s then exit 0 (bridge timeout kills it)
 * - `big`    → emit output far beyond any test capture cap
 * - `echoin` → read stdin and echo it inside the JSON payload
 * - `envelope` → exit 0 with a 0.1.6-style `{success, identity, data}` envelope
 * - anything else → exit 0 with `{"argv": [...]}`
 */
const args = process.argv.slice(2)
const first = args[0] ?? ''

if (first === 'boom') {
  process.stderr.write('boom failed\n')
  process.exit(7)
} else if (first === 'slow') {
  setTimeout(() => process.exit(0), 10_000)
} else if (first === 'big') {
  process.stdout.write(JSON.stringify({ argv: args, pad: 'x'.repeat(10_000) }))
  process.exit(0)
} else if (first === 'echoin') {
  let body = ''
  process.stdin.on('data', (chunk) => { body += String(chunk) })
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({ argv: args, stdin: body }))
    process.exit(0)
  })
} else if (first === 'envelope') {
  // yzj-cli 0.1.6 起的成功信封：业务数据在 data 里。
  process.stdout.write(JSON.stringify({
    success: true, identity: 'user', data: { list: [{ id: 'a' }], more: false, count: 1 },
  }))
  process.exit(0)
} else {
  process.stdout.write(JSON.stringify({ argv: args }))
  process.exit(0)
}
