/**
 * 今天自己办了的 (界面重设计 律九 · §5.8) —— 「要你」清零时那一行点开的东西。
 *
 * 每件写明凭的是什么：你签的哪条规矩，或者群里谁的那句话。规矩办的那几件旁边有
 * 「这件不该自己办」——点了，那条规矩就收回，以后这类事又会每次问你。收紧是人的动作，
 * 这里只把门放在手边；云小助从不替人改规矩。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AutoHandledWire, SurfaceInject } from './rpc.ts'
import { openPalette, startOfToday } from './keys.ts'
import { openSessionNow, setFrame } from './store.ts'
import { Icon } from './icons.tsx'
import { AGENT, whenOf } from './words.ts'
import css from './auto.module.css'

export function AutoHandledSheet(props: { inject: SurfaceInject }): ReactNode {
  const { inject } = props
  const [rows, setRows] = useState<readonly AutoHandledWire[] | undefined>(undefined)
  const [asking, setAsking] = useState<string | undefined>(undefined)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setRows(await inject.autoHandled(startOfToday()) ?? [])
  }, [inject])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); openPalette('closed') }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  const revoke = (leaseId: string): void => {
    setBusy(true)
    void inject.cardAct('lease', leaseId, 'revoke', '这件不该自己办').then((result) => {
      setBusy(false)
      setAsking(undefined)
      setNote(result?.outcome === 'applied' ? '收回了。以后这类事又会每次问你。' : result?.receipt ?? '没收回来，再试一次。')
      void load()
    })
  }

  const now = Date.now()
  return (
    <div className={css.sheet} role="dialog" aria-label="今天自己办了的" onClick={(event) => { event.stopPropagation() }}>
      <div className={css.head}>
        <span className={css.title}>今天{AGENT}自己办了的</span>
        <button type="button" className={css.close} aria-label="关闭" onClick={() => { openPalette('closed') }}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {note !== '' && <div className={css.note}>{note}</div>}
      <div className={css.list}>
        {rows === undefined && <div className={css.calm}>正在读…</div>}
        {rows !== undefined && rows.length === 0 && (
          <div className={css.calm}>今天还没有没问你就办的事。你签了规矩之后，那一类事{AGENT}会自己办，办了都记在这里。</div>
        )}
        {rows?.map((row, index) => {
          const key = `${String(row.at)}:${String(index)}`
          return (
            <div className={css.row} key={key}>
              <div className={css.line}>
                <span className={css.what}>{row.what}</span>
                <span className={css.when}>{whenOf(row.at, now)}</span>
              </div>
              <div className={css.why}>
                {row.placeName !== undefined && row.sessionId !== undefined && (
                  <button
                    type="button"
                    className={css.place}
                    onClick={() => {
                      openPalette('closed')
                      setFrame({ kind: 'session' })
                      openSessionNow(row.sessionId as string)
                    }}
                  >
                    {row.placeName}<Icon name="chevR" size={12} />
                  </button>
                )}
                <span className={css.by}>
                  {row.by.kind === 'lease' ? `凭你签的规矩：${row.by.rule}` : `凭${row.by.who}在群里叫它做的`}
                </span>
              </div>
              {row.by.kind === 'lease' && (
                row.by.active
                  ? asking === key
                    ? (
                      <div className={css.ask}>
                        <span>收回「{row.by.rule}」？以后这类事又会每次问你。</span>
                        <button type="button" className={css.danger} disabled={busy} onClick={() => { revoke((row.by as { leaseId: string }).leaseId) }}>收回</button>
                        <button type="button" className={css.ghost} onClick={() => { setAsking(undefined) }}>算了</button>
                      </div>
                    )
                    : (
                      <button type="button" className={css.wrong} onClick={() => { setAsking(key) }}>这件不该自己办</button>
                    )
                  : <span className={css.gone}>这条规矩已经收回了</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
