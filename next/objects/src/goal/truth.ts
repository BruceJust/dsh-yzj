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
import { asNumber, asRecord, asString, type JsonValue } from '@yzj-next/graph'
import { failureOf } from '../bridge-error.ts'
import { splitAtFence } from '../fence.ts'
import { goalCommitmentIdFor } from './family.ts'

/**
 * 一次 CLI 读取的结果，**照真 bridge 的形状**。
 *
 * 此前这里各处自己写了 `{ ok, json?, error? }`——而 `YzjRunResult` 根本没有 `error`
 * 字段（它有 `stderr`）。结构类型把多出来的字段照收，于是编译通过、假 bridge 也按这个
 * 形状造，**假的和错的互相印证**，而线上每一条失败提示都退化成了那句兜底。写成一个
 * 具名类型，是为了让下一次偏差在编译期就撞上。
 */
export interface BridgeRead {
  readonly ok: boolean
  readonly json?: unknown
  readonly stderr?: string
  readonly exitCode?: number | null
  readonly timedOut?: boolean
}

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
  ctx: Context, docId: string, prefetched?: BridgeRead,
): Promise<{ mark: string; note: string } | { error: string }> {
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { error: '云之家通道未就绪' }

  // 调用方已经读过一次就用那一次——指纹和正文必须出自同一次观察。
  const body = prefetched
    ?? await bridge.run(['doc', 'block', 'list', '--id', docId], { timeoutMs: 20_000 })
  if (body.ok) {
    const version = asNumber(asRecord(asRecord(body.json as JsonValue)?.data)?.version)
    if (version !== undefined) return { mark: `blocks:${String(version)}`, note: `正文版本 ${String(version)}` }
  }

  const node = await bridge.run(['doc', 'get', '--id', docId], { timeoutMs: 15_000 })
  if (!node.ok) return { error: failureOf(node, '读不到这个文档') }
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
export async function checkGoalTruth(
  ctx: Context, goalRef: string, prefetched?: BridgeRead,
): Promise<TruthVerdict> {
  const docId = docIdOf(goalRef)
  if (docId === undefined) {
    return { kind: 'unknown', why: '这个目标引用不是一个云之家知识库链接，看不了它的版本' }
  }
  const seen = await fingerprint(ctx, docId, prefetched)
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

/**
 * 真身正文,以及它读不到时的实话。
 *
 * `text` 是**人写的那一段**（台账栅栏以上），不是整篇正文——理由见 `../fence.ts`：
 * 系统自己回写的台账混进「成功标准」，会让 agent 把一行「· …· 已完成」当成一条标准
 * 判 `met`，证据引它自己。
 *
 * `ledger` 两条臂上都有，因为它回答的是**另一个问题**：「这份文档里立过栅栏没有」。
 * 回写要用它决定该不该先立一条线，而那一刻正文里可能一条标准都还没有（`ok: false`）。
 * 把它只挂在成功的那条臂上，等于让「没标准」把「有栅栏」一起吞掉。
 */
export type TruthBody =
  | { readonly ok: true; readonly text: string; readonly ledger?: string }
  | { readonly ok: false; readonly why: string; readonly ledger?: string }

/**
 * 一个富文本节点里的全部文字。**形状是实测出来的，不是猜的。**
 *
 * 真实返回（`doc block list` 打在一份真文档上）：`data.blocks` 只有一个块，
 * `type: 'doc'`，它的 `content` 是节点数组；每个节点形如
 *
 * ```
 * { type: 'heading', content: [{ type: 'text', content: '🏠 认识知识空间' }],
 *   childNodes: [ …同一份内容… ], textContent: null }
 * ```
 *
 * 三处容易读错，每一处都会让这个函数**安静地返回空串**——而空串会被上层当成
 * 「这份文档没有正文」，于是退回签发时的副本，一切看起来正常：
 *
 * - 文字挂在 **`content`** 上，不是 `text`。第一版按 `text` 取，对着真文档跑
 *   出来的是一片空白，而单元测试是照着我自己的假设写的夹具——**测试和代码在一个
 *   谁都没验过的形状上达成了一致**。这个仓库里已经有一条注释在讲同一件事了。
 * - `content` 既可能是字符串（叶子）也可能是数组（容器），得递归。
 * - `childNodes` 与 `content` 在返回里是**同一份内容的两个副本**，两个都走会把
 *   每段文字读成两遍。所以有 `content` 就只走 `content`。
 */
function textOfNode(node: JsonValue | undefined): string {
  const record = asRecord(node)
  if (record === undefined) return ''
  const content = record.content
  if (typeof content === 'string') return content
  const children = Array.isArray(content)
    ? content
    : Array.isArray(record.childNodes) ? record.childNodes : undefined
  if (children === undefined) {
    // 有些叶子把文字放在 `textContent` 上（返回里多为 null，但不是永远）。
    return asString(record.textContent) ?? ''
  }
  return children.map(child => textOfNode(child)).join('')
}

/**
 * 一个块拆成若干行。
 *
 * 顶层那个 `doc` 块的每个直接子节点（标题、段落、列表项）各占一行——把整篇拼成
 * 一行会让「三家竞品各一页」和它下一条标准粘成同一句话，而成功标准是**逐条**判的。
 */
function linesOfBlock(block: JsonValue | undefined): string[] {
  const record = asRecord(block)
  if (record === undefined) return []
  const content = record.content
  if (!Array.isArray(content)) return [textOfNode(block)]
  return content.map(node => textOfNode(node))
}

/**
 * 读目标真身的正文 —— 差距简报的**判据** (v3.10 4h②).
 *
 * 此前评估读的是 `criteria`：立目标那一刻抄下的副本。翻案的理由很直接——**CLI 一直
 * 有 `doc block list`**，"押文档 API" 那条判断是我把 IM 通道的方法面误当成了 CLI
 * 的能力面。既然读得到，就没有理由拿副本当判据：副本只证明**签发时刻人签了什么**
 * （环境快照律的用处），而「做到没做到」必须对着此刻的正文判。
 *
 * 读不到就说读不到。这一族的第一条纪律在这里同样成立：把「看不了」说成「就按副本
 * 来吧」，是让一个可能已经过时的标准继续冒充有效标准。
 *
 * 读回来的是**台账栅栏以上那一段**：线以下是这套系统自己回写的账，把它当标准判，
 * 就是拿自己的记账证明自己达标（见 `../fence.ts`）。
 */
export async function readGoalBody(ctx: Context, goalRef: string): Promise<TruthBody> {
  const docId = docIdOf(goalRef)
  if (docId === undefined) {
    return { ok: false, why: '这个目标引用不是云之家知识库链接，读不到它的正文' }
  }
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { ok: false, why: '云之家通道未就绪' }
  const result = await bridge.run(['doc', 'block', 'list', '--id', docId], { timeoutMs: 20_000 })
  return bodyOf(result)
}

/**
 * 「读到了，正文确实是空的」。
 *
 * 拎成常量，是因为 {@link fenceOf} 要靠它区分**看见了一片空白**和**根本没看着**——
 * 拿字符串去 `includes` 匹配，等于把一条判断挂在一句会被改写的文案上。
 */
export const EMPTY_BODY = '这份文档的正文是空的'

/** 把一次 `doc block list` 的回包读成正文。分出来，是为了让指纹和正文共用同一次读。 */
function bodyOf(result: BridgeRead): TruthBody {
  if (!result.ok) return { ok: false, why: failureOf(result, '读不到这份文档的正文') }
  const blocks = asRecord(asRecord(result.json as JsonValue)?.data)?.blocks
  if (!Array.isArray(blocks)) {
    return { ok: false, why: '这份文档没有可读的正文块（可能是上传的文件，不是在线文档）' }
  }
  const text = blocks
    .flatMap(block => linesOfBlock(block))
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n')
  if (text === '') return { ok: false, why: EMPTY_BODY }

  /*
    判据截到台账栅栏为止 (见 `../fence.ts`).

    线以下是这套系统自己回写进去的账。把它一起交出去当「成功标准」，agent 会读到
    一行「· 拉三家竞品各一页 — 代少兵 · 已完成」并且完全有理由把它当成一条标准，
    判 `met`——**用系统自己的记账，证明系统达到了标准**。

    「线以上什么都没有」和「这份文档是空的」是两回事，分开说：前者是**没人写过成功
    标准**，那是一句能让人当场去补的话；后者是文档本身空着。合并成一句，就把一个
    可行动的缺口说成了一个死胡同。
  */
  const { human, ledger } = splitAtFence(text)
  if (human.trim() === '') {
    return {
      ok: false,
      why: '这份文档里，系统台账那条分界线以上没有任何成功标准——没人写过判它的尺子',
      ...(ledger === undefined ? {} : { ledger }),
    }
  }
  return { ok: true, text: human, ...(ledger === undefined ? {} : { ledger }) }
}

/**
 * 这份文档此刻有没有台账栅栏。**三值**：`undefined` 是「没看着」，不是「没有」。
 *
 * 回写要靠它决定该不该先立一条线，而这个判断只有两值的话必然错向一边：
 *
 * - 当成「没有」→ 一次读超时就往一份全组在读的文档里再贴一条栅栏；
 * - 当成「有」→ 有人把线删了我们不知道，往后所有的账都裸贴在成功标准后面。
 *
 * 所以它只在**亲眼看见**的时候答 true/false：看见线、或看见正文（含看见一片空白）
 * 里没有线。通道断了、CLI 失败了、这份东西根本没有块结构（上传的 Office 文件，
 * 那里也没地方立线）——一律 `undefined`，让调用方自己决定拿不准的时候偏哪边。
 *
 * 这就是这一族的第一条纪律（看不了 ≠ 没变）在第三个地方的同一次应用。
 */
export async function fenceOf(ctx: Context, goalRef: string): Promise<boolean | undefined> {
  const body = await readGoalBody(ctx, goalRef)
  if (body.ledger !== undefined) return true
  if (body.ok) return false
  return body.why === EMPTY_BODY ? false : undefined
}

/**
 * 看一眼真身，**同一次读**里把指纹和正文都取回来。
 *
 * 分两次读的后果不只是多打一次 CLI：两次之间有人改了正文，指纹会说「没变」而正文
 * 是新的那一版——一个自相矛盾的回合，而且矛盾的方向恰好是最坏的（说没变，却按新
 * 正文判）。既然同一个接口一次就把两样都给了，就没有理由问两遍。
 */
export async function inspectGoalTruth(
  ctx: Context, goalRef: string,
): Promise<{ readonly verdict: TruthVerdict; readonly body: TruthBody }> {
  const docId = docIdOf(goalRef)
  const bridge = ctx.get('yzjBridge')
  if (docId === undefined || bridge === undefined) {
    return { verdict: await checkGoalTruth(ctx, goalRef), body: await readGoalBody(ctx, goalRef) }
  }
  const result = await bridge.run(['doc', 'block', 'list', '--id', docId], { timeoutMs: 20_000 })
  return {
    verdict: await checkGoalTruth(ctx, goalRef, result),
    body: bodyOf(result),
  }
}

/**
 * 一句话,给 agent 读。三种结果各说各的,不合并。
 *
 * `liveBody` 说的是「这次读到了此刻的正文没有」。读到了,「变了」就不再意味着手里
 * 的标准过时——过时的是**按旧标准下过的那些结论**;读不到,才轮到那句「下面是副本」。
 * 不分这两种,就会在明明拿着最新正文的时候仍然叫人去重读一遍正文 (v3.10 4h②)。
 */
export function truthLine(verdict: TruthVerdict, liveBody = false): string {
  switch (verdict.kind) {
    case 'unchanged':
      return `真身：自上次查看以来没有改动（${verdict.note}）`
    case 'first-look':
      return `真身：第一次记下它现在的样子（${verdict.note}）——从现在起它被改动会被发现`
    case 'changed':
      return liveBody
        ? `真身已被改动（${verdict.note}）——下面的成功标准是**此刻的正文**，`
          + `照旧标准下过的结论（包括已有的差距简报）未必还成立，需要重新判。`
        : `真身已被改动（${verdict.note}）。**下面这份成功标准是我们上次抄下来的副本，`
          + `可能已经过时**——要对着当前正文判断，先用 yzj_doc_block_list 读一遍真身正文。`
    default:
      // 「看不了」不是「没变」。说出是哪一堵墙，比给一句「一切正常」诚实。
      return `真身：这次没能查看（${verdict.why}）——所以“有没有被改”这一问，现在答不了`
  }
}
