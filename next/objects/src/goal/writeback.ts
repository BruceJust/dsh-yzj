/**
 * 状态回写真身 —— 「同一条边两个听众」的第二个听众 (v4.9，v3.10 4h①).
 *
 * 一条委派有两个听众：**操作者**看承诺板的实时信号，**全组**看的是云之家上那份目标
 * 文档。此前只有第一个听众是活的——板上什么都对，而组里的人打开那份文档，看到的还是
 * 立目标那天的样子。「目标活着，不需要任何人去维护目标」这句验收句，对操作者成立了
 * 一半，对全组一句都不成立。
 *
 * 这个文件补的是另一半。每一条纪律都对应一种它真的变坏过的样子：
 *
 * - **只在生与死两个时刻写。** 把每一次进度都推回去，就是把一份全组共读的文档变成
 *   一条日志流——那份文档的价值恰恰在于它短到有人愿意读。设计的原话就是「回写只在
 *   生与死」。
 * - **写过的不再写。** 每一笔都落一条 `goal/written-back`，重启扫一遍先问「这一笔
 *   写过没有」。没有这一条，重启就会往一份全组在读的文档里再贴一遍同样的行。
 * - **失败也落一条。** 不落的话重启会无限重试；更要紧的是「组里到底知不知道」得有
 *   一个答案——板上说已回写、文档里什么都没有，是幽灵承诺换了个通道复活。
 * - **那条失败记录得有读者。** 落库落得再诚实，没人读就只是注释：CLI 改了一个参数名，
 *   线上每一笔回写连着失败了一个下午，系统一声不吭。所以写不进去要开一条**等待**。
 * - **写在栅栏以下。** 台账贴在成功标准后面，看起来只是排版问题——直到差距简报改读
 *   真身正文当判据，系统自己记的账就成了系统判自己达标的尺子。见 `../fence.ts`。
 * - **它是机械后果，不是新的一次决定。** 人在提案裁决那一刻已经签过字了（那张卡上
 *   写着「确认即签发」），这里再弹一张确认卡就是同一个主权时刻收两次费——和代发登记
 *   话语同一个道理（§5.3：一次主权时刻一次确认）。写入本身仍然走 guard 的写权限档，
 *   合同说不能写，它就写不进去。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asNumber, asRecord, asString, type GraphEvent, type JsonValue } from '@yzj-next/graph'
import { failureOf } from '../bridge-error.ts'
import { fenceLine } from '../fence.ts'
import { waitingIdFor } from '../task/waiting.ts'
import { goalCommitmentIdFor } from './family.ts'
import { bodyMark, docIdOf, fenceOf } from './truth.ts'

/**
 * 回写从哪一条日志开始负责。
 *
 * 第一次上线时把当时的水位记下来，之后每次重启都读回同一个数。没有它，补账那一遍
 * 会把**全部历史**倒进真实的目标文档；有了它，补账只覆盖「我们上线之后出生、可能死在
 * 半路」的那一小段——那正是补账本来要修的东西。
 */
async function waterline(ctx: Context): Promise<number> {
  for (const event of ctx.yzjGraph.rawEvents(['goal/writeback-began'])) {
    const seq = asNumber(asRecord(event.data)?.atSeq)
    if (seq !== undefined) return seq
  }
  /*
    水位取「此刻库里最大的那个 seq」。

    第一版写的是 `rawEvents([])` ——而它是按类型过滤的，空数组意味着**一个类型都不要**，
    于是水位恒为 0、补账把全部历史当成新的。一个返回空的读取和一个「什么都还没发生」的
    库长得一模一样，这正是这一族反复在防的那种错。
  */
  let atSeq = 0
  for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, {})) {
    atSeq = Math.max(atSeq, object.updatedSeq)
  }
  await ctx.yzjGraph.append({
    type: 'goal/writeback-began',
    data: { atSeq },
    actor: { kind: 'system' },
  })
  return atSeq
}

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

/**
 * 一次写入的结果。失败带着原因——「没写成」和「为什么没写成」是两件事。
 *
 * 成功那一支带着**写完之后正文是第几版**：`doc block insert` 的回包里就有它，和
 * `doc block list` 是同一个计数器（实测）。有了它，我们自己那次编辑就能当场记回目标，
 * 不必再多打一次 CLI，也不会被下一次检查当成「有人改了成功标准」。
 */
type WriteOutcome =
  | { readonly ok: true; readonly version?: number }
  | { readonly ok: false; readonly why: string }

/**
 * 往文档尾部贴若干段。一次调用贴完，栅栏和它下面的第一行不会被谁插在中间。
 *
 * **父块参数叫 `--parent-block-id`**，不叫 `--block-id`——后者是 yzj-cli 0.1.4 之前
 * 的名字，同名参数在 `doc block list` 上至今还是旧写法，两条命令一个用新名一个用旧名。
 * 这条是实跑撞出来的：CLI 在今天 14:52 升到 0.1.4，而在那之后，**线上每一笔目标回写
 * 都在失败**——argv 解析直接拒绝，一个字都没写进任何一份文档。图上会如实记 `failed`
 * （这要感谢 `failureOf` 现在真的读得到 stderr），可组里看到的就是那份文档不再更新。
 *
 * 不带 `--index` 就是追加到末尾（实测；CLI 帮助里写的「默认 0」不对——`--index 0`
 * 会插到标题下面第一行）。台账必须在末尾：插到头上，栅栏会把整份成功标准切到线以下，
 * 于是判据变成空的，而这正是栅栏本来要防的事反过来发生一遍。
 */
async function insert(ctx: Context, docId: string, lines: string[]): Promise<WriteOutcome> {
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { ok: false, why: '云之家通道未就绪' }
  const element = JSON.stringify(
    lines.map(line => ({ type: 'paragraph', content: [{ type: 'text', content: line }] })),
  )
  const result = await bridge.run(
    ['doc', 'block', 'insert', '--id', docId, '--element', element, '--parent-block-id', 'doc'],
    { timeoutMs: 20_000 },
  )
  if (!result.ok) return { ok: false, why: failureOf(result, '写入失败') }
  const version = asNumber(asRecord(asRecord(result.json as JsonValue)?.data)?.version)
  return { ok: true, ...(version === undefined ? {} : { version }) }
}

/** 这个目标身上，我们成功写进去过几笔账。0 就是一笔都没写成过。 */
function successesFor(ctx: Context, goalRef: string): number {
  let count = 0
  for (const event of ctx.yzjGraph.rawEvents(['goal/written-back'])) {
    const data = asRecord(event.data)
    if (asString(data?.goalRef) === goalRef && asString(data?.status) === 'written') count += 1
  }
  return count
}

/**
 * 「这份文档写不进去」是一条**等待**，不是一行日志 (§6.5 同一条道理).
 *
 * 在装上它之前，`goal/written-back` 这个家族**一个读者都没有**：失败照实落库，然后
 * 没有任何代码、任何面、任何人再去看它一眼。今天下午就撞上了后果——yzj-cli 14:52 升到
 * 0.1.4 改了一个参数名，从那一刻起线上每一笔回写都在失败，而系统一声不吭，我是手敲
 * 一条 CLI 才发现的。**一条没有读者的记录是注释，不是机制。**
 *
 * 这个文件开头就写着「『组里到底知不知道』得有一个答案」。那个答案不能只存在于日志里：
 * 组里看到的那份目标文档停止更新了，而板上一切正常——这正是幽灵承诺换了个通道复活。
 * 通道离线用的就是这一招（`channel/health.ts`），照抄它：等待对象可应答、可投影、
 * 重启之后还在。
 *
 * **一个目标一条**，不是全局一条：坏的是「这一份文档」，而一条笼统的「有些回写失败了」
 * 既不可行动、又会在下一次任意一笔成功时被错误地全部清掉。代价是 CLI 整体坏掉时几个
 * 活目标各开一条——那是实话（这几份文档确实都停更了），而且它们会一起消失。
 *
 * id 里带**已成功笔数**当代次：等待是吸收态，关掉的那条不能复活，所以每次成功之后的
 * 新故障必须落在一个新 id 上，否则第二次故障永远开不出来。
 */
function outageIdFor(goalRef: string, generation: number): string {
  return waitingIdFor('goal-writeback', `${goalRef}#${String(generation)}`)
}

async function reportOutage(
  ctx: Context, goalRef: string, generation: number, why: string,
): Promise<void> {
  const waitingId = outageIdFor(goalRef, generation)
  // 同一次故障只开一条：不然「等了多久」会在每一笔失败时重置，而那个数字正是它的全部价值。
  if (ctx.yzjGraph.rawObject('waiting', waitingId) !== undefined) return
  const goal = asRecord(ctx.yzjGraph.rawObject('commitment', goalCommitmentIdFor(goalRef))?.state)
  const name = asString(goal?.what as never) ?? goalRef
  await ctx.yzjGraph.append({
    type: 'waiting/opened',
    data: {
      waitingId,
      kind: 'system',
      what: `目标真身写不进去：「${name}」——组里在那份文档里看不到承诺的动静（${why}）`,
      openedAt: Date.now(),
      idemKey: waitingId,
    },
    actor: { kind: 'system' },
  })
}

/** 写成了就把上一代那条故障关掉。**只有写成功能证明那份文档又通了。** */
async function clearOutage(ctx: Context, goalRef: string, generation: number): Promise<void> {
  const waitingId = outageIdFor(goalRef, generation)
  const status = asString(asRecord(ctx.yzjGraph.rawObject('waiting', waitingId)?.state)?.status)
  if (status !== 'open' && status !== 'escalated') return
  await ctx.yzjGraph.append({
    type: 'waiting/closed',
    data: { waitingId, cause: 'resolved' },
    actor: { kind: 'system' },
  })
}

/**
 * 写一行台账，**必要时先立一条栅栏**。
 *
 * 立不立线，先问**那份文档此刻长什么样**：图只知道「我们写过账」，而线还在不在是文档
 * 说了算——有人把它删了，图还记着写过，于是往后所有的账都裸贴在成功标准后面，正是这条
 * 线要防的事。所以读是**权威**。多一次 CLI 调用，买的是「我写之前看过它现在什么样」；
 * 而回写一辈子只在生与死两个时刻发生，这个价钱付得起。
 *
 * 读**没看着**的时候（通道断、超时、这份东西根本没有块结构）才轮到图说话。少了这一层，
 * 一次读超时配上一次写成功，就往一份全组在读的文档里再贴一条栅栏——而这种「读失败但写
 * 成功」的组合，恰恰是超时最常见的样子。
 *
 * 两边都答不上来就**立线**。宁可多一条线（`splitAtFence` 认第一条，多出来的那条落在
 * 台账里，难看但不改变判断），也不要一行裸账贴在成功标准后面被当成一条标准。
 *
 * 读不出正文照写不误：**账该记还是得记**——「看不了」不能变成「不写了」，那会让组里
 * 彻底看不到这条承诺。
 */
async function appendLine(ctx: Context, goalRef: string, line: string): Promise<WriteOutcome> {
  const docId = docIdOf(goalRef)
  if (docId === undefined) {
    return { ok: false, why: '目标真身不是云之家知识库文档，写不进去' }
  }
  const fenced = await fenceOf(ctx, goalRef) ?? successesFor(ctx, goalRef) > 0
  return insert(ctx, docId, fenced ? [line] : [fenceLine('成功标准'), line])
}

/**
 * 挂上监听并扫一遍历史。返回 disposer。
 *
 * 走图事件而不是写在卡的 `apply` 里，和 `notify.ts` 同一个理由：`apply` 是纯的——它
 * 决定什么成为事实，而往一份全组共读的文档里写字是**效果**，不是决定。放在这里也意味
 * 着无论从哪个面确认的，回写都会发生。
 */
export function applyGoalWriteback(ctx: Context): () => void {
  /*
    正在写的那几笔。

    「查一下写过没有」和「写下去」之间隔着一次 `await`——监听器和补账那一遍可以同时
    走到这里，双方都查到「没写过」，然后**同一行往一份全组在读的文档里贴两遍**。
    落库的幂等记录挡不住它：那条记录要等写完才存在。
  */
  const inFlight = new Set<string>()
  /*
    卸载之后就别再写了。

    `off()` 只摘掉监听器，**补账那一遍还在路上**——旧实例的补账和新实例的补账各有
    各的 in-flight 集合，两边都查到「没写过」，于是同一行往一份全组在读的文档里贴
    两遍。热重载、合同变更、插件重挂都会走到这条路上。
    （这一条是全量跑里偶发的一次红暴露的：单跑六次全绿，套件里跑第四次才红一次。
    偶发不是「不要紧」，是**它已经发生过一次了**。）
  */
  let disposed = false
  /*
    同一份文档的回写**排队走**。

    `inFlight` 挡的是同一笔被写两遍；挡不住的是**不同的两笔撞同一份文档**：两条子承诺
    同时出生，两边都读到「这份文档还没有栅栏」，于是往一份全组在读的文档里贴两条栅栏。
    栅栏是一次性的东西，而判断它在不在必然是一次「读完再写」——这中间的缝只能靠排队补。

    顺带还买到一件事：同一条承诺的 `born` 与 `settled` 在文档里的**先后顺序是确定的**。
    两笔并发时先落哪一行本来是看谁的 CLI 先回来，而一份「已完成」排在「登记」上面的
    台账，读的人会以为它完成在被交办之前。
  */
  const chains = new Map<string, Promise<unknown>>()
  const onGoal = async (goalRef: string, job: () => Promise<void>): Promise<void> => {
    // 前一笔失败不该卡住后一笔：两个回调都是 job。
    const mine = (chains.get(goalRef) ?? Promise.resolve()).then(job, job)
    const settled = mine.catch(() => undefined)
    chains.set(goalRef, settled)
    // 队空了就把这个目标从表里摘掉，否则这张表会随目标数只涨不落。
    void settled.then(() => {
      if (chains.get(goalRef) === settled) chains.delete(goalRef)
    })
    await mine
  }
  const write = async (
    goalRef: string, commitmentId: string, moment: 'born' | 'settled',
  ): Promise<void> => {
    if (disposed) return
    const writebackId = writebackIdFor(goalRef, commitmentId, moment)
    // 写过就不再写——那份文档是全组在读的，重贴一行不是小事。
    if (ctx.yzjGraph.rawObject('goal-writeback', writebackId) !== undefined) return
    if (inFlight.has(writebackId)) return
    inFlight.add(writebackId)
    try {
      await onGoal(goalRef, async () => {
        // 排到队才动手，所以两个判断都得重来一遍：等的这段时间里世界变了。
        if (disposed) return
        if (ctx.yzjGraph.rawObject('goal-writeback', writebackId) !== undefined) return
        const state = asRecord(ctx.yzjGraph.rawObject('commitment', commitmentId)?.state)
        if (state === undefined) return
        const line = lineFor(moment, state)
        /*
          代次要在**这一笔落库之前**数。

          数在后面的话，成功那一笔会把自己算进代次，于是 `clearOutage` 去关的是一条
          还没出生的等待——故障永远挂着，而它挂着的理由是它已经好了。
        */
        const generation = successesFor(ctx, goalRef)
        const outcome = await appendLine(ctx, goalRef, line)
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
        // 落库之后再动等待：先开等待后落库的话，中间崩一下就留下一条没有来由的故障。
        await (outcome.ok
          ? clearOutage(ctx, goalRef, generation)
          : reportOutage(ctx, goalRef, generation, outcome.why))
        /*
          把**我们刚写出来的那一版**记回目标 —— 否则自己的编辑会冒充「有人改了标准」。

          真身检查比的是正文版本，而回写就是在改正文。不记的话，每写一笔账，下一次消费
          就报一句「真身已被改动，照旧标准下过的结论未必还成立，需要重新判」——而那个
          改动是我们自己贴的一行台账，跟成功标准一个字的关系都没有。这条警告会在每一次
          回写后准时响一遍，然后再也没有人会认真看它。这个仓库里已经写过这句话了：**反复
          报出来的警告等于没有警告。**

          版本号是写入回包白送的，不必再读一次；拿不到就不记——记一个猜的版本，比不记
          更坏，那会让一次真的改动被吞掉。

          **图上没有这个目标就不记。** `append` 打在一个不存在的 id 上是**建一个对象**
          （`store.fold` 对 `previous === undefined` 照建不误），于是这一行会凭空造出一条
          只有指纹、没有名字没有状态的承诺——一个谁也删不掉的幽灵，而它出现在承诺板上。
          子承诺的 `parentGoalRef` 是模型报上来的一个链接，`commitment_register` **不校验
          它指向的目标存不存在**，所以这条路是走得通的，不是假想。`checkGoalTruth` 里那次
          同样的记录早就有这道闸（`truth.spec.ts` 专门锁着它），我这一处漏了。
        */
        const goalId = goalCommitmentIdFor(goalRef)
        if (
          outcome.ok && outcome.version !== undefined
          && ctx.yzjGraph.rawObject('commitment', goalId) !== undefined
        ) {
          await ctx.yzjGraph.append({
            type: 'commitment/updated',
            data: { commitmentId: goalId, truthFingerprint: bodyMark(outcome.version) },
            actor: { kind: 'agent' },
          })
        }
      })
    } catch (error) {
      console.error('[yzj-next-objects] failed to record the write-back', error)
    } finally {
      inFlight.delete(writebackId)
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

  /*
    **私下登记的边默认不投影明细** (v4.22 裁决③).

    两条已冻结的定律在这儿撞上：承诺继承登记话语的听众集合（§1.6），而同一条边的两个
    听众要覆盖它的一生（回写律）。裁决把优先级定死了——**是否把这条边投影进全组可读的
    真身，是 owner 的隐私主权**。

    此前这里写的是「凡挂了目标的子承诺一律写」：一条在私聊里登记的活，它的事由、执行者、
    期限会**原样出现在一份全组打开就能读的文档里**，而登记它的时候在场的只有两个人。
    这一族的错法本来就比平常贵一档，这一种最贵：泄漏收不回来。

    判据是**正着问的**：听众里有没有一个群。不是「是不是私聊」——`audience` 缺席时
    `audienceAllows` 让任何场所 viewer 都读不到它，那是**最私密**的一档，而反着问会
    把它当成「不确定」放行。
  */
  const inGroup = (audience: readonly string[] | undefined): boolean => (
    // `yzj-group-` / `yzj-dm-` 的出处是通道的 `placeKeyFor`；这一层只读它的形状。
    audience?.some(place => place.startsWith('yzj-group-')) === true
  )

  const consider = async (commitmentId: string): Promise<void> => {
    const object = ctx.yzjGraph.rawObject('commitment', commitmentId)
    const state = asRecord(object?.state)
    const goalRef = asString(state?.parentGoalRef as never)
    if (goalRef === undefined || goalRef === '') return
    /*
      听众集合读的是**对象上那一份**（图自己用来判可见的那一份），不是 state 里抄的
      副本：判「谁看得见」的事实只能有一个来源，否则迟早出现「图说看不见、回写说看得见」。

      终态跟着出生走，是因为下面那句「死了就补生」：没投影过的边不该突然冒出一行
      「已完成」——组里看到的会是一件他们从没见过被登记的事完成了。
    */
    if (!inGroup(object?.audience)) return
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
    补账，但**只补上线之后出生的**。

    这一段原来有两个方向相反的错，正好互相抵消，所以一次都没被发现：

    - 它在插件挂载那一刻就扫，而账号分区是**通道拿到身份之后**才 `selectAccount` 的
      ——扫的时候库还没打开，`query` 返回空。于是补账在生产环境里一次也没跑过：
      日志里 11 条带 `parentGoalRef` 的承诺，`goal/written-back` **零条**。
    - 而假如它真跑起来了，会更糟：它会把**全部历史**的子承诺挨个补写进真实的目标
      文档——那些文档是同事在读的。一条三个月前出生、两个月前就关掉的承诺，今天补一行
      「已完成」进去不是修复，是往共读的文档里倒噪音。

    所以两件事一起改：**等分区真的打开**，以及**记一道水位**。回写是「出生与死亡
    时刻」的一条边，不是一次对账——它只对上线之后发生的事负责。水位之前的东西不是
    「漏了」，是**不归它管**。
  */
  void (async () => {
    await ctx.yzjGraph.ready()
    const baseline = await waterline(ctx)
    for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'commitment' })) {
      if (disposed) return
      if (object.createdSeq <= baseline) continue
      await consider(object.id).catch(() => undefined)
    }
  })().catch(() => undefined)

  return () => {
    disposed = true
    off()
  }
}
