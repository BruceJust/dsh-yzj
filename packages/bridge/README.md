# @dsh-yzj/bridge

Host channel to the Yunzhijia CLI (`yzj-cli`): bounded subprocess invocations that reuse the machine's `yzj-cli auth login` state.

## Service

`ctx.yzjBridge` (service name `yzjBridge`), default-exported `YzjBridge extends Service`.

### `run(command, options?)`

Run one `yzj-cli` command with the executable resolved from config. Arguments pass verbatim — no shell interpolation. A non-zero exit is a result, not a rejection. `options.stdin` writes a body to the child's stdin and closes it.

Returns `YzjRunResult`: `ok`, `exitCode` (`null` when killed by the timeout), `stdout`/`stderr` (capped at `maxOutputChars`), `json` (stdout parsed as one JSON document when it parses), `truncated`, `timedOut`, `durationMs`.

Rejects with `YzjSpawnError` only when the configured binary cannot be launched.

### `check(timeoutMs?)`

Runs `contact user get` and returns whether the binary is reachable and authenticated; used by tests and by consumers deciding whether to advertise tools.

## Config

| Field | Default | Meaning |
| ----- | ------- | ------- |
| `binary` | `yzj-cli` | Executable name or absolute path. |
| `profile` | (none) | yzj-cli credential/config profile (`--profile <name>`); empty = the CLI default profile. |
| `timeoutMs` | `60000` | Cooperative timeout per invocation. |
| `maxOutputChars` | `200000` | Per-stream capture cap in characters. |

## Model Experience

No direct token, prompt, or KV-cache effect: the bridge spawns the CLI and returns typed results to consumers; the model-visible digests are owned by `@dsh-yzj/tool-yzj`.

## Known Limitations and Deferred Work

- **Single-JSON stdout assumption** — `run` parses stdout only when the whole stream is one JSON document; multi-document or wrapped output stays text-only and the caller must render it.
- **No output retention** — captured output exists only on the returned result; durable replay of a tool result depends on the tool layer logging it.
- **No in-process API client** — the bridge deliberately reuses the CLI's login state and command surface; a REST channel would be a separate service.
