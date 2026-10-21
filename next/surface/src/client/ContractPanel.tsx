/**
 * 云小助在这里的规则 (界面重设计 §5.7，原「场所合同」).
 *
 * 人打开它的时候在想一个问题：「它在这儿能替我做什么、什么时候会问我」。所以这一屏是
 * 六行人话，按那个问题的顺序排：
 *
 * 1. 接谁的话 · 2. 每次都问你 · 3. 写之前问一次 · 4. 不会做 · 5. 你签的规矩 · 6. 它记着的
 *
 * 工具名、版本号、撤销流水收进「看明细」——它们是证据，不是回答。
 *
 * 每一行都从**真的在决定行为**的那处读：guard 查的合同、它卡的写表、它执行的逃逸名单、
 * 它逐调用复查的撤销、它命中的租约。这里不是任何一条策略的第二份抄本——一块能和 guard
 * 说不一样的话的面板，撒谎的会是它。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ContractViewWire, SurfaceInject } from './rpc.ts'
import { AgentFace, Icon } from './icons.tsx'
import { AGENT, plainError } from './words.ts'
import tokens from './tokens.module.css'
import css from './rules.module.css'

const MEMORY_POLICY: Record<string, string> = {
  normal: '这里学到的惯例会记下来，之后在这个群里用得上',
  'facts-only': '只记能核对的事实，不记它自己的判断',
  never: '什么都不记——这里说过的话，它下次不会知道',
}

const TOOL_CLASS: Record<string, string> = { doc: '文档', sheet: '表格', calendar: '日程', im: '群消息', file: '文件' }

const DAY = 24 * 60 * 60 * 1000

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
  /** 接单范围是接单的第一个参数（决策 #63），不是事后的设置。 */
  const [scope, setScope] = useState<'all' | 'self' | 'standby'>('all')
  /** 第二在岗押门：已有同侪对群在岗，这一次没有接。 */
  const [conflict, setConflict] = useState<{ name: string; since: number; draft?: string } | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  /** 退岗时本群场所记忆的脱密拟稿：越境律，人签发。 */
  const [memoryDraft, setMemoryDraft] = useState<string | undefined>(undefined)
  const [detail, setDetail] = useState(false)
  /** 收回一条规矩之前的那一问。 */
  const [revoking, setRevoking] = useState<string | undefined>(undefined)
  const [revokeWhy, setRevokeWhy] = useState('')
  const [ruleNote, setRuleNote] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setView(await inject.contract(placeKey))
  }, [inject, placeKey])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [close])

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true) }, () => { setCopied(false) })
  }

  const serve = (turningOn: boolean, range?: 'all' | 'self' | 'standby'): void => {
    setBusy(true)
    void inject.setServed(placeKey, turningOn, range).then((result) => {
      setBusy(false)
      setAsking(false)
      if (result.error !== undefined) { setNote(plainError(result.error).text); return }
      if (result.conflict !== undefined) {
        setConflict({ name: result.conflict.name, since: result.conflict.since, ...(result.draft === undefined ? {} : { draft: result.draft }) })
        return
      }
      if (result.memoryDraft !== undefined) setMemoryDraft(result.memoryDraft)
      setNote(result.announced === false
        ? turningOn ? '接上了，但在岗声明没发出去——群里还不知道它在。' : '移出了，但退岗帖没发出去——群里还以为它在。'
        : '')
      void load()
    })
  }

  const presence = view?.presence?.self
  const rules = view?.rules ?? []

  return (
    <div className={`${tokens.tokens} ${css.mask}`} onClick={close}>
      <div className={css.panel} role="dialog" aria-label={`${AGENT}在这里的规则`} onClick={(event) => { event.stopPropagation() }}>
        <div className={css.head}>
          <AgentFace size={32} />
          <span className={css.headText}>
            <span className={css.title}>{AGENT}在这里的规则</span>
            <span className={css.sub}>{view?.groupName ?? '…'}</span>
          </span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭"><Icon name="x" size={16} /></button>
        </div>

        {view === undefined
          ? <div className={css.calm}>正在读…</div>
          : (
            <div className={css.lines}>
              {/* ——— 1 · 接谁的话 ——— */}
              <section className={css.line}>
                <div className={css.lineHead}><span className={css.no}>1</span>接谁的话</div>
                <div className={css.lineBody}>
                  <p className={css.prose}>
                    {view.onDuty === false
                      ? <>
                        <b>不在这个群接话。</b>群里的人照常说话；在这里 @ {AGENT}，
                        {(view.presence?.peers.length ?? 0) > 0
                          ? <>会由这个群在岗的 {view.presence?.peers.map(peer => peer.name).join('、')} 接。</>
                          : <>会在发出之前被拦下，而不是发出去等一个不会来的回复。</>}
                      </>
                      : presence === 'self'
                        ? <><b>只接你的话。</b>同事 @ 它，你这边不动手。</>
                        : presence === 'standby'
                          ? <><b>备岗。</b>你 @ 它立刻接；同事 @ 它，先让在岗的那位，没人应才接。</>
                          : <><b>接全群的话。</b>谁 @ 它、或回复它的消息，它都会接。</>}
                  </p>
                  {view.onDuty !== false && presence === 'all' && view.presence?.selfAnchor === undefined && (
                    <div className={css.warn}>
                      还没在群里说过它在岗——群里的人不知道可以找它。
                      <button type="button" className={css.inline} disabled={busy} onClick={() => { serve(true, 'all') }}>在群里说一声</button>
                    </div>
                  )}
                  {view.onDuty !== false && (view.presence?.peers.length ?? 0) > 0 && (
                    <div className={css.note}>
                      这个群里还有：{view.presence?.peers.map(peer => `${AGENT}（${peer.name}）`).join('、')}。同事的 @ 由在岗的那位接，你自己的 @ 仍由你的接。
                    </div>
                  )}
                  {view.onDuty !== false && <div className={css.note}>这台电脑合上盖子时，这个群没人接话，群里也不会知道。</div>}

                  {memoryDraft !== undefined && (
                    <div className={css.box}>
                      <div>它在这个群学到的惯例，拟成了一段交接的话。发不发、发给谁，由你定。</div>
                      <textarea className={css.draft} readOnly value={memoryDraft} rows={4} />
                      <div className={css.acts}>
                        <button type="button" className={css.btn} onClick={() => { copy(memoryDraft) }}>{copied ? '已复制' : '复制'}</button>
                        <button type="button" className={css.inline} onClick={() => { setMemoryDraft(undefined) }}>收起</button>
                      </div>
                    </div>
                  )}
                  {conflict !== undefined && (
                    <div className={css.box}>
                      <div>
                        <b>没接上。</b>这个群已经有 {AGENT}（{conflict.name}）在岗了——一个群同一时刻只能有一位接全群的话。
                      </div>
                      {conflict.draft !== undefined && (
                        <>
                          <div className={css.note}>想请对方让出来，这段话你自己发：</div>
                          <textarea className={css.draft} readOnly value={conflict.draft} rows={3} />
                        </>
                      )}
                      <div className={css.acts}>
                        {conflict.draft !== undefined && (
                          <button type="button" className={css.btn} onClick={() => { copy(conflict.draft ?? '') }}>{copied ? '已复制' : '复制这段话'}</button>
                        )}
                        <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={busy} onClick={() => { setConflict(undefined); serve(true, 'self') }}>
                          改成只接你的话
                        </button>
                        <button type="button" className={css.inline} onClick={() => { setConflict(undefined) }}>先不接</button>
                      </div>
                    </div>
                  )}
                  {asking
                    ? (
                      <div className={css.box}>
                        <div>
                          {view.onDuty === false
                            ? <>接上之后，它会<b>读这个群的历史</b>，话题会长在这里，<b>@ 它会有回应</b>，登记的承诺也会投到这里。</>
                            : <>移出之后，它<b>看不见</b>这里的新消息；已经有的话题还在，但不会再长新的。{presence === 'all' && <>会在群里说一声它不在岗了。</>}</>}
                        </div>
                        {view.onDuty === false && (
                          <div className={css.choice}>
                            <label>
                              <input type="radio" name="serve-scope" checked={scope === 'all'} onChange={() => { setScope('all') }} />
                              <span><b>接全群的话</b> · 同事也能 @ 它；会在群里说一声它在岗。一个群只能有一位。</span>
                            </label>
                            <label>
                              <input type="radio" name="serve-scope" checked={scope === 'self'} onChange={() => { setScope('self') }} />
                              <span><b>只接你的话</b> · 不在群里说，和别人的不冲突。</span>
                            </label>
                            <label>
                              <input type="radio" name="serve-scope" checked={scope === 'standby'} onChange={() => { setScope('standby') }} />
                              <span><b>备岗</b> · 同事 @ 它没人应时才接；不在群里说。</span>
                            </label>
                          </div>
                        )}
                        <div className={css.acts}>
                          <button
                            type="button"
                            className={`${css.btn} ${css.btnPrimary}`}
                            disabled={busy}
                            onClick={() => { serve(view.onDuty === false, view.onDuty === false ? scope : undefined) }}
                          >
                            {busy ? '正在办…' : view.onDuty === false ? '接上' : '移出'}
                          </button>
                          <button type="button" className={css.inline} onClick={() => { setAsking(false) }}>算了</button>
                        </div>
                      </div>
                    )
                    : (
                      <button type="button" className={css.btn} onClick={() => { setAsking(true) }}>
                        {view.onDuty === false ? '让它接这个群' : '不让它接这个群了'}
                      </button>
                    )}
                  {note !== '' && <div className={css.warn}>{note}</div>}
                </div>
              </section>

              {/* ——— 2 · 每次都问你 ——— */}
              <section className={css.line}>
                <div className={css.lineHead}><span className={css.no}>2</span>每次都问你</div>
                <div className={css.lineBody}>
                  <p className={css.prose}>
                    删掉、覆盖这类<b>做了收不回</b>的，和建群这类<b>会改变谁看得到</b>的——{view.strongTools.length} 种操作，每次都先问你。签了规矩也一样。
                  </p>
                </div>
              </section>

              {/* ——— 3 · 写之前问一次 ——— */}
              <section className={css.line}>
                <div className={css.lineHead}><span className={css.no}>3</span>写之前问一次</div>
                <div className={css.lineBody}>
                  <p className={css.prose}>
                    其余 {view.standardCount} 种写操作：群里有人 @ 它让它做的那一轮，不再问；别的时候，写之前先问你一次。
                  </p>
                </div>
              </section>

              {/* ——— 4 · 不会做 ——— */}
              <section className={css.line}>
                <div className={css.lineHead}><span className={css.no}>4</span>不会做</div>
                <div className={css.lineBody}>
                  <p className={css.prose}>
                    群里叫它，它<b>碰不到这台电脑</b>上的命令行和文件——群里的一句话给的是「用云之家」的权限，不是「跑任何东西」的权限。
                    {view.oaRequiredCategories.length > 0 && <>要走公司审批的（{view.oaRequiredCategories.join('、')}），它直接不做。</>}
                  </p>
                </div>
              </section>

              {/* ——— 5 · 你签的规矩 ——— */}
              <section className={css.line}>
                <div className={css.lineHead}><span className={css.no}>5</span>你签的规矩</div>
                <div className={css.lineBody}>
                  {rules.length === 0
                    ? <span className={css.dim}>还没有。同一类写操作你连续同意 5 次、没拒过，卡上会问你要不要签一条。</span>
                    : rules.map(rule => (
                      <div className={css.rule} key={rule.leaseId}>
                        <div className={css.ruleMain}>
                          <b>往{TOOL_CLASS[rule.toolClass] ?? rule.toolClass}里新加东西不用每次问</b>
                          <span className={css.ruleMeta}>
                            {rule.scoped ? '只在这个群' : '不限群'}
                            {' · '}
                            {rule.status === 'proposed'
                              ? '等你签'
                              : `${rule.signedBy ?? '有人'}签的 · 还剩 ${String(Math.max(1, Math.ceil((rule.until - Date.now()) / DAY)))} 天 · 替你省了 ${String(rule.saved)} 次确认`}
                          </span>
                        </div>
                        {rule.status === 'active' && (revoking === rule.leaseId
                          ? (
                            <span className={`${css.acts} ${css.revoke}`}>
                              <span className={css.dim}>收回之后，这类写入又会每次问你。</span>
                              <input
                                className={css.reason}
                                autoFocus
                                value={revokeWhy}
                                placeholder="为什么收回（可不写）"
                                onChange={(event) => { setRevokeWhy(event.target.value) }}
                              />
                              <button
                                type="button"
                                className={`${css.btn} ${css.btnDanger}`}
                                disabled={busy}
                                onClick={() => {
                                  setBusy(true)
                                  void inject.cardAct('lease', rule.leaseId, 'revoke', revokeWhy.trim() === '' ? undefined : revokeWhy.trim()).then((result) => {
                                    setBusy(false)
                                    setRevoking(undefined)
                                    setRevokeWhy('')
                                    if (result?.outcome !== 'applied') setRuleNote(result?.receipt ?? '没收回来——再试一次。')
                                    void load()
                                  })
                                }}
                              >
                                收回
                              </button>
                              <button type="button" className={css.inline} onClick={() => { setRevoking(undefined); setRevokeWhy('') }}>算了</button>
                            </span>
                          )
                          : <button type="button" className={css.inline} onClick={() => { setRevoking(rule.leaseId) }}>收回…</button>)}
                      </div>
                    ))}
                  {ruleNote !== '' && <div className={css.warn}>{ruleNote}</div>}
                </div>
              </section>

              {/* ——— 6 · 它记着的 ——— */}
              <section className={css.line}>
                <div className={css.lineHead}><span className={css.no}>6</span>它记着的</div>
                <div className={css.lineBody}>
                  <p className={css.prose}>
                    {MEMORY_POLICY[view.memoryPolicy] ?? MEMORY_POLICY.normal}。
                    {view.processSummary && '做完一件不简单的事，回帖里会附上它做过哪些步。'}
                  </p>
                </div>
              </section>

              <button type="button" className={css.detailToggle} aria-expanded={detail} onClick={() => { setDetail(value => !value) }}>
                <Icon name="chevR" size={12} className={detail ? css.chevOpen : undefined} />看明细
              </button>
              {detail && (
                <div className={css.detail}>
                  <div className={css.detailHead}>每次都问的 {view.strongTools.length} 种</div>
                  <ul className={css.list}>
                    {view.strongTools.map(tool => <li key={tool.name}><code>{tool.name}</code>{tool.reason}</li>)}
                  </ul>
                  <div className={css.detailHead}>群里叫它时碰不到的</div>
                  <div className={css.codes}>{view.bannedTools.map(name => <code key={name}>{name}</code>)}</div>
                  {(view.servedChanges ?? []).length > 0 && (
                    <>
                      <div className={css.detailHead}>谁开关过它</div>
                      <ul className={css.list}>
                        {(view.servedChanges ?? []).map(item => (
                          <li key={`${String(item.time)}-${String(item.served)}`}>
                            {new Date(item.time).toLocaleString('zh-CN', { hour12: false })} · {item.served ? (item.scope === 'self' ? '接上（只接本人）' : item.scope === 'standby' ? '接上（备岗）' : '接上（全群）') : '移出'}{item.by === undefined ? '' : ` · ${item.by}`}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {(view.yields ?? []).length > 0 && (
                    <>
                      <div className={css.detailHead}>最近为什么没接</div>
                      <ul className={css.list}>
                        {(view.yields ?? []).map(item => (
                          <li key={`${String(item.time)}-${item.reason}`}>
                            {new Date(item.time).toLocaleString('zh-CN', { hour12: false })} · {item.reason === 'object-owner'
                              ? '那件事在别人的助理那边'
                              : item.reason === 'speaker-instance'
                                ? '说话的人自己的助理接了'
                                : item.reason === 'ack-order'
                                  ? '对方先应了'
                                  : '你这边不接全群的话'}{item.to === undefined ? '' : ` · 让给 ${item.to}`}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className={css.detailHead}>收回过的授权</div>
                  {view.revocations.length === 0
                    ? <div className={css.dim}>还没有。</div>
                    : (
                      <ul className={css.list}>
                        {view.revocations.map(item => (
                          <li key={item.messageId}>{new Date(item.time).toLocaleString('zh-CN', { hour12: false })} · {item.reason}</li>
                        ))}
                      </ul>
                    )}
                  <div className={css.dim}>这个群的规则第 {String(view.version)} 版{view.version === 0 ? '（用的是公司默认，这个群没单独改过）' : ''}。</div>
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  )
}
