/**
 * 真身之变 —— 给 `truth/changed` 一个生产者 (§1.9-4 数据律四).
 *
 * 这个文件补的是一个**一直空着的洞**:图上 `truth/changed` 的定义早就完整,读它
 * 的路也在,但没有任何一行代码 append 过它——因为**没有任何一行代码去看过那份
 * 真身**。于是整个系统对一个目标的判断,一直来自立目标那一刻抄下的一份成功标准
 * 副本;而设计说真身在云之家、改成功标准就是去改那份文档。两句话合起来的意思是:
 * **只要有人在云之家改了正文,系统永远不会知道。**
 *
 * 修法不是去轮询。设计的原话是「**Recorded at the consumption-time check**」——
 * 在**消费真身的那一刻**顺手比一下,而不是养一个定时器盯着它。这也正是
 * 「随时可对账,不是持续对账」:没人问的时候,系统不该替谁看着一份文档。
 *
 * 比什么:**正文版本**,不是节点版本。这一条是实测撞出来的——`doc get` 返回的
 * `version` 是节点元数据的版本(改标题、移动、改权限才动),往正文里插一段话它
 * **纹丝不动**;正文的版本在 `doc block list` 的顶层。取错了的后果最坏:一个
 * 永远答「没有改动」的检查器,比没有检查器更危险,因为它会让人以为对过账了。
 *
 * 指纹是**一个带着来源的字符串**而不是一个数字:两种节点(在线文档看正文版本、
 * Office 文件看节点更新时间)的数字不在一个量纲上,混着比会凭空报出一次并不
 * 存在的改动。
 *
 * 三种结果必须分开,合并任意两个都是撒谎:
 *
 * - **没变**：看过了,和上次一样;
 * - **变了**：看过了,不一样——这才写 `truth/changed`;
 * - **看不了**：没有通道、不是知识库链接、文档被删——「看不了」不是「没变」,
 *   把它说成没变,等于用一次失败的观察冒充一次成功的观察。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asNumber, asRecord, asString } from '@yzj-next/graph'
import { goalCommitmentIdFor } from './family.ts'

/** 一次观察的结论。`unknown` 带着原因——看不了必须说出为什么看不了。 */
export type TruthVerdict =
  | { readonly kind: 'unchanged'; readonly note: string }
  | { readonly kind: 'changed'; readonly note: string }
  | { readonly kind: 'first-look'; readonly note: string }
  | { readonly kind: 'unknown'; readonly why: string }

/**
 * 从目标引用里抠出知识库节点 id。
 *
 * 云之家的文档链接形如 `…/#/store/doc/<id>`,而 id 是 24 位十六进制。**要求它
 * 长得像个 id**,而不是「取最后一段」:一个 `…/doc/q3` 这样的占位链接会被取成
 * `q3`,然后我们拿着它去问服务端,得到一个和「文档没变」长得一模一样的失败。
 */
export function docIdOf(goalRef: string): string | undefined {
  const match = /\/(?:doc|sheet)\/([0-9a-f]{24})(?:[/?#]|$)/iu.exec(goalRef)
  return match?.[1]
}

/**
 * 读一个知识库节点的指纹。没有通道就是没有,不假装读到了。
 *
 * **先问正文,再退回节点。** 在线文档(otl)的正文版本在 `doc block list` 里;
 * 上传的 Office 文件没有块结构,那一路会失败,它能给的最好的证据是节点自己的
 * 更新时间。两条路的取值不在一个量纲上,所以指纹里写明是哪一条。
 */
async function fingerprint(
  ctx: Context, docId: string,
): Promise<{ mark: string; note: string } | { error: string }> {
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { error: '云之家通道未就绪' }

  const body = await bridge.run(['doc', 'block', 'list', '--id', docId], { timeoutMs: 20_000 })
  if (body.ok) {
    const version = asNumber(asRecord(asRecord(body.json)?.data)?.version)
    if (version !== undefined) return { mark: `blocks:${String(version)}`, note: `正文版本 ${String(version)}` }
  }

  const node = await bridge.run(['doc', 'get', '--id', docId], { timeoutMs: 15_000 })
  if (!node.ok) return { error: asString(asRecord(node)?.error) ?? '读不到这个文档' }
  const record = asRecord(node.json)
  const updated = asString(record?.updateTime)
  const version = asNumber(record?.version)
  if (updated === undefined && version === undefined) {
    return { error: '这个文档既读不到正文版本也读不到更新时间，比不出变没变' }
  }
  const mark = `node:${String(version ?? 0)}@${updated ?? ''}`
  return { mark, note: `节点更新于 ${updated ?? '未知时间'}` }
}

/**
 * 看一眼真身,和上次看到的比。
 *
 * 变了就 append `truth/changed`——**这是那个事件族的第一个也是唯一一个生产者**。
 * 无论变没变,都把这次看到的版本记回目标上:不记的话,下一次比对的基准就还是
 * 上上次,同一个改动会被反复报出来,而反复报出来的警告等于没有警告。
 */
export async function checkGoalTruth(ctx: Context, goalRef: string): Promise<TruthVerdict> {
  const docId = docIdOf(goalRef)
  if (docId === undefined) {
    return { kind: 'unknown', why: '这个目标引用不是一个云之家知识库链接，看不了它的版本' }
  }
  const seen = await fingerprint(ctx, docId)
  if ('error' in seen) return { kind: 'unknown', why: seen.error }

  const goalId = goalCommitmentIdFor(goalRef)
  const goal = ctx.yzjGraph.rawObject('commitment', goalId)
  if (goal === undefined) {
    return { kind: 'unknown', why: '图上没有这个目标——先登记它，才谈得上盯它的真身' }
  }
  const known = asString(asRecord(goal.state)?.truthFingerprint)

  /*
    记回去这一步不能省。

    省了的话,下一次比的还是上上次的基准,同一个改动会在每一次消费时都被重新
    报一遍——而一条每次都在喊的警告,和一条从不喊的警告一样没用。
  */
  const remember = async (): Promise<void> => {
    await ctx.yzjGraph.append({
      type: 'commitment/updated',
      data: { commitmentId: goalId, truthFingerprint: seen.mark },
      actor: { kind: 'agent' },
    })
  }

  if (known === undefined) {
    await remember()
    return { kind: 'first-look', note: seen.note }
  }
  if (known === seen.mark) return { kind: 'unchanged', note: seen.note }

  await ctx.yzjGraph.append({
    type: 'truth/changed',
    data: {
      ref: { uri: goalRef, placeKey: 'yzj-kb', kind: 'doc' },
      kind: 'changed',
      observedAt: Date.now(),
      detail: `真身已被改动（${known} → ${seen.mark}）——按旧标准下过的结论未必还成立`,
    },
    actor: { kind: 'agent' },
  })
  await remember()
  return { kind: 'changed', note: `${known} → ${seen.mark}` }
}

/** 一句话,给 agent 读。三种结果各说各的,不合并。 */
export function truthLine(verdict: TruthVerdict): string {
  switch (verdict.kind) {
    case 'unchanged':
      return `真身：自上次查看以来没有改动（${verdict.note}）`
    case 'first-look':
      return `真身：第一次记下它现在的样子（${verdict.note}）——从现在起它被改动会被发现`
    case 'changed':
      return `真身已被改动（${verdict.note}）。**下面这份成功标准是我们上次抄下来的副本，`
        + `可能已经过时**——要对着当前正文判断，先用 yzj_doc_block_list 读一遍真身正文。`
    default:
      // 「看不了」不是「没变」。说出是哪一堵墙，比给一句「一切正常」诚实。
      return `真身：这次没能查看（${verdict.why}）——所以“有没有被改”这一问，现在答不了`
  }
}
