/**
 * 事件枢纽 —— 一场会看进去是什么样 (§5.6).
 *
 * **材料就绪度从关联承诺的状态免费推导。** 这五个字里最要紧的是「免费」：它不是一个
 * 字段，所以没有人需要去更新它。设计的验收句是「不需要任何人去维护」，而一个叫
 * `readiness` 的字段第一天就会开始撒谎——有人把活干完了忘了来点一下，会前那一眼看到
 * 的还是「没准备好」。
 *
 * 推导只有三档，因为**三档是人在会前真正会做出反应的全部分辨率**：
 *
 * - `ready` —— 挂上的都办完了，可以开；
 * - `partial` —— 还有在跑的，心里有数；
 * - `none` —— 什么都没挂，或者挂的一件都没动。
 *
 * 再细下去（百分比、几件几件）不会改变任何人会前的动作，只会让这一行变长。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphViewer } from '@yzj-next/graph'
import { isSettled, ownsCommitment, type CommitmentStatus } from '../commitment/family.ts'
import { splitAtFence, withLedger } from '../fence.ts'

/** 会前那一眼要的分辨率，只有三档。 */
export type Readiness = 'ready' | 'partial' | 'none'

export interface EventPrep {
  readonly commitmentId: string
  readonly what: string
  readonly who: string
  readonly status: string
  /**
   * 它在哪个话题里干 —— **一跳可达，绝不搬运**。
   *
   * 会前那一眼看见「还差一件」，下一个动作永远是去看那一件到哪一步了。没有这个键，
   * 枢纽只能报出一个数而指不了路，而「报得出却按不下去」正是幽灵信号。
   */
  readonly topicKey?: string
  /** 这件事留下的东西——会上真正要用的是它，不是「已完成」四个字。 */
  readonly artifacts: readonly { readonly uri: string; readonly title: string }[]
  /*
    下面三样是**修理动词要用的**（决策 #57：板与 hub 同构）。

    枢纽这一格此前只有「去看 ›」：会前那一眼看出「这件来不及了」，能做的却只有跳走
    ——而跳到那个话题里也没有动词，因为动词长在板和目标页上。**「既可见又可动」对 hub
    行同样自我适用**，所以把顺延要用的原话期限、主权要用的委派者、合并要用的归属一并
    带出来。带的是判断需要的最小三样，不是把整行承诺搬过来。
  */
  readonly due?: string
  /** 不归我管时是谁——与板、目标页共用 `ownsCommitment` 同一个谓词。 */
  readonly stewardedBy?: string
  readonly goalRef?: string
}

export interface EventHub {
  readonly eventId: string
  readonly title?: string
  readonly startAt?: number
  /** 这场会为哪个目标开。 */
  readonly goalRef?: string
  /** 从哪句话里长出来的——平台读不回，只有图记得。 */
  readonly bornFrom?: string
  readonly prepares: readonly EventPrep[]
  readonly readiness: Readiness
  /** 已经写进日程描述、全参会人可见的那一版材料清单。 */
  readonly postedMaterials?: string
}

/** 执行者的人话。 */
function whoOf(state: Record<string, unknown> | undefined): string {
  const executor = asRecord(state?.executor as never)
  if (asString(executor?.kind) === 'agent') return 'agent'
  return asString(executor?.name) ?? asString(executor?.openId) ?? '未指定'
}

/**
 * 一场会的全部，读作一次派生查询。
 *
 * 和目标页同一条纪律：**没有第二份存储**。挂接边在图上，状态在承诺上，产出在血缘边
 * 上——这里只是把它们读到一起。
 */
export function eventHub(ctx: Context, viewer: GraphViewer, eventId: string): EventHub | undefined {
  const event = asRecord(ctx.yzjGraph.object(viewer, 'event', eventId)?.state)
  if (event === undefined) return undefined

  const ids = Array.isArray(event.prepares) ? event.prepares.map(String) : []
  /*
    产出按承诺归集，一次扫完。

    每条承诺各扫一遍血缘日志，一场挂了五件事的会就要扫五遍——而这个函数是会前那一眼
    要调的，扫的次数得和会上挂了几件事无关。
  */
  const artifactsOf = new Map<string, { uri: string; title: string }[]>()
  /*
    一个话题可以住着**好几件**挂在这场会上的活 (v3.10 4h⑤ 同一课).

    这里第一版写的是 `Map<topicKey, commitmentId>`——同一个会话里挂了两件事，后写的
    那条把先写的顶掉，于是那个会话产出的东西**全部记在第二件名下，第一件一件不剩**，
    而没有任何地方会报错。承诺板刚为这件事换过判据，这里不能又踩回去。
  */
  const owners = new Map<string, string[]>()
  for (const id of ids) {
    const topicKey = asString(asRecord(ctx.yzjGraph.rawObject('commitment', id)?.state)?.topicKey)
    if (topicKey === undefined) continue
    owners.set(topicKey, [...(owners.get(topicKey) ?? []), id])
  }
  for (const edge of ctx.yzjGraph.rawEvents(['lineage/produced'])) {
    const data = asRecord(edge.data)
    const artifact = asRecord(data?.artifact)
    const uri = asString(artifact?.uri)
    if (uri === undefined) continue
    const taskId = asString(data?.taskId)
    const sharing = owners.get(asString(data?.topicKey) ?? '') ?? []
    /*
      说不清出处就算在共用它的每一件名下。

      丢掉是丢真数据；独占是说假话。会前简报要的是「东西在哪」——同一份材料在两件
      活下面各出现一次，比它凭空归给其中一件诚实（清单那一层按 URI 去重，人不会
      看到重复的行）。
      */
    const attributed = taskId === undefined
      ? sharing
      : sharing.filter(id => id === taskId || sharing.length === 1)
    for (const owner of attributed.length === 0 ? sharing : attributed) {
      const bucket = artifactsOf.get(owner) ?? []
      if (!bucket.some(item => item.uri === uri)) {
        bucket.push({ uri, title: asString(artifact?.title) ?? uri })
      }
      artifactsOf.set(owner, bucket)
    }
  }

  const prepares: EventPrep[] = []
  for (const id of ids) {
    /*
      看得见才算数。

      挂在这场会上的承诺可能来自别的场所——一个只在别处可见的承诺，不该因为挂到了
      一场会上就对所有人显形（§1.6）。看不见的那些**连计数都不进**：否则「还有 2 件
      没办完」本身就泄露了那两件事的存在。
    */
    const object = ctx.yzjGraph.object(viewer, 'commitment', id)
    if (object === undefined) continue
    const state = asRecord(object.state)
    const topicKey = asString(state?.topicKey)
    const due = asString(state?.due)
    const goalRef = asString(state?.parentGoalRef)
    const delegatedBy = asString(state?.delegatedBy)
    const me = asString((ctx.yzjCards?.desktopActor() as { openId?: string } | undefined)?.openId)
    /*
      主权与板上同一个谓词、同一份判断。查看者不明时不下断言（`ownsCommitment` 对
      undefined 的 openId 返回 false，所以这里显式跳过——**不知道我是谁 ≠ 不是我的**）。
    */
    const steward = me === undefined
      || ownsCommitment(me, delegatedBy === undefined ? {} : { delegatedBy })
      ? undefined
      : delegatedBy
    prepares.push({
      commitmentId: id,
      what: asString(state?.what) ?? '',
      who: whoOf(state),
      status: asString(state?.status) ?? 'open',
      ...(topicKey === undefined ? {} : { topicKey }),
      ...(due === undefined ? {} : { due }),
      ...(goalRef === undefined ? {} : { goalRef }),
      ...(steward === undefined ? {} : { stewardedBy: steward }),
      artifacts: artifactsOf.get(id) ?? [],
    })
  }

  const settled = prepares.filter(item => isSettled(item.status as CommitmentStatus)).length
  const readiness: Readiness = prepares.length === 0
    ? 'none'
    : settled === prepares.length ? 'ready' : settled === 0 ? 'none' : 'partial'

  const goalRef = asString(event.goalRef)
  const bornFrom = asString(event.bornFrom)
  const posted = asString(event.postedMaterials)
  return {
    eventId,
    ...(asString(event.title) === undefined ? {} : { title: asString(event.title) as string }),
    ...(typeof event.startAt === 'number' ? { startAt: event.startAt } : {}),
    // 解开写的是空串（更正即追加），所以「没挂」不止 undefined 一种样子。
    ...(goalRef === undefined || goalRef === '' ? {} : { goalRef }),
    ...(bornFrom === undefined ? {} : { bornFrom }),
    ...(posted === undefined ? {} : { postedMaterials: posted }),
    prepares,
    readiness,
  }
}

/** 会前那一眼的一句话。三档各说各的，不合并。 */
export function readinessLine(hub: EventHub): string {
  const total = hub.prepares.length
  if (total === 0) return '这场会还没挂任何要准备的事'
  const settled = hub.prepares.filter(item => isSettled(item.status as CommitmentStatus)).length
  switch (hub.readiness) {
    case 'ready': return `材料齐了：挂着的 ${String(total)} 件都办完了`
    case 'partial': return `还差一些：${String(total)} 件里办完 ${String(settled)} 件`
    default: return `挂着 ${String(total)} 件，一件都还没动`
  }
}

/**
 * 写进日程描述的那一份材料清单 —— 全参会人看的是它。
 *
 * 只列**已经有产出的**：一份写着「待办、待办、待办」的清单对开会的人没有用，而且会
 * 把日程描述变成第二块看板。会前要的是「东西在哪」。
 */
export function materialsFor(hub: EventHub): string | undefined {
  /*
    按 URI 去重。

    一份产在共用会话里的材料会挂在共用它的每一件活下面（那是归属层的诚实做法），
    可**清单是给人看的**——同一个链接印两遍只会让人以为有两份东西。
  */
  const seen = new Set<string>()
  const lines: string[] = []
  for (const item of hub.prepares) {
    for (const artifact of item.artifacts) {
      if (seen.has(artifact.uri)) continue
      seen.add(artifact.uri)
      lines.push(`· ${artifact.title} ${artifact.uri}`)
    }
  }
  if (lines.length === 0) return undefined
  return ['【会前材料】', ...lines].join('\n')
}

/**
 * 这场会的描述该改成什么样，`undefined` 表示**不用改**。
 *
 * 此前这里是 `--description materials` 一把盖过去：会议主人写的议程、拨号号码、
 * 「带上上季度的数」，全没了。摩擦再分配说得明白——「把材料链接一条条粘进日程」是
 * 损耗性摩擦，该归零；「会议主人写的议程」是**主权性**摩擦，一寸都不该碰。而同一件
 * 事，回写在目标文档里一直是追加、在日程描述里却是覆盖，两种做法里必有一种是错的。
 *
 * 能保住它，是因为**读得回来**：实测 `calendar event get` 返回 `content`，正是
 * `--description` 写的那个字段。读得回来还覆盖，那是图省事。
 *
 * 「已经写过了没有」也一并改成问**此刻的日程**，不再问图。图只知道「我们写过」，
 * 有人把那段删了它不会知道——于是板上说已送达、日程里什么都没有。那是幽灵承诺换了
 * 个通道复活，这个仓库里已经为它修过一次了。
 */
export function descriptionFor(
  current: string, materials: string, posted?: string,
): string | undefined {
  const { human, ledger } = splitAtFence(current)
  // 一模一样就不动：日程描述是全参会人看的，重贴一遍不是小事。
  if (ledger === materials) return undefined
  /*
    栅栏出现之前写下的那一份，是**我们的**，不是会议主人的。

    那时候的代码把材料整段盖上去、不带线。现在再写一次，`splitAtFence` 找不到线，
    于是把整段旧材料当成「人写的议程」保在线以上，再在线以下写一份新的——**同一份
    材料出现两遍，其中一份还冒充了人写的东西**。保护主权的那条规矩，反过来把系统
    自己的旧输出封成了不可动的圣物。

    认它的凭据是**图里那条记录**（`postedMaterials`：我们上次写下去的原文），不是
    对着文本猜。猜错的方向恰好最坏：把真的议程当成我们的旧输出删掉。图里没有记录
    就宁可留着——多一份重复看得见、改得掉；抹掉一段人写的议程没人知道。
  */
  const mine = posted !== undefined && human.trim() === posted.trim()
  return withLedger(mine ? '' : human, '会议议程', materials)
}
