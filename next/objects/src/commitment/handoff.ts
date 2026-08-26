/**
 * 移交 = **这条边的重新签发** —— 决策 #59 的那一份实现。
 *
 * 三条路会到这里（桌面的选择条、agent 的 `commitment_handoff`、IM 里的 `/handoff`），
 * 而它们必须写出**一模一样的两笔**。各写一份的后果不会立刻报错，只会在某一次改动之后
 * 开始各说各话——比如有一条忘了带血缘，于是从那条路移交出去的活，接手的人看不到这件事
 * 以前发生过什么。
 *
 * ## 为什么是分叉，不是改一个字段
 *
 * 边变异模型（`updated.executor`）被 review 推翻，理由不是洁癖：`/handoff` 在这套系统里
 * 一直是 `/fork` 的语义，而**边变异让听众集合无解**——一条边先后经过两次登记性话语，
 * 它的听众究竟是哪一批人？两次的并集是一个谁都答不上来「这句话说给谁听」的泥潭，而
 * 听众集合是这套东西的地基。
 *
 * 分叉之后那个问题不存在了：各自的听众就是各自那次话语的听众（v4.4 干净适用）。附带
 * 地，**三方知情从一个要发明的补递机制，降成两个既有动作的自然结果**。
 *
 * ## 顺序：新边先出生
 *
 * 反过来的话，中间那一刻这件活既不在跟、也还没有接手人——一次**可观测的凭空消失**。
 * 按现在的顺序，最坏情况是两条边同时活着：看得见，也修得掉。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type JsonValue } from '@yzj-next/graph'
import { commitmentIdFor, type CommitmentExecutor, type CommitmentState } from './family.ts'

export interface ReissuePlan {
  /** 旧边。 */
  readonly from: string
  /** 新执行者。**可以和现任是同一个人**——换场所不换人也是移交。 */
  readonly executor: { readonly openId: string; readonly name?: string }
  /** 新边的听众：移交话语落在的那个场所。 */
  readonly placeKey: string
  /** 出生锚：移交话语那条消息。同一句话重放只会得到同一条边。 */
  readonly anchor: string
  /** 移交话语落在话题里时带上——落在主楼时没有，那是如实。 */
  readonly topicKey?: string
}

export interface Reissued {
  readonly toCommitmentId: string
  /** 旧边的登记场所。跨场所时要往那儿落一帖解除告知。 */
  readonly fromPlaceKey?: string
  readonly what: string
  readonly due?: string
  readonly fromExecutor: CommitmentExecutor
}

/**
 * 旧边上**还有什么等着人裁决** —— 移交不吞裁决 (v3.19r③).
 *
 * 旧边一转吸收态就 `isResolved`，挂在它上面的验收卡随之收口。于是一份「他交了、等你
 * 验收」的交付，会被一次移交**无声地吞掉**：没有人拒绝过它，也没有人接受过它，它只是
 * 不见了。这是「绝不静默丢失」这条律的移交面。
 *
 * **不阻塞**（移交是 owner 的主权，他有权在裁决之前就换人），但必须**亮出来**：确认
 * 之前说清「1 份待验收将随旧边封存——验收权仍在你，可以先裁决」。
 */
export function pendingDecisionsOn(state: CommitmentState): readonly string[] {
  const out: string[] = []
  if (state.delivery !== undefined) {
    const round = state.round === undefined || state.round === 0 ? '' : `（第 ${String(state.round + 1)} 版）`
    out.push(`1 份待验收的交付${round}：「${state.delivery.claim}」`)
  }
  return out
}

/** 旧边此刻能不能被重新签发。拒绝要说人话——这是给人看的回执，不是日志。 */
export function reissuable(
  state: CommitmentState | undefined,
): { readonly state: CommitmentState } | { readonly refusal: string } {
  if (state === undefined) return { refusal: '找不到这条承诺。' }
  if (state.status === 'transferred') {
    const to = state.transferredTo?.executor
    const who = to === undefined || to.kind === 'agent' ? '别人' : to.name ?? to.openId
    return { refusal: `这条已经移交给${who}了——要再转手，去新的那一条上移交。` }
  }
  if (state.status !== 'open') return { refusal: '这条承诺已经结束了，不能移交。' }
  return { state }
}

/**
 * 这条边**登记在哪个场所** —— 一份答案，三个提问者。
 *
 * 提问的有三处：预选当前值那一屏（现场所要标出来）、「都不改 = 无事发生」那道守卫、
 * 解除告知往哪儿落。它们必须得到同一个答案，否则会长出一种最难查的谎：界面标着「现在
 * 就在这儿」，守卫却认为场所变了，于是一次真正的空操作被放行。
 *
 * **两条来路，因为哪一条都可能缺**：`audience` 是登记那句话确立的听众（正常路径都有），
 * 而更早的一些生产者只记了 `topicKey`。少写这条回退，那些行会同时失去守卫和告知。
 */
export function placeOfEdge(ctx: Context, state: CommitmentState): string | undefined {
  const listed = (state.audience ?? [])[0]
  if (listed !== undefined) return listed
  if (state.topicKey === undefined) return undefined
  return ctx.yzjGraph.topicHandle(state.topicKey)?.placeKey
}

/**
 * 两维都没变 = **无事发生**（决策 #59 的守卫）。
 *
 * 不是省一次写：一次「什么都没改的移交」会在图上留下一条 transferred 的旧边和一条内容
 * 完全相同的新边，而板上看起来就是这件活自己抖了一下、换了个 id。已有的回执与轨迹全
 * 留在了那条没人再看的旧边上——**代价全付了，什么都没换到**。
 */
export function nothingChanges(
  ctx: Context,
  state: CommitmentState,
  plan: { readonly executor: { readonly openId: string }; readonly placeKey: string },
): boolean {
  const now = state.executor
  const samePerson = now.kind === 'human' && now.openId === plan.executor.openId
  return samePerson && placeOfEdge(ctx, state) === plan.placeKey
}

/**
 * 写那两笔。**新边先出生，旧边后转态**（见文件头）。
 *
 * 新边继承的是**这件事本身**：事项、期限、验收标准、它挂在哪个目标下。不继承的是这条边
 * 私有的历史——回执、轨迹、受领状态、投影选择。受领三态因此在新边上从头开始，而那是对
 * 的：新执行者还没答应过任何事。
 */
export async function reissueEdge(
  ctx: Context,
  plan: ReissuePlan,
): Promise<Reissued | { readonly error: string }> {
  const raw = ctx.yzjGraph.rawObject('commitment', plan.from)
  const state = raw?.state as CommitmentState | undefined
  const gate = reissuable(state)
  if ('refusal' in gate) return { error: gate.refusal }
  const old = gate.state

  const toCommitmentId = commitmentIdFor(plan.anchor, old.what)
  if (toCommitmentId === plan.from) {
    // 同一个锚 + 同一件事 = 同一条边。这不是移交，是把自己交给自己。
    return { error: '这一句就是那条承诺自己的出生话语——移交要另说一句。' }
  }
  const fromExecutor = old.executor
  await ctx.yzjGraph.append({
    type: 'commitment/opened',
    data: {
      commitmentId: toCommitmentId,
      what: old.what,
      executor: {
        kind: 'human',
        openId: plan.executor.openId,
        ...(plan.executor.name === undefined ? {} : { name: plan.executor.name }),
      },
      sourceAnchor: plan.anchor,
      ...(plan.topicKey === undefined ? {} : { topicKey: plan.topicKey }),
      // 听众 = 移交话语的听众集合。旧边那批人不跟着走——他们收到的是解除告知。
      audience: [plan.placeKey],
      ...(old.due === undefined ? {} : { due: old.due }),
      ...(old.criteria === undefined ? {} : { criteria: old.criteria }),
      /*
        目标挂接继承旧边。`attachedVia` 仍写 `inherited`——它说的是「这条边的挂接是从
        语境继承来的，不是人事后补挂的」，而移交语境正是一种语境。
      */
      ...(old.parentGoalRef === undefined
        ? {}
        : { parentGoalRef: old.parentGoalRef, attachedVia: 'inherited' as const }),
      ...(old.parentCommitmentId === undefined
        ? {}
        : { parentCommitmentId: old.parentCommitmentId }),
      transferredFrom: { commitmentId: plan.from, executor: fromExecutor },
    },
    actor: ctx.yzjCards.desktopActor(),
  })
  await ctx.yzjGraph.append({
    type: 'commitment/transferred',
    data: {
      commitmentId: plan.from,
      transferredTo: {
        commitmentId: toCommitmentId,
        executor: {
          kind: 'human',
          openId: plan.executor.openId,
          ...(plan.executor.name === undefined ? {} : { name: plan.executor.name }),
        },
        at: Date.now(),
      },
    },
    actor: ctx.yzjCards.desktopActor(),
  })
  // 解除告知要往那儿落。和守卫、和预选那一屏读同一个答案（见 `placeOfEdge`）。
  const fromPlaceKey = placeOfEdge(ctx, old)
  return {
    toCommitmentId,
    ...(fromPlaceKey === undefined ? {} : { fromPlaceKey }),
    what: old.what,
    ...(old.due === undefined ? {} : { due: old.due }),
    fromExecutor,
  }
}

/**
 * 移交话语的拟稿 —— **是谁、哪一条、原话期限，外加这是转手**。
 *
 * 期限用**原话**，不用解析出来的日期：把人说过的话改写成时间戳，是拿我们的解析冒充他的
 * 承诺。这句话最容易退化成一句「已移交」，而收到的人得回头翻记录才知道说的是哪件事。
 */
export function handoffDraft(input: {
  readonly what: string
  readonly due?: string
  readonly toName?: string
  readonly fromName?: string
  /** 换场所不换人时是另一句话：事没换手，换的是这件事在哪儿说。 */
  readonly samePerson?: boolean
}): string {
  const due = input.due === undefined ? '' : `，原定 ${input.due}`
  if (input.samePerson === true) {
    return `${input.toName === undefined ? '' : `${input.toName}，`}「${input.what}」这条以后在这边跟${due}。`
  }
  const from = input.fromName === undefined ? '' : `（原来是${input.fromName}的）`
  return `${input.toName === undefined ? '' : `${input.toName}，`}「${input.what}」这条现在转给你了${from}${due}。`
}

/** 旧场所那一帖 —— 解除告知。旧执行者本来就在这批听众里，所以这一帖就是告诉他。 */
export function releaseNotice(input: {
  readonly what: string
  readonly toName?: string
}): string {
  return `「${input.what}」这条转给${input.toName ?? '别人'}了，这边到此为止。`
    + '回执和轨迹留在原处，不跟着走。'
}

/** 事件里那个执行者叫什么，给回执用。 */
export function executorName(executor: CommitmentExecutor | undefined): string | undefined {
  if (executor === undefined) return undefined
  return executor.kind === 'agent' ? 'agent' : executor.name ?? executor.openId
}

/** `state.transferredTo` 读出来的去向，给板上那一行用。 */
export function transferredToName(state: JsonValue | undefined): string | undefined {
  const to = asRecord(asRecord(state)?.transferredTo)
  const executor = asRecord(to?.executor)
  if (executor === undefined) return undefined
  return asString(executor.name) ?? asString(executor.openId)
}
