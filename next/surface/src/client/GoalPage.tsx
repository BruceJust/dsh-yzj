/**
 * 目标页 —— 承诺板的第二缩放级别 (v4.12 §7.6).
 *
 * **不是一个新 surface。** 它是同一份查询放大一级:板上一行装不下的东西(决断、
 * 每条承诺自己的闭环、修理动词、评估)在这里摊开。进出即缩放、Back 恢复板位、
 * 数据同源——「分活去哪、看进度看哪」的割裂因此从根上不存在。竞品的死因恰恰
 * 在这里:功能最全的那个死于「又一个要打开的 app」。
 *
 * **灵魂一句:三个主权时刻在此落座,其余一切是派生查询。** 签发(立目标)、
 * 裁决(拆解提案)、验收(评估)——人只出现在这三处;计数、归集、信号、停滞,
 * 全是读出来的,没有一个字段等着谁去维护。
 *
 * 三条结构性法则,写在这里是为了让后来改这个文件的人先读到:
 *
 * ① **单一形态**——一个模板贯穿生死,变形只由派生信号驱动(有简报=收口的样子、
 *    全终态=回顾的样子)。**不许出现任何「阶段」字段**:「磨稿中/收口中」是伪
 *    状态,页面自签发起就存在,磨稿期的家在私语会话里。
 * ② **随时可对账,不是持续对账**——常驻只放原料(标准正文 × 终态计数 × 产出
 *    归集),结论只在人按下评估时产出。常驻一个结论就是一个会过期的进度条。
 * ③ **可见域**——一页 N 个查看者 N 种渲染。这套桌面只有一个查看者(操作者本人),
 *    所以这一条今天是被图的 `audienceAllows` 自动满足的;真到多人打开时,过滤
 *    要发生在查询里,不在这里。
 *
 * **违规能力自检**:这一页的合法增量只有决断落座、一跳导航、就近动词。凡是
 * 只能在这一页获得的能力,就是违规能力——每个动词都必须在 IM 里有兜底说法。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BoardRowWire, GoalPageWire, SurfaceInject } from './rpc.ts'
import { sendErrand } from './store.ts'
import { RoomPicker, type Portal } from './RoomPicker.tsx'
import { safeHref } from './preview.ts'
import { ArtifactCard } from './ArtifactCard.tsx'
import { artifactRefOf } from './artifacts.ts'
import tokens from './tokens.module.css'
import css from './goal.module.css'

export interface GoalPageProps {
  goalRef: string
  goalName: string
  inject: SurfaceInject
  openSession(sessionId: string): void
  /** ‹ 返回 —— 回到板上离开时的那个位置。 */
  back(): void
}

/** 三值状态怎么说出口。「没消息」不等于「没问题」,所以三种各有各的话。 */
const SIGNAL: Record<BoardRowWire['signal'], { label: string; tone: string }> = {
  evidence: { label: '有证据', tone: 'ok' },
  silent: { label: '无信号', tone: 'warn' },
  stale: { label: '信号过时', tone: 'warn' },
}

function whenLabel(at: number): string {
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000))
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${String(days)} 天前`
}

/** 修理动词族里需要输入的那几个,共用一张就近的小表单。 */
type Repair =
  | { kind: 'postpone'; row: BoardRowWire }
  | { kind: 'handoff'; row: BoardRowWire }
  | { kind: 'merge'; row: BoardRowWire }

export function YzjGoalPage(props: GoalPageProps): ReactNode {
  const { goalRef, goalName, inject, openSession, back } = props
  const [view, setView] = useState<GoalPageWire | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [repair, setRepair] = useState<Repair | undefined>(undefined)
  /** 传送门：等着人选一间屋子的那件差事。 */
  const [portal, setPortal] = useState<Portal | undefined>(undefined)
  const [field, setField] = useState('')
  const [field2, setField2] = useState('')

  const fetchSeq = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    fetchSeq.current += 1
    const ticket = fetchSeq.current
    const next = await inject.goalPage(goalRef)
    if (ticket !== fetchSeq.current) return
    if (next === undefined) setError('板上没有这个目标——它可能已经被移出视野。')
    else { setError(''); setView(next) }
  }, [inject, goalRef])

  useEffect(() => {
    let alive = true
    void refresh()
    const timer = setInterval(() => { if (alive) void refresh() }, 6_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    if (toast === '') return undefined
    const timer = setTimeout(() => { setToast('') }, 5_000)
    return () => { clearTimeout(timer) }
  }, [toast])

  const run = useCallback((
    key: string, work: Promise<{ error?: string }>, done: string,
  ): void => {
    setBusy(key)
    void work.then((result) => {
      setToast(result.error ?? done)
      setBusy('')
      setRepair(undefined)
      setField('')
      setField2('')
      void refresh()
    })
  }, [refresh])

  /*
    传送门:话在会话里说,不在页面上填表。

    **场所要问,不能猜 (§1.6)。** 公开委派是施压与透明,私下委派是留余地——
    这个选择是社交决策,系统替人做了,就等于替他决定了这句话会让谁听见。
    曾经这里直接跳进「当前会话」,而当前会话是**上一次点开的那个话题**:
    一句本该在财务群说的委派,会落在一个毫不相干的窗口里,而且没有任何一步
    问过人。这一行注释当时就写着「不可代做」,代码却在代做。

    唯一不问的是**催**:催的落点是这条承诺当初登记的那间屋子,那不是推导,
    是它本来就在那儿。B4 禁借身催办依然成立——agent 拟稿、传送门送你过去,
    那句话由你自己按下发送。
  */
  const ask = useCallback((next: Portal): void => { setPortal(next) }, [])

  const jump = useCallback((
    voice: 'place' | 'private', seed: string, sessionId: string,
  ): void => {
    // 目标页上的传送门带的一定是目标——这一屏本来就是一个目标的放大态。
    sendErrand({ subject: 'goal', goalRef, goalName, voice, seed })
    openSession(sessionId)
  }, [goalRef, goalName, openSession])

  if (error !== '') {
    return (
      <div className={`${tokens.tokens} ${css.page}`}>
        <div className={css.head}>
          <button type="button" className={css.back} onClick={back}>‹ 返回</button>
          <span className={css.title}>{goalName}</span>
        </div>
        <div className={css.calm}>{error}</div>
      </div>
    )
  }
  if (view === undefined) {
    return (
      <div className={`${tokens.tokens} ${css.page}`}>
        <div className={css.head}>
          <button type="button" className={css.back} onClick={back}>‹ 返回</button>
          <span className={css.title}>{goalName}</span>
        </div>
        <div className={css.calm}>正在读这个目标的子图…</div>
      </div>
    )
  }

  const { goal, decisions, pulse, staleDays, retired } = view
  const name = goal.row?.what ?? goalName
  const href = safeHref(goalRef)

  /*
    留意层:是信号,不是可应答对象。

    逾期没有「答」这个动作——它是一个事实,而人要做的是催、顺延、或者作废。
    把它混进决断层,人会去找一个并不存在的按钮;把动词放在旁边,它才是可动的。
  */
  const attention = goal.children.filter(
    child => child.status === 'open' && (child.overdue || child.signal !== 'evidence'),
  )
  /** 目标结束后还在跟的那些——级联的对象。 */
  const stillOpen = goal.children.filter(child => child.status === 'open')

  const repairForm = (row: BoardRowWire): ReactNode => {
    if (repair === undefined || repair.row.id !== row.id) return null
    if (repair.kind === 'postpone') {
      return (
        <div className={css.repair}>
          <span className={css.repairWhy}>
            改的是当初说出口的那个日子——公事，别人看得见。
            <b>「这条先别再烦我」是另一回事</b>，那只动你自己的计划，这套系统还没有那个闹钟。
          </span>
          <input
            className={css.repairInput}
            value={field}
            placeholder="新的期限，例如 2026-09-05"
            onChange={event => { setField(event.target.value) }}
          />
          <button
            type="button"
            className={css.repairGo}
            disabled={field.trim() === '' || busy !== ''}
            onClick={() => {
              run(row.id, inject.postponeCommitment(row.id, field.trim()), `已把期限改到 ${field.trim()}。`)
            }}
          >
            顺延期限
          </button>
          <button type="button" className={css.repairX} onClick={() => { setRepair(undefined) }}>取消</button>
        </div>
      )
    }
    if (repair.kind === 'handoff') {
      return (
        <div className={css.repair}>
          <span className={css.repairWhy}>
            换人，不换承诺——出生边、听众、已有的回执都还在这一条上。
            <b>新执行者还不知道</b>：改完图之后，得有人在场所里说出口（幽灵承诺禁令对移交同样成立）。
          </span>
          <input
            className={css.repairInput}
            value={field}
            placeholder="新执行者的 openId"
            onChange={event => { setField(event.target.value) }}
          />
          <input
            className={css.repairInput}
            value={field2}
            placeholder="显示名（可空）"
            onChange={event => { setField2(event.target.value) }}
          />
          <button
            type="button"
            className={css.repairGo}
            disabled={field.trim() === '' || busy !== ''}
            onClick={() => {
              run(
                row.id,
                inject.handoffCommitment(row.id, field.trim(), field2.trim() === '' ? undefined : field2.trim()),
                '已移交。记得去登记场所说一声——图改了不等于人知道了。',
              )
            }}
          >
            移交
          </button>
          <button type="button" className={css.repairX} onClick={() => { setRepair(undefined) }}>取消</button>
        </div>
      )
    }
    const others = goal.children.filter(child => child.id !== row.id && child.status === 'open')
    return (
      <div className={css.repair}>
        <span className={css.repairWhy}>
          两条登记其实是同一件事。<b>相似度分不该替人做这个判断</b>——两条听上去一样的，
          可能是两个部门各自要一份。合并之后被合掉的这条不再被任何动词唤醒（墓碑律）。
        </span>
        {others.length === 0
          ? <span className={css.repairWhy}>这个目标下没有别的在跟的承诺可以合并。</span>
          : (
            <select
              className={css.repairInput}
              value={field}
              onChange={event => { setField(event.target.value) }}
            >
              <option value="">合并进哪一条…</option>
              {others.map(other => (
                <option key={other.id} value={other.id}>{other.what}</option>
              ))}
            </select>
          )}
        <button
          type="button"
          className={css.repairGo}
          disabled={field === '' || busy !== ''}
          onClick={() => { run(row.id, inject.mergeCommitment(row.id, field), '已合并。') }}
        >
          合并
        </button>
        <button type="button" className={css.repairX} onClick={() => { setRepair(undefined) }}>取消</button>
      </div>
    )
  }

  /*
    环行 —— 每一行承诺带着自己的迷你闭环。

    来源(出生边)/ 会话一跳 + 过程摘要(执行)/ 产物 chips / 回执与终态(回流边)。
    一行看完就知道这件事**转到哪儿了**,而不是只知道它「进行中」。
  */
  const loopRow = (row: BoardRowWire): ReactNode => {
    const signal = SIGNAL[row.signal]
    return (
      <div className={`${css.loop} ${row.overdue ? css.loopOverdue : ''} ${row.status !== 'open' ? css.loopDone : ''}`} key={row.id}>
        <div className={css.loopHead}>
          <span className={`${css.exec} ${row.executorKind === 'agent' ? css.execAgent : css.execHuman}`}>
            {row.executorKind === 'agent' ? 'agent' : '人'}
          </span>
          <span className={css.loopWhat}>{row.what}</span>
          <span className={`${css.signal} ${signal.tone === 'ok' ? css.signalOk : css.signalWarn}`}>
            {signal.label}
            {row.signal !== 'evidence' && ` · 最后动静 ${whenLabel(row.lastSignalAt)}`}
          </span>
        </div>
        <div className={css.loopMeta}>
          {/* 来源 = 出生边:这条承诺是怎么长出来的。 */}
          <span>来源：{row.placeName ?? '未记录场所'}{row.attachedVia === undefined ? '' : ` · ${row.attachedVia}`}</span>
          <span>{row.who}</span>
          {row.due !== undefined && <span className={row.overdue ? css.due : ''}>{row.due.text}{row.overdue && ' · 逾期'}</span>}
          {row.notified === 'failed' && (
            <span className={css.ghost} title="登记落库了，但没能告诉本人——幽灵承诺禁令要求这件事永不静默">
              未通知
            </span>
          )}
          {/* 级联显形：目标死了，这条还活着——是不是也该停，是人的判断。 */}
          {row.parentRetired === true && (
            <span className={css.ghost} title="父目标已经结束，这条没有被自动作废——继续、改挂、还是作废，由你定">
              父目标已结束
            </span>
          )}
          {row.status !== 'open' && <span className={css.settled}>{row.status === 'closed' ? '已了' : row.status === 'voided' ? '已作废' : '已合并'}</span>}
        </div>
        {/* 回流边:回执是这件事到底转回来了没有的唯一证据。 */}
        {row.progress !== undefined && <div className={css.receipt}>回执：{row.progress}</div>}
        <div className={css.loopActs}>
          {row.sessionId === undefined
            ? <span className={css.hintInline}>人执行 · 回执经登记场所</span>
            : (
              <button
                type="button"
                className={css.act}
                onClick={() => { openSession(row.sessionId as string) }}
              >
                会话 ›
              </button>
            )}
          {row.status === 'open' && (
            <>
              {/*
                催 = 拟稿 + 传送门 + 你亲发。
                不是一个「催办」按钮——催一个人是说一句话，而借你的名义去说，
                是把社交后果转嫁给一个不在场的系统 (B4)。
              */}
              <button
                type="button"
                className={css.act}
                onClick={() => {
                  // 原话语，不是解析出的日期——否则拟稿会把他没承诺过的日子写进催办里。
                  const seed = `${row.who}，「${row.what}」这条现在什么情况？${row.due === undefined ? '' : `原定 ${row.due.text}。`}`
                  if (row.sessionId === undefined) {
                    // 登记时不在任何话题里——那就还是得问一句去哪儿说。
                    ask({
                      subject: 'goal',
                      goalRef, goalName, voice: 'place', seed,
                      title: '催：去哪个会话说？',
                      note: '这条承诺没有记下登记场所，所以落点得你来定。句子还是你自己说。',
                    })
                  } else jump('place', seed, row.sessionId)
                }}
              >
                催（去说）
              </button>
              <button type="button" className={css.act} onClick={() => { setRepair({ kind: 'postpone', row }); setField(row.due?.text ?? '') }}>顺延期限</button>
              <button type="button" className={css.act} onClick={() => { setRepair({ kind: 'handoff', row }); setField(''); setField2('') }}>移交</button>
              <button type="button" className={css.act} onClick={() => { setRepair({ kind: 'merge', row }); setField('') }}>合并</button>
              <button
                type="button"
                className={css.act}
                disabled={busy === row.id}
                onClick={() => { run(row.id, inject.voidCommitment(row.id, '在目标页作废'), `已作废：${row.what}`) }}
              >
                作废
              </button>
              <button
                type="button"
                className={css.act}
                disabled={busy === row.id}
                onClick={() => { run(row.id, inject.unlinkCommitments([row.id]).then(r => r), '已移出这个目标，回到「无归属」。') }}
              >
                移出
              </button>
            </>
          )}
        </div>
        {repairForm(row)}
      </div>
    )
  }

  return (
    <div className={`${tokens.tokens} ${css.page}`}>
      <div className={css.head}>
        <button type="button" className={css.back} onClick={back}>‹ 返回</button>
        <span className={css.title}>{name}</span>
        <span className={css.sub}>目标 · 承诺板放大一级</span>
      </div>

      <div className={css.body}>
        {/*
          Header 全零存储推导。

          这里没有一个字段是存下来的:owner 与时限来自那条登记、状态来自子承诺、
          停滞天数来自图上最后一次动静。目标不会因为没人来更新它而显得停滞——
          它显得停滞是因为底下真的没动。
        */}
        <div className={`${css.header} ${retired ? css.headerRetired : ''}`}>
          <div className={css.headerTop}>
            <span className={css.goalTag}>目标</span>
            <span className={css.headerName}>{name}</span>
            {goal.row?.who !== undefined && <span className={css.owner}>owner {goal.row.who}</span>}
            {goal.row?.due !== undefined && <span className={css.owner}>{goal.row.due.text}</span>}
            <span className={css.manual}>终态：人工验收</span>
          </div>
          <div className={css.headerMeta}>
            {href === undefined
              ? <span className={css.unsafe} title={goalRef}>这个引用不是一个链接</span>
              : <a className={css.link} href={href} target="_blank" rel="noreferrer noopener">真身在云之家 ↗</a>}
            <span>
              {goal.counts.open} 在跟
              {goal.counts.overdue > 0 && <b className={css.due}> · {goal.counts.overdue} 逾期</b>}
              {goal.counts.settled > 0 && ` · ${String(goal.counts.settled)} 已了`}
            </span>
            {staleDays !== undefined && (
              <span className={staleDays >= 3 ? css.stale : ''}>
                图内 {staleDays} 天无新轨迹
              </span>
            )}
          </div>

          {/* 成功标准 = 真身正文的派生投影，不是一组字段（防 KR 后门）。 */}
          {goal.criteria !== undefined && (
            <div className={css.criteria}>
              <span className={css.criteriaTag}>成功标准</span>
              {goal.criteria}
            </div>
          )}

          {/*
            真身之变显形。

            结论会过期，而过期的结论比没有结论更危险——它看起来仍然成立。
          */}
          {goal.criteriaDrifted === true && (
            <div className={css.drift}>
              {goal.truthChanged === undefined
                ? <>⚠ 我们手上这份成功标准的副本改过，而最近这份简报是照着旧版写的——<b>当前结论未对账</b>。</>
                /* agent 去看过真身，这句话是它当时的原话——不是页面猜的。 */
                : <>⚠ {goal.truthChanged.detail}（{whenLabel(goal.truthChanged.at)}发现）。</>}
              <button
                type="button"
                className={css.act}
                onClick={() => {
                  ask({
                    subject: 'goal',
                    goalRef, goalName, voice: 'private',
                    seed: `以现在这版成功标准，重新评估目标「${name}」的完成度。`,
                    title: '以新基准重估：在哪个会话里私下问？',
                    note: '简报默认落私语域——它汇集的证据来自多个场所，投到群里等于越境。',
                  })
                }}
              >
                以新基准重估
              </button>
            </div>
          )}

          {/*
            目标作废的级联 —— 摩擦刀裁定的那一处。

            省下几次点击，拿走的是一次判断。目标死了不等于底下每件事都白做：
            有的确实白做了，有的另有价值，有的已经答应了别人。所以系统只做两件
            事——**让它没法悄悄存在**，和**让处理它只要一下**。
          */}
          {retired && stillOpen.length > 0 && (
            <div className={css.drift}>
              <span className={css.driftText}>
                这个目标已经结束（{goal.row?.status === 'voided' ? '已作废' : '已验收'}），
                底下还有 <b>{stillOpen.length} 条</b>在跟。
                <b>它们没有被自动作废</b>——继续跑完、改挂到别的目标、还是一起停掉，是你的判断。
              </span>
              <button
                type="button"
                className={css.act}
                disabled={busy === 'cascade'}
                onClick={() => {
                  run(
                    'cascade',
                    Promise.all(stillOpen.map(child => inject.voidCommitment(child.id, '父目标已结束')))
                      .then(results => results.find(r => r.error !== undefined) ?? {}),
                    `已把这 ${String(stillOpen.length)} 条一起作废。`,
                  )
                }}
              >
                全部作废
              </button>
              <button
                type="button"
                className={css.act}
                disabled={busy === 'cascade'}
                onClick={() => {
                  run(
                    'cascade',
                    inject.unlinkCommitments(stillOpen.map(child => child.id)).then(r => r),
                    `已把这 ${String(stillOpen.length)} 条移出，回到「无归属」等着改挂。`,
                  )
                }}
              >
                全部移出改挂
              </button>
            </div>
          )}
          {retired && stillOpen.length === 0 && (
            <div className={css.drift}>
              这个目标已经结束（{goal.row?.status === 'voided' ? '已作废' : '已验收'}），底下也没有还在跟的事了。
            </div>
          )}

          <div className={css.ctas}>
            <button
              type="button"
              className={css.cta}
              onClick={() => {
                ask({
                  subject: 'goal',
                  goalRef, goalName, voice: 'place', seed: `关于目标「${name}」：`,
                  title: '委派：跳进哪个会话说？',
                  note: '公开委派是施压与透明，私下委派是留余地——这个选择不该由系统替你做。',
                })
              }}
            >
              ＋ 委派
            </button>
            <button
              type="button"
              className={css.cta}
              onClick={() => {
                ask({
                  subject: 'goal',
                  goalRef, goalName, voice: 'private',
                  seed: `帮我把目标「${name}」拆成子承诺，逐条列出做什么、谁做、什么时候前。`,
                  title: '拆解：在哪个会话里私下问？',
                  note: 'agent 只有提议权——每条都要过你的手，确认才落库并代发登记话语。',
                })
              }}
            >
              ⚡ 拆解
            </button>
            <button
              type="button"
              className={css.cta}
              onClick={() => {
                ask({
                  subject: 'goal',
                  goalRef, goalName, voice: 'private',
                  seed: `评估目标「${name}」的完成度，逐条对着成功标准给证据。`,
                  title: '评估：在哪个会话里私下问？',
                  note: 'agent 备料，验收权在你——简报默认落私语域。',
                })
              }}
            >
              ✓ 评估
            </button>
            {/* 轻问 = 传送门，不是页内输入框——轻问是会话 turn，不是旁路。 */}
            <button
              type="button"
              className={css.cta}
              onClick={() => {
                ask({
                  subject: 'goal',
                  goalRef, goalName, voice: 'private', seed: `关于目标「${name}」，我想问：`,
                  title: '问这个目标：在哪个会话里私下问？',
                  note: '轻问是一次会话 turn，不是页面旁路——所以它落在某个会话的日志里。',
                })
              }}
            >
              🔍 问这个目标
            </button>
            {!retired && goal.row !== undefined && (
              <button
                type="button"
                className={css.cta}
                disabled={busy === 'goal'}
                onClick={() => {
                  run('goal', inject.voidCommitment(goal.row?.id ?? '', '操作者在目标页作废'), '目标已作废——底下的承诺请逐条处理。')
                }}
              >
                作废这个目标
              </button>
            )}
          </div>
          <div className={css.ctaNote}>
            这四个都是传送门：话在会话里说。拆解出的每一条都要过你的手，确认即以你的名义把登记消息发到执行者在场的通道——没有静默登记。
          </div>
        </div>

        {toast !== '' && <div className={css.toast}>{toast}</div>}

        {/* Zone1 决断层:与收件箱是同一个可应答对象的过滤投影,不是复制列表。 */}
        <div className={css.zone}>需要你 · 决断</div>
        {decisions.length === 0
          ? <div className={css.calm}>这个目标下没有等你答的东西。</div>
          : decisions.map(item => (
            <button
              type="button"
              className={css.decision}
              key={item.sessionId}
              onClick={() => { openSession(item.sessionId) }}
            >
              <span className={css.decisionBadge}>{item.badge}</span>
              <span className={css.decisionText}>
                <b>{item.title}</b>
                <span className={css.decisionSub}>{item.preview}</span>
              </span>
              <span className={css.arrow}>›</span>
            </button>
          ))}
        <div className={css.hint}>
          和收件箱里是<b>同一个</b>可应答对象——在哪边答都算数（先答先赢），这里只是按目标过滤了一遍。
        </div>

        {/* 留意层:信号 + 就近动词。逾期不是可应答对象。 */}
        {attention.length > 0 && (
          <>
            <div className={css.zone}>需要你 · 留意</div>
            {attention.map(row => (
              <div className={css.notice} key={`attend-${row.id}`}>
                <span className={css.noticeText}>
                  <b>{row.what}</b>
                  <span className={css.decisionSub}>
                    {row.who}
                    {row.overdue && ` · ${row.due ?? ''} 逾期`}
                    {row.signal !== 'evidence' && ` · ${SIGNAL[row.signal].label}，最后动静 ${whenLabel(row.lastSignalAt)}`}
                  </span>
                </span>
                <button
                  type="button"
                  className={css.act}
                  onClick={() => {
                    const seed = `${row.who}，「${row.what}」这条现在什么情况？`
                    if (row.sessionId === undefined) {
                      ask({
                        subject: 'goal',
                        goalRef, goalName, voice: 'place', seed,
                        title: '催：去哪个会话说？',
                        note: '这条承诺没有记下登记场所，所以落点得你来定。',
                      })
                    } else jump('place', seed, row.sessionId)
                  }}
                >
                  催（去说）
                </button>
              </div>
            ))}
            <div className={css.hint}>
              逾期和没信号都是<b>信号，不是可应答对象</b>——没有「答」这个动作，
              能做的是催、顺延、或者作废，所以动词就在旁边。
            </div>
          </>
        )}

        {/* Zone2 执行清单:平铺 + 计数 + 一跳，永不画树。 */}
        <div className={css.zone}>执行清单 · 每行带着自己的闭环</div>
        {goal.children.length === 0
          ? (
            <div className={css.calm}>
              {/* 空态三义分家:合并三义即谎言。 */}
              还没有任何承诺挂在这个目标下——<b>空转</b>。
              用上面的「＋ 委派」把第一件事说出去，或者让 agent 先拆一版。
            </div>
          )
          : (
            <>
              <div className={css.pulse}>
                {pulse === 'running' && <>在跑 · 最近一次动静 {staleDays === undefined ? '—' : `${String(staleDays)} 天前`}</>}
                {pulse === 'stalled' && <><b>停摆</b> · 底下的事都在等别人，没有一条有新证据</>}
                {pulse === 'idle' && <>空转</>}
              </div>
              {goal.children.map(loopRow)}
            </>
          )}

        {/* 产出归集:两跳派生，不是第二存储。 */}
        <div className={css.zone}>产出 · {goal.artifacts.length}</div>
        {goal.artifacts.length === 0
          ? <div className={css.calm}>这个目标下的工作还没有留下工件。</div>
          : goal.artifacts.map(artifact => (
            <ArtifactCard
              key={artifact.uri}
              dense
              artifact={artifactRefOf({
                uri: artifact.uri,
                title: artifact.title,
                action: artifact.action,
                marks: [artifact.shared === true
                  ? { label: '共用会话', why: '这个会话同时在服务不止一个目标，无法把产出独归其一' }
                  : undefined],
              })}
            />
          ))}

        {/* 评估:结论只在人按下之后才存在（随时可对账，不是持续对账）。 */}
        {goal.assessment !== undefined && (
          <>
            <div className={css.zone}>最近一份差距简报</div>
            <div className={css.report}>
              <div className={css.reportHead}>
                {goal.assessment.summary}
                <span className={css.reportWhen}>{whenLabel(goal.assessment.at)}</span>
              </div>
              {goal.assessment.lines.map(line => (
                <div className={css.reportLine} key={line.criterion}>
                  <span className={`${css.verdict} ${line.verdict === 'met' ? css.verdictMet : line.verdict === 'partial' ? css.verdictPartial : css.verdictMissing}`}>
                    {line.verdict === 'met' ? '✓' : line.verdict === 'partial' ? '◐' : '✗'}
                  </span>
                  <span className={css.reportText}>
                    {line.criterion}
                    <span className={css.decisionSub}>{line.evidence}</span>
                  </span>
                  {line.verdict !== 'met' && (
                    <button
                      type="button"
                      className={css.act}
                      onClick={() => {
                        ask({
                          subject: 'goal',
                          goalRef, goalName, voice: 'place',
                          seed: `关于目标「${name}」还缺的这块：${line.criterion}。`,
                          title: '把这条缺口变成委派：跳进哪个会话说？',
                          note: '句子还是你自己说——这里只负责把你送到该说话的地方。',
                        })
                      }}
                    >
                      差距 → 委派
                    </button>
                  )}
                </div>
              ))}
              <div className={css.hint}>
                证据是<b>承诺终态 + 工件归集 + 轨迹</b>，不是自报数。
                {goal.assessment.criteriaBasis === undefined
                  ? '（这份简报没有记下它依据的标准版本，所以「标准变没变」这一问它答不了。）'
                  : ''}
              </div>
            </div>
          </>
        )}

        {/*
          闭环自检表 —— 环路完整性检验对这一页自己适用 (v4.12 验收标准)。

          七环每一环都必须**既可见又可动**;缺一环就是一笔割裂债,而割裂债的
          还款方式是人用手去搬运。写在页面上,是为了让缺口没法悄悄存在。
        */}
        {portal !== undefined && (
          <RoomPicker
            portal={portal}
            inject={inject}
            close={() => { setPortal(undefined) }}
            go={(sessionId) => {
              sendErrand({
                subject: portal.subject,
                goalRef: portal.goalRef,
                goalName: portal.goalName,
                voice: portal.voice,
                ...(portal.seed === undefined ? {} : { seed: portal.seed }),
              })
              setPortal(undefined)
              openSession(sessionId)
            }}
          />
        )}

        <div className={css.selfCheck}>
          闭环自检：拆解/委派 · 执行一跳 + 三值状态 · 产出归集 · 回执与验收 ·
          修理动词族（催/顺延/移交/合并/作废/移出）· 评估 · 真身之变显形
          —— 每一环都既看得见又动得了。
          这一页的合法增量只有决断落座、一跳导航、就近动词；每个动词在 IM 里都有兜底说法。
        </div>
      </div>
    </div>
  )
}
