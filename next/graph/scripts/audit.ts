/**
 * 账的审计（技术方案-下一代ERP账本 §13.6）。只读，不进模型工具面，不进 UI。
 *
 *   pnpm --filter @yzj-next/graph run audit [<分区目录 | 分区根目录>]
 *
 * 是 `pnpm run audit`：`pnpm audit` 是 pnpm 自带的依赖漏洞审计。默认读
 * `$DSH_HOME/yzj-next/graph` 下的每个分区。先构建、再跑构建产物——仓库里没有 TS 运行器，
 * Node 的类型剥离又不支持参数属性，所以这里只是一层薄壳，逻辑全在 `src/ledger.ts`（有测试）。
 * 链断了、或起点封存的那段 v1 被改过（`v1Sealed: false`），就以退出码 1 结束；孤儿、损坏行与
 * 「效果可能已发生」照实报告，交人去看。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { auditLedger, parseLog, v1SealHolds } from '../lib/index.js'

const target = resolve(process.argv[2] ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'yzj-next', 'graph'))
if (!existsSync(target)) throw new Error(`no such directory: ${target}`)
const partitions = existsSync(join(target, 'graph.jsonl'))
  ? [target]
  : readdirSync(target).map(name => join(target, name)).filter(dir => existsSync(join(dir, 'graph.jsonl')))
if (partitions.length === 0) throw new Error(`no graph.jsonl under ${target}`)

let broken = false
for (const partition of partitions) {
  const bytes = readFileSync(join(partition, 'graph.jsonl'))
  const { events, damagedLines } = parseLog(bytes.toString('utf8'))
  const audit = auditLedger(events)
  const v1Sealed = v1SealHolds(bytes, events)
  broken ||= audit.chain.breakAt !== undefined || v1Sealed === false
  console.log(JSON.stringify({ partition, lines: events.length, damagedLines, v1Sealed, ...audit }, null, 2))
}
process.exitCode = broken ? 1 : 0
