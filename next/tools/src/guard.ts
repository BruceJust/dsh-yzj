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
 *
 * **And it keeps the books** (技术方案-下一代ERP账本 §13.3): whichever branch released
 * a write is held per call, and `tools/execute` writes `action/released` — with
 * the person that authority resolves to — BEFORE the body runs, then
 * `action/settled` after. A write whose line cannot be written does not run.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH,
  type PreToolDecision, type ToolExecution, type ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { ACTION_RELEASED, ACTION_SETTLED } from '@yzj-next/graph'
import { approvalIdFor, digestArgs, type TurnBinding } from '@yzj-next/objects'
import { applyActionLedger, type ActionAuthority, type ActionOutcome } from './action.ts'
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
  /*
    修理动词族的**话语兜底**过同一道门 (v3.15 裁决②).

    §7.6 的兜底明标写着「作废/顺延/移交 = 对 agent 说」，而一个只能在承诺板上按的动词
    是一种**违规能力**（凡只能在一个面上获得的能力就是违规能力）。正确形态是
    「对象寻址 + agent 提案 + 确认卡」——第三段不必新造：**写工具本来就过这道门**，
    有主权者的话语 + 确认与按钮同权（文本面是四通道之一）。

    `commitment_void` 是 `strong`：墓碑律——作废之后这条不会再被任何动词唤醒，而
    strong 从不被授权租约放行。另两个改的是**说出口过的事实**（日子、执行者），
    可纠可再改，standard。
  */
  commitment_void: { reason: '作废一条承诺 —— 墓碑律：作废之后它不会再被任何动词唤醒', level: 'strong' },
  /*
    **把一条惯例记成「不限场所」= 一次改变触达面的动作**（Bruce 裁决，2026-08-25）。

    三轴里只有场所轴关在这一间屋子里；本人（实体）与全组织两轴的坐标是账号本身，于是
    这样一条惯例**从此在每一个会话的每一轮里对模型生效**——和接单、建群同一族：改的不是
    某一件事，是「它在多少个房间里说话」。

    为什么必须是 `strong` 而不是 `standard`：standard 在「接纳这一回合的那条消息」之内
    是免确认的，而记忆恰恰几乎总是在那种回合里写下的——那道门会一次都不开。这里不是在
    说它不可逆（`memory_forget` 能忘掉它），是说**它每次都得问**：一条你没点头就跟去每个
    群的惯例，和一条悄悄改了触达面的开关，是同一种东西。

    `when` 让场所轴照旧零摩擦：绝大多数惯例本来就只关这一间屋子的事，给它们加一道门
    只会让人学会闭着眼睛点确认——摩擦要花在爆炸半径大的那一侧。
  */
  memory_note: {
    reason: '把一条惯例记成「不限场所」—— 它会跟着你进入每一个会话，此后每一轮都对模型生效',
    level: 'strong',
    when: args => asString(args.axis) !== 'place',
  },
  commitment_postpone: { reason: '顺延承诺期限 —— 改的是当初对着人说出口的那个日子', level: 'standard' },
  commitment_handoff: { reason: '把承诺移交给另一个执行者 —— 换人不换承诺', level: 'standard' },
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

/**
 * 轻问能用的工具 —— **白名单**（N6）。
 *
 * 轻问的契约是「问一个数得一个数，不做任何写入，什么都不发到场所里」。此前它只拦确认表
 * 里的写与逃逸工具，于是不在表里的写照样能跑：改日程描述（`event_post_materials`）、建
 * 目标文档（`goal_propose`）、往场所投卡（`commitment_register`）、改本地图
 * （`commitment_receipt`、`memory_forget`）、写本地文件（`write`、`edit`）——新加的工具
 * 也默认放行。契约要靠「列出能做的」来守：名单外一律拒，新工具在被人审过加进来之前，
 * 进不了只读回合。
 *
 * 只读 = 不改本地图、不改外部系统、不往场所发、不写文件、不动会话状态。
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // 图与私账
  'graph_query', 'pledger_query', 'event_brief', 'goal_evidence',
  // 云之家
  'yzj_whoami', 'yzj_contact_get', 'yzj_contact_search',
  'yzj_calendar_event_get', 'yzj_calendar_event_list', 'yzj_calendar_event_participants', 'yzj_calendar_room_find',
  'yzj_doc_workspace_list', 'yzj_doc_workspace_get', 'yzj_doc_list', 'yzj_doc_recent', 'yzj_doc_get',
  'yzj_doc_block_list', 'yzj_doc_download_url',
  'yzj_sheet_get', 'yzj_sheet_table_get', 'yzj_sheet_record_list',
  'yzj_im_group_recent', 'yzj_im_group_search', 'yzj_im_message_list', 'yzj_im_message_search',
  // 本机文件与网页：只读
  'read', 'read_image', 'glob', 'grep', 'web_fetch', 'web_search',
])

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
  /*
    只读投影的判据跟着**一张表**走，不跟着前缀走 (v3.15 裁决② 同一处教训)——而且是能做
    什么的那张表，不是不能做什么的那张：确认表只列了要问人的写，没列的写在这里照样会过。
  */
  if (readOnly && !READ_ONLY_TOOLS.has(exec.name)) {
    return '轻问是只读投影：问一个数得一个数，不做任何写入。需要写就用普通提问开一个任务。'
  }
  if (!exec.name.startsWith('yzj_')) return undefined
  if (binding?.messageId !== undefined) {
    const revoked = ctx.yzjGraph.revocationOf(binding.messageId)
    /*
      **写前复核** (决策 #63, §6.4)：让位落的就是一条 `authority/revoked`（撤销穿透，
      逐调用实时查）。一个在认领里输了却已进入工作的回合，在第一个写调用处被截断——
      双写的最后一道机械防线。理由原样带出：「另一个实例正在做」和「人收回了权力」
      对模型是两种完全不同的处境。
    */
    if (revoked !== undefined) {
      return revoked.startsWith('让位')
        ? `这次受话已${revoked}，本实例不再动手——宁可无人接单，不可两人动手`
        : '云之家任务授权已被撤销（超时或人工取消）'
    }
  }
  const spec = WRITE_SPECS[exec.name]
  if (spec?.category === undefined) return undefined
  const contract = ctx.yzjGraph.contractFor(binding?.placeKey ?? ORG_DEFAULT_PLACE)
  return contract.oaRequiredCategories.includes(spec.category)
    ? `此类事项（${spec.category}）需走组织审批流程，本地确认卡不能代替`
    : undefined
}

/**
 * 放行时挂起的授权来源。`exempt` 与 `approval` 要到执行时才定得下是谁：前者取那一刻的
 * 操作者，后者要看那张卡最后是不是我们的卡、批了没有。
 */
type PendingAuthority =
  | Extract<ActionAuthority, { kind: 'lease' | 'message' }>
  | { readonly kind: 'exempt' }
  | { readonly kind: 'approval' }

/** 一次调用的键：callId 只在单个会话内唯一（§13.3）。 */
const callKey = (sessionId: string, callId: string): string => `${sessionId}\0${callId}`

/**
 * 接纳本回合的那条消息，连同它的发送者。**缺一不可**：只有消息 id 的授权追不到人，
 * 宁可多问一次，也不放出一次无主的写（§13.3-4）。空串一律视为缺失。
 */
function admissionOf(binding: TurnBinding | undefined): { messageId: string; senderOpenId: string } | undefined {
  const messageId = binding?.messageId
  const senderOpenId = binding?.senderOpenId
  if (messageId === undefined || messageId === '' || senderOpenId === undefined || senderOpenId === '') return undefined
  return { messageId, senderOpenId }
}

/** 把挂起的授权定成账上的那一种；定不下来就是 undefined，调用方 fail closed。 */
function resolveAuthority(
  ctx: Context, held: PendingAuthority | undefined, binding: TurnBinding | undefined,
  sessionId: string, callId: string,
): ActionAuthority | undefined {
  if (held === undefined) return undefined
  if (held.kind === 'lease' || held.kind === 'message') return held
  const operator = binding?.accountOpenId
  if (held.kind === 'approval') {
    const approvalId = approvalIdFor(sessionId, callId)
    const approval = ctx.yzjGraph.rawObject('approval', approvalId)
    if (approval === undefined) {
      // 图上没有审批对象：确认是宿主自己的审批界面做的，它只在操作者桌面上。
      return operator === undefined ? undefined : { kind: 'operator', openId: operator, via: 'host-approval' }
    }
    const state = asRecord(approval.state)
    const decidedBy = asString(state.decidedBy)
    // 不是 approved 却走到了执行：按理不会发生，发生了就不认。
    return state.status === 'approved' && decidedBy !== '' ? { kind: 'approval', approvalId, decidedBy } : undefined
  }
  return operator === undefined ? undefined : { kind: 'operator', openId: operator, via: 'exempt' }
}

/** The timeout policy's code (`dsh-tool-call-timeout-policy`, not a dependency of ours). */
const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/**
 * 效果有没有发生（§13.3 表）——账要记的是效果，不是 post-execute 之后的说法。
 *
 * 超时归 `aborted-after-body`，不归 `failed`：宿主的超时包装器在计时器响过之后**替换**
 * 结果，而它的计时从 `tools/execute` 里才开始、工具体几毫秒内就被调用——超时几乎总是
 * 「工具体跑了、调用被掐断」。记成 failed 等于告诉翻账的人「没写成」，而那份文档可能
 * 已经建好了。
 */
function outcomeOf(result: ToolExecutionResult): { outcome: ActionOutcome; errorCode?: string } {
  if (!result.isError) {
    /*
      宿主说成功，不等于效果发生了：`yzj_*` 工具把 CLI 失败写成一段话照常返回（见
      `failureDigest`）。CLI 被超时杀掉时请求可能已经到了服务端——效果可能已发生；其余
      非零退出照实记 failed（退出码 3 = CLI 自己拒绝执行，读 errorCode 就知道）。
    */
    const failure = asRecord(asRecord(asRecord(result.value).data).cliFailure)
    if (Object.keys(failure).length === 0) return { outcome: 'ok' }
    return failure.timedOut === true
      ? { outcome: 'aborted-after-body', errorCode: 'CLI_TIMEOUT' }
      : { outcome: 'failed', errorCode: `CLI_EXIT_${String(failure.exitCode ?? 'killed')}` }
  }
  const code = result.error.info?.code
  const outcome: ActionOutcome = code === TOOL_ABORTED_BEFORE_DISPATCH ? 'not-dispatched'
    : code === TOOL_ABORTED || code === TOOL_TIMEOUT ? 'aborted-after-body'
      : 'failed'
  return { outcome, ...(code === undefined || code === '' ? {} : { errorCode: code }) }
}

/** fail closed 的返回值：与 dsh-tools 自己的错误结果同形。 */
function refused(message: string): ToolExecutionResult {
  return { isError: true, error: { message }, content: [{ type: 'text', text: `Error: ${message}` }] }
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
   * 放行路径挂起在这里，等 `tools/execute` 落账。这里只是**挂起**、不写日志：之后的单调
   * 守卫还可能拒绝。放在闭包里而不是模块级：模块级变量跨 Context 共享，插件卸载后还在。
   */
  const pending = new Map<string, PendingAuthority>()
  const hold = (exec: ToolExecution, authority: PendingAuthority): void => {
    if (exec.agent === undefined) return
    // 先查上限、超了先清空，再写入——先写后清会把刚写入的这一条也清掉。
    if (pending.size >= 5_000) pending.clear()
    pending.set(callKey(String(exec.agent.session.id), String(exec.callId)), authority)
  }
  /*
    挂起的授权在调用结束时就清掉，不论它走没走到执行：被下游拒绝、确认卡被拒或过期、
    取消，都不经过 `tools/execute`。只靠上限一次清空的话，被拒的调用会一直攒着，攒满时
    连**正在等确认卡**的那一条也一起清掉——人批了，写却因为「找不到授权」被拒。
    上限因此只是保险：在途的调用到不了这个数。
  */
  const disposeResult = ctx.on('tools/result', (exec: ToolExecution) => {
    if (exec.agent !== undefined) pending.delete(callKey(String(exec.agent.session.id), String(exec.callId)))
  })
  const disposeLedger = applyActionLedger(ctx)

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
          activeLeaseIds: [...(ctx.get('yzjLeases')?.activeLeaseIds() ?? [])],
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
    /*
      **确认表是「要不要问」的判据，`yzj_` 前缀是「是不是一次平台调用」的判据。**

      这两件事此前压在同一行里：`if (!exec.name.startsWith('yzj_')) return next()`。
      于是 v3.15 裁决② 把三个 `commitment_*` 写进确认表之后，**表里有、门不看**——
      作废一条承诺**一次确认都不弹**就落库了，而那条裁决的全部要点正是「人签发」。
      实测抓到的（对着 agent 说一句「把那条作废掉」，墓碑当场就立了）；而我为它写的
      单测只断言了**表里那一格**，没断言门真的会开口——一条锁住数据、锁不住行为的
      断言，正是它自己要防的那种。

      身份重钉与 env 快照仍然只对平台调用做：那两件事问的是「这次调用要不要用云之家
      的账号」，与要不要人点头无关。
      */
    const agent = exec.agent
    const binding = bindingFor(ctx, agent)
    /*
      身份重钉与 env 快照跟着**平台调用**走，读也要做：前者问的是「这次调用要不要用
      云之家的账号」，后者是「这一回合碰过云之家没有」。它们和「要不要人点头」是两个
      问题——压在同一个前缀判断里，正是下面那条 bug 的成因。
    */
    if (exec.name.startsWith('yzj_')) {
      if (binding !== undefined && binding.messageId !== undefined) await assertIdentity(binding)
      if (agent !== undefined) await recordEnvSnapshot(agent, binding)
    }

    const spec = WRITE_SPECS[exec.name]
    if (spec === undefined) return next()
    const args = asRecord(exec.arguments)
    const admission = admissionOf(binding)
    // 无须确认的写照样有主：接纳它的那条消息，否则是本实例的操作者（如 memory_note 的场所轴）。
    if (spec.when !== undefined && !spec.when(args)) {
      hold(exec, admission === undefined ? { kind: 'exempt' } : { kind: 'message', ...admission })
      return next()
    }

    // Decision order (§5.1): escape and identity are already behind us; a live
    // lease releases the call before the contract's write level is consulted.
    // Strong writes are never lease-covered — the safety floor is that
    // irreversible actions always ask.
    const lease = spec.level === 'standard'
      ? ctx.get('yzjLeases')?.coveringLease({
        toolName: exec.name,
        args,
        ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
        ...(binding?.accountOpenId === undefined ? {} : { openId: binding.accountOpenId }),
      })
      : undefined
    if (lease !== undefined) {
      hold(exec, { kind: 'lease', ...lease })
      return next()
    }

    // A standard write inside the turn the gateway just admitted is already
    // authorized by the message that admitted it — and only when we can say
    // WHO sent it. Earlier turns and ordinary desktop prompts never inherit
    // that; strong writes always ask.
    if (spec.level === 'standard' && binding?.writeMode === 'standard' && admission !== undefined) {
      hold(exec, { kind: 'message', ...admission })
      return next()
    }

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
    hold(exec, { kind: 'approval' })
    return { kind: 'ask', reason }
  }, { prepend: true })

  /*
    **先记后做**（§13.3-5）。写工具的效果可能落在别处、不可逆，所以 `action/released` 必须
    在工具体之前落盘；落不下或授权定不下来，就不执行（fail closed）。发言可以发后再记，
    写不行——发言本身就落在场所里，写的效果不一定。

    `prepend: true`：本监听是最外层，`next()` 看到的是宿主每一层包装器（超时、检查点）
    之后的结果。
  */
  const disposeExecute = ctx.on('tools/execute', async (exec, next) => {
    const spec = WRITE_SPECS[exec.name]
    if (spec === undefined) return next()
    const agent = exec.agent
    const sessionId = agent === undefined ? '' : String(agent.session.id)
    const callId = String(exec.callId)
    const held = agent === undefined ? undefined : pending.get(callKey(sessionId, callId))
    pending.delete(callKey(sessionId, callId))
    const binding = bindingFor(ctx, agent)
    const authority = resolveAuthority(ctx, held, binding, sessionId, callId)
    if (authority === undefined) return refused('找不到这次写入的授权，没有执行')
    try {
      await ctx.yzjGraph.append({
        type: ACTION_RELEASED,
        data: {
          sessionId, callId, toolName: exec.name, level: spec.level,
          argsDigest: digestArgs(exec.arguments), authority,
          ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
          ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
        },
        actor: { kind: 'agent' },
      })
    } catch (error) {
      return refused(`账没记上，这次写入没有执行（${error instanceof Error ? error.message : String(error)}）`)
    }
    const started = Date.now()
    /*
      `next()` 抛出 = 下游某一层包装器自己坏了，效果有没有发生说不清。那就不写 settled：
      它留成一个孤儿，`integrity()` 立刻看得见，下次打开分区标成「结果不明」——说不清的事
      照实记成说不清，好过替它编一个 outcome。
    */
    const result = await next()
    try {
      await ctx.yzjGraph.append({
        type: ACTION_SETTLED,
        data: { sessionId, callId, ...outcomeOf(result), durationMs: Date.now() - started },
        actor: { kind: 'agent' },
      })
    } catch (error) {
      // 写不下 settled 只报错、不改结果：效果已经发生了，下次启动由孤儿扫描兜底。
      console.error('[yzj-next-tools] failed to settle a released write', error)
    }
    return result
  }, { prepend: true })

  return () => {
    void disposeListener()
    void disposeExecute()
    void disposeResult()
    disposeGuard()
    disposeLedger()
  }
}
