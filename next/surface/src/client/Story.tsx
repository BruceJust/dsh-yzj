/**
 * 来龙去脉 —— 选中板上一行时，右栏摆的东西 (界面重设计 §5.4 · 律六).
 *
 * 从上到下回答四个问题：这条现在怎样（头）、怎么来的（原话、谁、何时、在哪）、之后发生
 * 了什么（每一笔带证据档：绿 = 有东西或平台记了，琥珀 = 只有一句话）、挂在哪。最后是
 * 全站唯一那一组修理动词——只给这条的主人；不是你的，就说该去找谁。
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { CommitmentStoryWire, SurfaceInject } from './rpc.ts'
import {
  landOn, ledgerChanged, pushFrame, requestPortal, sendErrand, setFrame, setSpotlight, subscribeLedger,
} from './store.ts'
import { RepairVerbs, type Repair } from './RepairVerbs.tsx'
import { handoffPortal } from './RoomPicker.tsx'
import { delegateSeed } from './commission.ts'
import { stage, stagedNow, subscribeStaged, undo } from './answers.ts'
import { nudgeDraft } from './ledger.ts'
import { safeHref } from './preview.ts'
import { usePoll } from './poll.ts'
import { Icon } from './icons.tsx'
import { AGENT, whenOf } from './words.ts'
import css from './story.module.css'

const DAY_MS = 24 * 60 * 60_000

/** 头一行：谁欠谁 · 原话期限 · 逾期几天。 */
export function storyHead(story: CommitmentStoryWire): string {
  const who = story.executorKind === 'agent' ? AGENT : story.who
  const owe = story.direction === 'owed-to-me'
    ? `${who}欠你`
    : story.direction === 'mine'
      ? story.acceptor === undefined ? '你自己定的' : `你欠${story.acceptor}`
      : `${who}${story.acceptor === undefined ? '' : `欠${story.acceptor}`}`
  return [
    owe,
    story.due === undefined ? '没说期限' : `原话「${story.due.text}」`,
    story.status !== 'open'
      ? undefined
      : story.overdueDays !== undefined ? `逾期 ${String(story.overdueDays)} 天` : undefined,
  ].filter((part): part is string => part !== undefined).join(' · ')
}

export function CommitmentStoryPanel(props: {
  id: string
  title: string
  intent?: 'reject'
  inject: SurfaceInject
  close(): void
  openSession?(sessionId: string): void
}): ReactNode {
  const { id, title, intent, inject, close, openSession } = props
  const [story, setStory] = useState<CommitmentStoryWire | undefined | null>(null)
  const [repair, setRepair] = useState<Repair | undefined>(undefined)
  const [field, setField] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(intent === 'reject')
  const [reason, setReason] = useState('')
  const [fixing, setFixing] = useState(false)
  const staged = useSyncExternalStore(subscribeStaged, stagedNow)
  const pending = staged.find(entry => entry.kind === 'commitment' && entry.id === id)

  const load = useCallback(async (): Promise<void> => {
    setStory(await inject.commitmentStory(id))
  }, [inject, id])
  usePoll(load)
  useEffect(() => subscribeLedger(() => { void load() }), [load])
  useEffect(() => { setRejecting(intent === 'reject') }, [intent, id])
  useEffect(() => {
    if (note === '') return undefined
    const timer = setTimeout(() => { setNote('') }, 5_000)
    return () => { clearTimeout(timer) }
  }, [note])

  /** 去那条承诺的会话：中栏先换回会话，再打开它。 */
  const goTo = (sessionId: string, at?: { kind: string; id: string }): void => {
    if (at !== undefined) landOn({ sessionId, kind: at.kind, id: at.id })
    setFrame({ kind: 'session' })
    setSpotlight(undefined)
    openSession?.(sessionId)
  }

  const run = (target: string, work: Promise<{ error?: string }>, done: string): void => {
    setBusy(true)
    void work.then((result) => {
      setBusy(false)
      setNote(result.error ?? done)
      if (result.error === undefined) {
        setRepair(undefined)
        setField('')
        ledgerChanged()
        void load()
      }
      void target
    })
  }

  const answer = (actionId: 'accept' | 'reject', said: string, input?: string): void => {
    stage({ kind: 'commitment', id, steps: [{ actionId, ...(input === undefined ? {} : { input }) }], said }, async () => {
      const result = await inject.cardAct('commitment', id, actionId, input)
      if (result?.outcome !== 'applied') setNote(result?.receipt ?? '没成，再试一次。')
      ledgerChanged()
      void load()
    })
  }

  if (story === null) return <div className={css.panel}><div className={css.calm}>正在读…</div></div>
  if (story === undefined) {
    return (
      <div className={css.panel}>
        <div className={css.top}>
          <span className={css.topText}>{title}</span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭"><Icon name="x" size={14} /></button>
        </div>
        <div className={css.calm}>这一条已经不在板上了。</div>
      </div>
    )
  }

  const open = story.status === 'open'
  const sovereign = open && story.stewardedBy === undefined && story.mirror === undefined
  const waitingOnMe = open && story.delivery !== undefined && story.acceptor === undefined && story.stewardedBy === undefined
  const who = story.executorKind === 'agent' ? AGENT : story.who
  const target = { id: story.id, what: story.what, status: story.status, ...(story.due === undefined ? {} : { due: story.due }), ...(story.goal === undefined ? {} : { goalRef: story.goal.ref }) }

  return (
    <div className={css.panel}>
      <div className={css.top}>
        <span className={css.topText}>{storyHead(story)}</span>
        <button type="button" className={css.close} onClick={close} aria-label="关闭"><Icon name="x" size={14} /></button>
      </div>
      <div className={css.title}>{story.what}</div>

      {/* ——— 等你的那一下：放在最上面，因为它是此刻唯一要你做的事 ——— */}
      {pending !== undefined && (
        <div className={css.ask}>
          <span>{pending.said} · {Math.max(1, Math.ceil((pending.deadline - Date.now()) / 1000))} 秒后生效</span>
          <button type="button" className={css.btn} onClick={() => { undo({ kind: 'commitment', id }) }}>撤回 Z</button>
        </div>
      )}
      {pending === undefined && waitingOnMe && (
        <div className={`${css.ask} ${css.askNeed}`}>
          {story.evidence === 'said'
            ? (
              <>
                <span className={css.askText}>{who}说交了，但没见到东西。</span>
                <span className={css.acts}>
                  <button
                    type="button"
                    className={css.btn}
                    onClick={() => {
                      if (story.sessionId === undefined) { setNote('这条不在任何话题里，没有地方可找。'); return }
                      sendErrand({ subject: 'nudge', goalRef: '', goalName: story.what, voice: 'private', seed: `「${story.what}」${who}说交了，但我没见到东西。帮我找找交的是什么、在哪——找不到也告诉我。` })
                      goTo(story.sessionId)
                    }}
                  >
                    让{AGENT}找找
                  </button>
                  <button type="button" className={css.btn} onClick={() => { answer('accept', '你当它交了') }}>当它交了</button>
                </span>
              </>
            )
            : (
              <>
                <span className={css.askText}>{who}交了{story.evidence === 'platform' ? '，平台记了' : '，有东西可看'}。</span>
                <span className={css.acts}>
                  <button type="button" className={`${css.btn} ${css.btnGo}`} onClick={() => { answer('accept', '你验收了') }}>验收</button>
                  <button type="button" className={css.btn} onClick={() => { setRejecting(true) }}>打回…</button>
                </span>
              </>
            )}
          {story.delivery !== undefined && <span className={css.claim}>「{story.delivery.claim}」</span>}
          {rejecting && (
            <form
              className={css.reject}
              onSubmit={(event) => {
                event.preventDefault()
                if (reason.trim() === '') return
                answer('reject', '你打回了', reason.trim())
                setRejecting(false)
                setReason('')
              }}
            >
              <input
                className={css.input}
                value={reason}
                autoFocus
                placeholder={`哪里不行？${who === AGENT ? '' : who}看得到这句`}
                onChange={(event) => { setReason(event.target.value) }}
              />
              <button type="submit" className={css.btn} disabled={reason.trim() === ''}>打回</button>
              <button type="button" className={css.ghost} onClick={() => { setRejecting(false) }}>算了</button>
            </form>
          )}
        </div>
      )}

      {/* ——— 怎么来的 ——— */}
      <section className={css.section}>
        <div className={css.label}>怎么来的</div>
        {story.birth.said === undefined
          ? <div className={css.dim}>原话没找到——登记在{story.birth.where ?? '一个找不回来的地方'}，{whenOf(story.birth.at, Date.now())}。</div>
          : (
            <>
              <blockquote className={css.quote}>{story.birth.said}</blockquote>
              <div className={css.meta}>
                {[story.birth.by, whenOf(story.birth.at, Date.now()), story.birth.where].filter(Boolean).join(' · ')}
              </div>
            </>
          )}
        <div className={css.acts}>
          {story.sessionId !== undefined && (
            <button type="button" className={css.ghost} onClick={() => { goTo(story.sessionId as string, { kind: 'commitment', id: story.id }) }}>
              在话题里看<Icon name="chevR" size={12} />
            </button>
          )}
          {sovereign && (
            <button type="button" className={css.ghost} onClick={() => { setFixing(value => !value) }}>记错了？改</button>
          )}
        </div>
        {fixing && sovereign && (
          <div className={css.fix}>
            <button type="button" className={css.btn} onClick={() => { setFixing(false); setRepair({ kind: 'postpone', row: target }); setField(story.due?.text ?? '') }}>期限记错了</button>
            <button type="button" className={css.btn} onClick={() => { setFixing(false); setRepair({ kind: 'handoff', row: target }) }}>人记错了</button>
            <button type="button" className={css.btn} onClick={() => { setFixing(false); setRepair({ kind: 'void', row: target }); setField('') }}>本来就不该有这条</button>
          </div>
        )}
      </section>

      {/* ——— 之后 ——— */}
      <section className={css.section}>
        <div className={css.label}>之后</div>
        {story.steps.length === 0
          ? <div className={css.dim}>登记之后还没有任何动静{open ? `——已经 ${String(Math.max(0, Math.floor((Date.now() - story.birth.at) / DAY_MS)))} 天` : ''}。</div>
          : (
            <ol className={css.steps}>
              {story.steps.map(step => (
                <li className={css.step} key={`${String(step.at)}:${step.text}`}>
                  <span className={`${css.mark} ${css[`grade_${step.grade}`] ?? ''}`} title={step.grade === 'said' ? '只有一句话' : step.grade === 'note' ? '' : '有东西'} />
                  <span className={css.stepText}>
                    {step.uri !== undefined && safeHref(step.uri) !== undefined
                      ? <a className={css.link} href={safeHref(step.uri)} target="_blank" rel="noreferrer noopener">{step.text}</a>
                      : step.text}
                  </span>
                  <span className={css.stepWhen}>{whenOf(step.at, Date.now())}</span>
                </li>
              ))}
            </ol>
          )}
      </section>

      {/* ——— 挂在 ——— */}
      <section className={css.section}>
        <div className={css.label}>挂在</div>
        <div className={css.where}>
          {story.goal === undefined
            ? <span className={css.dim}>没挂目标</span>
            : (
              <button
                type="button"
                className={css.place}
                onClick={() => { pushFrame({ kind: 'goal', goalRef: story.goal?.ref ?? '', goalName: story.goal?.name ?? '' }, 0) }}
              >
                <Icon name="target" size={13} />{story.goal.name}<Icon name="chevR" size={12} />
              </button>
            )}
          {story.placeName !== undefined && story.sessionId !== undefined && (
            <button type="button" className={css.place} onClick={() => { goTo(story.sessionId as string) }}>
              <Icon name="hash" size={13} />{story.placeName}<Icon name="chevR" size={12} />
            </button>
          )}
          {sovereign && (
            <button type="button" className={css.ghost} onClick={() => { setRepair({ kind: 'attach', row: target }); setField('') }}>
              {story.goal === undefined ? '挂到目标…' : '不挂了…'}
            </button>
          )}
        </div>
      </section>

      {/* ——— 动词：全站只有这一组 ——— */}
      {open && (
        <section className={css.verbs}>
          {story.mirror !== undefined
            ? <div className={css.dim}>这条记在{AGENT}（{story.mirror.operator}）那边——要动它，去群里对那位说。</div>
            : story.stewardedBy !== undefined
              ? (
                <>
                  <div className={css.dim}>这条归{story.stewardedBy}管——要改，去跟{story.stewardedBy}说。</div>
                  {/*
                    可转包不可脱责（决策 #59）：转手是他的事；把一部分拆下去交给别人办是你的事——
                    拆出去的那条挂在这条底下，你仍然对他负责。
                  */}
                  {story.direction === 'mine' && (
                    <div className={css.acts}>
                      <button
                        type="button"
                        className={css.btn}
                        onClick={() => {
                          const asked = requestPortal({
                            subject: 'goal',
                            goalRef: story.goal?.ref ?? '',
                            goalName: story.goal?.name ?? story.what,
                            voice: 'place',
                            pick: 'executor',
                            seed: delegateSeed(story.what),
                            subCommitmentOf: story.id,
                            title: '拆一部分交给谁？',
                            note: `拆出去的那条挂在你这条底下——你仍然对${story.stewardedBy ?? '对方'}负责。`,
                          })
                          if (!asked) setNote('从承诺页或目标页里才能拆出去。')
                        }}
                      >
                        拆一部分给别人…
                      </button>
                    </div>
                  )}
                </>
              )
              : (
                <div className={css.acts}>
                  {story.direction === 'owed-to-me' && story.remindable && story.sessionId !== undefined && (
                    <button
                      type="button"
                      className={css.btn}
                      onClick={() => {
                        sendErrand({ subject: 'nudge', goalRef: story.goal?.ref ?? '', goalName: story.what, voice: 'place', seed: nudgeDraft({ what: story.what, ...(story.due === undefined ? {} : { due: story.due }), overdue: story.overdueDays !== undefined }) })
                        goTo(story.sessionId as string)
                      }}
                    >
                      催{story.executorKind === 'agent' ? '' : story.who}
                    </button>
                  )}
                  {story.direction === 'mine' && story.sessionId !== undefined && (
                    <button type="button" className={css.btn} onClick={() => { goTo(story.sessionId as string, { kind: 'commitment', id: story.id }) }}>去做</button>
                  )}
                  <button type="button" className={css.btn} onClick={() => { setRepair({ kind: 'postpone', row: target }); setField(story.due?.text ?? '') }}>顺延</button>
                  <button type="button" className={css.btn} onClick={() => { setRepair({ kind: 'handoff', row: target }) }}>转给别人</button>
                  <button type="button" className={css.btn} onClick={() => { setRepair({ kind: 'merge', row: target }); setField('') }}>合并</button>
                  <button type="button" className={`${css.btn} ${css.btnQuiet}`} onClick={() => { setRepair({ kind: 'void', row: target }); setField('') }}>作废…</button>
                </div>
              )}
          {repair !== undefined && sovereign && (
            <RepairVerbs
              repair={repair}
              siblings={story.siblings}
              inject={inject}
              busy={busy}
              field={field}
              setField={setField}
              close={() => { setRepair(undefined) }}
              run={run}
              handoff={(row) => {
                void handoffPortal(inject, row).then((opened) => {
                  if ('error' in opened) { setNote(opened.error); return }
                  setRepair(undefined)
                  if (!requestPortal(opened)) setNote('从承诺页里才能转给别人。')
                })
              }}
              goals={story.goals}
            />
          )}
        </section>
      )}
      {note !== '' && <div className={css.note}>{note}</div>}
    </div>
  )
}
