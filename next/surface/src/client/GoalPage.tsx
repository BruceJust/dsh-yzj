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
import { RoomPicker, errandFor, type Portal } from './RoomPicker.tsx'
import {
  assessAsk, breakdownAsk, delegateSeed, gapSeed, goalQuestionSeed, rebaseAsk,
} from './commission.ts'
import { RepairVerbs, cascadeLine, voidGate, type Repair } from './RepairVerbs.tsx'
import { safeHref } from './preview.ts'
import { ArtifactCard } from './ArtifactCard.tsx'
import { artifactRefOf } from './artifacts.ts'
import tokens from './tokens.module.css'
import css from './goal.module.css'

export interface GoalPageProps {
  goalRef: string
  goalName: string
  inject: SurfaceInject
  /**
   * 把一句话交给 agent —— **CTA 是话语的按钮形态** (§5.3 A6.1 ①).
   *
   * 拆解与评估走这里，不走传送门：它们的落点是**规则**（操作者私语域），不是一个
   * 要问人的社交决策。返回一句话 = 没送出去，为什么。
   */
  commission(text: string): Promise<string | undefined>
  /**
   * 操作者此刻所在的那个会话 —— 「问这个目标」落在这儿。
   *
   * 目标页是一层**画面**，不是一个会话：它盖在某个会话上面。轻问要落进会话日志
   * （而不是变成一次页面旁路），所以它需要知道自己盖在谁上面。
   */
  deskSessionId?: string
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
export function YzjGoalPage(props: GoalPageProps): ReactNode {
  const { goalRef, goalName, inject, commission, deskSessionId, openSession, back } = props
  const [view, setView] = useState<GoalPageWire | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [repair, setRepair] = useState<Repair | undefined>(undefined)
  /**
   * 已经亮出后果、正等第二下的那颗作废 (决策 #57)。一次只可能有一颗。
   *
   * 举起来的手会放下：一直举着的话，一小时后回来的人看到的是一个直接生效的
   * 「确认作废？」，而解释它的那句话早散了。门的两半同生同灭。
   */
  const [armed, setArmed] = useState('')
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
    if (armed === '') return undefined
    const timer = setTimeout(() => { setArmed('') }, 8_000)
    return () => { clearTimeout(timer) }
  }, [armed])

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

  /**
   * ⚡ 拆解 / ✓ 评估 —— **按钮就是那句话**，不是通往那句话的路 (A6.1 ①).
   *
   * 这两颗此前和「委派」长得一模一样：弹一屏问落点、跳过去、把一句现成的话放进
   * 输入框等人按发送。可**那个问题只有一个合法答案**——规格写死了「该 turn 落点 =
   * 操作者私语域」——而那句话是按钮的名字，不是人要说的话。于是三步里两步是纯损耗，
   * 而且第三步还给了人一个错觉：这句话是他说的。
   *
   * 送出去之后由宿主把人带进那个会话：备料的 work 块在那儿，随后的提案卡也在那儿。
   */
  const commit = useCallback((key: string, text: string): void => {
    setBusy(key)
    void commission(text).then((error) => {
      setBusy('')
      // 没送出去才说话；送出去了，人已经在会话里看见那句话了，再弹一条 toast 是噪音。
      if (error !== undefined) setToast(error)
    })
  }, [commission])

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

  const { goal, decisions, pulse, staleDays, retired, mySlice } = view
  const name = goal.row?.what ?? goalName
  const href = safeHref(goalRef)

  /*
    留意层:是信号,不是可应答对象。

    逾期没有「答」这个动作——它是一个事实,而人要做的是催、顺延、或者作废。
    把它混进决断层,人会去找一个并不存在的按钮;把动词放在旁边,它才是可动的。
  */
  const attention = goal.children.filter(
    child => child.status === 'open'
      && (child.overdue || child.signal !== 'evidence' || child.acceptance?.state === 'declined'),
  )
  /** 目标结束后还在跟的那些——级联的对象。 */
  const stillOpen = goal.children.filter(child => child.status === 'open')

  /*
    修理动词族已经搬到 `RepairVerbs.tsx` —— **板和目标页共用一份**。

    搬的理由不是整洁：一条**没挂目标的承诺**没有目标页可进，于是它的顺延/移交/合并
    在整个产品里都不可达（v4.21 第一档③）。板上要接同一套动词，而抄一份迟早会在
    「顺延到底改的是谁的日子」这件事上和原件分道扬镳。
  */
  const repairForm = (row: BoardRowWire): ReactNode => (
    repair === undefined || repair.row.id !== row.id
      ? null
      : (
        <RepairVerbs
          repair={repair}
          siblings={goal.children}
          /*
            **移交升传送门**：改完图之后，把人送到该说这句话的地方（v4.24）。落点逻辑
            和「催」同一条——记得下登记场所就直接跳，记不下就问一句去哪儿说。
          */
          announce={(target, draft) => {
            const child = goal.children.find(one => one.id === target.id)
            if (child?.sessionId === undefined) {
              ask({
                subject: 'goal',
                goalRef, goalName, voice: 'place', seed: draft,
                title: '移交：去哪个会话说？',
                note: '这条承诺没有记下登记场所，所以落点得你来定。句子还是你自己说。',
              })
            } else jump('place', draft, child.sessionId)
          }}
          inject={inject}
          busy={busy !== ''}
          field={field}
          setField={setField}
          field2={field2}
          setField2={setField2}
          close={() => { setRepair(undefined) }}
          run={run}
        />
      )
  )

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
          {/*
            **无主权的动词不渲染** (v4.22 裁决②)——和板上同一个谓词、同一份判断。
            这一族的主权是该承诺 owner 的；上级目标的 owner 对孙辈承诺也不渲染催
            （越级不便利：不禁社交追问，只是不造按钮）。
          */}
          {row.status === 'open' && row.stewardedBy === undefined && (
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
              {/*
                **作废两段式** (决策 #57)：一键作废与一键验收同罪。这里此前是一下点掉的
                ——而作废是不可逆的人签发终态（级联等待对象 + 回写真身）。文案与板上
                共用 `voidGate`：三处各写各的，迟早有一处的门看起来像个建议。
              */}
              <button
                type="button"
                className={`${css.act} ${armed === row.id ? css.actDanger : ''}`}
                disabled={busy === row.id}
                onClick={() => {
                  if (armed !== row.id) {
                    setArmed(row.id)
                    setToast('作废是不可逆的人签发终态：等待它的对象级联收口、真身回写一笔。再点一次确认。')
                    return
                  }
                  setArmed('')
                  run(row.id, inject.voidCommitment(row.id, '在目标页作废'), `已作废：${row.what}`)
                }}
              >
                {voidGate(armed === row.id).label}
              </button>
              <button
                type="button"
                className={css.act}
                disabled={busy === row.id}
                onClick={() => { run(row.id, inject.unlinkCommitments([row.id]).then(r => r), '已摘除，回到「无归属」。') }}
              >
                摘除
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
            **非操作者听众已经 x 天没有可读的对账** (v4.22 裁决③ 配套留意层信号)。

            板上一切正常，而组里打开那份目标文档看到的还是上一次回写时的样子——两个听众
            两种刷新率，而只有一个听众有人盯着。它是**信号不是可应答对象**：动词是评估
            （owner 的主权行为），就近摆在旁边；**不给上级加自动推送**——上级的正确供给
            是更勤的简报，不是一条越过 owner 的提醒。

            七天才说：低于这个数的沉默是正常节奏（回写只在生与死），天天提醒就是把一条
            信号做成了催促。
          */}
          {(view.goal.truthSilentDays ?? 0) >= 7 && (
            <div className={css.drift}>
              <span className={css.driftText}>
                组里那份文档已经 <b>{view.goal.truthSilentDays} 天</b>没有新的对账了——
                板上这些动静，非操作者是看不到的。
              </span>
              <button
                type="button"
                className={css.act}
                disabled={busy === 'assess'}
                onClick={() => { commit('assess', assessAsk(name, goalRef)) }}
              >
                写一份简报
              </button>
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
                disabled={busy === 'rebase'}
                onClick={() => { commit('rebase', rebaseAsk(name, goalRef)) }}
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
              {/*
                **这是这套界面里爆炸半径最大的一次作废**，所以它最不该是一下点掉的
                （决策 #57：任何入口皆两段式）。这里此前一按就把 N 条一起立了墓碑。

                第二段把数字写进按钮：确认的是「这 N 条」，不是一个泛指的「全部」。
              */}
              <button
                type="button"
                className={`${css.act} ${armed === 'cascade' ? css.actDanger : ''}`}
                disabled={busy === 'cascade'}
                onClick={() => {
                  if (armed !== 'cascade') {
                    setArmed('cascade')
                    setToast(`作废是不可逆的人签发终态。这一下会给 ${String(stillOpen.length)} 条各立一块墓碑，之后任何动词都唤不醒它们。再点一次确认。`)
                    return
                  }
                  setArmed('')
                  run(
                    'cascade',
                    Promise.all(stillOpen.map(child => inject.voidCommitment(child.id, '父目标已结束')))
                      .then(results => results.find(r => r.error !== undefined) ?? {}),
                    `已把这 ${String(stillOpen.length)} 条一起作废。`,
                  )
                }}
              >
                {armed === 'cascade' ? `确认作废这 ${String(stillOpen.length)} 条？` : '全部作废…'}
              </button>
              <button
                type="button"
                className={css.act}
                disabled={busy === 'cascade'}
                onClick={() => {
                  run(
                    'cascade',
                    inject.unlinkCommitments(stillOpen.map(child => child.id)).then(r => r),
                    `已把这 ${String(stillOpen.length)} 条摘除，回到「无归属」等着改挂。`,
                  )
                }}
              >
                全部摘除改挂
              </button>
            </div>
          )}
          {retired && stillOpen.length === 0 && (
            <div className={css.drift}>
              这个目标已经结束（{goal.row?.status === 'voided' ? '已作废' : '已验收'}），底下也没有还在跟的事了。
            </div>
          )}

          {/*
            **三个 CTA 与修理动词同按主权过滤** (v4.22 裁决②)。

            目标级动词归目标 owner——旁观者打开这一页看得见全部事实（可见域允许他看），
            但不该看见一排替别人的目标做主的按钮。「🔍 问这个目标」不在此列：**问不是
            动作**，轻问是只读投影，而不禁言正是这条法则的另一半。
          */}
          <div className={css.ctas}>
            {goal.row?.stewardedBy !== undefined && (
              <span className={css.ctaNote}>
                这个目标归 <b>{goal.row.stewardedBy}</b> 管——委派／拆解／评估是他的动词。
                你仍然可以问它，或者在会话里直接说。
              </span>
            )}
            {goal.row?.stewardedBy === undefined && <>
            <button
              type="button"
              className={css.cta}
              onClick={() => {
                ask({
                  subject: 'goal',
                  goalRef, goalName, voice: 'place', seed: delegateSeed(name),
                  title: '委派：跳进哪个会话说？',
                  note: '公开委派是施压与透明，私下委派是留余地——这个选择不该由系统替你做。',
                })
              }}
            >
              ＋ 委派
            </button>
            {/*
              ⚡ 拆解 与 ✓ 评估 **不是**传送门 —— 按下即是对 agent 说了那句话。

              它们和上面那颗「＋ 委派」的差别，正是这一屏上最容易混掉的一条界线：
              委派要问**场所**（听众是社交决策，人选不推导），而拆解与评估的落点
              是**规则**——「该 turn 落点 = 操作者私语域」，提案确认之前它既不是
              承诺、更不是公开话语。对一个只有一个答案的问题弹一屏，是把损耗性
              摩擦当成主权性摩擦收了一遍。
            */}
            <button
              type="button"
              className={css.cta}
              disabled={busy === 'breakdown'}
              title="按下就是对 agent 说「帮我拆」——它先读真身与成功标准备料，再递一份逐条可裁决的提案；每条都要过你的手"
              onClick={() => { commit('breakdown', breakdownAsk(name, goalRef)) }}
            >
              ⚡ 拆解
            </button>
            <button
              type="button"
              className={css.cta}
              disabled={busy === 'assess'}
              title="按下就是对 agent 说「评估一下」——它备料出差距简报，验收仍然是你的动作"
              onClick={() => { commit('assess', assessAsk(name, goalRef)) }}
            >
              ✓ 评估
            </button>
            </>}
            {/*
              轻问 = 落进会话日志的一次**只读投影**，不是页内输入框，也不是一次
              完整的 agent turn。这颗按钮此前带的是私语语态——名字写着「问一下」，
              按下去写工具却全部可用。问题是人自己的，所以只起个头。
            */}
            <button
              type="button"
              className={css.cta}
              title="跳回你来的那个会话，切到轻问：问一个数得一个数，不开任务、不写任何东西"
              onClick={() => {
                if (deskSessionId === undefined) {
                  setToast('这里还没有会话——轻问要落在会话日志里，先从左边打开一个。')
                  return
                }
                sendErrand({
                  subject: 'goal',
                  goalRef, goalName, voice: 'ask', seed: goalQuestionSeed(name),
                })
                openSession(deskSessionId)
              }}
            >
              🔍 问这个目标
            </button>
            {/*
              目标级作废的两段式 (决策 #57)：第一段把**级联**说清——底下有几条还在跟，
              以及它们**不会自动作废**（既有裁决保持：目标死了不等于底下每件事都该停，
              那是人的判断）。此前这里一下就点掉了，而它的波及面比任何一行都大。
            */}
            {!retired && goal.row !== undefined && goal.row.stewardedBy === undefined && (
              <button
                type="button"
                className={`${css.cta} ${armed === 'goal' ? css.actDanger : ''}`}
                disabled={busy === 'goal'}
                onClick={() => {
                  if (armed !== 'goal') {
                    setArmed('goal')
                    setToast(`作废目标是不可逆的人签发终态。${cascadeLine(goal.counts.open)}再点一次确认。`)
                    return
                  }
                  setArmed('')
                  run('goal', inject.voidCommitment(goal.row?.id ?? '', '操作者在目标页作废'), '目标已作废——底下的承诺请逐条处理。')
                }}
              >
                {armed === 'goal' ? '确认作废这个目标？' : '作废这个目标…'}
              </button>
            )}
          </div>
          {/*
            两类动词，说清楚哪一类是哪一类。

            人得看得出「按下去会发生什么」：委派把你送到该说话的地方（句子由你说），
            拆解与评估当场就把那句话说给了 agent（落点是你的私语域，不问、也不用问）。
            一段把两类混成「这四个都是传送门」的说明，比没有说明更坏——它对其中两颗
            按钮是一句假话。
          */}
          <div className={css.ctaNote}>
            <b>＋ 委派</b>是传送门：把你送到该说话的地方，句子由你说、发出去才算数。
            <b>⚡ 拆解</b>与<b>✓ 评估</b>按下即成话——那句话此刻就发给了 agent，落在你的私语域里（没有第二条通道）。
            拆解出的每一条仍要过你的手：确认才落库，并以你的名义把登记消息发到执行者在场的通道——没有静默登记。
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
                    {/*
                      **拒领要说在最前面**（v4.24 受领三态）：这条活现在没有人接，而
                      「无信号」「逾期」说的都是「接了的那件走到哪了」——两句话混在一起，
                      owner 会以为只是慢了。
                    */}
                    {row.acceptance?.state === 'declined'
                      && <b> · 拒领{row.acceptance.note === undefined ? '' : `：「${row.acceptance.note}」`}</b>}
                    {row.overdue && ` · ${row.due ?? ''} 逾期`}
                    {row.signal !== 'evidence' && ` · ${SIGNAL[row.signal].label}，最后动静 ${whenLabel(row.lastSignalAt)}`}
                  </span>
                </span>
                <button
                  type="button"
                  className={css.act}
                  onClick={() => {
                    const seed = row.acceptance?.state === 'declined'
                      ? `${row.who}，「${row.what}」这条你接不了${row.acceptance.note === undefined ? '' : `（你说「${row.acceptance.note}」）`}，那我们重新定一下：换个时间、换个人，还是换个做法？`
                      : `${row.who}，「${row.what}」这条现在什么情况？`
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
                  {/*
                    拒领之后「催」是错的动词：没人接的活催谁都没用。设计给的就近动词是
                    **重新协商**——换人、改期、改内容，都得回到那句话里去说。
                  */}
                  {row.acceptance?.state === 'declined' ? '重新协商（去说）' : '催（去说）'}
                </button>
                {/*
                  **说明文字承诺了三个动词，旁边却只有一个** —— 决策 #57 点名的那种占位，
                  在这一格上以最纯粹的形式存在过：下面那行 hint 白纸黑字写着「能做的是
                  催、顺延、或者作废」，而这一行只长了「催」。

                  「不得以说明文字占位」说的正是这件事：一句话把动词许诺出去，人照着去找，
                  找不到——比什么都不说更坏，因为它先让人相信这里有。

                  主权同一个谓词：无主权不渲染（不灰化，也不禁言）。
                */}
                {row.stewardedBy === undefined && (
                  <>
                    <button
                      type="button"
                      className={css.act}
                      onClick={() => { setRepair({ kind: 'postpone', row }); setField(row.due?.text ?? '') }}
                    >
                      顺延期限
                    </button>
                    {/* 作废两段式：这一格和板上、目标级共用 `voidGate` 的同一句话。 */}
                    <button
                      type="button"
                      className={`${css.act} ${armed === row.id ? css.actDanger : ''}`}
                      disabled={busy === row.id}
                      onClick={() => {
                        if (armed !== row.id) {
                          setArmed(row.id)
                          setToast('作废是不可逆的人签发终态：等待它的对象级联收口、真身回写一笔。再点一次确认。')
                          return
                        }
                        setArmed('')
                        run(row.id, inject.voidCommitment(row.id, '在留意层作废'), `已作废：${row.what}`)
                      }}
                    >
                      {voidGate(armed === row.id).label}
                    </button>
                  </>
                )}
              </div>
            ))}
            {/* 顺延要一个输入框，它就长在这一行下面——动词就近，不是把人送去别处。 */}
            {attention.map(row => (
              <div key={`attend-form-${row.id}`}>{repairForm(row)}</div>
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
              {/*
                **我的切片置顶** —— 一页 N 个查看者 N 种渲染 (v4.22 参与者视角).

                切片 = **我执行的 ∪ 我委派的**（两册合一：一条我委派、又恰好我自己执行
                的活，在一屏上只该出现一次）。置顶来自**切片律**，不来自决断层——逾期对
                任何视角都不是可应答对象，它是信号，动词就近长在行上。

                这是**排列，不是过滤**：切片之外的行一条不少地留在下面。这一页的合法
                增量只有决断落座、一跳导航、就近动词，多一个筛子就是多一个要维护的视图；
                而「另有 N 条你没看」那种装饰是明拒条款点名过的。
              */}
              {mySlice.length > 0 && mySlice.length < goal.children.length && (
                <div className={css.sliceNote}>
                  下面这 {mySlice.length} 条与你有关（你执行的、或你委派出去的），先摆在前面。
                </div>
              )}
              {[
                ...goal.children.filter(child => mySlice.includes(child.id)),
                ...goal.children.filter(child => !mySlice.includes(child.id)),
              ].map(loopRow)}
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
                          seed: gapSeed(name, line.criterion),
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
                {/*
                  验收落座在**卡**上，不在这一屏——但这一屏得有门。

                  上面的「需要你 · 决断」在简报待答时本来就会长出一条（子图范围含简报
                  所在会话），可那一条是按会话聚合的；人此刻正看着这份简报本身，让他
                  回头去上面找，就是把一次一跳变成一次寻路。
                */}
                {goal.assessment.status === 'open' && goal.assessment.sessionId !== undefined && (
                  <button
                    type="button"
                    className={css.act}
                    onClick={() => { openSession(goal.assessment?.sessionId as string) }}
                  >
                    去答这份简报 ›
                  </button>
                )}
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
            go={(sessionId, choice) => {
              sendErrand(errandFor(portal, choice))
              setPortal(undefined)
              openSession(sessionId)
            }}
          />
        )}

        <div className={css.selfCheck}>
          闭环自检：拆解/委派 · 执行一跳 + 三值状态 · 产出归集 · 回执与验收 ·
          修理动词族（催/顺延/移交/合并/作废/收养/摘除）· 评估 · 真身之变显形
          —— 每一环都既看得见又动得了。
          这一页的合法增量只有决断落座、一跳导航、就近动词；每个动词在 IM 里都有兜底说法。
        </div>
      </div>
    </div>
  )
}
