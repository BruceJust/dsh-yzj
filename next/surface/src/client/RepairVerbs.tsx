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
import { PersonPicker } from './PersonPicker.tsx'

/** 正在对哪一条、做哪一种修理。 */
export type Repair =
  | { kind: 'postpone'; row: BoardRowWire }
  | { kind: 'handoff'; row: BoardRowWire }
  | { kind: 'merge'; row: BoardRowWire }
  | { kind: 'void'; row: BoardRowWire }
  /** 收养（无归属行）与摘除（有归属行）**互斥**：同一格的加减法 (决策 #57)。 */
  | { kind: 'attach'; row: BoardRowWire }

/**
 * 作废那颗按钮此刻说什么 —— **两段式** (决策 #57).
 *
 * 作废是不可逆的人签发终态（级联等待对象 + 回写真身）。按摩擦三分法，这属于**主权
 * 摩擦必须保留**的场景：一键作废与一键验收同罪。所以任何入口都两段——第一段亮出后果，
 * 第二段才动手，中途永远可以走开。
 *
 * 抽成函数是为了让「哪一段说什么」可测，也为了板、目标页、留意层三处**说同一句话**：
 * 三处各写各的文案，迟早有一处的门看起来像个建议。
 */
export function voidGate(armed: boolean): { readonly label: string; readonly danger: boolean } {
  return armed ? { label: '确认作废？', danger: true } : { label: '作废…', danger: false }
}

/**
 * 作废一个目标时，底下那些活会怎么样 —— **级联显形，而不是级联执行**。
 *
 * 既有裁决保持：目标死了不等于底下每件事都该停，那是人的判断（摩擦保留）。但**必须
 * 当场说出有多少条**——不说的话，人按下的是一个不知道波及面的不可逆动作，而「半途而废
 * 的目标底下留着一片没人管的活」正是这条门要挡的东西。
 */
export function cascadeLine(openChildren: number): string {
  return openChildren === 0
    ? '底下没有还在跟的承诺。'
    : `底下 ${String(openChildren)} 条还在跟的承诺**不会自动作废**——它们仍是真实的活，各自的裁决保持，可逐条处理。`
}

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
  /** 可以收养这一条的目标。无归属行才用得上。 */
  goals?: readonly { readonly ref: string; readonly label: string }[]
  /**
   * 这一行如果是**目标**，它底下还有几条在跟。
   *
   * 同一件事有两扇门：板上目标组头那颗，和平铺列表里这一行的修理条。两扇门只有一扇
   * 说了级联，就等于告诉走另一扇的人「这次没有波及面」。
   */
  cascadeOpen?: number
  close(): void
  run(id: string, work: Promise<{ error?: string }>, done: string): void
}): ReactNode {
  const { repair, siblings, inject, busy, field, setField, field2, setField2, goals, cascadeOpen, close, run } = props
  const row = repair.row

/*
  **作废：既可见又可动，且必须过门** (决策 #57).

  这颗动词此前只长在目标组头上——于是一条没挂目标的承诺，作废在整个产品里都不可达
  （它没有目标页可进，而板行的修理条里没有它）。「修了可见性没修可动性」正是这一条
  裁决点名的半环割裂债。

  而它一进来就得带着门：**一键作废与一键验收同罪**。第一段（打开这一条）亮出后果，
  第二段（按下「确认作废」）才动手——中途永远可以走开。
*/
if (repair.kind === 'void') {
  return (
    <div className={css.repair}>
      <span className={css.repairWhy}>
        作废 = <b>人签发的终态</b>，不可逆：等待它的对象级联收口、真身上回写一笔「已作废」。
        它和「这件事还没做好」（打回）不是一回事，也不是「先放一放」——放一放没有动词，
        因为那只动你自己的计划。
      </span>
      {row.isGoal !== undefined && (
        <span className={css.repairWhy}>{cascadeLine(cascadeOpen ?? 0)}</span>
      )}
      <button
        type="button"
        className={`${css.repairGo} ${css.repairDanger}`}
        disabled={busy}
        onClick={() => {
          run(row.id, inject.voidCommitment(row.id, '操作者在承诺板作废'), `已作废：${row.what}`)
        }}
      >
        确认作废
      </button>
      <button type="button" className={css.repairX} onClick={() => { close() }}>取消</button>
    </div>
  )
}

/*
  收养与摘除 —— **同一格的加减法**，按归属互斥渲染 (v4.22 裁决② / 决策 #57)。

  未挂是合法状态，所以这两个动词都不是「撤销」：收养是事后挂接（挂接三时刻之三），
  摘除是把它送回无归属组。谁也不该同时出现——一条行要么有归属要么没有。
*/
if (repair.kind === 'attach') {
  const attached = row.goalRef !== undefined
  if (attached) {
    return (
      <div className={css.repair}>
        <span className={css.repairWhy}>
          摘除 = 把它送回「无归属」。<b>承诺不死</b>，死的只是那条挂接——不是所有工作都
          为某个目标服务，未挂是合法状态。
        </span>
        <button
          type="button"
          className={css.repairGo}
          disabled={busy}
          onClick={() => {
            run(row.id, inject.unlinkCommitments([row.id]), '已摘除，回到「无归属」。')
          }}
        >
          摘除
        </button>
        <button type="button" className={css.repairX} onClick={() => { close() }}>取消</button>
      </div>
    )
  }
  return (
    <div className={css.repair}>
      <span className={css.repairWhy}>
        收养 = 事后把它挂进一个目标（挂接三时刻之三）。<b>挂错了可以再摘</b>——所以这一步
        不设门；宁空勿错的那一半在于：不挂也完全正当。
      </span>
      {(goals ?? []).length === 0
        ? <span className={css.repairWhy}>还没有目标可挂——先立一个。</span>
        : (
          <select
            className={css.repairInput}
            value={field}
            onChange={event => { setField(event.target.value) }}
          >
            <option value="">挂进哪个目标…</option>
            {(goals ?? []).map(goal => (
              <option key={goal.ref} value={goal.ref}>{goal.label}</option>
            ))}
          </select>
        )}
      <button
        type="button"
        className={css.repairGo}
        disabled={field === '' || busy}
        onClick={() => {
          run(row.id, inject.linkCommitments(field, [row.id]), '已收养：这条现在为那个目标服务。')
        }}
      >
        收养
      </button>
      <button type="button" className={css.repairX} onClick={() => { close() }}>取消</button>
    </div>
  )
}
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
      {/*
        **没有人背得下同事的 openId。**

        这两个框此前是「新执行者的 openId」+「显示名（可空）」——一个要人手打身份，
        一个由人随便写。手打的那个不会报错：一个错的 openId 只是把这条承诺交给一个
        不存在的人，然后安静地待在板上。身份只能来自通讯录（`PersonPicker`，立目标
        的 owner 用的是同一个）。
      */}
      <PersonPicker
        inject={inject}
        picked={field.trim() === '' ? undefined : { openId: field.trim(), name: field2.trim() === '' ? field.trim() : field2.trim() }}
        onPick={(person) => { setField(person?.openId ?? ''); setField2(person?.name ?? '') }}
        placeholder="搜通讯录：新执行者是谁"
        clearTitle="换一个人"
        emptyTail="没选中人就移交不出去——这条承诺得有个真人接着。"
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
