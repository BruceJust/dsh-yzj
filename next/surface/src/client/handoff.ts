/**
 * 移交话语的拟稿 —— 浏览器这一侧的那一份（决策 #59）。
 *
 * ## 为什么这里有一份，`@yzj-next/objects` 里还有一份
 *
 * 这两份**必须一字不差**，而它们没法共用一个模块：客户端包不 import 任何宿主包（那会
 * 把 node 的东西拖进浏览器），宿主也不该反过来依赖一个视图目录。
 *
 * 所以这不是「忘了合并」，是一条被承认的边界；而承认它的代价是**必须有人守着**：
 * `tests/handoff-draft.spec.ts` 拿同样的输入去比两边的输出，一旦谁改了一个字就红。
 * 一份靠人记得去同步的复制品，就是下一个「两处各说各话」。
 *
 * ## 这句话为什么长这样
 *
 * 三样东西缺一不可：**是谁、哪一条、原话期限**。少了它们，收到这句话的人得回头翻记录
 * 才知道说的是哪件事——而那份翻找正是这个产品要消掉的东西。期限用**原话**而不是解析
 * 出来的日期：把人说过的话改写成时间戳，是拿我们的解析冒充他的承诺。
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
