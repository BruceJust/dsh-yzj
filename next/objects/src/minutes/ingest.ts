/**
 * 摄取一场会 —— 把纪要变成两份提案，一条都不落库成事实。
 *
 * **传输是一道门，映射不是。** 实测（2026-08-21）：`aisteno/list` 在公网网关上答的是
 * `{"errorCode":10000018,"error":"当前会话超时"}` 而**不是 404**——门在那儿、路由通，
 * 缺的只是一把用户会话钥匙。所以这一层按接缝设计：`YzjMinutesSource` 是那把钥匙到位
 * 之后要接的那一根线，而它上面的一切（双桥、三级可信度、去重、提案落库）今天就能跑、
 * 今天就能测。
 *
 * 这不是「位留实后置」的托词：**映射规则才是这段设计的实质**，传输只是一次 HTTP。把
 * 映射押到传输之后，等于把最需要被推敲的部分留到最赶的那一天写。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type JsonValue } from '@yzj-next/graph'
import { proposalIdFor } from '../goal/family.ts'
import { proposalItemFor, readMinutes, type MinutesRead } from './bridge.ts'

/**
 * 速记那一侧的读取面 —— **只读**。
 *
 * 没有 `write`/`update`：`minutes/action` 确实能写回去，但速记的待办**没有 per-item
 * id、更新是全量替换**，写回去会把人在速记里手工改过的东西整段覆盖掉。这条铁律写在
 * 类型上，而不是写在注释里指望别人记得。
 */
export interface YzjMinutesSource {
  /** 自 `since` 之后有更新的、已完成的速记。增量靠 updateTime，不是全量拉。 */
  since(since: number): Promise<readonly { readonly stenoId: string; readonly updatedAt: number }[]>
  /** 一场速记的详情（含 minutes）。 */
  detail(stenoId: string): Promise<JsonValue | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 由通道插件提供。缺席 = 那把会话钥匙还没到位。 */
    yzjMinutes?: YzjMinutesSource
  }
}

/** 一次摄取的结果，说清各自为什么。 */
export interface IngestOutcome {
  readonly goalProposalId?: string
  readonly taskProposalId?: string
  /** 已经提过、这次跳过的条目数——同一场会重复摄取时它应该等于全部。 */
  readonly skipped: number
  readonly note: string
}

/** 这条内容提过没有。指纹落在提案的 `sourceAnchor` 上，一次扫完。 */
function alreadyProposed(ctx: Context): Set<string> {
  const seen = new Set<string>()
  for (const event of ctx.yzjGraph.rawEvents(['proposal/opened'])) {
    const anchor = asString(asRecord(event.data)?.sourceAnchor)
    if (anchor === undefined) continue
    for (const part of anchor.split('#')) if (part.startsWith('fp:')) seen.add(part.slice(3))
  }
  return seen
}

/**
 * 把一份读好的纪要落成提案。
 *
 * 两份分开：决议是**方向**，待办是**活**——合成一张卡，人就得在同一次点击里既定方向
 * 又派活，而这是两个不同的主权时刻（签发 vs 逐条裁决）。
 */
export async function ingestMinutes(
  ctx: Context,
  read: MinutesRead,
  binding?: { readonly topicKey?: string; readonly placeKey?: string; readonly decider?: string },
): Promise<IngestOutcome> {
  const proposed = alreadyProposed(ctx)
  const decisions = read.decisions.filter(item => !proposed.has(item.fingerprint))
  const tasks = read.tasks.filter(item => !proposed.has(item.fingerprint))
  const skipped = (read.decisions.length - decisions.length) + (read.tasks.length - tasks.length)

  if (decisions.length === 0 && tasks.length === 0) {
    return {
      skipped,
      note: skipped === 0
        ? '这场会的纪要里没有决议，也没有待办。'
        : `这场会的 ${String(skipped)} 条都已经提过了，没有新的。`,
    }
  }

  const title = read.title ?? '会议'
  const out: { goalProposalId?: string; taskProposalId?: string } = {}

  /*
    参会人只作为**证据**随提案走，不冒充听众。

    图的听众词汇是 placeKey，表达不了「这几个人」。拿一个表达不了的东西当听众用，
    等于给了一个假的隔离承诺（§6.8 词汇卫生）。所以提案默认只有操作者看得见，而
    **确认那一刻就是人签发的越境**——纪要原文随代发消息进入新听众，是合法的，因为
    有人签了字。
  */
  const evidenceOf = (extra: string): string =>
    `steno:${read.stenoId}#${extra}`
      + (read.participants.length === 0 ? '' : `#参会 ${String(read.participants.length)} 人`)

  if (decisions.length > 0) {
    const anchor = `${evidenceOf('decisions')}#${decisions.map(d => `fp:${d.fingerprint}`).join('#')}`
    const id = proposalIdFor(anchor, `会议决议：${title}`)
    if (ctx.yzjGraph.rawObject('proposal', id) === undefined) {
      await ctx.yzjGraph.append({
        type: 'proposal/opened',
        data: {
          proposalId: id,
          kind: 'goal',
          title: `会议决议：${title}`,
          // 决议一条一个方向，逐条签发；速记给的 basis 跟着走——这是「带依据」的落点。
          items: decisions.map(item => ({
            what: item.basis === undefined ? item.what : `${item.what}（依据：${item.basis}）`,
          })),
          sourceAnchor: anchor,
          ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
          ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
          ...(binding?.decider === undefined ? {} : { decider: binding.decider }),
        },
        actor: { kind: 'agent' },
      })
      out.goalProposalId = id
    }
  }

  if (tasks.length > 0) {
    const anchor = `${evidenceOf('tasks')}#${tasks.map(t => `fp:${t.fingerprint}`).join('#')}`
    const id = proposalIdFor(anchor, `会议待办：${title}`)
    if (ctx.yzjGraph.rawObject('proposal', id) === undefined) {
      await ctx.yzjGraph.append({
        type: 'proposal/opened',
        data: {
          proposalId: id,
          kind: 'breakdown',
          title: `会议待办：${title}`,
          items: tasks.map(proposalItemFor),
          sourceAnchor: anchor,
          ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
          ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
          ...(binding?.decider === undefined ? {} : { decider: binding.decider }),
        },
        actor: { kind: 'agent' },
      })
      out.taskProposalId = id
    }
  }

  const unbound = tasks.filter(item => item.executor.tier !== 'bound').length
  return {
    ...out,
    skipped,
    note: [
      `这场会抽出 ${String(decisions.length)} 条决议、${String(tasks.length)} 条待办，`,
      '都以**提案**落库，等人逐条裁决——速记再准，签发也只能是人。',
      ...(unbound === 0
        ? []
        : [`其中 ${String(unbound)} 条没能绑定到账号，条目里写清了线索但**没有挂人**——挂错人的代价是那条承诺会以你的名义发到别人那里。`]),
      ...(skipped === 0 ? [] : [`另有 ${String(skipped)} 条此前提过，这次跳过。`]),
    ].join(''),
  }
}

/** 从速记源拉一场会并摄取。源不在就说源不在——这是一道基建门，不是一个 bug。 */
export async function pullAndIngest(
  ctx: Context,
  stenoId: string,
  binding?: { readonly topicKey?: string; readonly placeKey?: string; readonly decider?: string },
): Promise<IngestOutcome> {
  const source = ctx.get('yzjMinutes')
  if (source === undefined) {
    return {
      skipped: 0,
      note: '速记通道还没接上——网关是通的（实测答的是「当前会话超时」不是 404），'
        + '缺的是一把用户会话钥匙。钥匙到位之前，纪要要靠人贴进来。',
    }
  }
  const detail = await source.detail(stenoId)
  if (detail === undefined) return { skipped: 0, note: `读不到这场速记（${stenoId}）。` }
  return ingestMinutes(ctx, readMinutes(stenoId, detail), binding)
}
