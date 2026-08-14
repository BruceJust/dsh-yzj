/**
 * Bridge unit tests against a fake yzj-cli binary: argv passthrough, JSON
 * parsing, failure exits, stdin bodies, capture caps, timeout kills, and the
 * spawn-failure path. The fake is a real executable (shebang), so the bridge
 * `binary` field points at it directly and commands carry no argv[0].
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import YzjBridge, { YzjSpawnError } from '../src/index.ts'

const FAKE_BINARY = fileURLToPath(new URL('./fixtures/fake-yzj-cli.mjs', import.meta.url))

function bridgeWith(config: Record<string, unknown> = {}): YzjBridge {
  return new YzjBridge(new Context(), { binary: FAKE_BINARY, ...config })
}

describe('yzjBridge.run', () => {
  it('passes argv verbatim and parses stdout as JSON', async () => {
    const bridge = bridgeWith()
    const result = await bridge.run(['contact', 'user', 'get'], { timeoutMs: 5_000 })
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({ argv: ['contact', 'user', 'get'] })
    expect(result.timedOut).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it('prepends the configured --profile flag before the command', async () => {
    const bridge = bridgeWith({ profile: 'work' })
    const result = await bridge.run(['calendar', 'event', 'list'], { timeoutMs: 5_000 })
    expect(result.json).toEqual({ argv: ['--profile', 'work', 'calendar', 'event', 'list'] })
  })

  it('reports a non-zero exit as a result, not a rejection', async () => {
    const bridge = bridgeWith()
    const result = await bridge.run(['boom'], { timeoutMs: 5_000 })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(7)
    expect(result.stderr).toBe('boom failed\n')
    expect(result.json).toBeUndefined()
  })

  it('writes the stdin body and closes the pipe', async () => {
    const bridge = bridgeWith()
    const result = await bridge.run(['echoin'], {
      stdin: '{"a":1}',
      timeoutMs: 5_000,
    })
    expect(result.ok).toBe(true)
    expect(result.json).toEqual({ argv: ['echoin'], stdin: '{"a":1}' })
  })

  it('kills a command that exceeds the timeout budget', async () => {
    const bridge = bridgeWith()
    const result = await bridge.run(['slow'], { timeoutMs: 50 })
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })

  it('caps captured streams at maxOutputChars', async () => {
    const bridge = bridgeWith({ maxOutputChars: 64 })
    const result = await bridge.run(['big'], { timeoutMs: 5_000 })
    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(64)
  })

  it('rejects with YzjSpawnError when the binary cannot be launched', async () => {
    const bridge = new YzjBridge(new Context(), { binary: '/nonexistent/yzj-cli' })
    await expect(bridge.run(['doc', 'list'])).rejects.toBeInstanceOf(YzjSpawnError)
  })

  it('check() returns false when the binary is missing', async () => {
    const bridge = new YzjBridge(new Context(), { binary: '/nonexistent/yzj-cli' })
    await expect(bridge.check(5_000)).resolves.toBe(false)
  })

  it('check() returns true for a healthy binary', async () => {
    const bridge = bridgeWith()
    await expect(bridge.check(5_000)).resolves.toBe(true)
  })
})
