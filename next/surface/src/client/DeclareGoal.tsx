/**
 * 新目标 —— 承诺页右上角那颗「+ 新目标」打开的表。
 *
 * 目标就是一条你自己负责、由人验收的承诺；它的正文住在云之家的一篇文档里，这里只记
 * 谁负责、怎么算完成、什么时候验。按下「立目标」就是签发——云小助只能提议，不能替人立。
 *
 * 建在哪个知识库要人选：那决定了谁打得开它。建文档这件事归系统——离开产品、新建、
 * 复制链接、回来粘上，人在这几步里没有任何判断可做。
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { PersonWire, SurfaceInject, WorkspaceWire } from './rpc.ts'
import { sendErrand } from './store.ts'
import { goalCraftSeed } from './commission.ts'
import { PersonPicker } from './PersonPicker.tsx'
import { AGENT } from './words.ts'
import css from './board.module.css'

/**
 * 在手上这份名单里找知识库 —— **过滤，不是搜索**：几十个库已经在手上了，「这份名单里
 * 没有叫这个的」是一句关于已知全集的真话。名字之外把「个人/企业 · 主人」一并拿来匹配，
 * 因为同名的库真的存在。
 */
export function matchWorkspaces(
  all: readonly { readonly name: string; readonly personal?: boolean; readonly owner?: string }[],
  keyword: string,
): readonly { readonly name: string; readonly personal?: boolean; readonly owner?: string }[] {
  const word = keyword.trim().toLowerCase()
  if (word === '') return all
  return all.filter((space) => {
    const hay = `${space.name} ${space.owner ?? ''}${space.personal === true ? ' 个人' : ' 企业'}`.toLowerCase()
    return hay.includes(word)
  })
}

/** 在云之家建一篇目标正文：人选知识库，系统建文档。建完只回填链接，不替人按「立目标」。 */
function BodyMaker(props: {
  inject: SurfaceInject
  title: string
  /** 「怎么算完成」——建的时候一并写进正文，评估日后是回正文里读它的。 */
  criteria: string
  onMade(url: string, note?: string): void
}): ReactNode {
  const { inject, title, criteria, onMade } = props
  const [open, setOpen] = useState(false)
  const [spaces, setSpaces] = useState<readonly WorkspaceWire[]>([])
  const [picked, setPicked] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    void inject.workspaces().then((result) => {
      setSpaces(result.workspaces)
      // 读不了 ≠ 一个都没有：故障要说成故障。
      setNote(result.error === undefined
        ? (result.workspaces.length === 0 ? '一个知识库都没有——先在云之家建一个。' : '')
        : '知识库列不出来，稍后再试。这不等于你没有知识库。')
    })
  }, [inject, open])

  if (!open) {
    return (
      <button type="button" className={css.bodyMake} onClick={() => { setOpen(true) }}>
        ＋ 在云之家新建一篇
      </button>
    )
  }

  const chosen = spaces.find(space => space.id === picked)
  const hits = matchWorkspaces(spaces, filter) as readonly WorkspaceWire[]
  const label = (space: WorkspaceWire): string => [
    space.personal === true ? '个人' : '企业',
    space.owner ?? '',
    space.members === undefined ? '' : `${String(space.members)} 人`,
    space.docs === undefined ? '' : `${String(space.docs)} 篇`,
  ].filter(part => part !== '').join(' · ')
  return (
    <div className={css.bodyBox}>
      {chosen === undefined
        ? (
          <>
            <input
              className={css.input}
              value={filter}
              placeholder={`建在哪个知识库…（共 ${String(spaces.length)} 个，打字过滤）`}
              onChange={(event) => { setFilter(event.target.value) }}
            />
            {spaces.length > 0 && hits.length === 0 && (
              <span className={css.fieldHint}>这 {spaces.length} 个里没有名字带「{filter.trim()}」的。</span>
            )}
            <div className={css.spaceHits}>
              {hits.map(space => (
                <button
                  type="button"
                  key={space.id}
                  className={css.spaceHit}
                  onClick={() => { setPicked(space.id); setFilter('') }}
                >
                  <b>{space.name}</b>
                  <span className={css.spaceMeta}>{label(space)}</span>
                </button>
              ))}
            </div>
          </>
        )
        : (
          <button type="button" className={css.spacePicked} title="换一个知识库" onClick={() => { setPicked('') }}>
            {chosen.name}
            <span className={css.spaceMeta}>{label(chosen)}</span>
            <span className={css.spaceDrop}>×</span>
          </button>
        )}
      {chosen?.personal === true && (
        <span className={css.fieldHint}><b>个人知识库只有你看得见</b>——别人打不开这个目标。</span>
      )}
      {note !== '' && <span className={css.fieldHint}>{note}</span>}
      <div className={css.bodyActs}>
        <button
          type="button"
          className={css.sheetGo}
          disabled={picked === '' || title === '' || busy}
          title={title === '' ? '先写目标——文档用它当标题' : undefined}
          onClick={() => {
            setBusy(true)
            setNote('')
            void inject.createGoalBody({ workspace: picked, title, criteria }).then((result) => {
              setBusy(false)
              if (result.url === undefined) { setNote(result.error ?? '没建成，再试一次。'); return }
              onMade(result.url, result.note)
              setOpen(false)
            })
          }}
        >
          {busy ? '正在建…' : '建一篇'}
        </button>
        <button type="button" className={css.sheetGhost} onClick={() => { setOpen(false) }}>算了</button>
      </div>
    </div>
  )
}

export function DeclareGoal(props: {
  inject: SurfaceInject
  fromSessionId?: string
  /** 还没想清楚时的出口：去和云小助说，而不是再填一张表。 */
  openSession(sessionId: string): void
  close(): void
  done(message: string): void
}): ReactNode {
  const { inject, close, done, fromSessionId, openSession } = props
  const [what, setWhat] = useState('')
  const [goalRef, setGoalRef] = useState('')
  /** 负责人是选中的那个人，不是打出来的那串字——通讯录里同名的人不止一个。 */
  const [owner, setOwner] = useState<PersonWire | undefined>(undefined)
  /** 正文是不是刚刚建的那一篇；建的那篇已经写进了「怎么算完成」，粘进来的那篇我们一个字不动。 */
  const [made, setMade] = useState('')
  const [due, setDue] = useState('')
  const [criteria, setCriteria] = useState('')
  const [busy, setBusy] = useState(false)
  /** 上一次没立成的原因。就地说，表里填的东西都还在。 */
  const [refusal, setRefusal] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [close])

  const ready = what.trim() !== '' && goalRef.trim() !== ''

  return (
    <div className={css.mask} onClick={close}>
      <div className={css.sheet} role="dialog" aria-label="新目标" onClick={(event) => { event.stopPropagation() }}>
        <div className={css.sheetHead}>
          <span className={css.sheetTitle}>新目标</span>
          <button type="button" className={css.sheetClose} onClick={close} aria-label="关闭">×</button>
        </div>
        <label className={css.field}>
          <span className={css.fieldLabel}>目标</span>
          <input
            className={css.input}
            value={what}
            autoFocus
            placeholder="例：Q3 把对账周期压到 3 天内"
            onChange={(event) => { setWhat(event.target.value) }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>正文</span>
          <input
            className={css.input}
            value={goalRef}
            placeholder="粘一篇已有的云之家文档链接，或在下面新建一篇"
            spellCheck={false}
            onChange={(event) => { setGoalRef(event.target.value) }}
          />
          {goalRef.trim() === '' && (
            <BodyMaker
              inject={inject}
              title={what.trim()}
              criteria={criteria.trim()}
              onMade={(url, note) => { setGoalRef(url); setMade(note ?? '') }}
            />
          )}
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>怎么算完成</span>
          <textarea
            className={css.area}
            value={criteria}
            rows={3}
            placeholder="例：月结 T+3 日内出报表；四个部门用同一张模板"
            onChange={(event) => { setCriteria(event.target.value) }}
          />
          <span className={css.fieldHint}>
            {goalRef.trim() !== '' && made === ''
              ? '也请把这几句写进那篇文档——之后评估进度是拿它逐条对的。'
              : '建正文时会一并写进去；之后评估进度是拿它逐条对的。'}
          </span>
          {made !== '' && <span className={css.refusal}>{made}</span>}
        </label>
        <div className={css.fieldRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>负责人</span>
            <PersonPicker
              inject={inject}
              picked={owner}
              onPick={setOwner}
              placeholder="不填就是你"
              clearTitle="改回你自己"
              emptyTail="不选就是你。"
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>什么时候验</span>
            <input
              className={css.input}
              value={due}
              placeholder="例：季度末"
              onChange={(event) => { setDue(event.target.value) }}
            />
          </label>
        </div>
        {refusal !== '' && <div className={css.refusal}>{refusal}</div>}
        <div className={css.sheetFoot}>
          <button
            type="button"
            className={css.sheetGrind}
            disabled={busy}
            title={`还没想清楚「怎么算完成」？去和${AGENT}聊，聊好了它把提议递给你签`}
            onClick={() => {
              if (fromSessionId === undefined) {
                setRefusal(`先从左边打开一个会话，再回来——和${AGENT}聊总要有个地方。`)
                return
              }
              sendErrand({ subject: 'draft', goalRef: '', goalName: what.trim(), voice: 'private', seed: goalCraftSeed(what) })
              close()
              openSession(fromSessionId)
            }}
          >
            先和{AGENT}想清楚
          </button>
          <button
            type="button"
            className={css.sheetGo}
            disabled={!ready || busy}
            onClick={() => {
              setBusy(true)
              setRefusal('')
              void inject.declareGoal({
                what: what.trim(),
                goalRef: goalRef.trim(),
                ...(owner === undefined ? {} : { ownerOpenId: owner.openId, ownerName: owner.name }),
                ...(due.trim() === '' ? {} : { due: due.trim() }),
                ...(criteria.trim() === '' ? {} : { criteria: criteria.trim() }),
                // 它是从哪段对话里想出来的：三个月后回头看，这是唯一的线索。
                ...(fromSessionId === undefined ? {} : { sessionId: fromSessionId }),
              }).then((result) => {
                setBusy(false)
                if (result.error !== undefined) { setRefusal(result.error); return }
                done(`立了目标「${what.trim()}」。`)
              })
            }}
          >
            {busy ? '正在立…' : '立目标'}
          </button>
        </div>
      </div>
    </div>
  )
}
