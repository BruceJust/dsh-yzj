/**
 * 判断力档案 —— 合同面板的私账一节（决策 #64 §4）。
 *
 * 硬合同五条各列「系统保证」（只读、guard 强制）；软合同 = 你定的规矩（clause 句子），
 * 可删。**agent 无提议权**：另一半签署人是你自己，没有对方代表可以递案。
 *
 * 屏上只写人听得懂的那一半：每条保证写「是什么」，不写「怎么做到的」（`how` 是工程
 * 证明，留在数据里给判例册和审计看，律一）。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { JudgContractWire, SurfaceInject } from './rpc.ts'
import { Icon } from './icons.tsx'
import { AGENT } from './words.ts'
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
          <span className={`${css.avatar} ${css.avatarPri}`}><Icon name="lock" size={16} /></span>
          <span>
            <div className={css.title}>你的判断记录</div>
            <div className={css.sub}>只有你看得到，也只有你能改</div>
          </span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭"><Icon name="x" size={14} /></button>
        </div>
        {view === undefined
          ? <div className={css.calm}>读取中…</div>
          : (
            <>
              <section className={css.section}>
                <div className={css.sectionHead}>
                  这本账<span className={`${css.tag} ${css.tagHard}`}>系统保证，改不了</span>
                </div>
                {view.hard.map(term => (
                  <div className={css.row} key={term.label}>
                    <span className={css.key}>{term.label}</span>
                    <span className={css.value}>{term.value}</span>
                  </div>
                ))}
              </section>
              <section className={css.section}>
                <div className={css.sectionHead}>
                  你定的规矩<span className={`${css.tag} ${css.tagSoft}`}>说一句就改</span>
                </div>
                {view.soft.length === 0
                  ? <div className={css.calm}>还没有。在「仅你和{AGENT}」里说一句「以后验收前先看证据」，就记在这里。</div>
                  : view.soft.map(term => (
                    <div className={css.row} key={term.clauseId}>
                      <span className={css.key}>{term.key === 'lease' ? '你签的' : '你说的'}</span>
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
                        {term.key === 'lease' && <div className={css.note}>这条规矩记在公司的账上，这里只留你签过它的一笔。要收回，到那个群的「{AGENT}在这里的规则」里收回。</div>}
                      </span>
                    </div>
                  ))}
              </section>
              <div className={css.gate}>{AGENT}往这本账里写不了东西，也提不了建议——只有你能动它。</div>
            </>
          )}
      </div>
    </div>
  )
}
