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

/**
 * yzj-cli 0.1.6 起，成功输出统一包在信封里：`{ success: true, identity, data }`——
 * 0.1.4 及之前是裸数据（数组，或 `{ list, more }` 这样的对象）。
 *
 * **在这一点剥壳，而且只在这一点**：桥接层是所有消费者读 `result.json` 的唯一入口
 * （通道 / 工具 / 桌面 / 私账），每个消费者各自兼容两种形状，就是十几处可以忘记的
 * 地方——而忘掉一处的形态不是报错，是「(no workspaces)」这种恰好为空的屏幕。
 * 这次升级正是这么把两个实例一起打断的：identity 读到的是整只信封，`openId` 在
 * `data` 里，通道以为登录没了。
 *
 * 认信封的判据是**形状**不是版本：`success === true` 且带 `data` 键。裸数据里不会
 * 同时出现这两样（旧形状的对象是 `{ list, more }` / `{ msgId }` 之类）。失败信封走
 * 的是 stderr + 非零 exit，不经这里。
 */
export function unwrapEnvelope(json: unknown): unknown {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return json
  const record = json as Record<string, unknown>
  if (record.success === true && 'data' in record) return record.data
  return json
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
            json = unwrapEnvelope(JSON.parse(stdout) as unknown)
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
