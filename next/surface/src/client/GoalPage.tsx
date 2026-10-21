/**
 * 目标页 —— 承诺页放大一级 (界面重设计 §5.5).
 *
 * 人打开一个目标想知道三件事：它要什么（标准）、走到哪了（一行事实 + 底下的活）、
 * 现在要我做什么（最多一条提示、三个动词、要你的指针）。所以从上到下只有这些：
 *
 *   眉行 · 标题 · 怎么算完成 · 一行事实 · 最多一条提示 · [交给…] [拆解] [评估进度]
 *   要你（只放指针）· 执行（和承诺页同一行，默认只摊开不对劲的）· 产出（带出处）
 *
 * 这一页上没有一个字段是存下来的：负责人与期限来自那条登记，计数来自底下的承诺，
 * 「多久没动静」来自图上最后一笔。它显得停滞，是因为底下真的没动。
 *
 * 动词按主权渲染：目标不归你管，就只剩「问」——问不是动作。每个动词在云之家里都有
 * 兜底说法；只能在这一页做到的事，就是不该存在的事。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BoardRowWire, GoalPageWire, SurfaceInject } from './rpc.ts'
import { FRAME_SCROLL, backLabel, backTarget, landOn, onPortalRequest, sendErrand, subscribeLedger } from './store.ts'
import { useRestoreScroll } from './scroll.ts'
import { RoomPicker, landPortal, type Portal } from './RoomPicker.tsx'
import {
  assessAsk, breakdownAsk, delegateSeed, gapSeed, goalQuestionSeed, rebaseAsk,
} from './commission.ts'
import { RepairVerbs, type Repair } from './RepairVerbs.tsx'
import { safeHref } from './preview.ts'
import { ArtifactCard } from './ArtifactCard.tsx'
import { artifactRefOf } from './artifacts.ts'
import { LedgerRow, StoryDock, useLedger, useRowKeys } from './LedgerRow.tsx'
import { useBackKey } from './keys.ts'
import { usePoll } from './poll.ts'
import { UNUSUAL, goalTitleOf, rowSub, signalOf } from './ledger.ts'
import { Icon } from './icons.tsx'
import { AGENT } from './words.ts'
import { UnreadLine } from './Unread.tsx'
import tokens from './tokens.module.css'
import rows from './ledger.module.css'
import css from './goal.module.css'

export interface GoalPageProps {
  goalRef: string
  goalName: string
  inject: SurfaceInject
  /**
   * 把一句话交给云小助 —— 拆解、评估是**按钮形态的那句话**：落点只有一个（你和它的
   * 私语），所以不问去哪说。给了 `sessionId` 就说在那个会话里。返回一句话 = 没送出去。
   */
  commission(text: string, sessionId?: string): Promise<string | undefined>
  /** 你从哪个会话来的 —— 「问云小助这个目标」落在那儿：问要进会话日志，不是页面旁路。 */
  deskSessionId?: string
  openSession(sessionId: string): void
  /** 回来路（多半是承诺页），回到离开时的那个位置。 */
  back(): void
  /** 从这一页钻出去又弹回来：离开时滚到了哪儿。 */
  restoreScroll?: number
}

/** 「多久以前」的粗说法：只到天。 */
function daysAgo(days: number): string {
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${String(days)} 天前`
}

const DAY_MS = 24 * 60 * 60_000

/**
 * 这一页此刻最该说的那一句 —— **最多一条**，按轻重：目标结束了底下还在跑 › 标准改过、
 * 上次评估照的是旧版 › 云之家那篇很久没对账 › 底下停摆了。说多了，哪一句都没人看。
 */
export type GoalHint =
  | { readonly kind: 'retired'; readonly open: number; readonly how: '完成' | '作废' }
  | { readonly kind: 'drifted'; readonly text: string }
  | { readonly kind: 'silent'; readonly days: number }
  | { readonly kind: 'stalled'; readonly days?: number }

export function goalHintOf(view: GoalPageWire, now: number = Date.now()): GoalHint | undefined {
  const { goal, retired, pulse, staleDays } = view
  const open = goal.children.filter(child => child.status === 'open').length
  if (retired && open > 0) return { kind: 'retired', open, how: goal.row?.status === 'voided' ? '作废' : '完成' }
  if (retired) return undefined
  if (goal.criteriaDrifted === true) {
    return {
      kind: 'drifted',
      text: goal.truthChanged === undefined
        ? '完成标准改过了，上次的评估是照旧版写的。'
        : `${goal.truthChanged.detail}（${daysAgo(Math.floor((now - goal.truthChanged.at) / DAY_MS))}发现）——上次的评估是照旧版写的。`,
    }
  }
  if ((goal.truthSilentDays ?? 0) >= 7) return { kind: 'silent', days: goal.truthSilentDays ?? 7 }
  if (pulse === 'stalled') return { kind: 'stalled', ...(staleDays === undefined ? {} : { days: staleDays }) }
  return undefined
}

/** 一行事实：截止 · 在跟 · 逾期 · 最近动静。 */
export function goalFacts(view: GoalPageWire): readonly { readonly text: string; readonly late?: boolean }[] {
  const { goal, staleDays } = view
  const facts: { text: string; late?: boolean }[] = []
  if (goal.row?.due !== undefined) facts.push({ text: `截止 ${goal.row.due.text}`, ...(goal.row.overdue && !view.retired ? { late: true } : {}) })
  facts.push({ text: goal.counts.open + goal.counts.settled === 0 ? '还没挂活' : `${String(goal.counts.open)} 在跟` })
  if (goal.counts.overdue > 0) facts.push({ text: `${String(goal.counts.overdue)} 逾期`, late: true })
  if (goal.counts.settled > 0) facts.push({ text: `${String(goal.counts.settled)} 已结束` })
  if (staleDays !== undefined) facts.push({ text: `最近动静 ${daysAgo(staleDays)}` })
  return facts
}

export function YzjGoalPage(props: GoalPageProps): ReactNode {
  const { goalRef, goalName, inject, commission, deskSessionId, openSession, back, restoreScroll } = props
  const [view, setView] = useState<GoalPageWire | undefined>(undefined)
  /** 宿主答「没有这个目标」时它的原话；没读到不算（读不到 ≠ 没有）。 */
  const [missing, setMissing] = useState<string | undefined>(undefined)
  const [unread, setUnread] = useState(false)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [repair, setRepair] = useState<Repair | undefined>(undefined)
  const [field, setField] = useState('')
  const [portal, setPortal] = useState<Portal | undefined>(undefined)
  const [menu, setMenu] = useState(false)
  /** 目标结束了、底下还在跑：「全部作废」的第二下。举起来的手会放下。 */
  const [armed, setArmed] = useState(false)
  const [opened, setOpened] = useState<Readonly<Record<string, boolean>>>({})
  const [now, setNow] = useState(() => Date.now())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  useRestoreScroll(bodyRef, view === undefined ? undefined : restoreScroll)

  const fetchSeq = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    fetchSeq.current += 1
    const ticket = fetchSeq.current
    const next = await inject.goalPage(goalRef)
    if (ticket !== fetchSeq.current) return
    setNow(Date.now())
    setUnread('unread' in next)
    if ('unread' in next) return
    if ('refused' in next) {
      setMissing(next.refused)
      setView(undefined)
      return
    }
    setMissing(undefined)
    setView(next.value)
  }, [inject, goalRef])

  usePoll(refresh)
  useEffect(() => subscribeLedger(() => { void refresh() }), [refresh])
  // 右栏里按了「转给别人」「拆一部分出去」：选择条由这一屏开。
  useEffect(() => onPortalRequest((next) => { setPortal(next as Portal) }), [])
  useEffect(() => {
    if (toast === '') return undefined
    const timer = setTimeout(() => { setToast('') }, 5_000)
    return () => { clearTimeout(timer) }
  }, [toast])
  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => { setArmed(false) }, 8_000)
    return () => { clearTimeout(timer) }
  }, [armed])
  useEffect(() => {
    if (!menu) return undefined
    const shut = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      setMenu(false)
    }
    window.addEventListener('pointerdown', shut)
    window.addEventListener('keydown', shut)
    return () => { window.removeEventListener('pointerdown', shut); window.removeEventListener('keydown', shut) }
  }, [menu])

  const children = useMemo(() => view?.goal.children ?? [], [view])
  const { spotlight, selected, docked, staged, actions } = useLedger({ inject, commission, openSession, refresh, say: setToast })
  useRowKeys(bodyRef, children, selected)
  useBackKey(back)

  /** 拆解、评估：按下就是对云小助说了那句话。没送出去才出声。 */
  const say = useCallback((key: string, text: string): void => {
    setBusy(key)
    void commission(text).then((error) => {
      setBusy('')
      if (error !== undefined) setToast(error)
    })
  }, [commission])

  const run = useCallback((key: string, work: Promise<{ error?: string }>, done: string): void => {
    setBusy(key)
    void work.then((result) => {
      setToast(result.error ?? done)
      setBusy('')
      if (result.error === undefined) { setRepair(undefined); setField('') }
      void refresh()
    })
  }, [refresh])

  const head = (more?: ReactNode): ReactNode => (
    <div className={css.head}>
      <button type="button" className={css.back} onClick={back}><Icon name="chevL" size={14} />{backLabel(backTarget() ?? { kind: 'board' })}</button>
      {more}
    </div>
  )

  if (view === undefined) {
    return (
      <div className={`${tokens.tokens} ${css.page}`}>
        {head()}
        {unread && <UnreadLine had={false} />}
        <div className={css.body}>
          {missing !== undefined
            ? <div className={css.calm}>这个目标已经不在了——可能被作废了，或者被移走了。</div>
            : !unread && (
              <div className={css.skeleton} aria-label="正在读">
                <span className={css.boneShort} />
                <span className={css.boneTitle} />
                <span className={css.boneBox} />
                <span className={css.bone} />
                <span className={css.bone} />
              </div>
            )}
        </div>
      </div>
    )
  }

  const { goal, decisions, retired, mySlice } = view
  // 进来时带的名字可能只是那条链接（右栏从判例点过来）：链接不当标题。
  const name = goal.row?.what ?? goal.name ?? (goalName === goalRef || goalName === '' ? goalTitleOf(goalRef) : goalName)
  const href = safeHref(goalRef)
  const mine = goal.row?.stewardedBy === undefined
  const hint = goalHintOf(view, now)
  const facts = goalFacts(view)
  const stillOpen = children.filter(child => child.status === 'open')

  /* 执行：我执行的、我交出去的排在前面——是排列，不是过滤。 */
  const sliced = [
    ...children.filter(child => mySlice.includes(child.id)),
    ...children.filter(child => !mySlice.includes(child.id)),
  ]
  const live = sliced.filter(row => row.status === 'open')
  const unusual = live.filter(row => UNUSUAL.has(signalOf(row, now).key))
  const normal = live.filter(row => !UNUSUAL.has(signalOf(row, now).key))
  const done = sliced.filter(row => row.status !== 'open')

  const rowNode = (row: BoardRowWire): ReactNode => {
    const pending = staged.find(entry => entry.kind === 'commitment' && entry.id === row.id)
    return (
      <LedgerRow
        key={row.id}
        row={row}
        sub={rowSub(row)}
        now={now}
        selected={selected === row.id}
        {...(pending === undefined ? {} : { pending })}
        actions={actions}
      />
    )
  }

  /** 交给…：先问谁来做，再问在哪儿说——当着全组说和私下说，是你的社交决定。 */
  const delegate = (seed: string, title = '交给谁？'): void => {
    setPortal({ subject: 'goal', goalRef, goalName: name, voice: 'place', seed, pick: 'executor', title })
  }

  const assessLead = hint?.kind === 'silent'
  const verdicts = goal.assessment?.lines ?? []
  const tally = (['met', 'partial', 'missing'] as const)
    .map(key => ({ key, n: verdicts.filter(line => line.verdict === key).length }))
    .filter(item => item.n > 0)

  return (
    <div className={`${tokens.tokens} ${css.page}`}>
      {head(
        <span className={css.menuWrap}>
          <button
            type="button"
            className={css.more}
            aria-label="更多"
            aria-expanded={menu}
            onPointerDown={(event) => { event.stopPropagation() }}
            onClick={() => { setMenu(value => !value) }}
          >
            <Icon name="more" size={16} />
          </button>
          {menu && (
            <div className={css.menu} role="menu" onPointerDown={(event) => { event.stopPropagation() }}>
              <button
                type="button"
                role="menuitem"
                className={css.menuItem}
                onClick={() => {
                  setMenu(false)
                  if (deskSessionId === undefined) { setToast('先从左边打开一个会话——问的话要落在会话里。'); return }
                  sendErrand({ subject: 'goal', goalRef, goalName: name, voice: 'ask', seed: goalQuestionSeed(name) })
                  openSession(deskSessionId)
                }}
              >
                问{AGENT}这个目标
              </button>
              {mine && !retired && goal.row !== undefined && (
                <button
                  type="button"
                  role="menuitem"
                  className={`${css.menuItem} ${css.menuDanger}`}
                  onClick={() => {
                    setMenu(false)
                    const row = goal.row as BoardRowWire
                    setRepair({ kind: 'void', row: { id: row.id, what: row.what, status: row.status, isGoal: goalRef, ...(row.due === undefined ? {} : { due: row.due }) } })
                    setField('')
                  }}
                >
                  作废这个目标…
                </button>
              )}
            </div>
          )}
        </span>
      )}
      {unread && <UnreadLine had />}
      <div className={rows.split}>
        <div className={css.body} ref={bodyRef} {...{ [FRAME_SCROLL]: '' }}>
          <div className={css.column}>
            {/* ——— 眉行 · 标题 · 怎么算完成 · 一行事实 ——— */}
            <div className={css.eyebrow}>
              <Icon name="target" size={13} />
              <span>目标</span>
              {goal.row?.who !== undefined && <span>· {goal.row.who}负责</span>}
              {retired && <span className={css.retired}>· 已{goal.row?.status === 'voided' ? '作废' : '完成'}</span>}
            </div>
            <h1 className={css.title}>{name}</h1>
            {goal.criteria !== undefined && (
              <div className={css.criteria}>
                <span className={css.criteriaLabel}>完成标准</span>
                <span className={css.criteriaText}>{goal.criteria}</span>
              </div>
            )}
            <div className={css.facts}>
              {facts.map((fact, index) => (
                <span key={fact.text} className={fact.late === true ? css.late : undefined}>
                  {index > 0 && <span className={css.dotSep}>·</span>}
                  {fact.text}
                </span>
              ))}
              {href !== undefined && (
                <a className={css.open} href={href} target="_blank" rel="noreferrer noopener">
                  在云之家打开<Icon name="ext" size={12} />
                </a>
              )}
            </div>

            {/* ——— 最多一条提示 ——— */}
            {hint !== undefined && (
              <div className={css.hint}>
                {hint.kind === 'retired' && (
                  <>
                    <span className={css.hintText}>
                      目标已经{hint.how}了，底下还有 {hint.open} 条在跟——做完、改挂，还是一起停掉，你定。
                    </span>
                    <span className={css.hintActs}>
                      <button
                        type="button"
                        className={`${css.btn} ${armed ? css.btnDanger : ''}`}
                        disabled={busy === 'cascade'}
                        onClick={() => {
                          if (!armed) { setArmed(true); return }
                          setArmed(false)
                          run(
                            'cascade',
                            Promise.all(stillOpen.map(child => inject.voidCommitment(child.id, '目标结束了')))
                              .then(results => results.find(result => result.error !== undefined) ?? {}),
                            `这 ${String(stillOpen.length)} 条一起作废了。`,
                          )
                        }}
                      >
                        {armed ? `确认作废这 ${String(stillOpen.length)} 条？收不回来` : '全部作废…'}
                      </button>
                      <button
                        type="button"
                        className={css.btn}
                        disabled={busy === 'cascade'}
                        onClick={() => {
                          run('cascade', inject.unlinkCommitments(stillOpen.map(child => child.id)), `这 ${String(stillOpen.length)} 条不挂这个目标了，在「没挂目标」里等你改挂。`)
                        }}
                      >
                        全部不挂了
                      </button>
                    </span>
                  </>
                )}
                {hint.kind === 'drifted' && (
                  <>
                    <span className={css.hintText}>{hint.text}</span>
                    {mine && (
                      <span className={css.hintActs}>
                        <button type="button" className={css.btn} disabled={busy === 'rebase'} onClick={() => { say('rebase', rebaseAsk(name, goalRef)) }}>
                          重新评估
                        </button>
                      </span>
                    )}
                  </>
                )}
                {hint.kind === 'silent' && (
                  <span className={css.hintText}>
                    云之家那篇已经 {hint.days} 天没更新进展了——组里的人看不到这里的动静。
                  </span>
                )}
                {hint.kind === 'stalled' && (
                  <span className={css.hintText}>
                    底下的事都在等别人{hint.days === undefined ? '' : `，${String(hint.days)} 天没有新动静`}。
                  </span>
                )}
              </div>
            )}

            {/* ——— 三个动词 ——— */}
            {(!retired || !mine) && (
            <div className={css.acts}>
              {mine && !retired && (
                <>
                  <button type="button" className={`${css.btn} ${assessLead ? '' : css.btnGo}`} onClick={() => { delegate(delegateSeed(name)) }}>
                    交给…
                  </button>
                  <button
                    type="button"
                    className={css.btn}
                    disabled={busy === 'breakdown'}
                    title={`${AGENT}先读正文和完成标准，再递一份逐条可定的拆法；每条都要你点头`}
                    onClick={() => { say('breakdown', breakdownAsk(name, goalRef)) }}
                  >
                    拆解
                  </button>
                  <button
                    type="button"
                    className={`${css.btn} ${assessLead ? css.btnGo : ''}`}
                    disabled={busy === 'assess'}
                    title={`${AGENT}对着完成标准逐条看一遍，写一份差距；验收还是你来`}
                    onClick={() => { say('assess', assessAsk(name, goalRef)) }}
                  >
                    评估进度
                  </button>
                </>
              )}
              {!mine && <span className={css.dim}>这个目标归{goal.row?.stewardedBy}管——交给谁、怎么拆、评不评估，是{goal.row?.stewardedBy}的事。</span>}
            </div>
            )}
            {repair !== undefined && (
              <RepairVerbs
                repair={repair}
                siblings={[]}
                inject={inject}
                busy={busy !== ''}
                field={field}
                setField={setField}
                cascadeOpen={stillOpen.length}
                close={() => { setRepair(undefined) }}
                run={run}
              />
            )}

            {/* ——— 要你：只放指针 ——— */}
            {decisions.length > 0 && (
              <section className={css.block}>
                <div className={css.label}>要你 <span className={css.count}>{decisions.length}</span></div>
                {decisions.map(item => (
                  <button
                    type="button"
                    className={css.pointer}
                    key={`${item.sessionId}:${item.cardRef?.kind ?? ''}:${item.cardRef?.id ?? ''}`}
                    onClick={() => {
                      landOn(item.cardRef === undefined ? undefined : { sessionId: item.sessionId, ...item.cardRef })
                      openSession(item.sessionId)
                    }}
                  >
                    <span className={css.needDot} />
                    <span className={css.pointerText}>
                      <span className={css.pointerLine}>
                        <b className={css.pointerVerb}>{item.demand?.verb ?? item.badge}</b>
                        {item.demand?.label ?? item.title}
                      </span>
                      <span className={css.pointerSub}>{item.placeName}</span>
                    </span>
                    <Icon name="chevR" size={14} className={css.pointerGo} />
                  </button>
                ))}
              </section>
            )}

            {/* ——— 执行 ——— */}
            <section className={css.block}>
              <div className={css.label}>
                执行
                {live.length > 0 && <span className={css.count}>{live.length} 在跟</span>}
              </div>
              {children.length === 0
                ? <div className={css.calm}>还没有活挂在这个目标下。交给谁，或者让{AGENT}先拆一版。</div>
                : (
                  <div className={css.rows}>
                    {unusual.map(rowNode)}
                    {normal.length > 0 && (opened.normal === true || unusual.length === 0)
                      ? normal.map(rowNode)
                      : normal.length > 0 && (
                        <button type="button" className={rows.fold} onClick={() => { setOpened(value => ({ ...value, normal: true })) }}>
                          其余 {normal.length} 件正常 <Icon name="chevD" size={12} />
                        </button>
                      )}
                    {done.length > 0 && (
                      opened.done === true
                        ? <>
                          {done.map(rowNode)}
                          <button type="button" className={rows.fold} onClick={() => { setOpened(value => ({ ...value, done: false })) }}>收起已结束</button>
                        </>
                        : (
                          <button type="button" className={rows.fold} onClick={() => { setOpened(value => ({ ...value, done: true })) }}>
                            已结束 {done.length} <Icon name="chevD" size={12} />
                          </button>
                        )
                    )}
                  </div>
                )}
            </section>

            {/* ——— 产出：带出处 ——— */}
            <section className={css.block}>
              <div className={css.label}>
                产出
                {goal.artifacts.length > 0 && <span className={css.count}>{goal.artifacts.length}</span>}
              </div>
              {goal.artifacts.length === 0
                ? <div className={css.calm}>底下的活还没留下东西。</div>
                : (
                  <div className={css.artifacts}>
                    {goal.artifacts.map(artifact => (
                      <ArtifactCard
                        key={artifact.uri}
                        dense
                        artifact={artifactRefOf({
                          uri: artifact.uri,
                          title: artifact.title,
                          ...(artifact.from === undefined ? {} : { from: artifact.from }),
                          marks: [artifact.shared === true
                            ? { label: '共用话题', why: '这个话题同时在为不止一个目标干活，说不准这份归哪个' }
                            : undefined],
                        })}
                      />
                    ))}
                  </div>
                )}
            </section>

            {/* ——— 最近一次评估：结论只在人按下评估之后才有 ——— */}
            {goal.assessment !== undefined && (
              <section className={css.block}>
                <button
                  type="button"
                  className={css.reportHead}
                  aria-expanded={opened.report === true}
                  onClick={() => { setOpened(value => ({ ...value, report: value.report !== true })) }}
                >
                  <Icon name={opened.report === true ? 'chevD' : 'chevR'} size={12} />
                  <span className={css.label}>最近一次评估</span>
                  <span className={css.count}>{daysAgo(Math.floor((now - goal.assessment.at) / DAY_MS))}</span>
                  <span className={css.tally}>
                    {tally.map(item => (
                      <span key={item.key}>{item.key === 'met' ? '✓' : item.key === 'partial' ? '◐' : '✗'} {item.n}</span>
                    ))}
                  </span>
                </button>
                <div className={css.reportSummary}>{goal.assessment.summary}</div>
                {goal.assessment.status === 'open' && goal.assessment.sessionId !== undefined && (
                  <button
                    type="button"
                    className={css.pointer}
                    onClick={() => {
                      const sessionId = goal.assessment?.sessionId as string
                      landOn({ sessionId, kind: 'assessment', id: goal.assessment?.id as string })
                      openSession(sessionId)
                    }}
                  >
                    <span className={css.needDot} />
                    <span className={css.pointerText}><span className={css.pointerLine}><b className={css.pointerVerb}>验收</b>这份评估</span></span>
                    <Icon name="chevR" size={14} className={css.pointerGo} />
                  </button>
                )}
                {opened.report === true && (
                  <ul className={css.lines}>
                    {verdicts.map(line => (
                      <li className={css.line} key={line.criterion}>
                        <span className={`${css.verdict} ${line.verdict === 'missing' ? css.verdictMissing : ''}`}>
                          {line.verdict === 'met' ? '✓' : line.verdict === 'partial' ? '◐' : '✗'}
                        </span>
                        <span className={css.lineText}>
                          {line.criterion}
                          <span className={css.lineWhy}>{line.evidence}</span>
                        </span>
                        {line.verdict !== 'met' && mine && !retired && (
                          <button
                            type="button"
                            className={css.ghost}
                            onClick={() => { delegate(gapSeed(name, line.criterion), '这条差距交给谁？') }}
                          >
                            交给…
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </div>
        <StoryDock spotlight={spotlight} docked={docked} inject={inject} openSession={openSession} />
      </div>

      {portal !== undefined && (
        <RoomPicker
          portal={portal}
          inject={inject}
          close={() => { setPortal(undefined) }}
          go={(landing, choice) => { setPortal(undefined); landPortal(portal, landing, choice, openSession) }}
        />
      )}
      {toast !== '' && <div className={rows.toast}>{toast}</div>}
    </div>
  )
}
