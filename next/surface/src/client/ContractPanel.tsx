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
  /**
   * 触发者范围 (决策 #63)：对群在岗（会向群发在岗声明）/ 仅本人（不公告、不算在岗）。
   * 接单是身份/听众敏感的主权动作，范围是它的第一个参数，不是事后的设置。
   */
  const [scope, setScope] = useState<'all' | 'self' | 'standby'>('all')
  /** 第二在岗押门：已有同侪对群在岗时，这一次没有接——两条出口在这儿。 */
  const [conflict, setConflict] = useState<
    { name: string; since: number; draft?: string } | undefined
  >(undefined)
  const [copied, setCopied] = useState(false)
  /** 退岗时本群场所记忆的脱密拟稿：越境律，人签发——发不发、发给谁归你。 */
  const [memoryDraft, setMemoryDraft] = useState<string | undefined>(undefined)

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
                    {view.onDuty === false
                      ? '未接单'
                      : view.presence?.self === 'self' ? '仅本人' : view.presence?.self === 'standby' ? '备岗' : '对群在岗'}
                  </span>
                </div>
                <div className={css.row}>
                  <span className={css.key}>本场所</span>
                  <span className={css.value}>
                    {view.onDuty === false
                      ? <>
                        agent <b>不在这里应答</b>。人和人照常说话、照常回复；
                        {(view.presence?.peers.length ?? 0) > 0
                          ? <>在这里 @ 它，这句话会<b>由本群在岗的同侪实例接单</b>，本机不动手。</>
                          : <>在这里 @ 它会被<b>拦在发送之前</b>，而不是发出去等一个永远不来的回复。</>}
                      </>
                      : view.presence?.self === 'self'
                        ? <>
                          agent 在这里<b>只应答你自己</b>：同事 @ 它不由本机接（一个群一次受话
                          一个接单者；仅本人不声明、不算在岗，与别人的实例天然无冲突）。
                        </>
                        : view.presence?.self === 'standby'
                          ? <>
                            agent 在这里<b>备岗</b>：你自己的 @ 立刻接；同事的 @ 先让在岗实例，
                            无人应答时按备岗序等一到几个轮询周期再接。不公告、不算在岗。
                          </>
                        : <>
                          agent 在这里<b>接受全群委派</b>：@ 它或回复它的消息都会起一个回合。
                          {view.presence?.selfAnchor === undefined
                            ? <>
                              <span className={css.noteBad}>还没向群发过在岗声明——群里不知道它在岗。</span>
                              {/*
                                部署名单里的群是配置签的岗，不是人对着群签的。补这一帖仍然要
                                人按——它是身份/听众敏感的动作，不自动发。
                              */}
                              <button
                                type="button"
                                className={css.serveBtn}
                                disabled={busy}
                                onClick={() => {
                                  setBusy(true)
                                  void inject.setServed(placeKey, true, 'all').then((result) => {
                                    setBusy(false)
                                    if (result.error !== undefined) setNote(result.error)
                                    else if (result.conflict !== undefined) {
                                      setConflict({
                                        name: result.conflict.name,
                                        since: result.conflict.since,
                                        ...(result.draft === undefined ? {} : { draft: result.draft }),
                                      })
                                    } else {
                                      setNote(result.announced === false ? '在岗声明帖没发出去——群里还不知道它在岗。' : '')
                                      void load()
                                    }
                                  })
                                }}
                              >
                                向群发在岗声明
                              </button>
                            </>
                            : <>已向群发过在岗声明。</>}
                          <div className={css.note}>
                            已知缺陷：这台电脑合盖离线时，本群<b>无人接单，而群里不会知道</b>
                            （寄生期 agent 的可用性寄生在个人电脑上；专号/机器人阶段解决）。
                          </div>
                        </>}
                    {/*
                      **同侪在岗** (决策 #63)：署名识别出来的、在这个群对群在岗的别的实例。
                      群里 N 个都叫「云小助」，这一行说清此刻谁在岗——也是「我的 agent 为什么
                      没接」的第一个答案。
                    */}
                    {(view.presence?.peers.length ?? 0) > 0 && (
                      <div className={css.note}>
                        本群在岗的同侪实例：
                        {(view.presence?.peers ?? []).map(peer => (
                          <span key={peer.openId}> 云小助（{peer.name}）</span>
                        ))}
                        。一个场所一次受话一个接单者——同事的 @ 由它接，你自己的 @ 仍由你的实例接。
                      </div>
                    )}
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
                    {memoryDraft !== undefined && (
                      <div className={css.confirm}>
                        <div className={css.confirmBody}>
                          <b>在岗移交的背景包。</b>这个群里助理学到的惯例（场所记忆）拟成了一段话——
                          越境须人签发，所以它只是拟稿：发不发、发给接岗的谁，都是你的。私语不迁移。
                        </div>
                        <textarea className={css.draft} readOnly value={memoryDraft} rows={4} />
                        <div className={css.confirmActs}>
                          <button
                            type="button"
                            className={css.confirmNo}
                            onClick={() => {
                              void navigator.clipboard?.writeText(memoryDraft)
                                .then(() => { setCopied(true) }, () => { setCopied(false) })
                            }}
                          >
                            {copied ? '已复制' : '复制拟稿'}
                          </button>
                          <button type="button" className={css.confirmNo} onClick={() => { setMemoryDraft(undefined) }}>
                            收起
                          </button>
                        </div>
                      </div>
                    )}
                    {conflict !== undefined && (
                      /*
                        第二在岗押门 (P1)：分工需要名字，名字需要专号。在那之前一个群只能有
                        一个对群在岗的实例。两条出口——请对方退岗（拟稿亲发，社交摩擦不碰）、
                        或改为仅本人（只服务你自己，天然无冲突）。
                      */
                      <div className={css.confirm}>
                        <div className={css.confirmBody}>
                          <b>没有接。</b>本群已有 云小助（{conflict.name}）对群在岗
                          （{new Date(conflict.since).toLocaleString('zh-CN', { hour12: false })} 声明）。
                          一个群一次受话一个接单者，第二个在岗此阶段不接。
                        </div>
                        {conflict.draft !== undefined && (
                          <>
                            <div className={css.note}>请对方退岗的话，你亲自发（拟稿，不代发）：</div>
                            <textarea className={css.draft} readOnly value={conflict.draft} rows={3} />
                          </>
                        )}
                        <div className={css.confirmActs}>
                          {conflict.draft !== undefined && (
                            <button
                              type="button"
                              className={css.confirmNo}
                              onClick={() => {
                                void navigator.clipboard?.writeText(conflict.draft ?? '')
                                  .then(() => { setCopied(true) }, () => { setCopied(false) })
                              }}
                            >
                              {copied ? '已复制' : '复制拟稿'}
                            </button>
                          )}
                          <button
                            type="button"
                            className={css.confirmGo}
                            disabled={busy}
                            onClick={() => {
                              setBusy(true)
                              void inject.setServed(placeKey, true, 'self').then((result) => {
                                setBusy(false)
                                setConflict(undefined)
                                if (result.error !== undefined) setNote(result.error)
                                else void load()
                              })
                            }}
                          >
                            改为仅本人接入
                          </button>
                          <button type="button" className={css.confirmNo} onClick={() => { setConflict(undefined) }}>
                            先不接
                          </button>
                        </div>
                      </div>
                    )}
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
                                {view.presence?.self === 'all' && <>会向群发一条<b>退岗帖</b>。</>}
                              </>}
                          </div>
                          {view.onDuty === false && (
                            /*
                              范围是接单的第一个参数 (决策 #63)。对群在岗 = 把你的账号与授权借给
                              这个群，向群公告一次（群即审计面）；仅本人 = 只应答你，不公告。
                            */
                            <div className={css.choice}>
                              <label>
                                <input
                                  type="radio"
                                  name="serve-scope"
                                  checked={scope === 'all'}
                                  onChange={() => { setScope('all') }}
                                />
                                <b>接受全群委派</b>（对群在岗）——同事也能 @ 它；会向群发一条在岗声明，
                                一个群只能有一个在岗实例。
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name="serve-scope"
                                  checked={scope === 'self'}
                                  onChange={() => { setScope('self') }}
                                />
                                <b>仅本人</b>——只应答你自己的 @；不公告，和别人的实例天然无冲突。
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name="serve-scope"
                                  checked={scope === 'standby'}
                                  onChange={() => { setScope('standby') }}
                                />
                                <b>备岗</b>——无人应答时才接同事的 @（按备岗序多等一到几个轮询周期）；不公告、不算在岗。
                              </label>
                            </div>
                          )}
                          <div className={css.confirmActs}>
                            <button
                              type="button"
                              className={css.confirmGo}
                              disabled={busy}
                              onClick={() => {
                                setBusy(true)
                                const turningOn = view.onDuty === false
                                void inject.setServed(placeKey, turningOn, turningOn ? scope : undefined)
                                  .then((result) => {
                                    setBusy(false)
                                    setAsking(false)
                                    if (result.error !== undefined) {
                                      setNote(result.error)
                                    } else if (result.conflict !== undefined) {
                                      setConflict({
                                        name: result.conflict.name,
                                        since: result.conflict.since,
                                        ...(result.draft === undefined ? {} : { draft: result.draft }),
                                      })
                                    } else {
                                      const lines: string[] = []
                                      if (result.announced === false) {
                                        lines.push(turningOn
                                          ? '已接入，但在岗声明帖没发出去——群里还不知道它在岗。'
                                          : '已移出，但退岗帖没发出去——群里还以为它在岗。')
                                      }
                                      if (result.memoryDraft !== undefined) {
                                        setMemoryDraft(result.memoryDraft)
                                      }
                                      setNote(lines.join(' '))
                                      void load()
                                    }
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
                    {/*
                      **谁按的这个开关** (v3.15 裁决⑤).

                      接单 = 让 agent 听见这里的每一句话，是一次听众敏感的主权动作，
                      所以它在图上有事件史。而记下来没人读得到等于没记——审计要靠 grep
                      一个 jsonl 的东西不叫可审计。这一问发生的地方就是这里：人正看着
                      这个开关，想的是「这是谁开的、什么时候」。

                      **只报动作，不报状态**：当前开着没有，上面那一行已经说了；这一格
                      多说一次，两处就有机会打架。
                    */}
                    {(view.servedChanges ?? []).length > 0 && (
                      <ul className={css.list}>
                        {(view.servedChanges ?? []).map(item => (
                          <li key={`${String(item.time)}-${String(item.served)}`}>
                            {new Date(item.time).toLocaleString('zh-CN', { hour12: false })}
                            {' · '}{item.served ? (item.scope === 'self' ? '接入（仅本人）' : item.scope === 'standby' ? '接入（备岗）' : '接入（对群在岗）') : '移出'}
                            {item.by === undefined ? '' : ` · ${item.by}`}
                          </li>
                        ))}
                      </ul>
                    )}
                    {/*
                      **「我的 agent 为什么没接」** (决策 #63)：让位账在这里读。静默让位没有帖、
                      只有账——正因为如此它必须在面板上，否则"没接"看起来像"坏了"。
                    */}
                    {(view.yields ?? []).length > 0 && (
                      <div className={css.note}>
                        最近让位：
                        <ul className={css.list}>
                          {(view.yields ?? []).map(item => (
                            <li key={`${String(item.time)}-${item.reason}`}>
                              {new Date(item.time).toLocaleString('zh-CN', { hour12: false })}
                              {' · '}
                              {item.reason === 'object-owner'
                                ? '对象在别的实例图上'
                                : item.reason === 'speaker-instance'
                                  ? '发言者自己的助理接了'
                                  : item.reason === 'ack-order'
                                    ? '对方先应了（总序）'
                                    : '本机不对群在岗'}
                              {item.to === undefined ? '' : ` · 让给 ${item.to}`}
                              {item.loud ? ' · 有让位帖' : ' · 静默'}
                            </li>
                          ))}
                        </ul>
                      </div>
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
                  {/*
                    这一格此前叫「不可撤销操作」。而它真正的判据是**每次都问**，理由有
                    两种：一种是做了收不回（删文档、作废），另一种是**改变触达面**
                    （建群、把一条惯例记成「不限场所」——它从此在每个会话里对模型说话）。
                    后者是可撤销的，顶着「不可撤销」这个标题就成了这一格自己在说谎。
                  */}
                  <span className={css.key}>每次都问的操作</span>
                  <span className={css.value}>
                    {view.strongTools.length} 个：<b>做了收不回</b>，或者<b>改变触达面</b>。
                    每次都问，租约永远盖不住
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
