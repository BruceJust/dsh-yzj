/**
 * 判断力档案 —— 合同面板的私账一节（决策 #64 §4）。
 *
 * 硬合同五条各列「系统保证」（只读、guard 强制）；软合同 = 你定的规矩（clause 句子），
 * 可删。**agent 无提议权**：另一半签署人是你自己，没有对方代表可以递案。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { JudgContractWire, SurfaceInject } from './rpc.ts'
import tokens from './tokens.module.css'
import css from './contract.module.css'

export interface JudgContractProps {
  inject: SurfaceInject
  close(): void
}

export function YzjJudgContract(props: JudgContractProps): ReactNode {
  const { inject, close } = props
  const [view, setView] = useState<JudgContractWire | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (): Promise<void> => { setView(await inject.judgContract()) }, [inject])
  useEffect(() => { void load() }, [load])

  return (
    <div className={`${tokens.tokens} ${css.mask}`} onClick={close}>
      <div className={css.panel} role="dialog" aria-label="判断力档案" onClick={(event) => { event.stopPropagation() }}>
        <div className={css.head}>
          <span className={css.avatar}>🔒</span>
          <span>
            <div className={css.title}>你的判断记录</div>
            <div className={css.sub}>另一半签署人：{view?.signedBy ?? '你自己'}</div>
          </span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭">×</button>
        </div>
        {view === undefined
          ? <div className={css.calm}>读取中…</div>
          : (
            <>
              <section className={css.section}>
                <div className={css.sectionHead}>
                  你的判断记录<span className={`${css.tag} ${css.tagHard}`}>只有你</span>
                </div>
                {view.hard.map(term => (
                  <div className={css.row} key={term.label}>
                    <span className={css.key}>{term.label}</span>
                    <span className={css.value}>
                      <b>{term.value}</b>
                      <span className={`${css.tag} ${css.tagHard}`} style={{ marginLeft: 8 }}>系统保证</span>
                      <div className={css.note}>{term.how}</div>
                    </span>
                  </div>
                ))}
                <div className={css.note}>我只在你要看的时候拿出来，不拿它去改别的事。</div>
              </section>
              <section className={css.section}>
                <div className={css.sectionHead}>
                  你定的规矩<span className={`${css.tag} ${css.tagSoft}`}>说一句就改</span>
                </div>
                {view.soft.length === 0
                  ? <div className={css.calm}>（还没有——在私语道里说一句「以后验收前先看证据」就记下了）</div>
                  : view.soft.map(term => (
                    <div className={css.row} key={term.clauseId}>
                      <span className={css.key}>{term.key === 'lease' ? '租约' : '你定的'}</span>
                      <span className={css.value}>
                        「{term.text}」
                        {term.key !== 'lease' && (
                          <button
                            type="button"
                            className={css.serveBtn}
                            disabled={busy}
                            style={{ marginLeft: 8 }}
                            onClick={() => {
                              setBusy(true)
                              void inject.clearClause(term.key, term.family).then(() => { setBusy(false); void load() })
                            }}
                          >
                            删
                          </button>
                        )}
                        {term.key === 'lease' && <div className={css.note}>租约本体在公司的账上（授权租约）；这里只记你签发过它。要收回，去那张租约卡上。</div>}
                      </span>
                    </div>
                  ))}
              </section>
              <div className={css.gate}>
                <b>agent 在这份合同上没有提议权。</b>
                另一半签署人是你自己——模型没有写私账的工具，连提议的通道都不存在。
              </div>
            </>
          )}
      </div>
    </div>
  )
}
