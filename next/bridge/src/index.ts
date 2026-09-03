/**
 * `@yzj-next/bridge` — the host channel to the Yunzhijia CLI.
 *
 * Re-cast from the verified pattern of the previous system (technical plan
 * §1.3 "已验证模式清单 · CLI 通道"): spawn the binary with an argv ARRAY and no
 * shell, so nothing in a model-authored argument can be interpolated; cap both
 * captured streams; kill on a cooperative timeout; treat a non-zero exit as a
 * RESULT rather than a rejection, because "the CLI said no" is information the
 * caller must be able to render.
 *
 * It reuses the machine's existing `yzj-cli auth login` state, so the harness
 * never handles an appSecret or an accessToken.
 *
 * This lives in its own package rather than inside `channel` for a dependency
 * reason: both the tool family and the transport consume it, and folding it
 * into the transport would point `tools → channel` the wrong way round.
 * @module @yzj-next/bridge
 */

import { spawn, execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

const execFileAsync = promisify(execFile)

/** Result of one `yzj-cli` invocation. */
export interface YzjRunResult {
  /** True when the process exited 0 within budget. */
  readonly ok: boolean
  /** Exit code; null when the timeout killed the process. */
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  /** stdout parsed as one JSON document when it parses; omitted otherwise. */
  readonly json?: unknown
  /** True when either stream hit the capture cap. */
  readonly truncated: boolean
  readonly timedOut: boolean
  readonly durationMs: number
}

/** Failed to launch the configured binary. */
export class YzjSpawnError extends Error {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjBridge: YzjBridge
  }
}

export interface Config {
  /** Executable name or absolute path. Defaults to `yzj-cli`. */
  binary?: string
  /** Credential profile (`--profile <name>`). Empty means the default profile. */
  profile?: string
  /** Cooperative timeout per invocation in milliseconds. */
  timeoutMs?: number
  /** Per-stream capture cap in characters. */
  maxOutputChars?: number
}

const DEFAULT_BINARY = 'yzj-cli'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_CHARS = 200_000

const CLI_ENVELOPE_KEYS = new Set(["success", "identity", "data", "error"])

/** Peel yzj-cli 0.1.6 `{success, identity, data}` down to `data`. Bare 0.1.4 payloads pass through. */
export function unwrapCli(json: unknown): unknown {
  if (json === undefined || json === null) return json
  if (Array.isArray(json) || typeof json !== "object") return json
  const rec = json as Record<string, unknown>
  if (rec.success === true && "data" in rec) {
    return rec.data === undefined || rec.data === null ? {} : rec.data
  }
  if (rec.success === true && rec.identity !== undefined) {
    const extra = Object.keys(rec).filter(key => !CLI_ENVELOPE_KEYS.has(key))
    if (extra.length === 0) return rec.data ?? {}
  }
  return json
}

export const ConfigSchema: z<Config> = z.object({
  binary: z.string().default(DEFAULT_BINARY),
  profile: z.string().default(''),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  maxOutputChars: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_CHARS),
})

/**
 * Parse an npm-generated Windows launcher and return the node entry script it
 * forwards to. `spawn` cannot execute the .cmd/.ps1/.sh shims npm installs, so
 * the bridge routes the command through `node <entry>` there instead.
 */
export function resolveNpmLauncher(cmdPath: string): string | undefined {
  let content: string
  try {
    content = readFileSync(cmdPath, 'utf8')
  } catch {
    return undefined
  }
  const match = content.match(/%dp0%\\(node_modules\\[^"]+?\\scripts\\[^"]+)/i)
  if (match === null || match[1] === undefined) return undefined
  return join(dirname(cmdPath), match[1].replaceAll('\\', sep))
}

const windowsLauncherCache = new Map<string, [string, string[]]>()

async function resolveBinary(binary: string): Promise<[string, string[]]> {
  if (process.platform !== 'win32') return [binary, []]
  if (binary.includes('/') || binary.includes('\\') || binary.endsWith('.exe')) return [binary, []]
  const cached = windowsLauncherCache.get(binary)
  if (cached !== undefined) return cached
  let resolved: [string, string[]] = [binary, []]
  try {
    const { stdout } = await execFileAsync('where.exe', [binary], { timeout: 5_000 })
    const cmdPath = stdout.split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line !== '' && /\.(cmd|bat)$/i.test(line))
    if (cmdPath !== undefined) {
      const script = resolveNpmLauncher(cmdPath)
      if (script !== undefined) resolved = [process.execPath, [script]]
    }
  } catch {
    // Resolution failure falls through; the spawn below reports the real error.
  }
  windowsLauncherCache.set(binary, resolved)
  return resolved
}

export class YzjBridge extends Service {
  static Config: z<Config> = ConfigSchema

  private readonly binary: string
  private readonly profile: string | undefined
  private readonly timeoutMs: number
  private readonly maxOutputChars: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'yzjBridge')
    this.binary = config.binary ?? DEFAULT_BINARY
    this.profile = config.profile === undefined || config.profile === '' ? undefined : config.profile
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  }

  /**
   * Run one command. `command` is argv AFTER the executable and any configured
   * `--profile` prefix, e.g. `['doc', 'workspace', 'list']`.
   */
  async run(
    command: readonly string[],
    options?: { timeoutMs?: number; stdin?: string },
  ): Promise<YzjRunResult> {
    const started = Date.now()
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs
    const stdin = options?.stdin
    const [executable, prefix] = await resolveBinary(this.binary)
    const argv = [
      ...prefix,
      ...(this.profile === undefined ? [] : ['--profile', this.profile]),
      ...command,
    ]

    return new Promise<YzjRunResult>((resolve, reject) => {
      const child = spawn(executable, argv, {
        stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let truncated = false
      let timedOut = false

      const capture = (existing: string, chunk: Buffer): string => {
        const next = existing + chunk.toString('utf8')
        if (next.length > this.maxOutputChars) {
          truncated = true
          return next.slice(0, this.maxOutputChars)
        }
        return next
      }

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)

      const stdoutStream = child.stdout
      const stderrStream = child.stderr
      if (stdoutStream === null || stderrStream === null) {
        clearTimeout(timer)
        reject(new YzjSpawnError(`spawn of "${this.binary}" returned no stdout/stderr stream`))
        return
      }
      stdoutStream.on('data', (chunk: Buffer) => { stdout = capture(stdout, chunk) })
      stderrStream.on('data', (chunk: Buffer) => { stderr = capture(stderr, chunk) })

      if (stdin !== undefined) {
        const stdinStream = child.stdin
        if (stdinStream === null) {
          clearTimeout(timer)
          reject(new YzjSpawnError(`spawn of "${this.binary}" returned no stdin stream`))
          return
        }
        // The child may exit before reading; swallow EPIPE rather than
        // surfacing an unhandled stream error.
        stdinStream.on('error', () => {})
        stdinStream.end(stdin)
      }

      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new YzjSpawnError(`failed to spawn yzj-cli binary "${this.binary}": ${String(error)}`))
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        let json: unknown
        if (stdout.trim() !== '') {
          try {
            json = unwrapCli(JSON.parse(stdout) as unknown)
          } catch {
            // Non-JSON output stays text-only.
          }
        }
        resolve({
          ok: !timedOut && code === 0,
          exitCode: timedOut ? null : code,
          stdout,
          stderr,
          ...(json === undefined ? {} : { json }),
          truncated,
          timedOut,
          durationMs: Date.now() - started,
        })
      })
    })
  }

  /** Probe reachability and authentication with a read-only command. */
  async check(timeoutMs = 10_000): Promise<boolean> {
    try {
      return (await this.run(['contact', 'user', 'get'], { timeoutMs })).ok
    } catch {
      return false
    }
  }
}

export const name = 'yzj-next-bridge'
export const Config = ConfigSchema

export function apply(ctx: Context, config: Config): void {
  void new YzjBridge(ctx, config)
}

export default YzjBridge
