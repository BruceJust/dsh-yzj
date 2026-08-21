/**
 * 会话决断条 —— 「需要你」落座语法的第三级递归 (v4.14/v4.15，§7.1)。
 *
 * 收件箱 → 目标枢纽 Zone1 → 这里。前两级都是**聚合**，这一级只做一件事：在你已经
 * 站着的这段对话里，告诉你有几件事在等你答，以及它们在哪。
 *
 * 五条它必须守住的规矩，每一条都对应一种它可能长歪的样子：
 *
 * - **同源**：它读的是 `cards` —— 和流内那些卡是**同一个数组**。所以「决断条与收件箱
 *   是同一批可应答对象的投影、先答先赢」不是靠纪律维持的约定，而是想让两边说不同的
 *   话都做不到。
 * - **指针投影，不复制落座**：条上只有名字和一个跳转。把卡拔到顶上钉住，要么是复制
 *   真身（同一个应答有了两个身体），要么是撕掉时间线（丢掉前后语境）——而**语境就是
 *   决断的证据**。顺手也就防住了「批量清账不看上下文」那种堕化。
 * - **答完即溶**：`demand` 没了，chip 就没了；一件不剩时整条消失。calm，零 chrome。
 * - **一行封顶**：条是指针不是清单。放得下几个放几个，其余折成 +N。长成横幅吃掉半屏
 *   对话，就违背了它自己存在的理由——对话不离场。
 * - **本语境直属**：`cards` 本来就只装这个话题的对象，所以「绝不上卷」在数据这一层就
 *   成立了。话题里的待答经话题卡徽标逐级兑付，不往群顶堆。
 *
 * 摩擦边界：**寻路归零、决断保留**。条只送达不代答——按下去是滚过去看着交付物做决定，
 * 不是在条上把它答掉。
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AnswerableDemandWire, StreamCard } from './rpc.ts'
import css from './decision.module.css'

/**
 * 一行**真的**放得下几个。
 *
 * 设计的原话是「计数 + 放得下的前几个 chip」——放得下，不是固定三个。实测过固定三个
 * 的样子：右栏一开，中栏被压窄，三枚 chip 挤成「待验收 农佳捷…」「待验收 抱歉，」
 * 「待验收 代」——第三枚只剩一个字，它占着位置却什么都没说，而它挤掉的是**本可以
 * 让前两枚说清楚**的空间。条是指针，指针得指得清。
 *
 * 上限仍是三：只收阻塞待答的话，健康负载本来就是 0-2 件；再多也不是排版该解决的事。
 */
function inlineFor(width: number): number {
  if (width <= 0) return 3
  if (width < 560) return 1
  if (width < 760) return 2
  return 3
}

/**
 * 长到这个数就不是排版问题了 (v4.15 条长即治理信号)。
 *
 * 一段会话长期挂着五件以上待答，说明的是**审批疲劳**，不是条太短。药方是授权租约，
 * 所以入口就长在条尾——疲劳发生在这里，发现入口也该在这里，而不是等人有一天想起来
 * 去合同面板里翻。
 */
const FATIGUE = 5

export interface DecisionBarProps {
  /** 本会话的全部卡。条只是它的一次过滤投影——同源在这里是结构性的。 */
  cards: readonly StreamCard[]
  /** 滚过去 + 高亮。条只指路，答还是在对象上答。 */
  jumpTo(kind: string, id: string): void
  /** 条尾的租约入口。给了才画——没有的地方不画一扇打不开的门。 */
  onLease?(): void
}

/** 条上那一枚 chip 需要知道的全部。 */
interface Chip {
  readonly kind: string
  readonly id: string
  readonly badge: string
  readonly label: string
  /** 出生序。条按它排——等得久的排在前面。 */
  readonly seq: number
}

export function chipsOf(cards: readonly StreamCard[]): Chip[] {
  const out: Chip[] = []
  for (const card of cards) {
    /*
      非阻塞的不算 —— 一条逾期承诺或一次可纠的挂接推断塞进这里，就是把「可纠」
      升格成「待答」，人得为每一个默认值签一次字。

      `resolved` 这道是**冗余的**：服务端算 demand 时已经先问过 `isResolved`，答完的
      对象根本不带 demand 过来。留着是因为两个判断来自两处（一处说「它结束了」，
      一处说「它在等什么」），而这里宁可信「它结束了」——真要有一天它们对不上，
      多画一枚点不出东西的 chip 比少画要糟。
    */
    if (card.resolved) continue
    const demand: AnswerableDemandWire | undefined = card.demand
    if (demand === undefined || demand.layer !== 'blocking') continue
    out.push({
      kind: card.kind,
      id: card.id,
      /*
        徽标由服务端定死了（家族自己写的，或从模式推的）。这里不再推一次:同一个
        字符串两处推导，就是两份要一起维护的映射表，而漏掉的那一处不会报错。
      */
      badge: demand.badge ?? '待答',
      label: demand.label,
      seq: card.seq,
    })
  }
  /*
    等得久的排前面。

    按到达顺序排等于「谁最新谁最急」——而一条被冷落了三天的确认，恰恰是最该先被
    看见的那一条。折成 +N 的时候这个顺序尤其要紧：被折进去的必须是最新的那几件，
    不是等得最久的那几件。

    用**出生序**不用时间戳：同一次裁决落库的几条卡毫秒数一模一样，那时按时间排
    就退化成按查询顺序排，而查询顺序恰好是新的在前——正好排反。
  */
  return out.sort((left, right) => left.seq - right.seq)
}

/** 一条的全部形状：谁并排、折了几个、是不是该谈租约了。 */
export interface BarShape {
  readonly chips: readonly Chip[]
  readonly shown: readonly Chip[]
  readonly folded: number
  /** 条长即治理信号：到这个数，条尾长出租约入口。 */
  readonly tired: boolean
}

/**
 * 条的形状，算在渲染之外。
 *
 * 「一行封顶」和「条长即治理信号」都是**可以悄悄失效**的规矩——多画一个 chip、少判
 * 一次阈值，屏幕上看不出错，只是某天条变成了横幅、或者那句「设为租约」再没出现过。
 * 算成一个纯函数，它们就有了各自的用例。
 */
export function barOf(cards: readonly StreamCard[], width = 0): BarShape {
  const chips = chipsOf(cards)
  const shown = chips.slice(0, inlineFor(width))
  return {
    chips,
    shown,
    folded: chips.length - shown.length,
    tired: chips.length >= FATIGUE,
  }
}

export function YzjDecisionBar(props: DecisionBarProps): ReactNode {
  const { cards, jumpTo, onLease } = props
  const [width, setWidth] = useState(0)
  const watching = useRef<ResizeObserver | null>(null)
  /*
    条有多宽，得问它自己。

    中栏的宽度随右栏开合而变，条只知道自己那一行有多长——所以它量自己，而不是去打听
    布局。用**回调 ref** 而不是 `useEffect`：条会整条消失又整条回来（答完即溶），
    带依赖数组的 effect 会错过它第二次挂载；不带依赖数组的又要在每一次轮询重渲染时
    拆装一遍观察器。回调 ref 恰好在挂载与卸载的那两刻各响一次。

    挂上就先直接读一次矩形：`ResizeObserver` 的第一次回调不保证赶在这一帧，而在那
    之前条会按「宽的」画——右栏开着时会闪一下三枚挤成一团的 chip。
  */
  const measure = useCallback((node: HTMLDivElement | null): void => {
    watching.current?.disconnect()
    watching.current = null
    if (node === null) return
    setWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      /*
        两次测量得是同一个量。

        首帧读的是 `getBoundingClientRect()`（含内边距），而 `contentRect` 不含——
        条左右各 20px 内边距，两者差 40。阈值附近这 40px 会让「第一次 resize」在
        什么都没真的变的情况下把 chip 数从 3 翻成 2，看上去像随机重排。
      */
      const entry = entries[0]
      const measured = entry?.borderBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width
      if (measured !== undefined) setWidth(measured)
    })
    observer.observe(node)
    watching.current = observer
  }, [])
  const { chips, shown, folded, tired } = useMemo(() => barOf(cards, width), [cards, width])

  // 答完即溶：没有等着的事，这一条就不存在。不是变灰，是不占位。
  if (chips.length === 0) return null

  return (
    <div className={css.bar} data-testid="decision-bar" ref={measure}>
      <span className={css.count}>需要你 · {String(chips.length)}</span>
      <span className={css.chips}>
        {shown.map(chip => (
          <button
            type="button"
            key={`${chip.kind}:${chip.id}`}
            className={css.chip}
            title={`${chip.label}——跳到它在这段对话里的位置`}
            onClick={() => { jumpTo(chip.kind, chip.id) }}
          >
            <span className={css.chipBadge}>{chip.badge}</span>
            <span className={css.chipLabel}>{chip.label}</span>
          </button>
        ))}
        {folded > 0 && (
          <button
            type="button"
            className={`${css.chip} ${css.more}`}
            title="还有几件在下面等着——跳到最早的那件，逐件答完这一条会自己消失"
            onClick={() => {
              const next = chips[shown.length]
              if (next !== undefined) jumpTo(next.kind, next.id)
            }}
          >
            +{String(folded)}
          </button>
        )}
      </span>
      {/*
        条尾的租约入口 (v4.15 疼痛门采集位)。

        它出现本身就是一句话：**你在这段对话里已经连续确认太多次了**。这不是排版
        问题，是审批疲劳，而疲劳的解药是预授权，不是把条做短。
      */}
      {tired && onLease !== undefined && (
        <button type="button" className={css.lease} onClick={onLease}>
          经常在确认这类操作？设为租约 ›
        </button>
      )}
    </div>
  )
}
