/**
 * 私账合同面板 —— **与场所合同同一语法、同一组件族** (v2.1 = #61 澄清②).
 *
 * 它复用 `contract.module.css`，而那不是省事：**一份合同长得像合同，人才会当合同
 * 读**。金库 Header 上那排 chips 从此是这一面的入口摘要（信号即门）——「说明文字
 * 占位同罪」对 chips 自身适用，一句点不开的「仅你可见」，人只能选择信或不信。
 *
 * 两处与场所合同不同，都是这份合同的特殊性本身：
 *
 * - **硬区列的是「为什么改不了」**，不是「请勿修改」。每一条带着它的机械保证形态
 *   （policy / import 禁令 / 无查询形态 / schema 面 / 参数面）——一条 guard 拦得住
 *   而面板说不清的规矩，和一条没人执行的规矩一样不可信。
 * - **agent 无提议权.** 场所合同的软项 agent 可以提议修改；这一份不行。
 *   **另一半签署人是你自己，没有对方代表可以递案。**
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { SurfaceInject, VaultContractWire } from './rpc.ts'
import tokens from './tokens.module.css'
import css from './contract.module.css'

export interface VaultContractPanelProps {
  inject: SurfaceInject
  close(): void
}

export function YzjVaultContract(props: VaultContractPanelProps): ReactNode {
  const { inject, close } = props
  const [view, setView] = useState<VaultContractWire | undefined>(undefined)

  useEffect(() => { void inject.vaultContract().then(setView) }, [inject])

  return (
    <div className={`${tokens.tokens} ${css.mask}`} onClick={close}>
      <div
        className={css.panel}
        role="dialog"
        aria-label="私账合同"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.head}>
          <span className={css.avatar}>🔒</span>
          <span>
            <div className={css.title}>我的判断（金库）· 这本账的合同</div>
            <div className={css.sub}>
              另一半签署人：{view?.signedBy ?? '你自己'}
            </div>
          </span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭">×</button>
        </div>

        {view === undefined
          ? <div className={css.calm}>读取中…</div>
          : (
            <>
              <section className={css.section}>
                <div className={css.sectionHead}>
                  硬合同
                  <span className={`${css.tag} ${css.tagHard}`}>机械保证 · 对话改不动</span>
                </div>
                {/*
                  每一行陈列的是**为什么改不了**。

                  「请勿修改」是一句请求，而请求会被下一个赶工期的人绕过；
                  「这个查询面上没有 viewer 参数」是一件说得出口、也查得到的事。
                */}
                {view.hard.map(term => (
                  <div className={css.row} key={term.label}>
                    <span className={css.key}>{term.label}</span>
                    <span className={css.value}>
                      <b>{term.guarantee}</b>
                      <div className={css.note}>{term.how}</div>
                    </span>
                  </div>
                ))}
              </section>

              <section className={css.section}>
                <div className={css.sectionHead}>
                  软合同 · 换挡台参数
                  <span className={`${css.tag} ${css.tagSoft}`}>可调 · 只由你在金库里调</span>
                </div>
                {/*
                  **可调项恰是软合同的同构位**，而每一行都写出两个方向的代价。

                  一个只说「调大更宽松」的参数面，会让人一路调到底然后关掉整个功能。
                */}
                {view.soft.map(term => (
                  <div className={css.row} key={term.label}>
                    <span className={css.key}>{term.label}</span>
                    <span className={css.value}>
                      <b>{term.value}</b>
                      {' · '}
                      {/*
                        **「改在哪儿」要是一扇门，不是一句说明**（信号即门）。

                        我在这份合同里写着「说不出在哪儿改的可调，和不可调没有分别」
                        ——那么一句点不开的「金库 · 配额行」，离那句话也就只差一步。
                        面板关掉，人就站在金库里，那一行就在眼前。

                        P1 固定的那两条**不画门**：它们此刻真的没有入口，而画一扇
                        推不开的门比不画更糟。
                      */}
                      {term.where.startsWith('金库')
                        ? (
                          <button type="button" className={css.serveBtn} onClick={close}>
                            去改：{term.where} ›
                          </button>
                        )
                        : <>改在 {term.where}</>}
                      <div className={css.note}>{term.cost}</div>
                    </span>
                  </div>
                ))}
              </section>

              {/*
                这份合同和场所合同**唯一的语法差别**，摆在最后，因为它才是全部特殊性。

                它不是一条运行时检查，是一处**缺席**：模型工具的动作枚举里没有这些
                参数，agent 连提议的通道都不存在。
              */}
              <div className={css.gate}>
                <b>agent 在这份合同上没有提议权。</b>
                {view.note}
              </div>
            </>
          )}
      </div>
    </div>
  )
}
