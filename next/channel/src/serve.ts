/**
 * 接单与摘单 —— **一次改变触达面的主权动作** (v3.15 裁决⑤).
 *
 * 把 agent 接进一个群，等于让它听见那里的每一句话。此前这件事只在一个 JSON 里留下
 * 一个布尔值：回头问「谁把它接进这个群的、什么时候」，没有答案——只有一个当前值。
 * 一个改变触达面的决定不该只剩下一个当前值。
 *
 * 抽成一个函数是为了让**顺序**可测。这三步谁先谁后不是风格问题：
 *
 * 1. 记（图上留下动作）—— 记不下就整件事不发生；
 * 2. 改运行态（内存里的名单，下一次轮询就按它走）；
 * 3. 落盘（重启后还算数）。
 *
 * 先做后记的话，中间崩一下，触达变了而没有任何地方说得清是谁改的——那正是这条裁决
 * 要消灭的东西。所以失败向调用者**抛**，不吞：一次没有出处的接单，比一次失败的接单
 * 更贵。
 *
 * 这**不是第二本账**：运行态的真相仍然只有 `allowedGroupIds`/`deniedGroupIds` 一处，
 * 图上记的是那个**动作**，方向单向（动作 → 图事件 → 物化）。
 */

import { placeKeyFor } from './protocol.ts'

/** 一次接单/摘单动作在图上的样子。 */
export interface ServeRecord {
  readonly placeKey: string
  readonly served: boolean
  /** 名录里认得出来才写——**不猜**，宁可那一笔只有 id。 */
  readonly groupName?: string
}

export function serveRecordFor(groupId: string, on: boolean, name?: string): ServeRecord {
  return { placeKey: placeKeyFor('group', groupId), served: on, ...(name === undefined ? {} : { groupName: name }) }
}

/**
 * 执行一次接单/摘单。
 *
 * @param input.record - 把动作记到图上。抛出即整件事不发生。
 * @param input.persist - 落盘。
 */
export async function applyServe(input: {
  readonly groupId: string
  readonly on: boolean
  readonly allowedGroupIds: Set<string>
  readonly deniedGroupIds: Set<string>
  readonly record: (record: ServeRecord) => Promise<void>
  readonly nameOf?: (groupId: string) => string | undefined
  readonly persist: (groupId: string, on: boolean) => Promise<void>
}): Promise<void> {
  await input.record(serveRecordFor(input.groupId, input.on, input.nameOf?.(input.groupId)))
  /*
    三值纪律 (`onDutyIn`)：接单写进 allowed **并撤掉那个明确的「不」**，摘单反过来写进
    denied。只从一个集合里 delete 会把「明确说了不」退化回「从没提过」，而后者会被部署
    默认接管——人刚说过的话，下一个默认就把它盖掉了。
  */
  if (input.on) {
    input.allowedGroupIds.add(input.groupId)
    input.deniedGroupIds.delete(input.groupId)
  } else {
    input.deniedGroupIds.add(input.groupId)
    input.allowedGroupIds.delete(input.groupId)
  }
  await input.persist(input.groupId, input.on)
}
