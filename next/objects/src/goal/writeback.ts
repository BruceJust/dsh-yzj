/**
 * 状态回写真身 —— 「同一条边两个听众」的第二个听众 (v4.9，v3.10 4h①).
 *
 * 一条委派有两个听众：**操作者**看承诺板的实时信号，**全组**看的是云之家上那份目标
 * 文档。此前只有第一个听众是活的——板上什么都对，而组里的人打开那份文档，看到的还是
 * 立目标那天的样子。「目标活着，不需要任何人去维护目标」这句验收句，对操作者成立了
 * 一半，对全组一句都不成立。
 *
 * 这个文件补的是另一半。四条纪律，每一条都对应一种它可能变坏的样子：
 *
 * - **只在生与死两个时刻写。** 把每一次进度都推回去，就是把一份全组共读的文档变成
 *   一条日志流——那份文档的价值恰恰在于它短到有人愿意读。设计的原话就是「回写只在
 *   生与死」。
 * - **写过的不再写。** 每一笔都落一条 `goal/written-back`，重启扫一遍先问「这一笔
 *   写过没有」。没有这一条，重启就会往一份全组在读的文档里再贴一遍同样的行。
 * - **失败也落一条。** 不落的话重启会无限重试；更要紧的是「组里到底知不知道」得有
 *   一个答案——板上说已回写、文档里什么都没有，是幽灵承诺换了个通道复活。
 * - **它是机械后果，不是新的一次决定。** 人在提案裁决那一刻已经签过字了（那张卡上
 *   写着「确认即签发」），这里再弹一张确认卡就是同一个主权时刻收两次费——和代发登记
 *   话语同一个道理（§5.3：一次主权时刻一次确认）。写入本身仍然走 guard 的写权限档，
 *   合同说不能写，它就写不进去。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphEvent } from '@yzj-next/graph'
import { failureOf } from '../bridge-error.ts'
import { docIdOf } from './truth.ts'

/** 一次回写的身份。生与死各记各的——同一条承诺会被写两次，那是对的。 */
export function writebackIdFor(
  goalRef: string, commitmentId: string, moment: 'born' | 'settled',
): string {
  return `${goalRef}#${commitmentId}#${moment}`
}

/** 执行者的人话。agent 干的活就说 agent——写「未知」等于在文档里留一个谜。 */
function whoOf(state: Record<string, unknown> | undefined): string {
  const executor = asRecord(state?.executor as never)
  if (asString(executor?.kind) === 'agent') return 'agent'
  return asString(executor?.name) ?? asString(executor?.openId) ?? '未指定'
}

/** 终态的人话。 */
function endOf(status: string, cause: string | undefined): string {
  if (status === 'voided') return `已作废${cause === undefined ? '' : `（${cause}）`}`
  if (status === 'merged') return '已合并到另一条'
  return cause === 'accepted' ? '已验收' : '已完成'
}

/**
 * 写进文档的那一行。
 *
 * 刻意是**一行纯文本**，不是一张表：那份文档是人写的、人读的，我们往里加的东西要看
 * 起来像是同一个人接着写的，而不是一段机器吐出来的结构。
 */
export function lineFor(
  moment: 'born' | 'settled', state: Record<string, unknown> | undefined,
): string {
  const what = asString(state?.what as never) ?? '(未命名)'
  const due = asString(state?.due as never)
  if (moment === 'born') {
    return `· ${what} — ${whoOf(state)}${due === undefined ? '' : ` · ${due}`}`
  }
  const status = asString(state?.status as never) ?? 'closed'
  return `· ${what} — ${whoOf(state)} · ${endOf(status, asString(state?.cause as never))}`
}

/** 一次写入的结果。失败带着原因——「没写成」和「为什么没写成」是两件事。 */
type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly why: string }

async function appendLine(ctx: Context, goalRef: string, line: string): Promise<WriteOutcome> {
  const docId = docIdOf(goalRef)
  if (docId === undefined) {
    return { ok: false, why: '目标真身不是云之家知识库文档，写不进去' }
  }
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { ok: false, why: '云之家通道未就绪' }
  const element = JSON.stringify([
    { type: 'paragraph', content: [{ type: 'text', content: line }] },
  ])
  const result = await bridge.run(
    ['doc', 'block', 'insert', '--id', docId, '--element', element, '--block-id', 'doc'],
    { timeoutMs: 20_000 },
  )
  if (!result.ok) return { ok: false, why: failureOf(result, '写入失败') }
  return { ok: true }
}

/**
 * 挂上监听并扫一遍历史。返回 disposer。
 *
 * 走图事件而不是写在卡的 `apply` 里，和 `notify.ts` 同一个理由：`apply` 是纯的——它
 * 决定什么成为事实，而往一份全组共读的文档里写字是**效果**，不是决定。放在这里也意味
 * 着无论从哪个面确认的，回写都会发生。
 */
export function applyGoalWriteback(ctx: Context): () => void {
  const write = async (
    goalRef: string, commitmentId: string, moment: 'born' | 'settled',
  ): Promise<void> => {
    const writebackId = writebackIdFor(goalRef, commitmentId, moment)
    // 写过就不再写——那份文档是全组在读的，重贴一行不是小事。
    if (ctx.yzjGraph.rawObject('goal-writeback', writebackId) !== undefined) return
    const state = asRecord(ctx.yzjGraph.rawObject('commitment', commitmentId)?.state)
    if (state === undefined) return
    const line = lineFor(moment, state)
    const outcome = await appendLine(ctx, goalRef, line)
    try {
      await ctx.yzjGraph.append({
        type: 'goal/written-back',
        data: {
          writebackId,
          goalRef,
          commitmentId,
          moment,
          line,
          status: outcome.ok ? 'written' : 'failed',
          ...(outcome.ok ? {} : { detail: outcome.why }),
        },
        actor: { kind: 'agent' },
      })
    } catch (error) {
      console.error('[yzj-next-objects] failed to record the write-back', error)
    }
  }

  /**
   * 一条子承诺此刻该被写回哪一笔，如果有的话。
   *
   * 目标自己那条承诺**不回写**：它就是那份文档，往自己身上贴一行「我出生了」没有
   * 意义。只有挂在它下面的子承诺才有生与死可报。
   */
  const momentOf = (state: Record<string, unknown> | undefined): 'born' | 'settled' | undefined => {
    const status = asString(state?.status as never) ?? 'open'
    if (asString(state?.goalRef as never) !== undefined) return undefined
    return status === 'open' ? 'born' : 'settled'
  }

  const consider = async (commitmentId: string): Promise<void> => {
    const state = asRecord(ctx.yzjGraph.rawObject('commitment', commitmentId)?.state)
    const goalRef = asString(state?.parentGoalRef as never)
    if (goalRef === undefined || goalRef === '') return
    const moment = momentOf(state)
    if (moment === undefined) return
    /*
      死了就补生。

      一条在我们上线之前就已经结束的承诺，`born` 那一笔永远不会有事件来触发；只写
      `settled` 的话，文档里会冒出一行「已完成」而组里从没见过它被登记。两笔都补，
      顺序也对——`born` 先写。
    */
    if (moment === 'settled') await write(goalRef, commitmentId, 'born')
    await write(goalRef, commitmentId, moment)
  }

  const listener = (event: GraphEvent): void => {
    if (!event.type.startsWith('commitment/')) return
    const commitmentId = asString(asRecord(event.data)?.commitmentId)
    if (commitmentId === undefined) return
    void consider(commitmentId).catch((error: unknown) => {
      console.error('[yzj-next-objects] goal write-back failed', error)
    })
  }

  const off = ctx.on('yzj-graph/appended', listener)

  /*
    重启补账。

    进程死在「文档写完了但事件还没落」和「事件落了但文档没写」之间，两种都可能。前者
    会重贴一行——所以先落事件的顺序不能反；后者靠这一遍扫回来。
  */
  void (async () => {
    for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'commitment' })) {
      await consider(object.id).catch(() => undefined)
    }
  })().catch(() => undefined)

  return off
}
