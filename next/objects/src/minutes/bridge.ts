/**
 * 纪要双桥 —— 会议纪要变成**提案**，永远不变成事实 (§5.6，设计 v4.16).
 *
 * 一场会散了之后，AI 速记已经把「定了什么」和「谁去做什么」抽出来了。这个文件做的
 * 是把那两样接进图里，各走一座桥：
 *
 * - **decisions → 目标提案**，带上速记给的 `basis`（当时凭什么这么定的）；
 * - **actionItems → 承诺提案**，带上 `executors[].openId`（能直落到人）。
 *
 * 两座桥的终点都是**提案**，不是承诺，也不是目标。铁律没有例外：**人签发**。速记再
 * 准，它抽出来的也只是一份稿子——一条没人签过字就进了账的承诺，正是这套设计从第一天
 * 起就在拒绝的东西。
 *
 * 三条容易做错的：
 *
 * - **三级可信度**：绑定的 `openId` > AI 写的名字 > 「发言人3」。只有第一级才自动
 *   挂到人身上；后两级照样进裁决，但**不挂人**——宁空勿错。挂错人的代价不是一个字段
 *   错了，是那条承诺会以某人的名义被代发到群里。
 * - **纪要没有版本号**：同一场会重复摄取，靠**内容级指纹**去重，不靠时间戳。时间戳
 *   会变、内容不变，按时间戳去重会把同一件事提第二遍。
 * - **速记侧的待办只读**：`minutes/action` 能写回去，但那些条目**没有 per-item id、
 *   更新是全量替换**——写回去会把人在速记里手工改过的东西整段覆盖掉。所以这一侧
 *   只读，一个字都不写。
 */

import { createHash } from 'node:crypto'
import { asNumber, asRecord, asString, type JsonValue } from '@yzj-next/graph'

/** 一个 JSON 数组，或者没有。内核的 json 助手里没有这一个，只在这里用。 */
function asArray(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

/** 谁做这件事，以及**我们凭什么这么认为**。 */
export type ExecutorTrust =
  /** 绑定到了真实账号——只有这一级会自动挂人。 */
  | { readonly tier: 'bound'; readonly openId: string; readonly name?: string }
  /** 速记写下的一个名字。是不是这个人、组织里有没有重名，都不知道。 */
  | { readonly tier: 'named'; readonly name: string }
  /** 连名字都没有，只有「发言人3」。 */
  | { readonly tier: 'unknown' }

/** 一条待办，读成提案条目该有的样子。 */
export interface MinutesTask {
  readonly what: string
  readonly executor: ExecutorTrust
  readonly due?: string
  /** 内容级指纹——同一场会重复摄取时靠它认出「这条提过了」。 */
  readonly fingerprint: string
}

/** 一条决议：定了什么，以及当时凭什么。 */
export interface MinutesDecision {
  readonly what: string
  /** 速记给的依据。**目标提案带依据**这件事，全行业只有开了会才拿得到。 */
  readonly basis?: string
  readonly owner?: string
  readonly fingerprint: string
}

export interface MinutesRead {
  readonly stenoId: string
  readonly title?: string
  readonly decisions: readonly MinutesDecision[]
  readonly tasks: readonly MinutesTask[]
  /**
   * 参会人的 openId。
   *
   * 设计说纪要要携带**参会人听众集合**。而图的听众词汇是 placeKey，表达不了「这几个
   * 人」——所以这里只把它作为**证据**记下来，不冒充听众。少了这一步会更糟：拿一个
   * 表达不了的东西当听众用，等于给了一个假的隔离承诺。见 §6.8 词汇卫生条款。
   */
  readonly participants: readonly string[]
}

/** 指纹：同一场会里同一句话，无论抽取几次都是同一条。 */
function fingerprintOf(stenoId: string, kind: string, text: string): string {
  return createHash('sha256')
    .update('yzj-next-minutes-v1').update('\0')
    .update(stenoId).update('\0').update(kind).update('\0')
    .update(text.replace(/\s+/gu, ' ').trim().toLowerCase())
    .digest('hex')
    .slice(0, 20)
}

/**
 * 一个执行者的可信度。
 *
 * `executors[]` 是速记**绑定到了真实账号**的那一份，`assignee` 只是它写下的一段文字。
 * 前者能直落到人，后者不能——把后者当成前者，就会出现「张三」被挂到组织里另一个张三
 * 身上，然后以操作者的名义把登记消息发进那个人的会话。
 */
export function trustOf(item: JsonValue | undefined): ExecutorTrust {
  const record = asRecord(item)
  const executors = asArray(record?.executors)
  for (const candidate of executors ?? []) {
    const person = asRecord(candidate)
    const openId = asString(person?.openId)
    if (openId === undefined || openId === '') continue
    const name = asString(person?.name) ?? asString(person?.userName)
    return { tier: 'bound', openId, ...(name === undefined ? {} : { name }) }
  }
  const assignee = asString(record?.assignee)?.trim()
  if (assignee === undefined || assignee === '') return { tier: 'unknown' }
  /*
    「发言人3」不是一个名字。

    速记在认不出说话人时用这个占位。把它当名字挂上去，裁决面上会出现一条
    「发言人3 负责…」——读的人得先去猜那是谁，而这正是三级可信度要挡的那一格。
  */
  if (/^发言人\s*\d+$/u.test(assignee)) return { tier: 'unknown' }
  return { tier: 'named', name: assignee }
}

/** epoch 毫秒 → 人读的日期。速记给的是 int64。 */
function dueOf(value: JsonValue | undefined): string | undefined {
  const ms = asNumber(value)
  if (ms === undefined || ms <= 0) return undefined
  const date = new Date(ms)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 把一份速记详情读成两桥的原料。
 *
 * **形状取自 yapi 导出的真实声明**（455 livestream）：`minutes.decisions[{content,
 * basis, owner}]`、`minutes.actionItems[{text, assignee, dueDate, executors[]}]`、
 * `executors[].openId`。不是猜的——这个仓库已经为「断言一个形状而不去看它」付过两次
 * 学费了。
 */
export function readMinutes(stenoId: string, payload: JsonValue | undefined): MinutesRead {
  const root = asRecord(payload)
  const minutes = asRecord(root?.minutes)
  const decisions: MinutesDecision[] = []
  for (const entry of asArray(minutes?.decisions) ?? []) {
    const record = asRecord(entry)
    const what = asString(record?.content)?.trim()
    if (what === undefined || what === '') continue
    const basis = asString(record?.basis)?.trim()
    const owner = asString(record?.owner)?.trim()
    decisions.push({
      what,
      ...(basis === undefined || basis === '' ? {} : { basis }),
      ...(owner === undefined || owner === '' ? {} : { owner }),
      fingerprint: fingerprintOf(stenoId, 'decision', what),
    })
  }

  const tasks: MinutesTask[] = []
  for (const entry of asArray(minutes?.actionItems) ?? []) {
    const record = asRecord(entry)
    const what = asString(record?.text)?.trim()
    if (what === undefined || what === '') continue
    const due = dueOf(record?.dueDate)
    tasks.push({
      what,
      executor: trustOf(entry),
      ...(due === undefined ? {} : { due }),
      fingerprint: fingerprintOf(stenoId, 'task', what),
    })
  }

  const participants: string[] = []
  for (const entry of asArray(root?.participants) ?? asArray(root?.members) ?? []) {
    const openId = asString(asRecord(entry)?.openId)
    if (openId !== undefined && openId !== '' && !participants.includes(openId)) {
      participants.push(openId)
    }
  }

  const title = asString(root?.title) ?? asString(minutes?.title)
  return {
    stenoId,
    ...(title === undefined || title === '' ? {} : { title }),
    decisions,
    tasks,
    participants,
  }
}

/**
 * 一条待办要交给裁决面的样子。
 *
 * 只有 `bound` 那一级带 openId 出去。另外两级把**我们知道的那点线索**写进条目正文，
 * 让裁决的人自己认领——而不是替他认。
 */
export function proposalItemFor(task: MinutesTask): {
  readonly what: string
  readonly executorOpenId?: string
  readonly executorName?: string
  readonly due?: string
} {
  const base = { what: task.what, ...(task.due === undefined ? {} : { due: task.due }) }
  switch (task.executor.tier) {
    case 'bound':
      return {
        ...base,
        executorOpenId: task.executor.openId,
        ...(task.executor.name === undefined ? {} : { executorName: task.executor.name }),
      }
    case 'named':
      /*
        名字写进正文，**不写进执行者字段**。

        写进执行者字段的后果不是「填错一个格」：确认那一刻会以操作者的名义，把登记
        消息发进那个人的会话——而我们并不知道组织里叫这个名字的是不是他。
      */
      return { ...base, what: `${task.what}（速记记的是「${task.executor.name}」，未绑定账号）` }
    default:
      return { ...base, what: `${task.what}（速记没认出是谁）` }
  }
}
