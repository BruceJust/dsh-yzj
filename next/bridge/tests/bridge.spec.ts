/**
 * Bridge specs against a fake binary: argv passthrough (no shell, so nothing
 * in an argument is interpolated), JSON parsing, non-zero exits as results,
 * stdin bodies, capture caps, and timeout kills. Windows cannot spawn a
 * shebang script, so the fake is routed through node there — `argv.slice(2)`
 * stays identical either way.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { YzjBridge, YzjSpawnError, resolveNpmLauncher } from '../src/index.ts'

const FAKE_BINARY = fileURLToPath(new URL('./fixtures/fake-yzj-cli.mjs', import.meta.url))
const WINDOWS = process.platform === 'win32'

function bridgeWith(config: Record<string, unknown> = {}): YzjBridge {
  return new YzjBridge(new Context(), {
    binary: WINDOWS ? process.execPath : FAKE_BINARY,
    ...config,
  })
}

function fakeArgs(command: readonly string[]): string[] {
  return WINDOWS ? [FAKE_BINARY, ...command] : [...command]
}

describe('YzjBridge.run', () => {
  it('passes argv verbatim and parses stdout as JSON', async () => {
    const result = await bridgeWith().run(fakeArgs(['contact', 'user', 'get']), { timeoutMs: 5_000 })
    expect(result.ok).toBe(true)
    expect(result.json).toMatchObject({ argv: ['contact', 'user', 'get'] })
  })

  it('inserts the configured profile ahead of the command', async () => {
    const result = await bridgeWith({ profile: 'alt' }).run(fakeArgs(['doc', 'list']))
    expect(result.json).toMatchObject({ argv: ['--profile', 'alt', 'doc', 'list'] })
  })

  it('keeps a shell metacharacter as one literal argument', async () => {
    const nasty = '"; rm -rf / #'
    const result = await bridgeWith().run(fakeArgs(['echo', nasty]))
    expect(result.json).toMatchObject({ argv: ['echo', nasty] })
  })

  it('reports a non-zero exit as a result, not a rejection', async () => {
    const result = await bridgeWith().run(fakeArgs(['boom']))
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(7)
    expect(result.stderr).toContain('boom failed')
  })

  it('writes a stdin body and closes it', async () => {
    const result = await bridgeWith().run(fakeArgs(['echoin']), { stdin: '{"a":1}' })
    expect(result.json).toMatchObject({ stdin: '{"a":1}' })
  })

  it('caps captured output', async () => {
    const result = await bridgeWith({ maxOutputChars: 500 }).run(fakeArgs(['big']))
    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBe(500)
    expect(result.json).toBeUndefined()
  })

  it('kills a process that overruns its budget', async () => {
    const result = await bridgeWith().run(fakeArgs(['slow']), { timeoutMs: 200 })
    expect(result.timedOut).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBeNull()
  })

  it('rejects with a spawn error for a missing binary', async () => {
    const bridge = new YzjBridge(new Context(), { binary: '/nonexistent/yzj-cli' })
    await expect(bridge.run(['whatever'])).rejects.toBeInstanceOf(YzjSpawnError)
  })
})

describe('resolveNpmLauncher', () => {
  it('returns undefined for an unreadable path', () => {
    expect(resolveNpmLauncher('/nonexistent/launcher.cmd')).toBeUndefined()
  })
})
