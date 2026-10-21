/**
 * 我定过的 —— 你签过的判断，和后来发生的事 (界面重设计 §5.6 · 决策 #64).
 *
 * 和承诺页同构：组织轴 = 裁决族；组头一句话写比值的原料（同意几次、被推翻几次、平均多久
 * 才去验），不写比值、不打分；行 = 押 / 结果，选中一行右栏摆开当时的样子。「以后这类事…」
 * 就地展开，第一行先摆这一族的那句话——先看数，再决定改不改规矩。
 *
 * 整页纸色：这是唯一一个公司看不见的面。投屏开会时，颜色替人记得自己开着的是哪一本。
 * 没有决断条、没有排名、没有别人的账。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { FamilyHeadWire, JudgViewWire, PledgeRowWire, ReceiptRowWire, SurfaceInject } from './rpc.ts'
import { YzjJudgContract } from './JudgContract.tsx'
import {
  FRAME_SCROLL, backLabel, backTarget, currentJudgSelection, setJudgSelection, subscribeJudgSelection,
} from './store.ts'
import { Icon } from './icons.tsx'
import { useBackKey } from './keys.ts'
import { usePoll } from './poll.ts'
import tokens from './tokens.module.css'
import css from './vault.module.css'

export interface JudgProps {
  inject: SurfaceInject
  back(): void
}

const CELLS: readonly { id: 'q1' | 'q2' | 'q3' | 'q4'; label: string; note: (row: ReceiptRowWire) => string }[] = [
  { id: 'q1', label: '对了 · 因判断', note: () => '你当时看到的，就是后来发生的' },
  { id: 'q2', label: '对了 · 因运气', note: () => '结果是好的，但不是因为你当时看到的那些' },
  { id: 'q3', label: '错了 · 因判断', note: row => (row.then[1] === undefined ? '当时卡上有的，你没看' : `「${row.then[1].text}」当时就在卡上`) },
  { id: 'q4', label: '错了 · 因世界', note: () => '后来的事，当时看不到' },
]

const TYPE_LABEL = { pledged: '押过的', reversed: '同意了，后来被推翻', vindicated: '没同意，后来证明你对' } as const

const when = (at: number | string): string => {
  const parsed = typeof at === 'number' ? at : Date.parse(at)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : String(at)
}

/** 等了多久，用人读得出的单位：分钟 → 小时 → 天。 */
export function waitText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${String(minutes)} 分钟`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 48) return `${String(hours)} 小时`
  return `${String(Math.round(ms / 86_400_000))} 天`
}

/** 这一族的人做的是什么动作——「平均多久后才去验」里的那个字。 */
function actOf(label: string): string {
  if (label.includes('验收')) return '验'
  if (label.includes('确认') || label.includes('审批')) return '批'
  return '定'
}

/**
 * 一族一句话：比值的原料，不是比值 —— 例如「同意 33 次，都没被推翻 · 平均 22 小时后才去验」。
 *
 * 写「没被推翻」不写「成立」：没被推翻只是还没被现实打脸，不等于你对了。数字摆出来，
 * 比值由人自己去读；这一页没有分数。
 */
export function familySentence(head: FamilyHeadWire): string {
  const parts: string[] = []
  if (head.agree > 0) {
    parts.push(head.reversed === 0
      ? `同意 ${String(head.agree)} 次，都没被推翻`
      : `同意 ${String(head.agree)} 次：${String(head.notReversed)} 次没被推翻，${String(head.reversed)} 次被推翻`)
  }
  if (head.diverged > 0) {
    const tail = [
      head.vindicated > 0 ? `${String(head.vindicated)} 次后来证明你对` : '',
      head.pending > 0 ? `${String(head.pending)} 次还没分晓` : '',
    ].filter(part => part !== '')
    parts.push(`没同意 ${String(head.diverged)} 次${tail.length === 0 ? '' : `，${tail.join('，')}`}`)
  }
  if (head.waitMs > 0) parts.push(`平均 ${waitText(head.waitMs)}后才去${actOf(head.label)}`)
  if (head.dwellMs > 0) parts.push(`每次看约 ${String(Math.max(1, Math.round(head.dwellMs / 1000)))} 秒`)
  return parts.length === 0 ? '还没有结果回来' : parts.join(' · ')
}

/** 组头一行（卡下私条里也用）。 */
export function HeadLine(props: { head: FamilyHeadWire }): ReactNode {
  return <span className={css.sub}>{familySentence(props.head)}</span>
}

/**
 * 「以后这类事…」就地展开：第一行先摆这一族的那句话（先看比值再换挡），其下三个选择和「先不改」。
 * 「不用再问我」只是起一份规矩的提议，你签了才生效。
 */
export function GearBox(props: {
  head: FamilyHeadWire
  inject: SurfaceInject
  busy: boolean
  done(note: string | undefined): void
}): ReactNode {
  const { head, inject, busy, done } = props
  const run = (action: () => Promise<{ note?: string; error?: string }>): void => {
    void action().then(result => { done(result.error ?? result.note) })
  }
  return (
    <div className={css.gear} data-testid="gear-box">
      <div className={css.gearHead}><b>{head.label}</b> · 近 90 天：{familySentence(head)}</div>
      <div className={css.gearAsk}>以后「{head.label}」这类事：</div>
      <div className={css.actions}>
        <button type="button" className={css.verb} disabled={busy} onClick={() => { run(() => inject.setClause('spread', head.family)) }}>先把要求和交付摆给我看</button>
        <button type="button" className={css.verb} disabled={busy} onClick={() => { run(() => inject.setClause('mirror', head.family)) }}>给我看上次的结果</button>
        <button
          type="button"
          className={css.verb}
          disabled={busy || !head.leasable}
          title={head.leasable ? '起一份规矩的提议，你签了才生效；随时可以收回' : '这一类不是写东西，没有规矩可签'}
          onClick={() => { run(() => inject.proposeLease(head.family)) }}
        >
          不用再问我
        </button>
        <button type="button" className={`${css.verb} ${css.verbQuiet}`} disabled={busy} onClick={() => { done(undefined) }}>先不改</button>
      </div>
    </div>
  )
}

export function YzjJudg(props: JudgProps): ReactNode {
  const { inject, back } = props
  const [view, setView] = useState<JudgViewWire | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ key: string; text: string } | undefined>(undefined)
  const [gearAt, setGearAt] = useState<string | undefined>(undefined)
  const [contractOpen, setContractOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [takeout, setTakeout] = useState<string | undefined>(undefined)
  const selected = useSyncExternalStore(subscribeJudgSelection, currentJudgSelection)
  useBackKey(back)
  const seen = useRef(new Set<string>())

  const reload = useCallback(async (): Promise<void> => { setView(await inject.judg()) }, [inject])
  usePoll(reload)

  // 首次在屏：归因率的分母。每回执至多一次，只由这条渲染路径写。
  useEffect(() => {
    if (view === undefined) return
    const fresh = view.groups.flatMap(group => group.rows)
      .filter((row): row is ReceiptRowWire => row.kind === 'receipt' && !row.seen && !seen.current.has(row.calibrationId))
      .map(row => row.calibrationId)
    if (fresh.length === 0) return
    for (const id of fresh) seen.current.add(id)
    void inject.markSeen(fresh)
  }, [view, inject])

  const run = useCallback(async (action: () => Promise<{ error?: string; note?: string }>): Promise<void> => {
    setBusy(true)
    try {
      const result = await action()
      setNote(result.error ?? result.note)
      if (result.error === undefined) setEditing(undefined)
      await reload()
    } finally { setBusy(false) }
  }, [reload])

  const verb = (label: string, title: string, onClick: () => void, on = false): ReactNode => (
    <button
      type="button"
      className={`${css.verb} ${on ? css.verbOn : ''}`}
      title={title}
      disabled={busy}
      onClick={(event) => { event.stopPropagation(); onClick() }}
    >
      {label}
    </button>
  )

  const inlineInput = (key: string, placeholder: string, submit: (text: string) => Promise<{ error?: string }>): ReactNode => (
    editing?.key === key
      ? (
        <div className={css.inline}>
          <textarea className={css.input} rows={2} autoFocus placeholder={placeholder} value={editing.text} onChange={(event) => { setEditing({ key, text: event.target.value }) }} />
          <div className={css.actions}>
            {verb('记下', '原话照记，一个字不改', () => { const text = editing.text.trim(); if (text !== '') void run(() => submit(text)) })}
            {verb('算了', '不记', () => { setEditing(undefined) })}
          </div>
        </div>
      )
      : null
  )

  /** 一行可以被选中：右栏摆开当时的样子。 */
  const rowShell = (
    key: string, on: boolean, select: () => void, main: ReactNode, signal: ReactNode, verbs: ReactNode,
  ): ReactNode => (
    <div
      role="button"
      tabIndex={0}
      className={`${css.row} ${on ? css.rowOn : ''}`}
      onClick={select}
      onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) select() }}
      data-judg={key}
    >
      <span className={css.rowMain}>{main}</span>
      {signal}
      <span className={css.verbs}>{verbs}</span>
    </div>
  )

  const pledgeRow = (row: PledgeRowWire): ReactNode => {
    const on = selected?.kind === 'expectation' && selected.id === row.expectationId
    const changed = row.premise === 'changed' && row.status !== 'withdrawn'
    const status = row.status === 'withdrawn'
      ? { text: '撤回了', tone: css.quiet }
      : changed
        ? { text: '前提变了', tone: css.need }
        : row.status === 'due'
          ? { text: `过了${row.checkpointText}，还没结果`, tone: css.need }
          : { text: row.checkpointText === '没有定时间' ? '没定什么时候见分晓' : `${row.checkpointText}见分晓`, tone: css.quiet }
    return (
      <div key={row.expectationId}>
        {rowShell(
          row.expectationId,
          on,
          () => { setJudgSelection(on ? undefined : { kind: 'expectation', id: row.expectationId }) },
          <>
            <span className={css.what}>押：「{row.text}」</span>
            <span className={css.rowNote}>
              押在「{row.verdict.text}」上 · {when(row.verdict.at)}{row.reason === undefined || row.reason === '' ? '' : ` · ${row.reason}`}
            </span>
            {changed && <span className={css.rowNote}>你押的那条已经作废或转手了。撤回，或者照旧等结果，都行。</span>}
          </>,
          <span className={`${css.signal} ${status.tone}`}>{status.text}</span>,
          <>
            {row.status === 'due' && verb('补一句结果', '后来怎么样了，只有你知道', () => { setEditing({ key: `note:${row.expectationId}`, text: '' }) })}
            {changed && verb('照旧等', '不改，结果来了照样摆出来', () => { setNote('好，照旧等。结果来的时候照样会摆出来。') })}
            {row.status !== 'withdrawn' && verb('撤回', '撤回会留下记录；撤回后这条不能再押', () => { setEditing({ key: `withdraw:${row.expectationId}`, text: '' }) })}
          </>,
        )}
        {inlineInput(`note:${row.expectationId}`, '后来到底怎么样了？用你自己的话说一句。', text => inject.noteFact({ text, expectationId: row.expectationId }))}
        {inlineInput(`withdraw:${row.expectationId}`, '为什么撤回？（可不写）', text => inject.withdrawExpectation(row.expectationId, text))}
      </div>
    )
  }

  const receiptRow = (row: ReceiptRowWire, head: FamilyHeadWire): ReactNode => {
    const on = selected?.kind === 'calibration' && selected.id === row.calibrationId
    const open = row.attributionLabel === undefined && !row.dismissed
    return (
      <div key={row.calibrationId}>
        {rowShell(
          row.calibrationId,
          on,
          () => { setJudgSelection(on ? undefined : { kind: 'calibration', id: row.calibrationId }) },
          <>
            <span className={css.what}>{row.verdict.text} → {row.later[0]?.text ?? '还在等结果'}</span>
            <span className={css.rowNote}>
              {TYPE_LABEL[row.type]} · {when(row.verdict.at)}{row.later[0] === undefined ? '' : ` → ${when(row.later[0].at)}`}
            </span>
          </>,
          <span className={`${css.signal} ${open ? css.need : css.quiet}`}>
            {row.dismissed ? '没记' : row.attributionLabel ?? '这次算什么？'}
          </span>,
          <>
            {row.attributionLabel !== undefined && verb('改', '想改随时改，改动会留下记录', () => { setEditing({ key: `attr:${row.calibrationId}`, text: '' }) })}
            {row.dismissed && verb('记回来…', '按一格就记回来', () => { setEditing({ key: `attr:${row.calibrationId}`, text: '' }) })}
            {row.attributionLabel !== undefined && verb('以后这类事…', '先看这一类的数，再决定改不改', () => { setGearAt(gearAt === row.calibrationId ? undefined : row.calibrationId) })}
          </>,
        )}
        {(open || editing?.key === `attr:${row.calibrationId}`) && (
          <div className={css.ask}>
            {open && <span className={css.askText}>这次算什么？你来定。</span>}
            {CELLS.map(cell => verb(cell.label, cell.note(row), () => { void run(() => inject.attribute(row.calibrationId, cell.id)) }, cell.id === row.attribution))}
            {open && verb('这不是那件事的结果', '不记；想记回来再按一格', () => { void run(() => inject.dismissReceipt(row.calibrationId)) })}
            {!open && verb('算了', '不改', () => { setEditing(undefined) })}
          </div>
        )}
        {gearAt === row.calibrationId && <GearBox head={head} inject={inject} busy={busy} done={(text) => { setGearAt(undefined); setNote(text); void reload() }} />}
      </div>
    )
  }

  return (
    <div className={`${tokens.tokens} ${css.vault}`}>
      <div className={css.head}>
        <button type="button" className={css.back} onClick={back}><Icon name="chevL" size={14} />{backLabel(backTarget() ?? { kind: 'board' })}</button>
        <span className={css.headRule} />
        <span className={css.title}><Icon name="lock" size={14} />我定过的</span>
      </div>
      <div className={css.body} {...{ [FRAME_SCROLL]: '' }}>
        <div className={css.column}>
          <div className={css.contract}>
            <Icon name="lock" size={13} /><span>只有你看得到。不进公司的账，随时可以整本带走。</span>
            <button type="button" className={css.contractMore} onClick={() => { setContractOpen(true) }}>
              判断力档案<Icon name="chevR" size={12} />
            </button>
          </div>
          {contractOpen && <YzjJudgContract inject={inject} close={() => { setContractOpen(false); void reload() }} />}
          {note !== undefined && <div className={css.note}>{note}</div>}
          {view === undefined && <div className={css.calm}>这本账还打不开——云之家还没登录好。</div>}
          {view !== undefined && view.empty && view.groups.length === 0 && (
            <div className={css.calm}>
              还没有记下什么。在任何一个会话里私下说一句「押：这家供应商下个月会涨价」，
              到时候结果回来，这里会摆出你当时怎么想、后来怎么样。
            </div>
          )}
          {view?.groups.map(group => (
            <section className={css.group} key={group.head.family}>
              <div className={css.groupHead}>
                <span className={css.groupTitle}>{group.head.label} · {group.head.count} 次</span>
                <button
                  type="button"
                  className={css.groupAct}
                  onClick={() => { setGearAt(gearAt === `fam:${group.head.family}` ? undefined : `fam:${group.head.family}`) }}
                >
                  以后这类事…
                </button>
              </div>
              <div className={css.groupLine}>{familySentence(group.head)}</div>
              {gearAt === `fam:${group.head.family}` && <GearBox head={group.head} inject={inject} busy={busy} done={(text) => { setGearAt(undefined); setNote(text); void reload() }} />}
              {group.rows.length === 0
                ? <div className={css.calm}>近 {String(view.window.days)} 天没有结果回来。</div>
                : <div className={css.rows}>{group.rows.map(row => (row.kind === 'pledge' ? pledgeRow(row) : receiptRow(row, group.head)))}</div>}
            </section>
          ))}
          <div className={css.refuse}>这里没有分数、没有排名、没有别人的账。</div>
          <section className={css.destroy}>
            <div className={css.groupTitle}>带走</div>
            <div className={css.calm}>
              这本账存在你电脑上的 <code className={css.code}>{view?.directory ?? '……'}</code>，拷走这个文件夹就是整本带走。
            </div>
            <div className={css.actions}>
              {verb('生成一份能读的副本', '只读，不改账里任何东西', () => { void inject.judgExport().then((result) => { setTakeout(result?.casebook) }) })}
            </div>
            {takeout !== undefined && <div className={css.take}>{takeout}</div>}
            <div className={css.destroyRow}>
              <input
                className={css.input}
                value={confirm}
                placeholder={`销毁收不回来。原样输入「${view?.destroyPhrase ?? ''}」确认`}
                onChange={(event) => { setConfirm(event.target.value) }}
              />
              <button
                type="button"
                className={css.danger}
                disabled={busy || view === undefined || confirm !== view.destroyPhrase}
                onClick={() => { void run(async () => { const result = await inject.destroyVault(confirm); if (result.error === undefined) setConfirm(''); return result }) }}
              >
                销毁整本账
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
