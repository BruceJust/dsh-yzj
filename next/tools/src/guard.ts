/**
 * The approval guard — the single gate every Yunzhijia write passes through.
 *
 * It ships with the tools it guards rather than with the orchestrator, so a
 * deployment that mounts the tool family can never end up with ungated writes.
 *
 * **Where each check lives is a security decision, not a style one.** The pure
 * denials sit in `ctx.tools.guard()`, a MONOTONIC gate the registry runs after
 * every `tools/pre-execute` listener and before the tool body: guards have no
 * allow result, so no other plugin's `allow` can turn our denial back into
 * permission, and a revocation that lands while a confirmation card is still
 * pending still stops the call. Everything that needs to be async or to ASK
 * sits in a `tools/pre-execute` listener registered with `prepend: true`,
 * because a listener that claims the call first decides it (cordis waterfall
 * runs listeners in registration order).
 *
 * The order of checks, and why:
 *
 * 1. **Escape denial.** A gateway turn may not reach shell or delegated
 *    execution: the authority a Yunzhijia message carries is authority to use
 *    Yunzhijia, not authority to run anything.
 * 2. **Live revocation.** Read from the graph on EVERY call, never from a turn
 *    snapshot: "capability overreach is revocable" outranks snapshot stability
 *    (§5.3 撤销类硬项穿透快照).
 * 3. **Hard contract.** A category the place contract routes to the
 *    organization's own approval rail is denied outright — a local card must
 *    not manufacture the appearance of organizational permission (TD-5).
 * 4. **Identity re-pin.** Before every `yzj_*` call, the live CLI identity is
 *    compared with the one the turn was admitted under. A token swap mid-task
 *    would otherwise write into somebody else's account.
 * 5. **Lease hit.** A live authorization lease releases a standard write
 *    before the contract's write level is consulted. Strong writes are never
 *    lease-covered.
 * 6. **Ask.** The full parsed arguments are handed to the approval object, and
 *    the call blocks on the confirmation card.
 *
 * It also writes the turn's `env/snapshot` lazily, at the first Yunzhijia
 * resource consumption, at most once per turn (§4).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { TurnBinding } from '@yzj-next/objects'
import type {} from '@yzj-next/objects'
import { asRecord, asString } from './shared.ts'

/**
 * Tools a Yunzhijia-admitted turn may never call. Shell and delegated
 * execution are obvious; `send_message` and the goal tools are here because
 * they act outward under an authority the inbound message did not grant.
 */
export const GATEWAY_ESCAPE_TOOLS = new Set([
  'bash', 'pwsh', 'subagent', 'subagent_fork', 'workflow', 'ralph',
  'create_goal', 'update_goal', 'send_message',
])

/** Risk level of one gated write. */
export type YzjRiskLevel = 'standard' | 'strong'

interface WriteSpec {
  readonly reason: string
  /** `strong` marks the irreversible operations; they never batch-merge. */
  readonly level: YzjRiskLevel
  /**
   * Organizational category this action belongs to. When a place contract
   * lists it under `oaRequiredCategories`, the call is denied rather than
   * asked. Empty in P1 — the enum position exists so the boundary is real
   * before the first contract is ever written.
   */
  readonly category?: string
  /** Optional predicate over parsed arguments; default asks always. */
  when?(args: Record<string, unknown>): boolean
}

/** Tool name → gate. Every write tool in the family appears here. */
export const WRITE_SPECS: Record<string, WriteSpec> = {
  // --- strong: irreversible, never merged ---
  yzj_doc_delete: { reason: '删除知识库文档节点，不可恢复', level: 'strong' },
  yzj_doc_block_delete: { reason: '删除文档块内容，不可恢复', level: 'strong' },
  yzj_sheet_table_delete: { reason: '删除数据表及其全部记录，不可恢复', level: 'strong' },
  yzj_sheet_record_delete: { reason: '删除多维表格记录，不可恢复', level: 'strong' },
  yzj_calendar_event_delete: { reason: '取消/删除日程', level: 'strong' },
  /*
    建群 = 创造一个新的听众集合，比在现成的听众集合里挑一个**更须人批**（设计 v4.18）。

    它和上面那几条不同：那些是「删掉的东西回不来」，这一条是「从此有一批人听得见这里
    说的每一句话」。不可逆的是**边界本身**——群可以解散，但谁在那段时间里听见了什么，
    没有任何操作能收回。所以它落在 strong，且永不与别的写入合并确认。

    摩擦刀在这里的用法：平台让建群变容易了，而建群的难度本来在**保护听众集合**——
    设计的动向因此是把新能力放进确认门，不是拥抱这份便利。
  */
  yzj_im_group_create: { reason: '新建群组 —— 这会创造一个新的听众集合，从此他们听得见这里的每一句话', level: 'strong' },
  // --- standard: side effects but reversible or additive ---
  yzj_im_message_send: { reason: '发送 IM 消息到云之家会话，发出后不可撤回', level: 'standard' },
  yzj_file_upload: { reason: '上传文件到云之家，即刻落服务端', level: 'standard' },
  yzj_file_download: {
    reason: '下载文件并覆盖本地已有文件',
    level: 'standard',
    when: args => args.overwrite === true,
  },
  yzj_doc_move: { reason: '移动知识库文档节点', level: 'standard' },
  yzj_doc_workspace_create: { reason: '新建知识库', level: 'standard' },
  yzj_doc_create: { reason: '新建知识库文档', level: 'standard' },
  yzj_doc_rename: { reason: '重命名知识库文档', level: 'standard' },
  yzj_doc_import: { reason: '导入文件到知识库', level: 'standard' },
  yzj_doc_block_insert: { reason: '向文档插入内容', level: 'standard' },
  yzj_doc_block_update: { reason: '更新文档内容', level: 'standard' },
  yzj_sheet_create: { reason: '新建多维表格', level: 'standard' },
  yzj_sheet_table_create: { reason: '新建数据表', level: 'standard' },
  yzj_sheet_table_rename: { reason: '重命名数据表', level: 'standard' },
  yzj_sheet_record_create: { reason: '新增多维表格记录', level: 'standard' },
  yzj_sheet_record_update: { reason: '更新多维表格记录', level: 'standard' },
  yzj_calendar_event_create: { reason: '新建日程', level: 'standard' },
  yzj_calendar_event_update: { reason: '更新日程', level: 'standard' },
}

/** The place a turn with no place of its own is contracted under. */
export const ORG_DEFAULT_PLACE = 'org-default'

/** The turn binding in force for one execution, if any. */
function bindingFor(ctx: Context, agent: Agent | undefined): TurnBinding | undefined {
  if (agent === undefined) return undefined
  const turns = ctx.get('yzjTurns')
  return turns?.bindingFor(agent) ?? turns?.defaultBinding()
}

/**
 * Every denial that can be decided synchronously, in one place so the
 * monotonic guard and the early pre-execute check can never drift apart.
 * @returns the denial reason, or undefined to leave the call alone.
 */
export function denialFor(ctx: Context, exec: Pick<ToolExecution, 'name' | 'agent'>): string | undefined {
  const binding = bindingFor(ctx, exec.agent)
  const gatewayTurn = binding?.messageId !== undefined
  const readOnly = binding?.writeMode === 'read-only'

  if ((gatewayTurn || readOnly) && GATEWAY_ESCAPE_TOOLS.has(exec.name)) {
    return readOnly
      ? '轻问是只读投影，不能使用 shell 或委派执行类工具'
      : '云之家触发的回合不能使用 shell 或委派执行类工具'
  }
  if (!exec.name.startsWith('yzj_')) return undefined
  // A projection that can write is not a projection. Denied in the monotonic
  // guard so no earlier listener's `allow` can hand the authority back.
  if (readOnly && WRITE_SPECS[exec.name] !== undefined) {
    return '轻问是只读投影：问一个数得一个数，不做任何写入。需要写就用普通提问开一个任务。'
  }
  if (binding?.messageId !== undefined && ctx.yzjGraph.isRevoked(binding.messageId)) {
    return '云之家任务授权已被撤销（超时或人工取消）'
  }
  const spec = WRITE_SPECS[exec.name]
  if (spec?.category === undefined) return undefined
  const contract = ctx.yzjGraph.contractFor(binding?.placeKey ?? ORG_DEFAULT_PLACE)
  return contract.oaRequiredCategories.includes(spec.category)
    ? `此类事项（${spec.category}）需走组织审批流程，本地确认卡不能代替`
    : undefined
}

/**
 * The turn a call belongs to: session id plus the sequence of its opening
 * `turn/start`. Used as the once-per-turn key for `env/snapshot`.
 */
function turnAnchorOf(agent: Agent): string {
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start') return `${String(agent.session.id)}#${String(event.seq)}`
  }
  return `${String(agent.session.id)}#0`
}

/** Register the guard on both seams. Returns the disposer. */
export function applyApprovalGuard(ctx: Context): () => void {
  /** Turns whose `env/snapshot` has already been written. */
  const snapshotted = new Set<string>()

  /**
   * Compare the live CLI identity with the one this turn was admitted under.
   * A mismatch is fatal for the call, not a warning: the account is the whole
   * authority.
   */
  const assertIdentity = async (binding: TurnBinding): Promise<void> => {
    if (binding.accountOpenId === undefined || binding.accountOrgId === undefined) return
    const result = await ctx.yzjBridge.run(['contact', 'user', 'get'], { timeoutMs: 10_000 })
    if (!result.ok) throw new Error('Cannot verify the Yunzhijia account before this call')
    const first = Array.isArray(result.json) ? result.json[0] : result.json
    const identity = asRecord(first)
    if (asString(identity.orgId) !== binding.accountOrgId
      || asString(identity.openId) !== binding.accountOpenId) {
      throw new Error('Yunzhijia login account changed after this task was admitted')
    }
  }

  /** Lazily record what authority this turn is standing on (§1.9-5). */
  const recordEnvSnapshot = async (agent: Agent, binding: TurnBinding | undefined): Promise<void> => {
    const anchor = turnAnchorOf(agent)
    if (snapshotted.has(anchor)) return
    snapshotted.add(anchor)
    // Bounded: at most one line per turn, and only for turns that actually
    // touched Yunzhijia.
    if (snapshotted.size > 5_000) snapshotted.clear()
    const contract = ctx.yzjGraph.contractFor(binding?.placeKey ?? ORG_DEFAULT_PLACE)
    try {
      await ctx.yzjGraph.append({
        type: 'env/snapshot',
        data: {
          sessionAnchor: anchor,
          contractVersion: contract.version,
          activeLeaseIds: [],
          injectedMemoryIds: [],
          fedReferenceIds: [],
        },
        actor: { kind: 'agent' },
      })
    } catch (error) {
      // An unwritable snapshot must not block the work it describes.
      console.error('[yzj-next-tools] failed to record the turn environment snapshot', error)
    }
  }

  const disposeGuard = ctx.tools.guard(exec => denialFor(ctx, exec))

  const disposeListener = ctx.on('tools/pre-execute', async (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> => {
    // The same predicate the monotonic guard enforces, run early so a denied
    // call never prompts anybody. The guard remains the backstop.
    const denial = denialFor(ctx, exec)
    if (denial !== undefined) return { kind: 'deny', reason: denial }
    if (!exec.name.startsWith('yzj_')) return next()

    const agent = exec.agent
    const binding = bindingFor(ctx, agent)
    if (binding !== undefined && binding.messageId !== undefined) await assertIdentity(binding)
    if (agent !== undefined) await recordEnvSnapshot(agent, binding)

    const spec = WRITE_SPECS[exec.name]
    if (spec === undefined) return next()
    const args = asRecord(exec.arguments)
    if (spec.when !== undefined && !spec.when(args)) return next()

    // Decision order (§5.1): escape and identity are already behind us; a live
    // lease releases the call before the contract's write level is consulted.
    // Strong writes are never lease-covered — the safety floor is that
    // irreversible actions always ask.
    if (spec.level === 'standard' && ctx.get('yzjLeases')?.covers({
      toolName: exec.name,
      args,
      ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
      ...(binding?.accountOpenId === undefined ? {} : { openId: binding.accountOpenId }),
    }) === true) return next()

    // A standard write inside the turn the gateway just admitted is already
    // authorized by the message that admitted it. Earlier turns and ordinary
    // desktop prompts never inherit that; strong writes always ask.
    if (spec.level === 'standard'
      && binding?.writeMode === 'standard'
      && binding.messageId !== undefined) return next()

    const reason = `云之家操作确认：${spec.reason}`
    const asks = ctx.get('yzjAsks')
    if (asks === undefined || agent === undefined) {
      // No approval object mounted: fail closed rather than silently allowing.
      return { kind: 'deny', reason: `${reason}（确认通道不可用，已拒绝）` }
    }
    asks.record(String(agent.session.id), {
      callId: String(exec.callId),
      toolName: exec.name,
      level: spec.level,
      reason,
      args: args as never,
    })
    return { kind: 'ask', reason }
  }, { prepend: true })

  return () => {
    void disposeListener()
    disposeGuard()
  }
}
