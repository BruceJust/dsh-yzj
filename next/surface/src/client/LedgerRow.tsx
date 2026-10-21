/**
 * 承诺的一行 —— 承诺页和目标页是同一行 (界面重设计 §5.4 · 律五 · 律六).
 *
 * `头像 │ 标题 / 谁 · 哪 │ 一个信号`。悬停时信号让位给一两个就近动词；选中一行，右栏
 * 摆它的来龙去脉。两页各写一份的话，同一条承诺在两处会有两种长相、两套动词——人只会
 * 以为自己记错了。
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import type { BoardRowWire, SurfaceInject } from './rpc.ts'
import { currentSpotlight, landOn, sendErrand, setSpotlight, subscribeSpotlight, type Spotlight } from './store.ts'
import { revealAside } from './preview.ts'
import { commandKey } from './keys.ts'
import { CommitmentStoryPanel } from './Story.tsx'
import { stage, stagedNow, subscribeStaged, undo, type Staged } from './answers.ts'
import { nudgeDraft, onMe, signalOf } from './ledger.ts'
import { Avatar } from './Avatar.tsx'
import { AgentFace } from './icons.tsx'
import { AGENT, receiptLine } from './words.ts'
import css from './ledger.module.css'

/** 一行上能按的那几下。 */
export interface RowActions {
  /** 选中：右栏摆它的来龙去脉。再点一次收起。 */
  select(row: BoardRowWire, intent?: 'reject'): void
  /** 催一下：带着拟稿去那条承诺所在的会话，话由你自己发。 */
  nudge(row: BoardRowWire): void
  /** 验收（或「当它交了」）：进 5 秒撤回窗，和卡上的回答同一扇门。 */
  accept(row: BoardRowWire, said: string): void
  /** 说交了却没见到东西：让云小助去它自己的话题里找交的那份。 */
  look(row: BoardRowWire): void
  /** 你欠的那条：去它的会话里做。 */
  go(row: BoardRowWire): void
}

/**
 * 一屏承诺的焦点与动词。
 *
 * 右栏开不出来时（宿主在当前会话为空时不给开抽屉），来龙去脉停在这一屏自己的右边——
 * 选中一行必须有回应，「点了没反应」是最难被报告的那种坏。
 */
export function useLedger(props: {
  inject: SurfaceInject
  commission(text: string, sessionId?: string): Promise<string | undefined>
  openSession(sessionId: string): void
  refresh(): Promise<void>
  say(text: string): void
}): {
  readonly spotlight: Spotlight | undefined
  readonly selected: string | undefined
  readonly docked: boolean
  readonly staged: readonly Staged[]
  readonly actions: RowActions
} {
  const { inject, commission, openSession, refresh, say } = props
  const [docked, setDocked] = useState(false)
  const spotlight = useSyncExternalStore(subscribeSpotlight, currentSpotlight)
  const staged = useSyncExternalStore(subscribeStaged, stagedNow)

  // 离开这一屏，右栏不再摆这里选中的那一条。
  useEffect(() => () => {
    if (currentSpotlight()?.kind === 'commitment') setSpotlight(undefined)
  }, [])

  const select = useCallback((row: BoardRowWire, intent?: 'reject'): void => {
    const now = currentSpotlight()
    if (now?.kind === 'commitment' && now.id === row.id && intent === undefined) {
      setSpotlight(undefined)
      return
    }
    setSpotlight({ kind: 'commitment', id: row.id, title: row.what, ...(intent === undefined ? {} : { intent }) })
  }, [])

  // 选中从哪来都一样（点一行、J/K、⌘K）：右栏打开；开不出来就停在这一屏右边。
  const pickedId = spotlight?.kind === 'commitment' ? spotlight.id : undefined
  useEffect(() => {
    if (pickedId !== undefined) revealAside(() => { setDocked(true) })
  }, [pickedId])

  const nudge = useCallback((row: BoardRowWire): void => {
    if (row.sessionId === undefined) {
      say('这条登记时不在任何话题里——去跟对方直接说一声吧。')
      return
    }
    sendErrand({ subject: 'nudge', goalRef: row.goalRef ?? '', goalName: row.what, voice: 'place', seed: nudgeDraft(row) })
    openSession(row.sessionId)
  }, [openSession, say])

  const accept = useCallback((row: BoardRowWire, said: string): void => {
    stage({ kind: 'commitment', id: row.id, steps: [{ actionId: 'accept' }], said }, async () => {
      const result = await inject.cardAct('commitment', row.id, 'accept')
      if (result?.outcome !== 'applied') say(receiptLine(result, '没验收上，再试一次。'))
      void refresh()
    })
  }, [inject, refresh, say])

  const look = useCallback((row: BoardRowWire): void => {
    const ask = `「${row.what}」${row.executorKind === 'agent' ? '' : row.who}说交了，但我没见到东西。帮我在这个话题里找找交的是什么、在哪——找不到也告诉我。`
    void commission(ask, row.sessionId).then((error) => { if (error !== undefined) say(error) })
  }, [commission, say])

  const go = useCallback((row: BoardRowWire): void => {
    if (row.sessionId === undefined) return
    landOn({ sessionId: row.sessionId, kind: 'commitment', id: row.id })
    openSession(row.sessionId)
  }, [openSession])

  return {
    spotlight,
    selected: spotlight?.kind === 'commitment' ? spotlight.id : undefined,
    docked,
    staged,
    actions: { select, nudge, accept, look, go },
  }
}

/**
 * 悬停时换上的那一两个动词 —— **按主权渲染**：你答应别人的那几行没有「催」，只有「去做」；
 * 不归你管的、记在别的实例上的，一个都没有（右栏会说该去找谁）。
 */
function verbsOf(row: BoardRowWire, actions: RowActions): ReactNode[] {
  if (row.status !== 'open' || row.mirror !== undefined) return []
  const verb = (key: string, label: ReactNode, act: () => void, go = false): ReactNode => (
    <button
      type="button"
      key={key}
      className={`${css.verb} ${go ? css.verbGo : ''}`}
      onClick={(event) => { event.stopPropagation(); act() }}
    >
      {label}
    </button>
  )
  if (row.awaitingAcceptance === true && onMe(row)) {
    return row.evidence === 'said'
      ? [verb('look', `让${AGENT}找找`, () => { actions.look(row) }), verb('take', '当它交了', () => { actions.accept(row, '你当它交了') })]
      : [verb('ok', '验收', () => { actions.accept(row, '你验收了') }, true), verb('no', '打回…', () => { actions.select(row, 'reject') })]
  }
  if (row.direction === 'owed-to-me' && row.remindable && row.stewardedBy === undefined) {
    return [verb('nudge', `催${row.executorKind === 'agent' ? '' : row.who}`, () => { actions.nudge(row) })]
  }
  if (row.direction === 'mine' && row.sessionId !== undefined) return [verb('go', '去做', () => { actions.go(row) })]
  return []
}

export function LedgerRow(props: {
  row: BoardRowWire
  /** 第二行：谁欠谁 · 在哪（· 为哪个目标）。 */
  sub: string
  now: number
  selected: boolean
  pending?: Staged
  actions: RowActions
  /** 行首多出来的那一格（批量挂目标时的勾选框）。 */
  leading?: ReactNode
}): ReactNode {
  const { row, sub, now, selected, pending, actions, leading } = props
  const signal = signalOf(row, now)
  const verbs = verbsOf(row, actions)
  return (
    <div
      role="button"
      tabIndex={0}
      data-row={row.id}
      className={`${css.row} ${selected ? css.rowOn : ''} ${row.status !== 'open' ? css.rowDone : ''}`}
      onClick={() => { actions.select(row) }}
      onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) actions.select(row) }}
    >
      {leading}
      {row.executorKind === 'agent'
        ? <AgentFace size={24} className={css.face} />
        : <Avatar name={row.who} className={css.avatar} photoClassName={css.photo} />}
      <span className={css.main}>
        <span className={css.what}>{row.what}</span>
        {sub !== '' && <span className={css.sub}>{sub}</span>}
      </span>
      {pending !== undefined
        ? (
          <span className={css.pending}>
            {pending.said} · {Math.max(1, Math.ceil((pending.deadline - Date.now()) / 1000))} 秒后生效
            <button type="button" className={css.verb} onClick={(event) => { event.stopPropagation(); undo({ kind: 'commitment', id: row.id }) }}>
              撤回 <kbd className={css.kbd}>Z</kbd>
            </button>
          </span>
        )
        : (
          <>
            <span className={`${css.signal} ${css[`tone_${signal.tone}`] ?? ''} ${verbs.length > 0 ? css.signalHide : ''}`}>
              {signal.tone === 'late' || signal.tone === 'need' ? <span className={css.dot} /> : null}
              {signal.text}
            </span>
            {verbs.length > 0 && <span className={css.verbs}>{verbs}</span>}
          </>
        )}
    </div>
  )
}

/** 右栏开不出来时，来龙去脉停在这一屏的右边。 */
export function StoryDock(props: {
  spotlight: Spotlight | undefined
  docked: boolean
  inject: SurfaceInject
  openSession(sessionId: string): void
}): ReactNode {
  const { spotlight, docked, inject, openSession } = props
  if (!docked || spotlight?.kind !== 'commitment') return null
  return (
    <aside className={css.dock}>
      <CommitmentStoryPanel
        key={spotlight.id}
        id={spotlight.id}
        title={spotlight.title}
        {...(spotlight.intent === undefined ? {} : { intent: spotlight.intent })}
        inject={inject}
        openSession={(id) => { openSession(id) }}
        close={() => { setSpotlight(undefined) }}
      />
    </aside>
  )
}

/** J/K 在行间走（右栏跟着换）。Esc 归全站那一条链（keys.ts）。 */
export function useRowKeys(body: RefObject<HTMLElement | null>, rows: readonly BoardRowWire[], selected: string | undefined): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!commandKey(event)) return
      const down = event.key === 'j' || event.key === 'J'
      if (!down && event.key !== 'k' && event.key !== 'K') return
      const nodes = [...(body.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
      if (nodes.length === 0) return
      event.preventDefault()
      const at = nodes.findIndex(node => node.dataset.row === selected)
      const next = nodes[Math.min(nodes.length - 1, Math.max(0, at < 0 ? 0 : at + (down ? 1 : -1)))]
      const row = rows.find(one => one.id === next?.dataset.row)
      if (row === undefined || next === undefined) return
      setSpotlight({ kind: 'commitment', id: row.id, title: row.what })
      next.scrollIntoView({ block: 'nearest' })
      next.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [body, rows, selected])
}
