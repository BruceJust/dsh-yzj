/**
 * 决断指针 —— 「要你」阶梯的第三级 (界面重设计 律二 / 复审 R12).
 *
 * 阶梯是：左栏逐条 → 地方行上的点 → **这里** → 卡片标签。前两级是聚合，这一级只回答
 * 一个问题：**在你已经站着的这段对话里，那件等你答的事在哪**。
 *
 * 它此前是一条常驻的决断条，钉在流的顶上——可卡就在流里，卡在视野里时那一条只是把屏上
 * 已经看得见的东西再说一遍。「只指路」的意思是：**看得见目标时就不必再指**。所以它现在
 * 只在等你的卡**滚出视野**时浮出来，一颗胶囊：「要你确认 · 写入 12 条… ↓」，点一下滚
 * 过去、闪一下；卡回到视野里，它自己消失。
 *
 * 守住的规矩照旧：
 *
 * - **同源**：读的是 `cards`——和流内那些卡是同一个数组。
 * - **指针投影，不复制落座**：胶囊上只有名字和方向，答还是在卡上答，前后语境在场。
 * - **只收阻塞层、本语境直属**：`cards` 本来就只装这个话题的对象。
 * - **撤回窗里的不再指**：答了（哪怕还能撤回）就不再算「等你」。
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import type { StreamCard } from './rpc.ts'
import { answeringNow, subscribeAnswering } from './store.ts'
import { Icon } from './icons.tsx'
import css from './decision.module.css'

/** 指针上的一件事需要知道的全部。 */
export interface Chip {
  readonly kind: string
  readonly id: string
  readonly verb: string
  readonly label: string
  /** 开口问的先后。早等的排前面。 */
  readonly seq: number
}

/** 这段对话里此刻在等你答的那些卡，等得久的在前。 */
export function chipsOf(
  cards: readonly StreamCard[],
  answering: readonly { kind: string; id: string }[] = [],
): Chip[] {
  const out: Chip[] = []
  for (const card of cards) {
    /*
      非阻塞的不算——一条逾期承诺或一次可纠的挂接推断塞进来，就是把「可纠」升格成
      「待答」。`resolved` 是冗余的一道：服务端算 demand 时已先问过 `isResolved`，留着
      是因为两处判断来自两处，真对不上时宁可少指一件点不出东西的。
    */
    if (card.resolved) continue
    const demand = card.demand
    if (demand === undefined || demand.layer !== 'blocking') continue
    if (answering.some(ref => ref.kind === card.kind && ref.id === card.id)) continue
    out.push({ kind: card.kind, id: card.id, verb: demand.verb ?? '答', label: demand.label, seq: card.seq })
  }
  /*
    等得久的排前面。用**出生序**不用时间戳：同一次裁决落库的几张卡毫秒数一模一样，那时
    按时间排就退化成按查询顺序排，而查询顺序恰好是新的在前。
  */
  return out.sort((left, right) => left.seq - right.seq)
}

/** 一张卡此刻相对于视野在哪。没量到的当作「在视野里」——宁可晚一拍出现，不闪。 */
export type Where = 'in' | 'above' | 'below'

/** 胶囊的形状：指向谁、往哪边、另外还有几件不在视野里。 */
export interface PointerShape {
  readonly chip: Chip
  readonly direction: 'above' | 'below'
  readonly others: number
}

/**
 * 该不该浮出来、指向谁 —— 算在渲染之外，好让「看得见就不指」有自己的用例。
 *
 * 指向**等得最久**的那件不在视野里的；一件都不在视野外就是 `undefined`，胶囊不占位。
 */
export function pointerOf(chips: readonly Chip[], where: ReadonlyMap<string, Where>): PointerShape | undefined {
  const away = chips.filter(chip => (where.get(`${chip.kind}:${chip.id}`) ?? 'in') !== 'in')
  const first = away[0]
  if (first === undefined) return undefined
  const direction = where.get(`${first.kind}:${first.id}`) === 'below' ? 'below' : 'above'
  return { chip: first, direction, others: away.length - 1 }
}

export interface DecisionPointerProps {
  /** 本会话的全部卡。指针只是它的一次过滤投影。 */
  cards: readonly StreamCard[]
  /** 流的滚动容器——量「在不在视野里」的那个框。 */
  stream: RefObject<HTMLDivElement | null>
  /** 滚过去 + 闪一下。 */
  jumpTo(kind: string, id: string): void
}

export function YzjDecisionPointer(props: DecisionPointerProps): ReactNode {
  const { cards, stream, jumpTo } = props
  const answering = useSyncExternalStore(subscribeAnswering, answeringNow)
  const chips = useMemo(() => chipsOf(cards, answering), [cards, answering])
  const [where, setWhere] = useState<ReadonlyMap<string, Where>>(new Map())

  /*
    量位置用 IntersectionObserver：滚动时不跑任何代码，只在卡进出视野的那一刻回调一次。
    卡的节点跟着轮询重画，所以每次卡的集合变了就重新观察一遍。
  */
  const keys = chips.map(chip => `${chip.kind}:${chip.id}`).join('|')
  useEffect(() => {
    const root = stream.current
    if (root === null || chips.length === 0 || typeof IntersectionObserver === 'undefined') {
      setWhere(new Map())
      return undefined
    }
    const wanted = new Set(chips.map(chip => `${chip.kind}:${chip.id}`))
    const observer = new IntersectionObserver((entries) => {
      setWhere((previous) => {
        const next = new Map(previous)
        for (const entry of entries) {
          const key = entry.target.getAttribute('data-card') ?? ''
          const top = entry.rootBounds?.top ?? 0
          next.set(key, entry.isIntersecting ? 'in' : entry.boundingClientRect.top < top ? 'above' : 'below')
        }
        return next
      })
    }, { root, threshold: 0.15 })
    const seen = new Map<string, Where>()
    for (const node of root.querySelectorAll('[data-card]')) {
      const key = node.getAttribute('data-card') ?? ''
      if (!wanted.has(key)) continue
      seen.set(key, 'in')
      observer.observe(node)
    }
    // 窗口外（更早的历史里）的卡没有节点：它在上面。
    for (const key of wanted) if (!seen.has(key)) seen.set(key, 'above')
    setWhere(seen)
    return () => { observer.disconnect() }
    // keys 概括了 chips 的身份；cards 每次轮询都是新数组，按它重挂会让观察器抖。
  }, [keys, stream])

  const shape = pointerOf(chips, where)
  if (shape === undefined) return null

  return (
    <div className={css.dock}>
      <button
        type="button"
        className={css.pill}
        data-testid="decision-pointer"
        title={`${shape.chip.label}——跳到它在这段对话里的位置`}
        onClick={() => { jumpTo(shape.chip.kind, shape.chip.id) }}
      >
        <span className={css.dot} />
        <b className={css.verb}>要你{shape.chip.verb}</b>
        <span className={css.label}>{shape.chip.label}</span>
        {shape.others > 0 && <span className={css.others}>还有 {shape.others} 件</span>}
        <Icon name="chevD" size={14} className={shape.direction === 'above' ? css.up : undefined} />
      </button>
    </div>
  )
}
