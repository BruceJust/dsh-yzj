/**
 * 期中修理动词族 —— **就近，而不是只在某一个页面里**。
 *
 * 顺延 / 移交 / 合并这三个动词此前只长在目标页上。后果是：**一条没挂目标的承诺，
 * 它的修理动词在整个产品里都不可达**——它没有目标页可进，而板行上只有「移出」。
 * 一件事登记错了期限、换了人、和另一条其实是同一件，你在板上看得见它，却对它
 * 什么都做不了（v4.21 第一档③）。
 *
 * 单独成文件，和 `RoomPicker` 同一个理由：**板和目标页都要用它**。长在其中一个
 * 消费者体内的话，另一个要么去 import 一个组件的私处，要么自己抄一份——而抄的那
 * 一份迟早在「顺延到底改的是谁的日子」这件事上和原件分道扬镳。
 *
 * 三个动词各自带着**为什么**，不只是一个输入框：它们改的都是当初说出口的话，而
 * 改公开承诺和改自己的日程是两件事。那几行解释不是装饰，是这几个按钮存在的条件。
 */

import { type ReactNode } from 'react'
import type { BoardRowWire, SurfaceInject } from './rpc.ts'
import css from './goal.module.css'

/** 正在对哪一条、做哪一种修理。 */
export type Repair =
  | { kind: 'postpone'; row: BoardRowWire }
  | { kind: 'handoff'; row: BoardRowWire }
  | { kind: 'merge'; row: BoardRowWire }

export function RepairVerbs(props: {
  repair: Repair
  /** 可以合并进去的同伴。板上是同组/同「无归属」的行，目标页上是这个目标的子承诺。 */
  siblings: readonly BoardRowWire[]
  inject: SurfaceInject
  busy: boolean
  field: string
  setField(value: string): void
  field2: string
  setField2(value: string): void
  close(): void
  run(id: string, work: Promise<{ error?: string }>, done: string): void
}): ReactNode {
  const { repair, siblings, inject, busy, field, setField, field2, setField2, close, run } = props
  const row = repair.row
if (repair.kind === 'postpone') {
  return (
    <div className={css.repair}>
      <span className={css.repairWhy}>
        改的是当初说出口的那个日子——公事，别人看得见。
        <b>「这条先别再烦我」是另一回事</b>，那只动你自己的计划，这套系统还没有那个闹钟。
      </span>
      <input
        className={css.repairInput}
        value={field}
        placeholder="新的期限，例如 2026-09-05"
        onChange={event => { setField(event.target.value) }}
      />
      <button
        type="button"
        className={css.repairGo}
        disabled={field.trim() === '' || busy}
        onClick={() => {
          run(row.id, inject.postponeCommitment(row.id, field.trim()), `已把期限改到 ${field.trim()}。`)
        }}
      >
        顺延期限
      </button>
      <button type="button" className={css.repairX} onClick={() => { close() }}>取消</button>
    </div>
  )
}
if (repair.kind === 'handoff') {
  return (
    <div className={css.repair}>
      <span className={css.repairWhy}>
        换人，不换承诺——出生边、听众、已有的回执都还在这一条上。
        <b>新执行者还不知道</b>：改完图之后，得有人在场所里说出口（幽灵承诺禁令对移交同样成立）。
      </span>
      <input
        className={css.repairInput}
        value={field}
        placeholder="新执行者的 openId"
        onChange={event => { setField(event.target.value) }}
      />
      <input
        className={css.repairInput}
        value={field2}
        placeholder="显示名（可空）"
        onChange={event => { setField2(event.target.value) }}
      />
      <button
        type="button"
        className={css.repairGo}
        disabled={field.trim() === '' || busy}
        onClick={() => {
          run(
            row.id,
            inject.handoffCommitment(row.id, field.trim(), field2.trim() === '' ? undefined : field2.trim()),
            '已移交。记得去登记场所说一声——图改了不等于人知道了。',
          )
        }}
      >
        移交
      </button>
      <button type="button" className={css.repairX} onClick={() => { close() }}>取消</button>
    </div>
  )
}
const others = siblings.filter(one => one.id !== row.id && one.status === 'open')
return (
  <div className={css.repair}>
    <span className={css.repairWhy}>
      两条登记其实是同一件事。<b>相似度分不该替人做这个判断</b>——两条听上去一样的，
      可能是两个部门各自要一份。合并之后被合掉的这条不再被任何动词唤醒（墓碑律）。
    </span>
    {others.length === 0
      ? <span className={css.repairWhy}>这个目标下没有别的在跟的承诺可以合并。</span>
      : (
        <select
          className={css.repairInput}
          value={field}
          onChange={event => { setField(event.target.value) }}
        >
          <option value="">合并进哪一条…</option>
          {others.map(other => (
            <option key={other.id} value={other.id}>{other.what}</option>
          ))}
        </select>
      )}
    <button
      type="button"
      className={css.repairGo}
      disabled={field === '' || busy}
      onClick={() => { run(row.id, inject.mergeCommitment(row.id, field), '已合并。') }}
    >
      合并
    </button>
    <button type="button" className={css.repairX} onClick={() => { close() }}>取消</button>
  </div>
)
}
