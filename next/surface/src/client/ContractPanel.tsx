/**
 * 场所合同面板 (§8) — what this agent may do here, and where that comes from.
 *
 * Opened from the agent chip, which is where the question actually occurs to
 * somebody: they are looking at the agent, in a place, wondering what it is
 * allowed to do in it.
 *
 * Every row is read from something that already decides behaviour — the
 * contract the guard consults, the write table it gates on, the escape list it
 * enforces, the revocations it re-checks per call. Nothing here is a second
 * copy of a policy, because a panel that could disagree with the guard would
 * be the one lying, and a policy display people cannot trust is worse than
 * none.
 *
 * The lease section is absent rather than empty: nothing can grant one yet
 * (段 6, 疼痛门), and an empty box would read as a feature nobody uses — which
 * is exactly the signal that gate needs kept clean.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ContractViewWire, SurfaceInject } from './rpc.ts'
import tokens from './tokens.module.css'
import css from './contract.module.css'

const MEMORY_POLICY: Record<string, { label: string; detail: string }> = {
  normal: { label: '正常记忆', detail: '这里学到的惯例会被记下来，并注入后续回合' },
  'facts-only': { label: '只记事实', detail: '只保留可核对的事实，不蒸馏判断' },
  never: { label: '永不记忆', detail: '硬合同项：可读域受限，审计导出也触及不到' },
}

export interface ContractPanelProps {
  placeKey: string
  inject: SurfaceInject
  close(): void
}

export function YzjContractPanel(props: ContractPanelProps): ReactNode {
  const { placeKey, inject, close } = props
  const [view, setView] = useState<ContractViewWire | undefined>(undefined)
  /** 接单开关按下之前的那一问。 */
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setView(await inject.contract(placeKey))
  }, [inject, placeKey])

  useEffect(() => { void load() }, [load])

  const policy = MEMORY_POLICY[view?.memoryPolicy ?? 'normal'] ?? MEMORY_POLICY.normal

  return (
    <div className={`${tokens.tokens} ${css.mask}`} onClick={close}>
      <div className={css.panel} role="dialog" aria-label="场所合同" onClick={(event) => { event.stopPropagation() }}>
        <div className={css.head}>
          <span className={css.avatar}>AI</span>
          <span>
            <div className={css.title}>云小助 · 在「{view?.groupName ?? placeKey}」</div>
            <div className={css.sub}>
              场所合同 v{String(view?.version ?? 0)}
              {view?.version === 0 && ' · 继承组织默认，本场所尚未单独写过'}
            </div>
          </span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭">×</button>
        </div>

        {view === undefined
          ? <div className={css.calm}>读取中…</div>
          : (
            <>
              {/*
                接单与否是这一屏的第一个前提：下面每一行讲的都是「agent 在这里
                可以做什么」，而在一个它不接单的场所，答案是「什么都做不了，因为
                它不在这儿」。开关本身不在这里给——那是部署的爆炸半径，同模型
                那一格：说清事实和它改在哪儿。
              */}
              <section className={css.section}>
                <div className={css.sectionHead}>
                  接单
                  <span className={`${css.tag} ${view.onDuty === false ? css.tagSoft : css.tagHard}`}>
                    {view.onDuty === false ? '未接单' : '在岗'}
                  </span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>本场所</span>
                  <span className={css.value}>
                    {view.onDuty === false
                      ? <>
                        agent <b>不在这里应答</b>。人和人照常说话、照常回复；
                        在这里 @ 它会被<b>拦在发送之前</b>，而不是发出去等一个永远不来的回复。
                      </>
                      : <>agent 在这里接单：@ 它或回复它的消息都会起一个回合。</>}
                    <div className={css.note}>
                      接单范围是这套部署的<b>爆炸半径</b>。所以开关在这里，不在会话列里
                      ——四十多行里每行挂一个一键开关，等于邀请人顺手把 agent 能读能写的
                      范围扩大。改动立刻生效，也跨重启存活。
                    </div>
                    {/*
                      按之前先说清楚会发生什么。接入不是「让它能回话」这么一件事：
                      轮询会开始读这个会话的历史，话题会长在这里，登记的承诺卡也会
                      投进来。这些都不是按下去之后才该知道的。
                    */}
                    {asking
                      ? (
                        <div className={css.confirm}>
                          <div className={css.confirmBody}>
                            {view.onDuty === false
                              ? <>
                                接入「{view.groupName}」之后：轮询会<b>读它的历史</b>、
                                话题会长在这里、<b>@ 会被应答</b>、登记的承诺卡也会投到这里。
                              </>
                              : <>
                                移出服务之后：这里不再被轮询，<b>agent 看不见</b>新消息；
                                已经长出来的话题还在，但不会再有新的。
                              </>}
                          </div>
                          <div className={css.confirmActs}>
                            <button
                              type="button"
                              className={css.confirmGo}
                              disabled={busy}
                              onClick={() => {
                                setBusy(true)
                                void inject.setServed(placeKey, view.onDuty === false)
                                  .then((result) => {
                                    setBusy(false)
                                    setAsking(false)
                                    if (result.error !== undefined) setNote(result.error)
                                    else void load()
                                  })
                              }}
                            >
                              {busy ? '处理中…' : view.onDuty === false ? '确认接入' : '确认移出'}
                            </button>
                            <button
                              type="button"
                              className={css.confirmNo}
                              onClick={() => { setAsking(false) }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )
                      : (
                        <button
                          type="button"
                          className={css.serveBtn}
                          onClick={() => { setAsking(true) }}
                        >
                          {view.onDuty === false ? '接入这个会话' : '移出服务'}
                        </button>
                      )}
                    {note !== '' && <div className={css.noteBad}>{note}</div>}
                  </span>
                </div>
              </section>

              <section className={css.section}>
                <div className={css.sectionHead}>
                  硬合同<span className={`${css.tag} ${css.tagHard}`}>guard 强制 · 对话改不动</span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>不可撤销操作</span>
                  <span className={css.value}>
                    {view.strongTools.length} 个，<b>每次都问</b>，租约永远盖不住
                    <ul className={css.list}>
                      {view.strongTools.map(tool => (
                        <li key={tool.name}>
                          <code>{tool.name}</code> — {tool.reason}
                        </li>
                      ))}
                    </ul>
                  </span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>可逆写</span>
                  <span className={css.value}>
                    {view.standardCount} 个。<b>只在接纳它的那条消息所属的回合内</b>免确认——
                    早先的回合与桌面提问都不继承这份授权。
                  </span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>禁用工具</span>
                  <span className={css.value}>
                    云之家触发的回合永远够不到：
                    {' '}
                    {view.bannedTools.map(name => <code className={css.code} key={name}>{name}</code>)}
                    <div className={css.note}>
                      一条消息给的是「用云之家」的权限，不是「跑任何东西」的权限。
                    </div>
                  </span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>走组织审批</span>
                  <span className={css.value}>
                    {view.oaRequiredCategories.length === 0
                      ? '暂无类目。命中的类目会被直接拒绝——本地确认卡不能冒充组织许可。'
                      : view.oaRequiredCategories.join('、')}
                  </span>
                </div>
              </section>

              <section className={css.section}>
                <div className={css.sectionHead}>
                  软合同<span className={`${css.tag} ${css.tagSoft}`}>可对话修改</span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>记忆策略</span>
                  <span className={css.value}><b>{policy?.label}</b> · {policy?.detail}</span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>过程摘要</span>
                  <span className={css.value}>
                    {view.processSummary ? '开：非平凡任务在终态回帖里附带做过什么' : '关'}
                  </span>
                </div>
              </section>

              <section className={css.section}>
                <div className={css.sectionHead}>
                  授权撤销<span className={`${css.tag} ${css.tagHard}`}>穿透快照 · 逐调用实时查</span>
                </div>
                {view.revocations.length === 0
                  ? <div className={css.calm}>还没有撤销过任何一次授权。</div>
                  : view.revocations.map(item => (
                    <div className={css.row} key={item.messageId}>
                      <span className={css.key}>{new Date(item.time).toLocaleString('zh-CN')}</span>
                      <span className={css.value}>
                        <code className={css.code}>{item.messageId.slice(0, 12)}…</code> {item.reason}
                      </span>
                    </div>
                  ))}
              </section>

              {!view.leasesAvailable && (
                <div className={css.gate}>
                  <b>授权租约还没有开门。</b>
                  guard 的判定序里已经给它留好位置（租约命中先于合同写级），
                  但目前没有任何东西能签发一张——它押在「审批疲劳真实发生」这道疼痛门后面。
                  这里不画一个空清单，因为空清单看起来像「有这功能、没人用」。
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}
