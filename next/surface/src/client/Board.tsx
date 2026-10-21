/**
 * 承诺 —— 对账面 (界面重设计 §5.4 · 律五 · 律六).
 *
 * 人打开这一屏想知道一件事：**哪里不对劲**。所以：
 *
 * - **四个透镜 = 四种组织轴**：全部按目标分组；欠我的按人；我欠的按对方；🔒我定过的是
 *   另一屏（私账）。透镜换的是骨架，不是过滤条件。
 * - **今天条**：逾期、等你、说交了没见到东西、没动静，各一个数，数字就是入口。
 * - **一行一个信号**：逾期 › 等你 › 说交了没见到 › 没动静 › 快到期 › 在做 › 正常。
 *   默认只摊开不对劲的，正常的收进「其余 N 件正常」，完成的收进「已完成」。
 * - **动词跟着焦点**：悬停时信号换成一两个就近动词；选中一行，右栏摆来龙去脉和全套动词。
 *
 * 这一屏是对承诺的一次查询——没有板对象，没有第二本账，所以它不维护也为真。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BoardEventWire, BoardGoalWire, BoardRowWire, BoardViewWire, SurfaceInject } from './rpc.ts'
import {
  currentBoardLens, currentSpotlight, landOn, onPortalRequest, pushFrame, sendErrand, setBoardLens, setSpotlight,
  subscribeLedger, subscribeSpotlight, type BoardLens,
} from './store.ts'
import { revealAside } from './preview.ts'
import { RoomPicker, landPortal, type Portal } from './RoomPicker.tsx'
import { DeclareGoal } from './DeclareGoal.tsx'
import { CommitmentStoryPanel } from './Story.tsx'
import { stage, stagedNow, subscribeStaged, undo } from './answers.ts'
import { Avatar } from './Avatar.tsx'
import { AgentFace, Icon } from './icons.tsx'
import { AGENT } from './words.ts'
import tokens from './tokens.module.css'
import css from './ledger.module.css'

export { safeHref } from './preview.ts'
export { matchWorkspaces } from './DeclareGoal.tsx'

export interface BoardProps {
  inject: SurfaceInject
  /**
   * 把一句话交给云小助——CTA 是话语的按钮形态。给了 `sessionId` 就说在那个会话里
   * （「让云小助找找」要在那条承诺自己的话题里找），否则说在当前会话。
   * 返回一句话 = 没送出去，为什么。
   */
  commission(text: string, sessionId?: string): Promise<string | undefined>
  openSession(sessionId: string): void
  back(): void
  /** 从哪个会话来的——「先和云小助想清楚」回那里去。 */
  fromSessionId?: string
  /** 从目标页返回时，板回到离开时的那个像素。 */
  restoreScroll?: number
}

const EMPTY: BoardViewWire = { rows: [], goals: [], unattached: [] }
const SOON_MS = 36 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000

/** 「多久没动了」的人话。刻意粗：只到天/小时——精确的数字会让人以为它精确。 */
export function sinceText(at: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 60) return '刚刚'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时`
  return `${String(Math.floor(hours / 24))} 天`
}

/**
 * 催一下的拟稿 —— 一句能直接发出去的话：带上当初那件事和那句原话期限，不替人定调。
 */
export function nudgeDraft(row: { what: string; due?: { text: string }; overdue: boolean }): string {
  const said = row.due?.text?.trim() ?? ''
  const when = said === ''
    ? ''
    : row.overdue ? `（当时说的是${said}，已经过了）` : `（当时说的是${said}）`
  return `问一下「${row.what}」这条现在到哪一步了${when}`
}

/** 一条结束了的，结束在什么上。转手和作废分开说：一个是黄了，一个是换人了。 */
function settledLabel(row: { status: string; transferredTo?: string }): string {
  if (row.status === 'closed') return '完成了'
  if (row.status === 'voided') return '作废了'
  if (row.status === 'merged') return '合并了'
  if (row.status === 'transferred') return row.transferredTo === undefined ? '转手了' : `转给了${row.transferredTo}`
  return row.status
}

/* ——— 一行一个信号 ——— */

export type SignalKey = 'wait' | 'said' | 'late' | 'declined' | 'unheard' | 'quiet' | 'soon' | 'doing' | 'normal' | 'done'

export interface RowSignal {
  readonly key: SignalKey
  readonly text: string
  /** 只有 late 和 need 上色；其余都是墨色。一行最多一个颜色。 */
  readonly tone: 'late' | 'need' | 'warn' | 'quiet'
}

/** 这条现在等的是不是你：验收人是你（服务端在你就是验收人时不发 `acceptor`），且归你管。 */
const onMe = (row: BoardRowWire): boolean => row.acceptor === undefined && row.stewardedBy === undefined

/**
 * 这一行静态时只亮的那一个信号。
 *
 * 顺序就是律五那条：逾期 › 等你 › 说交了没见到 › 没动静 › 快到期 › 在做 › 正常——只有
 * 一处改动：**交了的、等你验收的排在逾期前面**。对方已经交了，球在你这边；再说「逾期」
 * 是在催一个已经交了的人。
 */
export function signalOf(row: BoardRowWire, now: number = Date.now()): RowSignal {
  if (row.status !== 'open') return { key: 'done', text: settledLabel(row), tone: 'quiet' }
  if (row.awaitingAcceptance === true && onMe(row)) {
    return row.evidence === 'said'
      ? { key: 'said', text: '说交了 · 没见到东西', tone: 'need' }
      : { key: 'wait', text: row.evidence === 'platform' ? '交了 · 平台记了' : '交了 · 等你验收', tone: 'need' }
  }
  if (row.overdue) {
    const days = row.due?.ts === undefined ? 0 : Math.floor((now - row.due.ts) / DAY_MS)
    return { key: 'late', text: days >= 1 ? `逾期 ${String(days)} 天` : '逾期', tone: 'late' }
  }
  if (row.awaitingAcceptance === true) return { key: 'doing', text: `交了 · 等${row.acceptor ?? row.stewardedBy ?? '对方'}验收`, tone: 'quiet' }
  if (row.acceptance?.state === 'declined') return { key: 'declined', text: '对方没接', tone: 'need' }
  if (row.notified === 'failed') return { key: 'unheard', text: '对方还不知道', tone: 'need' }
  if (row.signal === 'silent') return { key: 'quiet', text: '登记后没动静', tone: 'warn' }
  if (row.signal === 'stale') return { key: 'quiet', text: `${sinceText(row.lastSignalAt, now)}没动静`, tone: 'warn' }
  if (row.due?.ts !== undefined && row.due.ts >= now && row.due.ts - now < SOON_MS) {
    return { key: 'soon', text: `${row.due.text}到期`, tone: 'warn' }
  }
  if (row.executorKind === 'agent') return { key: 'doing', text: `${AGENT}在做`, tone: 'quiet' }
  if (row.evidence !== undefined) return { key: 'doing', text: row.evidence === 'said' ? '在做' : '在做 · 有东西', tone: 'quiet' }
  return { key: 'normal', text: row.due?.text ?? '', tone: 'quiet' }
}

/** 不对劲的那几种：默认摊开。其余收进「其余 N 件正常」。 */
const UNUSUAL: ReadonlySet<SignalKey> = new Set(['wait', 'said', 'late', 'declined', 'unheard', 'quiet', 'soon'])

/** 今天条的四颗数：逾期、等你、说交了没见到、没动静。 */
export type TodayKey = 'late' | 'wait' | 'said' | 'quiet'

const TODAY_OF: Partial<Record<SignalKey, TodayKey>> = {
  late: 'late', wait: 'wait', declined: 'wait', unheard: 'wait', said: 'said', quiet: 'quiet',
}

export function todayOf(rows: readonly BoardRowWire[], now: number = Date.now()): Record<TodayKey, number> {
  const out: Record<TodayKey, number> = { late: 0, wait: 0, said: 0, quiet: 0 }
  for (const row of rows) {
    const key = TODAY_OF[signalOf(row, now).key]
    if (key !== undefined) out[key] += 1
  }
  return out
}

export const TODAY_LABEL: Record<TodayKey, (n: number) => string> = {
  late: n => `${String(n)} 逾期`,
  wait: n => `${String(n)} 等你`,
  said: n => `${String(n)} 说交了，没见到东西`,
  quiet: n => `${String(n)} 没动静`,
}

/* ——— 透镜 = 组织轴 ——— */

export interface Group {
  readonly key: string
  readonly kind: 'goal' | 'unattached' | 'promised' | 'person'
  readonly title: string
  readonly goal?: BoardGoalWire
  readonly rows: readonly BoardRowWire[]
}

/**
 * 一个透镜下的骨架。
 *
 * - 全部：按目标分组，后面是「没挂目标」和「你答应别人的」（没挂目标、又是你欠的）。
 * - 欠我的：按欠你的那个人分组。
 * - 我欠的：按你欠的那个人分组；自己给自己定的单独一组。
 *
 * 目标行本身不进任何组：它是组头。
 */
/** 目标没有登记名字时（只知道它的文档链接），从链接里取一个人读得懂的名字。 */
export function goalTitleOf(ref: string): string {
  try {
    const last = new URL(ref.replace('#/', '')).pathname.split('/').filter(part => part !== '').at(-1)
    return last === undefined ? '没有名字的目标' : decodeURIComponent(last)
  } catch {
    return ref
  }
}

/** 这一组此刻有没有要看的：有在跟的活，或者是一个还开着、却还没挂上任何活的目标。 */
export function isLive(group: Group): boolean {
  if (group.rows.some(row => row.status === 'open')) return true
  return group.kind === 'goal' && group.rows.length === 0 && (group.goal?.row === undefined || group.goal.row.status === 'open')
}

export function groupsOf(view: BoardViewWire, lens: BoardLens): readonly Group[] {
  const work = view.rows.filter(row => row.isGoal === undefined || row.goalRef !== undefined)
  if (lens === 'all') {
    const goals: Group[] = view.goals.map(goal => ({
      key: `goal:${goal.goalRef}`, kind: 'goal', title: goal.row?.what ?? goalTitleOf(goal.goalRef), goal, rows: goal.children,
    }))
    const loose = view.unattached.filter(row => row.isGoal === undefined)
    const rest: Group[] = [
      { key: 'unattached', kind: 'unattached', title: '没挂目标', rows: loose.filter(row => row.direction !== 'mine') },
      { key: 'promised', kind: 'promised', title: '你答应别人的', rows: loose.filter(row => row.direction === 'mine') },
    ]
    return [...goals, ...rest.filter(group => group.rows.length > 0)]
  }
  const mine = lens === 'mine'
  const byPerson = new Map<string, BoardRowWire[]>()
  for (const row of work) {
    if (row.direction !== lens) continue
    const who = mine ? row.acceptor ?? '自己定的' : row.executorKind === 'agent' ? AGENT : row.who
    const bucket = byPerson.get(who) ?? []
    bucket.push(row)
    byPerson.set(who, bucket)
  }
  return [...byPerson.entries()].map(([who, rows]) => ({ key: `person:${who}`, kind: 'person' as const, title: who, rows }))
}

/**
 * 今天条上一个数按下去，落到哪一行 —— **每个数字都是门**。
 *
 * 那一行可能不在此刻的透镜里，或者躺在一个折起来的组里。计数读的是整本账，所以门要真的
 * 开：先把透镜调回「全部」、把那个组展开，再落过去。
 */
export function jumpTarget(
  view: BoardViewWire, lens: BoardLens, key: TodayKey, now: number = Date.now(),
): { readonly rowId: string; readonly lens: BoardLens; readonly groupKey?: string } | undefined {
  const row = view.rows.find(one => TODAY_OF[signalOf(one, now).key] === key)
  if (row === undefined) return undefined
  const landing: BoardLens = lens === 'all' || row.direction === lens ? lens : 'all'
  const group = groupsOf(view, landing).find(one => one.rows.some(candidate => candidate.id === row.id))
  return { rowId: row.id, lens: landing, ...(group === undefined ? {} : { groupKey: group.key }) }
}

const LENSES: readonly { id: BoardLens; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'owed-to-me', label: '欠我的' },
  { id: 'mine', label: '我欠的' },
]

export function YzjBoard(props: BoardProps): ReactNode {
  const { inject, commission, openSession, back, fromSessionId, restoreScroll } = props
  const [view, setView] = useState<BoardViewWire>(EMPTY)
  const [events, setEvents] = useState<BoardEventWire[]>([])
  /*
    透镜：从目标页 Back 回来时保留（那是同一次对账）；从左栏重新进来时回到「全部」——
    每次打开都该对得上整本账，而不是停在上次的角度里。
  */
  const [lens, setLensState] = useState<BoardLens>(() => (restoreScroll === undefined ? 'all' : currentBoardLens()))
  const setLens = useCallback((next: BoardLens): void => { setBoardLens(next); setLensState(next) }, [])
  /** 折叠起来的组；组头的计数折叠了也还在。 */
  const [shut, setShut] = useState<readonly string[]>([])
  /** 展开了「其余 N 件正常」/「已完成」的组。 */
  const [opened, setOpened] = useState<Readonly<Record<string, boolean>>>({})
  const [declaring, setDeclaring] = useState(false)
  const [portal, setPortal] = useState<Portal | undefined>(undefined)
  const [toast, setToast] = useState('')
  /** 「挂到目标…」：没挂目标那一组进入勾选。 */
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [busy, setBusy] = useState('')
  const [now, setNow] = useState(() => Date.now())
  /**
   * 右栏开不出来时（宿主在当前会话为空时不给开抽屉），来龙去脉停在这一屏自己的右边。
   * 选中一行必须有回应——「点了没反应」是最难被报告的那种坏。
   */
  const [docked, setDocked] = useState(false)
  const spotlight = useSyncExternalStore(subscribeSpotlight, currentSpotlight)
  const selected = spotlight?.kind === 'commitment' ? spotlight.id : undefined
  const staged = useSyncExternalStore(subscribeStaged, stagedNow)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollTop = useCallback((): number => bodyRef.current?.scrollTop ?? 0, [])

  /* 恢复滚动位置：等内容长够了再设，否则会被静静地钳到当时的最大值。 */
  const restored = useRef(false)
  useEffect(() => {
    if (restoreScroll === undefined || restored.current) return undefined
    const node = bodyRef.current
    if (node === null) return undefined
    let done = false
    let tick: ReturnType<typeof setTimeout> | undefined
    const attempt = (): void => {
      if (done) return
      if (node.scrollHeight - node.clientHeight >= restoreScroll) {
        node.scrollTop = restoreScroll
        restored.current = true
        done = true
        return
      }
      tick = setTimeout(attempt, 60)
    }
    attempt()
    const giveUp = setTimeout(() => { done = true }, 2_000)
    return () => {
      done = true
      if (tick !== undefined) clearTimeout(tick)
      clearTimeout(giveUp)
    }
  }, [restoreScroll])

  /** 同一个单调票号：过时的一次轮询不许重画。 */
  const fetchSeq = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    fetchSeq.current += 1
    const ticket = fetchSeq.current
    const next = await inject.board()
    if (ticket !== fetchSeq.current) return
    setView(next)
    setNow(Date.now())
  }, [inject])

  // 会前那一眼读平台的日程：独立的一次读，读不到就是没有，不拖住整块板。
  useEffect(() => { void inject.events().then(setEvents) }, [inject])
  useEffect(() => {
    let alive = true
    void refresh()
    const timer = setInterval(() => { if (alive) void refresh() }, 6_000)
    const off = subscribeLedger(() => { void refresh() })
    return () => { alive = false; clearInterval(timer); off() }
  }, [refresh])
  // 右栏里按了「转给别人」：选择条由这一屏开。
  useEffect(() => onPortalRequest((next) => { setPortal(next as Portal) }), [])
  useEffect(() => {
    if (toast === '') return undefined
    const timer = setTimeout(() => { setToast('') }, 5_000)
    return () => { clearTimeout(timer) }
  }, [toast])
  // 离开这一屏，右栏不再摆这里选中的那一条。
  useEffect(() => () => {
    if (currentSpotlight()?.kind === 'commitment') setSpotlight(undefined)
  }, [])

  const groups = useMemo(() => groupsOf(view, lens), [view, lens])
  const today = useMemo(() => todayOf(view.rows.filter(row => row.isGoal === undefined || row.goalRef !== undefined), now), [view.rows, now])
  const nextEvent = events.find(event => event.startAt === 0 || event.startAt + 60 * 60_000 > now)

  /** 选中一行：右栏摆它的来龙去脉。再点一次收起。 */
  const select = useCallback((row: BoardRowWire, intent?: 'reject'): void => {
    if (currentSpotlight()?.kind === 'commitment' && (currentSpotlight() as { id: string }).id === row.id && intent === undefined) {
      setSpotlight(undefined)
      return
    }
    setSpotlight({ kind: 'commitment', id: row.id, title: row.what, ...(intent === undefined ? {} : { intent }) })
    revealAside(() => { setDocked(true) })
  }, [])

  /** 催一下：带着拟稿去那条承诺所在的会话，话由你自己发。 */
  const nudge = useCallback((row: BoardRowWire): void => {
    if (row.sessionId === undefined) {
      setToast('这条登记时不在任何话题里——去跟对方直接说一声吧。')
      return
    }
    sendErrand({ subject: 'nudge', goalRef: row.goalRef ?? '', goalName: row.what, voice: 'place', seed: nudgeDraft(row) })
    openSession(row.sessionId)
  }, [openSession])

  /** 验收（或「当它交了」）：进 5 秒撤回窗，和卡上的回答同一扇门。 */
  const accept = useCallback((row: BoardRowWire, said: string): void => {
    stage({ kind: 'commitment', id: row.id, steps: [{ actionId: 'accept' }], said }, async () => {
      const result = await inject.cardAct('commitment', row.id, 'accept')
      if (result?.outcome !== 'applied') setToast(result?.receipt ?? '没验收上，再试一次。')
      void refresh()
    })
  }, [inject, refresh])

  /** 让云小助找找：说交了却没见到东西时，去它自己的话题里找交的那份。 */
  const look = useCallback((row: BoardRowWire): void => {
    const ask = `「${row.what}」${row.executorKind === 'agent' ? '' : row.who}说交了，但我没见到东西。帮我在这个话题里找找交的是什么、在哪——找不到也告诉我。`
    void commission(ask, row.sessionId).then((error) => { if (error !== undefined) setToast(error) })
  }, [commission])

  /** 今天条的一个数：落到那一类的第一行。它被折着、或在别的透镜里，就先把视野调过去。 */
  const jump = useCallback((key: TodayKey): void => {
    const target = jumpTarget(view, lens, key, now)
    if (target === undefined) return
    if (target.lens !== lens) setLens(target.lens)
    if (target.groupKey !== undefined) {
      const groupKey = target.groupKey
      // 今天条的几类都是默认摊开的那种；只要组没被折起来，那一行就在眼前。
      setShut(value => value.filter(one => one !== groupKey))
      setOpened(value => ({ ...value, quiet: true }))
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = bodyRef.current?.querySelector(`[data-row="${target.rowId}"]`)
        node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        node?.setAttribute('data-flash', '1')
        setTimeout(() => { node?.removeAttribute('data-flash') }, 1_400)
      })
    })
  }, [view, lens, now, setLens])

  /* J/K 在行间走，Enter 打开，Esc 收起右栏。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape' && currentSpotlight()?.kind === 'commitment') { setSpotlight(undefined); return }
      if (event.key !== 'j' && event.key !== 'k') return
      const rows = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
      if (rows.length === 0) return
      event.preventDefault()
      const at = rows.findIndex(node => node.dataset.row === selected)
      const next = rows[Math.min(rows.length - 1, Math.max(0, at < 0 ? 0 : at + (event.key === 'j' ? 1 : -1)))]
      const row = view.rows.find(one => one.id === next?.dataset.row)
      if (row === undefined || next === undefined) return
      setSpotlight({ kind: 'commitment', id: row.id, title: row.what })
      next.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [selected, view.rows])

  const goalOptions = view.goals.map(goal => ({ ref: goal.goalRef, label: goal.row?.what ?? goal.goalRef }))
  const linkPicked = (goalRef: string): void => {
    if (picked.length === 0) return
    setBusy('link')
    void inject.linkCommitments(goalRef, picked).then((result) => {
      setToast(result.error ?? `挂上了 ${String(result.linked ?? 0)} 条。`)
      setPicked([])
      setPicking(false)
      setBusy('')
      void refresh()
    })
  }

  const rowNode = (row: BoardRowWire, group: Group): ReactNode => {
    const signal = signalOf(row, now)
    const pending = staged.find(entry => entry.kind === 'commitment' && entry.id === row.id)
    const sub = [
      row.direction === 'owed-to-me'
        ? `${row.executorKind === 'agent' ? AGENT : row.who}欠你`
        : row.direction === 'mine'
          ? row.acceptor === undefined ? '你自己定的' : `你欠${row.acceptor}`
          : `${row.executorKind === 'agent' ? AGENT : row.who}${row.acceptor === undefined ? '' : ` → ${row.acceptor}`}`,
      row.placeName,
      // 透镜下目标退成行内标签：组头不再是它，可「这条为哪个目标」一跳还在。
      group.kind === 'person' && row.goalRef !== undefined
        ? view.goals.find(goal => goal.goalRef === row.goalRef)?.row?.what
        : undefined,
    ].filter((part): part is string => part !== undefined && part !== '')
    const verbs: ReactNode[] = []
    if (row.status === 'open' && row.mirror === undefined) {
      if (row.awaitingAcceptance === true && onMe(row)) {
        if (row.evidence === 'said') {
          verbs.push(<button type="button" key="look" className={css.verb} onClick={(event) => { event.stopPropagation(); look(row) }}>让{AGENT}找找</button>)
          verbs.push(<button type="button" key="take" className={css.verb} onClick={(event) => { event.stopPropagation(); accept(row, '你当它交了') }}>当它交了</button>)
        } else {
          verbs.push(<button type="button" key="ok" className={`${css.verb} ${css.verbGo}`} onClick={(event) => { event.stopPropagation(); accept(row, '你验收了') }}>验收</button>)
          verbs.push(<button type="button" key="no" className={css.verb} onClick={(event) => { event.stopPropagation(); select(row, 'reject') }}>打回…</button>)
        }
      } else if (row.direction === 'owed-to-me' && row.remindable && row.stewardedBy === undefined) {
        verbs.push(<button type="button" key="nudge" className={css.verb} onClick={(event) => { event.stopPropagation(); nudge(row) }}>催{row.executorKind === 'agent' ? '' : row.who}</button>)
      } else if (row.direction === 'mine' && row.sessionId !== undefined) {
        verbs.push(
          <button
            type="button"
            key="go"
            className={css.verb}
            onClick={(event) => {
              event.stopPropagation()
              landOn({ sessionId: row.sessionId as string, kind: 'commitment', id: row.id })
              openSession(row.sessionId as string)
            }}
          >
            去做
          </button>,
        )
      }
    }
    return (
      <div
        key={row.id}
        role="button"
        tabIndex={0}
        data-row={row.id}
        className={`${css.row} ${selected === row.id ? css.rowOn : ''} ${row.status !== 'open' ? css.rowDone : ''}`}
        onClick={() => { select(row) }}
        onKeyDown={(event) => { if (event.key === 'Enter') select(row) }}
      >
        {picking && group.kind === 'unattached' && (
          <input
            type="checkbox"
            className={css.pick}
            checked={picked.includes(row.id)}
            aria-label="选中，挂到目标"
            onClick={(event) => { event.stopPropagation() }}
            onChange={() => { setPicked(value => (value.includes(row.id) ? value.filter(id => id !== row.id) : [...value, row.id])) }}
          />
        )}
        {row.executorKind === 'agent'
          ? <AgentFace size={24} className={css.face} />
          : <Avatar name={row.who} className={css.avatar} photoClassName={css.photo} />}
        <span className={css.main}>
          <span className={css.what}>{row.what}</span>
          <span className={css.sub}>{sub.join(' · ')}</span>
        </span>
        {pending !== undefined
          ? (
            <span className={css.pending}>
              {pending.said} · {Math.max(1, Math.ceil((pending.deadline - Date.now()) / 1000))} 秒后生效
              <button type="button" className={css.verb} onClick={(event) => { event.stopPropagation(); undo({ kind: 'commitment', id: row.id }) }}>撤回 <kbd className={css.kbd}>Z</kbd></button>
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

  const groupNode = (group: Group): ReactNode => {
    const closed = shut.includes(group.key)
    const open = group.rows.filter(row => row.status === 'open')
    const unusual = open.filter(row => UNUSUAL.has(signalOf(row, now).key))
    const normal = open.filter(row => !UNUSUAL.has(signalOf(row, now).key))
    const done = group.rows.filter(row => row.status !== 'open')
    const late = open.filter(row => row.overdue).length
    const toggle = (key: string): void => { setOpened(value => ({ ...value, [key]: value[key] !== true })) }
    return (
      <section className={css.group} key={group.key}>
        <div className={css.groupHead}>
          <button
            type="button"
            className={css.chev}
            aria-label={closed ? '展开' : '折叠'}
            onClick={() => { setShut(value => (closed ? value.filter(one => one !== group.key) : [...value, group.key])) }}
          >
            <Icon name={closed ? 'chevR' : 'chevD'} size={14} />
          </button>
          {group.kind === 'goal'
            ? (
              <button
                type="button"
                className={css.groupTitleLink}
                title="打开这个目标"
                onClick={() => {
                  pushFrame({ kind: 'goal', goalRef: group.goal?.goalRef ?? '', goalName: group.title }, scrollTop())
                }}
              >
                <Icon name="target" size={14} className={css.groupIcon} />
                {group.title}
                <Icon name="chevR" size={12} className={css.groupGo} />
              </button>
            )
            : group.kind === 'person'
              ? (
                <span className={css.groupTitle}>
                  {group.title === AGENT
                    ? <AgentFace size={20} className={css.faceSmall} />
                    : group.title === '自己定的' ? null : <Avatar name={group.title} className={css.avatarSmall} photoClassName={css.photo} />}
                  {group.title}
                </span>
              )
              : <span className={css.groupTitle}>{group.title}</span>}
          <span className={css.groupMeta}>
            {group.kind === 'goal' && group.rows.length === 0 ? '还没挂活' : `${String(open.length)} 件在跟`}
            {late > 0 && <b className={css.groupLate}> · {late} 逾期</b>}
          </span>
          {group.kind === 'unattached' && !picking && goalOptions.length > 0 && (
            <button type="button" className={css.groupAct} onClick={() => { setPicking(true) }}>挂到目标…</button>
          )}
        </div>
        {!closed && (
          <div className={css.rows}>
            {unusual.map(row => rowNode(row, group))}
            {normal.length > 0 && (opened[`n:${group.key}`] === true || unusual.length === 0)
              ? normal.map(row => rowNode(row, group))
              : normal.length > 0 && (
                <button type="button" className={css.fold} onClick={() => { toggle(`n:${group.key}`) }}>
                  其余 {normal.length} 件正常 <Icon name="chevD" size={12} />
                </button>
              )}
            {done.length > 0 && (
              opened[`d:${group.key}`] === true
                ? <>
                  {done.map(row => rowNode(row, group))}
                  <button type="button" className={css.fold} onClick={() => { toggle(`d:${group.key}`) }}>收起已完成</button>
                </>
                : (
                  <button type="button" className={css.fold} onClick={() => { toggle(`d:${group.key}`) }}>
                    已完成 {done.length} <Icon name="chevD" size={12} />
                  </button>
                )
            )}
            {picking && group.kind === 'unattached' && (
              <div className={css.batch}>
                <span>选了 {picked.length} 条，挂到</span>
                {goalOptions.map(option => (
                  <button
                    type="button"
                    key={option.ref}
                    className={css.batchBtn}
                    disabled={picked.length === 0 || busy === 'link'}
                    onClick={() => { linkPicked(option.ref) }}
                  >
                    {option.label}
                  </button>
                ))}
                <button type="button" className={css.verb} onClick={() => { setPicking(false); setPicked([]) }}>算了</button>
              </div>
            )}
          </div>
        )}
      </section>
    )
  }

  const totalOpen = view.rows.filter(row => row.status === 'open' && row.isGoal === undefined).length
  const inLens = groups.reduce((sum, group) => sum + group.rows.length, 0)

  return (
    <div className={`${tokens.tokens} ${css.board}`}>
      <div className={css.head}>
        <button type="button" className={css.back} onClick={back}><Icon name="chevL" size={14} />会话</button>
        <span className={css.headRule} />
        <span className={css.title}>承诺</span>
        <div className={css.lenses} role="tablist">
          {LENSES.map(item => (
            <button
              type="button"
              role="tab"
              aria-selected={lens === item.id}
              key={item.id}
              className={`${css.lens} ${lens === item.id ? css.lensOn : ''}`}
              onClick={() => { setLens(item.id) }}
            >
              {item.label}
            </button>
          ))}
          {view.judgEntry === true && (
            <button
              type="button"
              role="tab"
              aria-selected={false}
              className={`${css.lens} ${css.lensPrivate}`}
              title="你签过的判断，和后来发生的事——只有你看得到"
              onClick={() => { pushFrame({ kind: 'judg' }, scrollTop()) }}
            >
              <Icon name="lock" size={12} />我定过的
              {view.judgMorning !== undefined && view.judgMorning > 0 && <span className={css.lensCount}>{view.judgMorning}</span>}
            </button>
          )}
        </div>
        <button type="button" className={css.declare} onClick={() => { setDeclaring(true) }}>
          <Icon name="plus" size={14} />新目标
        </button>
      </div>

      {(today.late + today.wait + today.said + today.quiet > 0 || nextEvent !== undefined) && (
        <div className={css.today}>
          {(['late', 'wait', 'said', 'quiet'] as const).filter(key => today[key] > 0).map(key => (
            <button type="button" key={key} className={`${css.chip} ${css[`chip_${key}`] ?? ''}`} onClick={() => { jump(key) }}>
              {TODAY_LABEL[key](today[key])}
            </button>
          ))}
          {nextEvent !== undefined && (
            <button
              type="button"
              className={`${css.chip} ${css.chipEvent}`}
              title="看这场会挂了哪几件活、材料在不在"
              onClick={() => {
                setSpotlight({ kind: 'event', eventId: nextEvent.eventId, title: nextEvent.title })
                revealAside(() => { setToast('右栏没能打开——窗口太窄。拉宽一点再点。') })
              }}
            >
              <Icon name="calendar" size={13} />
              {nextEvent.startAt === 0 ? '' : `${new Date(nextEvent.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} `}
              {nextEvent.title} · {nextEvent.readinessLine}
              {events.length > 1 && <span className={css.chipMore}>还有 {events.length - 1} 场</span>}
              <Icon name="chevR" size={12} />
            </button>
          )}
        </div>
      )}

      {view.mirrorNote !== undefined && <div className={css.note}>{view.mirrorNote}</div>}

      <div className={css.split}>
      <div className={css.body} ref={bodyRef}>
        {totalOpen === 0 && view.goals.length === 0
          ? (
            <div className={css.empty}>
              <AgentFace size={40} />
              <div className={css.emptyTitle}>还没有承诺</div>
              <div className={css.emptyText}>在群里说「张锐周五前给结论」，或者让{AGENT}登记一条，这里就会有。</div>
            </div>
          )
          : inLens === 0 && lens !== 'all'
            ? <div className={css.calm}>{lens === 'mine' ? '你没有欠谁的。' : '没有人欠你的。'}</div>
            : (
              <>
                {groups.filter(isLive).map(groupNode)}
                {groups.some(group => !isLive(group)) && (
                  opened.quiet === true
                    ? groups.filter(group => !isLive(group)).map(groupNode)
                    : (
                      <button type="button" className={css.foldGroups} onClick={() => { setOpened(value => ({ ...value, quiet: true })) }}>
                        其余 {groups.filter(group => !isLive(group)).length} {lens === 'all' ? '组' : '人'}没有在跟的 <Icon name="chevD" size={12} />
                      </button>
                    )
                )}
              </>
            )}
      </div>
      {docked && spotlight?.kind === 'commitment' && (
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
      )}
      </div>

      {declaring && (
        <DeclareGoal
          inject={inject}
          openSession={openSession}
          {...(fromSessionId === undefined ? {} : { fromSessionId })}
          close={() => { setDeclaring(false) }}
          done={(message) => { setToast(message); setDeclaring(false); void refresh() }}
        />
      )}
      {portal !== undefined && (
        <RoomPicker
          portal={portal}
          inject={inject}
          close={() => { setPortal(undefined) }}
          go={(landing, choice) => { setPortal(undefined); landPortal(portal, landing, choice, openSession) }}
        />
      )}
      {toast !== '' && <div className={css.toast}>{toast}</div>}
    </div>
  )
}
