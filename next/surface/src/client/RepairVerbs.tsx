/**
 * 修理动词 —— 全站只有这一组：顺延、转给别人、合并、作废，外加挂到目标 / 不挂了。
 *
 * 板上的来龙去脉、目标页、会前那一眼都用它，所以单独成文件：三处各写一份，迟早有一处
 * 在「顺延到底改的是谁的日子」上和别处说得不一样。
 *
 * 每个动词只带一句话：它会改到什么、谁看得到。改的都是当初说出口的话，所以这一句不是
 * 装饰——但也只要一句。
 */

import { type ReactNode } from 'react'
import type { SurfaceInject } from './rpc.ts'
import css from './repair.module.css'

/**
 * 修理动词认得的那一条 —— **只要这几样，不要一整行**。
 *
 * 此前它写死成 `BoardRowWire`，于是**只有板和目标页用得上**：事件枢纽的行是另一种形状
 * （会前那一眼要的东西），要复用就得伪造一整行承诺。而这几个动词真正读的只有 id、
 * 原话、状态、原话期限、归属——把这件事说清楚，「板与 hub 同构」（决策 #57）就不必靠
 * 造假来达成。
 */
export interface RepairTarget {
  readonly id: string
  readonly what: string
  readonly status: string
  /** 当初说出口的那句期限（原话，不是解析出来的日期）。 */
  readonly due?: { readonly text: string }
  readonly goalRef?: string
  /** 这一行本身是个目标时，它的真身 URI——作废要据此报级联。 */
  readonly isGoal?: string
}

/** 正在对哪一条、做哪一种修理。 */
export type Repair =
  | { kind: 'postpone'; row: RepairTarget }
  | { kind: 'handoff'; row: RepairTarget }
  | { kind: 'merge'; row: RepairTarget }
  | { kind: 'void'; row: RepairTarget }
  /** 收养（无归属行）与摘除（有归属行）**互斥**：同一格的加减法 (决策 #57)。 */
  | { kind: 'attach'; row: RepairTarget }

/**
 * 动词上的字。只在这里写一次：会前那一眼和来龙去脉摆出来的是同一排词。
 * 挂到目标 / 不挂了是同一格的加减法，看这一条眼下挂没挂。
 */
export function repairLabel(kind: Repair['kind'], row: Pick<RepairTarget, 'goalRef'>): string {
  switch (kind) {
    case 'postpone': return '顺延'
    case 'handoff': return '转给别人'
    case 'merge': return '合并'
    case 'void': return '作废…'
    case 'attach': return row.goalRef === undefined ? '挂到目标…' : '不挂了…'
  }
}

/** 一排修理动词的次序。 */
export const REPAIR_KINDS: readonly Repair['kind'][] = ['postpone', 'handoff', 'merge', 'void', 'attach']

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
    // 纯文本：它同时进提示条和面板里的一行字，两处都不过 markdown。
    : `底下 ${String(openChildren)} 条还在跟的承诺不会被一起作废，可以逐条处理。`
}

export function RepairVerbs(props: {
  repair: Repair
  /** 可以合并进去的同伴：同一个目标下的，或同为没挂目标的。 */
  siblings: readonly RepairTarget[]
  inject: SurfaceInject
  busy: boolean
  field: string
  setField(value: string): void
  /** 可以挂进去的目标。没挂目标的行才用得上。 */
  goals?: readonly { readonly ref: string; readonly label: string }[]
  /**
   * 转给别人：开委派那张选择条，人和地方预选成当前值。话由人在落点里说出去，说出去才算
   * 数——这里只负责把人送过去。没接上的一面如实说没有。
   */
  handoff?(row: RepairTarget): void
  /** 这一行如果是目标，它底下还有几条在跟——作废时要当场说出来。 */
  cascadeOpen?: number
  close(): void
  run(id: string, work: Promise<{ error?: string }>, done: string): void
}): ReactNode {
  const { repair, siblings, inject, busy, field, setField, goals, cascadeOpen, handoff, close, run } = props
  const row = repair.row
  const cancel = <button type="button" className={css.repairX} onClick={() => { close() }}>算了</button>

  if (repair.kind === 'void') {
    return (
      <div className={css.repair}>
        <span className={css.repairWhy}>
          作废之后收不回来，等着它的人会收到一句「作废了」。
          {row.isGoal !== undefined && ` ${cascadeLine(cascadeOpen ?? 0)}`}
        </span>
        <input
          className={css.repairInput}
          value={field}
          placeholder="为什么（可不写）"
          onChange={event => { setField(event.target.value) }}
        />
        <button
          type="button"
          className={`${css.repairGo} ${css.repairDanger}`}
          disabled={busy}
          onClick={() => {
            run(row.id, inject.voidCommitment(row.id, field.trim() === '' ? '你作废了' : field.trim()), `作废了：${row.what}`)
          }}
        >
          确认作废
        </button>
        {cancel}
      </div>
    )
  }

  if (repair.kind === 'attach') {
    if (row.goalRef !== undefined) {
      return (
        <div className={css.repair}>
          <span className={css.repairWhy}>不挂在这个目标下了——这条照样在跟。</span>
          <button
            type="button"
            className={css.repairGo}
            disabled={busy}
            onClick={() => { run(row.id, inject.unlinkCommitments([row.id]), '不挂了，它回到「没挂目标」。') }}
          >
            不挂了
          </button>
          {cancel}
        </div>
      )
    }
    return (
      <div className={css.repair}>
        {(goals ?? []).length === 0
          ? <span className={css.repairWhy}>还没有目标可挂——先立一个。</span>
          : (
            <select className={css.repairInput} value={field} onChange={event => { setField(event.target.value) }}>
              <option value="">挂到哪个目标…</option>
              {(goals ?? []).map(goal => <option key={goal.ref} value={goal.ref}>{goal.label}</option>)}
            </select>
          )}
        <button
          type="button"
          className={css.repairGo}
          disabled={field === '' || busy}
          onClick={() => { run(row.id, inject.linkCommitments(field, [row.id]), '挂上了。') }}
        >
          挂上
        </button>
        {cancel}
      </div>
    )
  }

  if (repair.kind === 'postpone') {
    return (
      <div className={css.repair}>
        <span className={css.repairWhy}>改的是当初说定的那个日子，对方看得到。</span>
        <input
          className={css.repairInput}
          value={field}
          autoFocus
          placeholder="新的期限，例如 下周三"
          onChange={event => { setField(event.target.value) }}
        />
        <button
          type="button"
          className={css.repairGo}
          disabled={field.trim() === '' || busy}
          onClick={() => { run(row.id, inject.postponeCommitment(row.id, field.trim()), `期限改成了「${field.trim()}」。`) }}
        >
          改期限
        </button>
        {cancel}
      </div>
    )
  }

  if (repair.kind === 'handoff') {
    return (
      <div className={css.repair}>
        <span className={css.repairWhy}>换个人做，或换个地方说。原来那边会收到一句交接。</span>
        <button type="button" className={css.repairGo} disabled={busy || handoff === undefined} onClick={() => { handoff?.(row) }}>
          选人和地方
        </button>
        {cancel}
      </div>
    )
  }

  const others = siblings.filter(one => one.id !== row.id && one.status === 'open')
  return (
    <div className={css.repair}>
      <span className={css.repairWhy}>和另一条其实是同一件事？合并后这条不再单独跟。</span>
      {others.length === 0
        ? <span className={css.repairWhy}>旁边没有别的在跟的可以合并。</span>
        : (
          <select className={css.repairInput} value={field} onChange={event => { setField(event.target.value) }}>
            <option value="">合并进哪一条…</option>
            {others.map(other => <option key={other.id} value={other.id}>{other.what}</option>)}
          </select>
        )}
      <button
        type="button"
        className={css.repairGo}
        disabled={field === '' || busy}
        onClick={() => { run(row.id, inject.mergeCommitment(row.id, field), '合并了。') }}
      >
        合并
      </button>
      {cancel}
    </div>
  )
}
