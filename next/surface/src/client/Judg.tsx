/**
 * 「我的判断」—— 第三取景框（跨裁决），与承诺板严格同构（决策 #64 §4）。
 *
 * 组织轴 = 裁决族；组头 = 该族原料 2×2 + 两个分母（近 90 天滚动）；行 = 押 / 回执，
 * 每行既可见又可动（撤回 / 照旧对 / 补一句结果 / 归因 / 看›）；就近动词「以后这类事…」
 * 长在组头，**就地展开第一行先摆本族 2×2**（先看比值再换挡）。板级明拒同样适用：
 * 无决断条、无排名、无跨人比较。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { FamilyHeadWire, JudgViewWire, PledgeRowWire, ReceiptRowWire, SurfaceInject } from './rpc.ts'
import { YzjJudgContract } from './JudgContract.tsx'
import { currentJudgSelection, setJudgSelection, subscribeJudgSelection } from './store.ts'
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

const TYPE_LABEL = { pledged: '押过的', reversed: '同意了，被现实推翻', vindicated: '没同意，被现实印证' } as const

const when = (at: number | string): string => {
  const parsed = typeof at === 'number' ? at : Date.parse(at)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : String(at)
}

/** 组头一行：同意 N（没被推翻 · 被推翻）｜没同意 N（证明对 · 待定）｜每次约 X 秒 · 等你约 Y 分钟。 */
export function HeadLine(props: { head: FamilyHeadWire }): ReactNode {
  const { head } = props
  return (
    <span className={css.sub}>
      同意 <b>{head.agree}</b>{head.agree > 0 ? `（没被推翻 ${String(head.notReversed)} · 被推翻 ${String(head.reversed)}）` : ''}
      {' ｜ '}没同意 <b>{head.diverged}</b>{head.diverged > 0 ? `（证明对 ${String(head.vindicated)}${head.pending > 0 ? ` · 待定 ${String(head.pending)}` : ''}）` : ''}
      {' ｜ '}每次约 {String(Math.round(head.dwellMs / 1000))} 秒 · 等你约 {String(Math.round(head.waitMs / 60_000))} 分钟
    </span>
  )
}

/**
 * 「以后这类事…」就地展开：第一行本族 2×2，其下三句 + 「不用再问我」+「先不改」。不跳转。
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
    <div className={css.empty} data-testid="gear-box">
      <div><b>{head.label}</b> · 近 90 天：<HeadLine head={head} /></div>
      <div className={css.actions}>
        以后「{head.label}」这类事：
        <button type="button" className={css.verb} disabled={busy} onClick={() => { run(() => inject.setClause('spread', head.family)) }}>先把要求和交付摆给我看</button>
        <button type="button" className={css.verb} disabled={busy} onClick={() => { run(() => inject.setClause('mirror', head.family)) }}>给我看上次的结果</button>
        <button
          type="button"
          className={css.verb}
          disabled={busy || !head.leasable}
          title={head.leasable ? '在公司的账上签一份授权租约（强确认卡）——这一期这类写入不再问你' : '这一类没有可租约化的写入——不用再问我只对写确认族开门'}
          onClick={() => { run(() => inject.proposeLease(head.family)) }}
        >
          不用再问我
        </button>
        <button type="button" className={css.verb} disabled={busy} onClick={() => { done(undefined) }}>先不改</button>
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
  const seen = useRef(new Set<string>())

  const reload = useCallback(async (): Promise<void> => { setView(await inject.judg()) }, [inject])
  useEffect(() => {
    void reload()
    const timer = setInterval(() => { void reload() }, 5_000)
    return () => { clearInterval(timer) }
  }, [reload])

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
    <button type="button" className={`${css.verb} ${on ? css.verbOn : ''}`} title={title} disabled={busy} onClick={onClick}>{label}</button>
  )

  const inlineInput = (key: string, placeholder: string, submit: (text: string) => Promise<{ error?: string }>): ReactNode => (
    editing?.key === key
      ? (
        <div className={css.actions}>
          <textarea className={css.input} rows={2} autoFocus placeholder={placeholder} value={editing.text} onChange={(event) => { setEditing({ key, text: event.target.value }) }} />
          {verb('记下', '一个字节不改地落账', () => { const text = editing.text.trim(); if (text !== '') void run(() => submit(text)) })}
          {verb('算了', '不记', () => { setEditing(undefined) })}
        </div>
      )
      : null
  )

  const pledgeRow = (row: PledgeRowWire): ReactNode => (
    <div key={row.expectationId}>
      <div className={css.row}>
        <span className={css.mark}>{row.status === 'withdrawn' ? '↩' : row.premise === 'changed' ? '⚠' : row.status === 'due' ? '⏳' : '🌱'}</span>
        <span className={css.rowMain}>
          「{row.text}」 · <b>
            {row.status === 'withdrawn' ? '已撤回' : row.premise === 'changed' ? '前提已变' : row.status === 'due' ? `已过 ${row.checkpointText}，还没结果` : `${row.checkpointText}见分晓`}
          </b>
          <span className={css.rowNote}>押在：{row.verdict.text} · {when(row.verdict.at)}{row.reason === undefined || row.reason === '' ? '' : ` · ${row.reason}`}</span>
          {row.premise === 'changed' && row.status !== 'withdrawn' && (
            <span className={css.rowNote}>⚠ 你押的那条裁决已作废 / 已移交。撤回是诚实，照旧对也完全正当——由你定。</span>
          )}
        </span>
        <span className={css.verbs}>
          {row.status === 'due' && verb('补一句结果', '图外的事实只能由你说——系统不猜图外', () => { setEditing({ key: `note:${row.expectationId}`, text: '' }) })}
          {row.status !== 'withdrawn' && verb('撤回', '撤回留痕不删史；撤回之后这条裁决不能再押', () => { setEditing({ key: `withdraw:${row.expectationId}`, text: '' }) })}
          {row.premise === 'changed' && row.status !== 'withdrawn' && verb('照旧对', '什么都不写：把这一行当作照旧，是你的选择', () => { setNote('好，照旧对。结果来的时候回执照样会出。') })}
          {verb('看 ›', '右栏摆开当时的照片', () => { setJudgSelection({ kind: 'expectation', id: row.expectationId }) }, selected?.kind === 'expectation' && selected.id === row.expectationId)}
        </span>
      </div>
      {inlineInput(`note:${row.expectationId}`, '后来到底怎么样了？用你自己的话说一句。', text => inject.noteFact({ text, expectationId: row.expectationId }))}
      {inlineInput(`withdraw:${row.expectationId}`, '为什么撤回？（留空也行）', text => inject.withdrawExpectation(row.expectationId, text))}
    </div>
  )

  const receiptRow = (row: ReceiptRowWire, head: FamilyHeadWire): ReactNode => (
    <div key={row.calibrationId}>
      <div className={css.row}>
        <span className={css.mark}>{row.dismissed ? '—' : row.attributionLabel !== undefined ? <span className={css.tag}>{row.attributionLabel}</span> : '📮'}</span>
        <span className={css.rowMain}>
          {row.verdict.text} → {row.later[0]?.text ?? '（等结果）'}
          <span className={css.rowNote}>
            {TYPE_LABEL[row.type]} · {when(row.verdict.at)}{row.later[0] === undefined ? '' : ` → ${when(row.later[0].at)}`}
            {row.dismissed ? ' · 没记入' : row.attributionLabel === undefined ? ' · 还没定' : ''}
          </span>
          {row.attributionLabel === undefined && !row.dismissed && (
            <span className={css.actions}>
              <b>这次算什么？</b>（你来定）
              {CELLS.map(cell => (
                <button key={cell.id} type="button" className={css.verb} disabled={busy} title={cell.note(row)} onClick={() => { void run(() => inject.attribute(row.calibrationId, cell.id)) }}>{cell.label}</button>
              ))}
              {verb('这不是那件事的结果', '判例不入账；想记回来再按一格即可', () => { void run(() => inject.dismissReceipt(row.calibrationId)) })}
            </span>
          )}
        </span>
        <span className={css.verbs}>
          {row.attributionLabel !== undefined && verb('改', '想改随时改——更正即追加', () => { setEditing({ key: `attr:${row.calibrationId}`, text: '' }) })}
          {row.dismissed && CELLS.map(cell => verb(cell.label, '记回来', () => { void run(() => inject.attribute(row.calibrationId, cell.id)) }))}
          {row.attributionLabel !== undefined && verb('以后这类事… ›', '先看本族的 2×2，再决定改不改规矩', () => { setGearAt(gearAt === row.calibrationId ? undefined : row.calibrationId) })}
          {verb('看 ›', '右栏摆开当时与后来的照片', () => { setJudgSelection({ kind: 'calibration', id: row.calibrationId }) }, selected?.kind === 'calibration' && selected.id === row.calibrationId)}
        </span>
      </div>
      {editing?.key === `attr:${row.calibrationId}` && (
        <div className={css.actions}>{CELLS.map(cell => verb(cell.label, cell.note(row), () => { void run(() => inject.attribute(row.calibrationId, cell.id)) }, cell.id === row.attribution))}</div>
      )}
      {gearAt === row.calibrationId && <GearBox head={head} inject={inject} busy={busy} done={(text) => { setGearAt(undefined); setNote(text); void reload() }} />}
    </div>
  )

  return (
    <div className={`${tokens.tokens} ${css.vault}`}>
      <div className={css.head}>
        <span className={css.title}>🔒 我的判断</span>
        <span className={css.sub}>你签发过的裁决，和后来发生的事。</span>
        <button type="button" className={css.back} onClick={back}>‹ 返回承诺板</button>
      </div>
      <div className={css.contract}>
        <span className={css.chip}>只有你能看到</span>
        <span className={css.chip}>不进公司的账</span>
        <span className={css.chip}>随时可以整本带走</span>
        <button type="button" className={css.chipMore} onClick={() => { setContractOpen(true) }}>📜 判断力档案 ›</button>
      </div>
      {contractOpen && <YzjJudgContract inject={inject} close={() => { setContractOpen(false); void reload() }} />}
      <div className={css.body}>
        {note !== undefined && <p className={css.error}>{note}</p>}
        {view === undefined && <div className={css.empty}>账本还没打开——云之家身份还没就绪，或者这个部署没有启用私账层。</div>}
        {view !== undefined && view.empty && view.groups.length === 0 && (
          <div className={css.empty}>还没有内容——押和结果都从你自己的裁决长出来。押是你的动词，系统不会来问；在任一会话的私语道里说「押：……」就记下了。</div>
        )}
        {view?.groups.map(group => (
          <div key={group.head.family}>
            <div className={css.section}>
              {group.head.label} · {group.head.count} 次裁决
              <span className={css.verbs} style={{ float: 'right' }}>
                {verb('以后这类事… ›', '先看本族的 2×2，再决定改不改规矩', () => { setGearAt(gearAt === `fam:${group.head.family}` ? undefined : `fam:${group.head.family}`) })}
              </span>
              <div><HeadLine head={group.head} /></div>
            </div>
            {gearAt === `fam:${group.head.family}` && <GearBox head={group.head} inject={inject} busy={busy} done={(text) => { setGearAt(undefined); setNote(text); void reload() }} />}
            {group.rows.length === 0
              ? <div className={css.empty}>近 {String(view.window.days)} 天没有结果回来。</div>
              : group.rows.map(row => (row.kind === 'pledge' ? pledgeRow(row) : receiptRow(row, group.head)))}
          </div>
        ))}
        <div className={css.refuse}>这里没有分数、没有排名、没有别人的账。</div>
        <div className={css.destroy}>
          <div className={css.section}>带走 · 销毁</div>
          <div className={css.empty}>这本账在：<code>{view?.directory ?? '（还没打开）'}</code>。拷走这个目录就是取走全账。</div>
          <div className={css.destroyRow}>
            {verb('判例册', '生成人可读的判例册（页眉带四个数）。读操作，不写任何事件。', () => { void inject.judgExport().then((result) => { setTakeout(result?.casebook) }) })}
          </div>
          {takeout !== undefined && <div className={`${css.empty} ${css.take}`}>{takeout}</div>}
          <div className={css.destroyRow}>
            <input className={css.input} value={confirm} placeholder={`销毁不可逆：原样输入「${view?.destroyPhrase ?? ''}」以确认`} onChange={(event) => { setConfirm(event.target.value) }} />
            <button type="button" className={css.danger} disabled={busy || view === undefined || confirm !== view.destroyPhrase} onClick={() => { void run(async () => { const result = await inject.destroyVault(confirm); if (result.error === undefined) setConfirm(''); return result }) }}>销毁整本账</button>
          </div>
        </div>
      </div>
    </div>
  )
}
