/**
 * 目标的**标题可见域** —— 地基空洞的填补 (v4.22 裁决①).
 *
 * 「一个目标能被谁看见」这件事，在这套设计里**从来没有定义过**。承诺有听众集合（登记
 * 话语确立的），工件有 ACL，唯独目标——它既不是图上的节点（真身在云之家），也没有一条
 * 「谁能看见它」的边。于是每一处要渲染 goalRef 的地方都各自即兴：有的印名字、有的印
 * URI、有的什么都不印。
 *
 * 裁决把它**两层化**：
 *
 * - **标题可见域**（这个文件）= 签发话语的听众 ∪ **owner 后续提及话语的听众**。它是
 *   动态扩张的，而且**完全派生**——零新边、零新事件：owner 在一个群里说过「这是 X 目标
 *   下的事」，那个群就在里面了。系统不该对聊天记录里明摆着的名字装瞎。
 * - **正文可见域** = 真身 ACL，消费时点校验（不在这里——正文住在云之家对象里，只有
 *   那边说了算）。
 *
 * **两级判定** (v3.14r①)，顺序不能倒：
 *
 * ① **结构化引用**——话语里带着 goalRef 的那些（话题装载、子承诺的 parentGoalRef）。
 *    确定性扩张，纯派生，不需要任何识别。
 * ② 自然语言提及——「这是 Q3 那个目标下的事」。**没有做**：硬条件是目标名确在话语中，
 *    而 LLM 的误关联会造成**凭空扩张 = 真泄漏**。宁窄勿错——§1.6 是硬边界，装瞎只是
 *    体验债。第二级要开的那天，它是一次 ack 可纠可收回的推断，不是这里的一次静默扩张。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphViewer } from '@yzj-next/graph'
import { goalCommitmentIdFor } from './family.ts'

/**
 * 这个目标的标题，此刻对哪些场所可见。
 *
 * 全部来自**结构化引用**（第一级）：
 *
 * - 目标自己那条登记的听众集合——签发话语说给谁听的；
 * - 装载了这个目标的话题所在的场所——owner 在那儿说过「这个话题为它干活」；
 * - 挂着它的子承诺的听众集合——每一条都是一次点名了这个目标的登记话语。
 *
 * 读的是**未过滤的图**：这个函数回答的正是「谁能看见」，用一个已经过滤过的视角去问它，
 * 等于拿答案当问题。
 */
export function goalTitleAudience(ctx: Context, goalRef: string): ReadonlySet<string> {
  const out = new Set<string>()
  const add = (audience: unknown): void => {
    if (!Array.isArray(audience)) return
    for (const place of audience) if (typeof place === 'string' && place !== '') out.add(place)
  }

  // ① 签发话语的听众——目标自己那条登记。
  const goal = ctx.yzjGraph.rawObject('commitment', goalCommitmentIdFor(goalRef))
  add(goal?.audience)

  /*
    ② 装载了它的话题。

    `armTopicGoal` 记的是「这个话题从此为这个目标干活」——那是 owner 在那间屋子里做的
    一次**结构化引用**，比任何自然语言提及都确定。
  */
  for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'goal-context' })) {
    const state = asRecord(object.state)
    if (asString(state?.goalRef) !== goalRef) continue
    add(object.audience)
  }

  /*
    ③ 挂着它的子承诺。

    每一条都是一次**点名了这个目标的登记话语**——「登记承诺：X，张三负责，挂 Q3 目标」。
    那句话说给谁听，谁就知道这个目标存在了；系统再装作它不存在，是对着一份聊天记录
    说谎。
  */
  for (const object of ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind: 'commitment' })) {
    const ref = asString(asRecord(object.state)?.parentGoalRef)
    if (ref !== goalRef) continue
    add(object.audience)
  }
  return out
}

/**
 * 三态投影的**第一问**：这个查看者看得见这个目标的标题吗 (v4.22 裁决①).
 *
 * 三态各自的渲染，由每个投影位自己决定，但第一问只有这一个答案：
 *
 * - 标题可见 ∧ 正文可读 → 全渲染；
 * - 标题可见 ∧ 正文不可读 → **显名字 + 链接、不显内容**；
 * - **标题不可见 → 一切投影按无归属形态渲染、零暗示**——不是「印个链接」，是**当它
 *   不存在**。印一个 URI 等于告诉对方「这儿有个你看不到的东西」，而 URI 本身常常
 *   就带着名字。与「连计数不泄漏」以及明拒⑤「不用『另有 N 项你看不到』做透明装饰」
 *   唯一自洽的做法，就是什么都不说。
 *
 * 操作者视角一律可见：他看的是自己那一份分区（`audienceAllows` 对 operator 恒真），
 * 而这个函数问的是**场所**能不能看见。
 */
export function goalTitleVisible(
  ctx: Context, goalRef: string, viewer: GraphViewer,
): boolean {
  if (viewer.kind === 'operator') return true
  return goalTitleAudience(ctx, goalRef).has(viewer.placeKey)
}
