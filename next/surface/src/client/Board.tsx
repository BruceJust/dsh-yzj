/**
 * 承诺板 — the department's commitments in one frame (检验标准④).
 *
 * People and agents side by side, because the unit being managed is the
 * commitment, not who or what happens to be executing it. Overdue rises to the
 * top and is the only thing here styled to be impossible to miss: this frame
 * exists to surface what is slipping, not to be a complete archive.
 *
 * **Two zoom levels, one list (v4.8).** 全部 is the flat cross-executor view.
 * GOALS groups the same commitments under the goal each serves — and a goal is
 * not a new kind of object: 「立目标」不是新动词, it is registering a commitment
 * whose executor is its owner and whose body is a Yunzhijia document. The goal
 * row is therefore drawn as a dashed OUTLINE: the body is not ours, and
 * drawing it solid would claim a copy we do not have. Its child counts are a
 * SIGNAL, never a derived completion — the parent's terminal state is always a
 * human acceptance.
 *
 * **未挂是合法状态，不是错误.** Not all work serves a goal, and forcing
 * alignment produces garbage alignment — the lesson every OKR tool learned the
 * expensive way. What the 无归属 group buys is that the alignment DEBT stops
 * being invisible: it can be pulled up, selected, and attached in one motion
 * at a weekly meeting instead of being discovered a quarter later.
 *
 * It is a QUERY over commitments — no board object, no second bookkeeping —
 * which is why it can be honest for free.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  BoardEventWire,
  BoardAssessmentWire, BoardGoalWire, BoardRowWire, BoardViewWire, PersonWire, SurfaceInject,
} from './rpc.ts'
import {
  currentBoardLens, pushFrame, sendErrand, setBoardLens, setSpotlight,
} from './store.ts'
import { revealAside } from './preview.ts'
import { RoomPicker, errandFor, type Portal } from './RoomPicker.tsx'
import { RepairVerbs, cascadeLine, voidGate, type Repair } from './RepairVerbs.tsx'
import { safeHref } from './preview.ts'
import {
  assessAsk, delegateSeed, eventPrepSeed, gapSeed, goalCraftSeed,
} from './commission.ts'
import { ArtifactCard } from './ArtifactCard.tsx'
import { PersonPicker } from './PersonPicker.tsx'
import { artifactRefOf } from './artifacts.ts'
import tokens from './tokens.module.css'
import css from './board.module.css'

export interface BoardProps {
  inject: SurfaceInject
  /**
   * 把一句话交给 agent —— **CTA 是话语的按钮形态** (§5.3 A6.1 ①).
   *
   * 「评估」走这里，不走传送门：它的落点是规则（私语域），不是要问人的社交决策。
   * 返回一句话 = 没送出去，为什么。
   */
  commission(text: string): Promise<string | undefined>
  openSession(sessionId: string): void
  back(): void
  /**
   * The conversation the operator came from, when there is one.
   *
   * 出生血缘指向磨稿会话 (v4.10): a goal ground out in a conversation and then
   * declared here is anchored to that conversation, not to 「桌面」. That anchor
   * is what somebody re-reads in month three when the goal has stopped making
   * sense — 「it came from nowhere」 is the one answer the graph must never give.
   */
  fromSessionId?: string
  /**
   * 从目标页返回时，板要回到离开时的那个像素。
   *
   * Back 与 Up 是两个问题:Up 是层级里的位置,Back 是**你personally**离开的那一屏。
   * 滚了半屏才看见的那个目标,返回时得还在眼前——否则每次进出都要重新找一遍,
   * 而缩放语法的全部意义就是进出不花钱。
   */
  restoreScroll?: number
}

type Lens = 'all' | 'goals'

const EMPTY: BoardViewWire = { rows: [], goals: [], unattached: [] }

/*
  目标引用与工件 URI 过的是同一道闸,所以只有一份实现(见 `preview.ts`)——
  一道安全闸有两份拷贝,迟早只有一份被修。
*/
export { safeHref } from './preview.ts'

/** How the parent reference got here — shown so it can be corrected. */
const VIA_LABEL: Record<string, string> = {
  inferred: '挂接为推断',
  inherited: '从语境继承',
  linked: '事后补挂',
  detached: '',
  explicit: '',
  'object-context': '从对象语境',
  chip: '从 chip 选定',
}

/**
 * 「多久没动了」的人话。
 *
 * 刻意**粗**：只到天/小时。板上要回答的是「这条是不是在滑掉」，而不是精确到分钟——
 * 一个精确的数字会让人以为它精确到那个程度，而 `lastSignalAt` 本身是「最后一次有东西
 * 碰过这个对象」的近似。
 */
export function sinceText(at: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 60) return '刚刚'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时`
  return `${String(Math.floor(hours / 24))} 天`
}

/**
 * 催办的拟稿 —— 一句**能直接发出去**的话，不是一个模板。
 *
 * 三条讲究，每一条都对着一种「拟了等于没拟」：
 *
 * - **带上原话**：催的是当初那句承诺，不是一个 id。「那件事怎么样了」对方要回头翻记录
 *   才知道你在问哪一件——那份翻找就是催办本该消掉的损耗。
 * - **期限用原话语**（`due` 是当初说的那句「下周初」，不是解析出来的时间戳）：把人说过
 *   的话改写成日期，是拿我们的解析冒充他的承诺（时间透镜两层规则，v4.21）。
 * - **不替人定调**：不写「请尽快」「麻烦了」。语气是社交决策，是发话的人自己的事——
 *   拟稿只把事实摆上，剩下的留给他改。
 */
/**
 * 这一屏此刻**按什么组织** —— 透镜 = 换组织轴，不是过滤器 (决策 #56).
 *
 * 抽成一个函数而不是散在 JSX 的条件里，是因为它是一条**判断**：方向透镜一开，目标分组
 * 就整个退场（组头/组 CTA/出生线/无归属分节全收起），行按信号序平铺。散着写的话，四个
 * 分支里漏掉一个，症状就是那次抓到的「欠我的显示的都是目标名称列表」——透镜换了问题，
 * 组织轴没换。
 */
/**
 * 「N 逾期 ›」按下去之后要做什么 —— **每个数字都是门**（逐级兑付定律）。
 *
 * 这个计数读的是**整块板**，而此刻屏幕上可能只铺着一个透镜下的一部分行，或者那条逾期的
 * 活正躺在一个折叠起来的目标组里。于是会出现这套系统最不该有的东西：**一个报出异常、
 * 却带不到现场的数字**——按下去什么都不发生，而「报出 3 项逾期却不可点」就是幽灵信号的
 * 定义。
 *
 * 两条路可选，这里选后者：把计数改成跟着透镜变（那样「逾期几条」这个事实就取决于我此刻
 * 从哪个角度看，而它明明是账本的事实），或者**让门真的开**——需要的话先把视野调回来。
 * 所以这个函数回答的是「要先做什么，才走得到那一行」。
 */
export function jumpPlan(input: {
  readonly rows: readonly { readonly id: string; readonly overdue: boolean; readonly goalRef?: string; readonly direction: string }[]
  readonly axis: 'all' | 'owed-to-me' | 'mine'
  /** 此刻折叠着的目标组。 */
  readonly shut: readonly string[]
}): { readonly rowId: string; readonly clearAxis: boolean; readonly expand?: string } | undefined {
  const first = input.rows.find(row => row.overdue)
  if (first === undefined) return undefined
  // 透镜挡住了它 → 先摘掉透镜。摘掉是因为**行在那儿**，只是此刻不在这个角度里。
  const clearAxis = input.axis !== 'all' && first.direction !== input.axis
  // 它在一个折叠的组里 → 先展开那个组。折叠收起的是身体，不是账。
  const expand = first.goalRef !== undefined && input.shut.includes(first.goalRef)
    ? first.goalRef
    : undefined
  return { rowId: first.id, clearAxis, ...(expand === undefined ? {} : { expand }) }
}

export function boardShape(
  axis: 'all' | 'owed-to-me' | 'mine', lens: 'all' | 'goals',
): 'flat' | 'grouped' {
  // 方向透镜盖过档位：它此刻问的不是「这条服务于哪个目标」。
  if (axis !== 'all') return 'flat'
  return lens === 'goals' ? 'grouped' : 'flat'
}

export function nudgeDraft(
  row: { what: string; due?: { text: string }; overdue: boolean },
): string {
  // 用 `text` 而不是解析出的日期：催的是他说过的那句话。
  const said = row.due?.text?.trim() ?? ''
  const when = said === ''
    ? ''
    : row.overdue ? `（当时说的是${said}，已经过了）` : `（当时说的是${said}）`
  return `问一下「${row.what}」这条现在到哪一步了${when}`
}

export function YzjBoard(props: BoardProps): ReactNode {
  const { inject, commission, openSession, back, fromSessionId, restoreScroll } = props
  const [view, setView] = useState<BoardViewWire>(EMPTY)
  /*
    档位从 store 里取初值:进目标页会把板卸载掉,回来是一次全新挂载。
    留在组件里的话,「按目标」放大进去再返回,落回的是「全部」——目标行连同你
    刚才停在的那一行一起消失,恢复滚动位置也就无从谈起。
  */
  const [lens, setLensState] = useState<Lens>(currentBoardLens)
  /*
    方向轴 —— **默认「全部」**。

    不记忆、不持久化：它是一次对账时的取景，不是一个偏好。记住它的后果是，下次打开
    板时你看到的是上次的取景，而板的承诺是「每次打开都能对上账」——一个记着旧筛选的
    板，正是 Viva Goals 那句验尸词说的「专程去喂的目的地」。
  */
  const [axis, setAxis] = useState<'all' | 'owed-to-me' | 'mine'>('all')
  /*
    折叠起来的目标组 (v4.21「组折叠 + 组头计数带异常语义」)。

    **折叠是查看者对注意力的主权**——它和租约（系统替你修剪已终态的东西）是正交的两件
    事：租约剪掉已经结束的，折叠收起一整个「还活着但今天不是我的事」的组。

    折叠之后**组头的计数必须还在**：折叠组仍然可对账。一个折叠起来就什么都不说的组，
    等于把一段账藏进抽屉——而板的定性就是账本的对账面。
  */
  const [shut, setShut] = useState<readonly string[]>([])
  /*
    期中修理动词族**就近** (v4.21 第一档③)。

    顺延/移交/合并此前只长在目标页上，于是**一条没挂目标的承诺，它的修理动词在整个
    产品里都不可达**——它没有目标页可进，而板行上只有摘除。你在板上看得见它，
    却对它什么都做不了。

    v4.23+（决策 #57）把这一条推到底：作废与收养/摘除也进了这个菜单。**无归属行没有
    hub 可去，板就是它唯一的修理入口**——只把入口做出来而里头是说明文字，等于全域不可达
    换了个样子（修了可见性没修可动性）。

    默认收起：行的常显只有四要素 + 三值信号（行信息层级），修理是**要的时候才亮出来**
    的东西。颜色预算同理——它是灰阶的一颗小按钮，不跟异常抢注意力。
  */
  const [repair, setRepair] = useState<Repair | undefined>(undefined)
  /**
   * 已经亮出后果、正等第二下的那颗作废 (决策 #57)。
   *
   * 一次只可能有一颗：按第二颗等于放弃第一颗，而放弃就是这道门存在的意义。
   */
  const [armed, setArmed] = useState('')
  /*
    **举起来的手会放下** (决策 #57 的一处补完).

    第一段亮出后果，第二段才动手——但如果那颗按钮一直举着，一小时后回到这一屏的人
    看到的是一个直接生效的「确认作废？」，而当初解释它的那句话早就散了。门的两半必须
    同生同灭：说明消失，扳机就该松开。

    比 toast 的 5 秒长一点：读完级联那句话再决定是正常节奏，而不是一场抢跑。
  */
  useEffect(() => {
    if (armed === '') return undefined
    const timer = setTimeout(() => { setArmed('') }, 8_000)
    return () => { clearTimeout(timer) }
  }, [armed])
  const [field, setField] = useState('')
  const [field2, setField2] = useState('')
  const setLens = useCallback((next: Lens): void => {
    setBoardLens(next)
    setLensState(next)
  }, [])
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  /** 事后时刻: what the weekly meeting has selected to attach in one go. */
  const [picked, setPicked] = useState<readonly string[]>([])
  const [declaring, setDeclaring] = useState(false)
  /** 传送门: the errand waiting for a room to be chosen for it. */
  const [portal, setPortal] = useState<Portal | undefined>(undefined)
  /*
    今天的会 —— 事件枢纽在板上的那一段 (§5.6).

    放在承诺板里而不是另开一屏：设计明写**不增殖注意力入口**（收件箱/卡徽标/决断条
    三层分工已经完整），而板本来就是「跨执行者、我盘子里有什么」那一框。v4.17 也把
    「今日日程」定为晨报的一个**段**，不是晨报本体。
  */
  const [events, setEvents] = useState<BoardEventWire[]>([])
  /** Which goals have their 产出 / 简报 drawers open. */
  const [openDrawer, setOpenDrawer] = useState<Record<string, boolean>>({})

  /*
    板自己的滚动容器。

    「Back 恢复板位」要的是**离开时的那个像素**,而板滚在自己这一层里,不是外层
    列——问外层要位置永远得到 0,于是从一个滚了半屏才看见的目标返回,人落在
    板顶,得自己再找一遍。
  */
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollTop = useCallback((): number => bodyRef.current?.scrollTop ?? 0, [])

  /*
    恢复得等内容先长出来。

    板是异步取的:刚挂载时高度还是 0,那一刻设 scrollTop 会被静静地钳成 0——
    看起来就像「返回没有恢复位置」。等到第一批行渲染出来再设。
  */
  const restored = useRef(false)
  useEffect(() => {
    if (restoreScroll === undefined || restored.current) return undefined
    const node = bodyRef.current
    if (node === null) return undefined
    /*
      等它长够了再放手。

      板是异步取来的,而且不是一次长到位:先是空的,然后行进来,然后组里的子行
      再撑开。任何一个中间时刻去设 scrollTop,浏览器都会**静静地钳到当时的
      最大值**——实测从滚到 500 的位置进目标页再返回,落在 187,看起来就像
      「恢复位置只恢复了一半」,而且没有任何报错说明发生了什么。

      所以判据不是「有没有得滚」,是「够不够滚到那儿」;不够就等下一拍。两秒
      还不够,说明板真的比离开时短了(有东西被作废、被筛掉),那就停在顶上——
      硬滚到一个不存在的位置比停在顶上更莫名其妙。
    */
    let done = false
    let tick: ReturnType<typeof setTimeout> | undefined
    const attempt = (): void => {
      if (done) return
      if (node.scrollHeight - node.clientHeight >= restoreScroll) {
        node.scrollTop = restoreScroll
        restored.current = true
        done = true
        return
      }
      tick = setTimeout(attempt, 60)
    }
    attempt()
    const giveUp = setTimeout(() => { done = true }, 2_000)
    return () => {
      done = true
      if (tick !== undefined) clearTimeout(tick)
      clearTimeout(giveUp)
    }
  }, [restoreScroll])

  /** Same monotonic ticket as the column: a stale poll must not repaint. */
  const fetchSeq = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    fetchSeq.current += 1
    const ticket = fetchSeq.current
    const next = await inject.board()
    if (ticket !== fetchSeq.current) return
    setView(next)
  }, [inject])

  /*
    会前那一眼要读**真身**（平台的日程），所以它是一次独立的异步读，不搭承诺那班车。
    读失败就是空——一段读不到的日程不该把整块板拖住。
  */
  useEffect(() => { void inject.events().then(setEvents) }, [inject])

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

  /**
   * 催一下 —— **拟稿 + 传送门 + 你自己发** (v4.21 第一档①「催办统一」).
   *
   * 此前这颗按钮是**一键借身**：点一下，系统就用操作者的名义把承诺卡重新投进那个群。
   * 省下的是打字，付出的是**「谁在说话」这件事不再由说话的人决定**——群里的人看到的
   * 是你在催，而你只是点了一颗按钮，甚至没看见催出去的是什么。这正是 B4 禁令要挡的
   * 事，而它在板上一直没有兑现。
   *
   * 换成传送门：把你送到那条承诺呼吸的地方，composer 里已经有一句拟好的稿——**改不改、
   * 发不发、怎么措辞，都还是你的**。摩擦再分配的原话：损耗性摩擦（找到那个会话、把事情
   * 重述一遍）归零；主权性摩擦（以我的名义向同事施压）保留并显式设计。
   *
   * 催不装载语境（`subject: 'nudge'`）：催不是委派，那个话题不该因为你催了一句就从此
   * 继承什么。
   */
  const nudge = useCallback((row: BoardRowWire): void => {
    if (row.sessionId === undefined) {
      // 没有可说话的地方就直说。一颗点下去没有下文的按钮，比没有按钮更坏。
      setToast('这条承诺没有可跳进去的会话——它登记时不在任何话题里。请自己去跟对方说一声。')
      return
    }
    sendErrand({
      subject: 'nudge',
      goalRef: row.goalRef ?? '',
      goalName: row.what,
      voice: 'place',
      seed: nudgeDraft(row),
    })
    openSession(row.sessionId)
  }, [openSession])

  /**
   * 验收 / 打回 —— **双动词，就近**。
   *
   * 打回要理由：拒收是一次质量判断，而没有理由的返工会让执行者第二次交上来的东西
   * 是猜的。验收不要——收下就是收下，追问「为什么收下」是给主权时刻加税。
   */
  const judge = useCallback((row: BoardRowWire, verdict: 'accept' | 'reject'): void => {
    const why = verdict === 'reject'
      ? window.prompt('打回的理由（会记在卡上，执行者看得到）：')
      : undefined
    if (verdict === 'reject' && (why === null || why === undefined || why.trim() === '')) return
    setBusy(row.id)
    void inject.cardAct('commitment', row.id, verdict, why ?? undefined).then((result) => {
      setToast(result?.receipt ?? (verdict === 'accept' ? '已验收。' : '已打回。'))
      setBusy('')
      void refresh()
    })
  }, [inject, refresh])

  /** 修理动词的统一收尾：说一句人话、刷新、把面板收起来。 */
  const runRepair = useCallback((id: string, work: Promise<{ error?: string }>, done: string): void => {
    setBusy(id)
    void work.then((result) => {
      setToast(result.error ?? done)
      setBusy('')
      if (result.error === undefined) {
        setRepair(undefined)
        setField('')
        setField2('')
        void refresh()
      }
    })
  }, [refresh])

  /** 事后补挂: attach everything selected to one goal, in one motion. */
  const linkPicked = useCallback((goalRef: string): void => {
    if (picked.length === 0) return
    setBusy('link')
    void inject.linkCommitments(goalRef, picked).then((result) => {
      setToast(result.error ?? `已把 ${String(result.linked ?? 0)} 条挂到这个目标下。`)
      setPicked([])
      setBusy('')
      void refresh()
    })
  }, [inject, picked, refresh])

  const overdue = view.rows.filter(row => row.overdue).length
  const goalOptions = useMemo(
    () => view.goals.map(goal => ({ ref: goal.goalRef, label: goal.row?.what ?? goal.goalRef })),
    [view.goals],
  )


  const voidRow = useCallback((row: BoardRowWire): void => {
    setBusy(row.id)
    void inject.voidCommitment(row.id, '操作者在承诺板作废').then((result) => {
      setToast(result.error ?? `已作废：${row.what}`)
      setBusy('')
      void refresh()
    })
  }, [inject, refresh])

  const rowNode = (row: BoardRowWire, pickable = false, inGoal = false): ReactNode => {
    /*
      挂接出处只在真的挂着的时候才有意义。

      Spotted on the live board: rows sitting in 无归属 were wearing 「事后补挂」.
      `attachedVia` is provenance for a reference, so once there is no
      reference the label is a claim about nothing — and it read as "this is
      attached" on exactly the rows the group exists to say are not. Gating on
      the reference rather than on the provenance value is right whatever wrote
      it, including rows written before 移出 learned to stamp `detached`.
    */
    const via = row.goalRef === undefined ? '' : VIA_LABEL[row.attachedVia ?? ''] ?? ''
    return (
      <div
        className={`${css.row} ${row.overdue ? css.rowOverdue : ''} ${row.status !== 'open' ? css.rowDone : ''}`}
        key={row.id}
        // 指路要有落点：数字是门，门后面得有一扇门牌。
        data-row={row.id}
        // 披露一级：hover 看得到出生故事；二级在「修理」面板里，不靠 hover。
        /*
          不渲染要**有出处**。一行上少了三颗按钮而不说为什么，人第一反应是界面坏了。
          出生故事那一级（hover）本来就在这儿，把「归谁管」并进去不花常显预算。
        */
        title={[
          via === '' ? '' : `挂接来源：${via}`,
          row.stewardedBy === undefined
            ? ''
            : `这条归 ${row.stewardedBy} 管——修理动词只对登记它的人渲染；你仍然可以在会话里直接说`,
        ].filter(line => line !== '').join('　·　') || undefined}
      >
        {pickable && (
          <input
            type="checkbox"
            className={css.pick}
            checked={picked.includes(row.id)}
            aria-label="选中以便批量补挂"
            onChange={() => {
              setPicked(value => (
                value.includes(row.id) ? value.filter(id => id !== row.id) : [...value, row.id]
              ))
            }}
          />
        )}
        <span className={`${css.who} ${row.executorKind === 'agent' ? css.whoAgent : css.whoHuman}`}>
          {row.who}
        </span>
        <span className={css.what}>{row.what}</span>
        {/*
          责任锚第二槽：**谁验收** (v4.21)。

          与「谁执行」正交——an agent cannot be held accountable。一条 agent 在跑的活，
          执行者是 agent、验收人仍是某个人；两件事挤在一格里，「这活归谁」和「这活最后
          谁点头」就永远分不开。**等于查看者本人时服务端不下发**（本人省略）：绝大多数
          行的验收人都是你自己，全都印出来只会把真正需要说清的那几行淹掉。
        */}
        {row.acceptor !== undefined && (
          <span className={css.acceptor} title={`由 ${row.acceptor} 验收——验收人恒为人`}>
            ✓ {row.acceptor}
          </span>
        )}
        {/*
          挂接来源**降两级披露** (v4.21 行信息层级)。

          它此前是常显的一枚 chip。常显有预算——四要素 + 三值信号；而**出生故事的差异化
          在于「有据可查」，不在于「时时刻刻挂在脸上」**。降到两级：hover 一级（这一行
          的 title），详情二级（「修理」面板里那一行，键盘与触屏都够得着）。

          **hover 永远不是唯一通道**：触屏没有 hover，读屏软件也不念 title。所以二级
          那一份不是补充，是它的可达性本身。

          只有**推断**来的挂接仍然常显一枚小标记：推断是需要被纠正的东西，而需要纠正
          的东西不该藏起来——「继承不是推断，两者不是同一种主张」这条分界仍然成立。
        */}
        {via !== '' && row.inferredGoal && (
          <span className={`${css.via} ${css.viaGuess}`} title={`挂接来源：${via}（推断，可纠正）`}>
            推断
          </span>
        )}
        <span className={`${css.due} ${row.overdue ? css.dueOverdue : ''}`}>
          {row.status !== 'open'
            ? row.status === 'closed' ? '已完成' : row.status === 'voided' ? '已作废' : '已合并'
            : row.due?.text ?? '无期限'}
        </span>
        {/*
          幽灵承诺禁令的失败模式：落库了，但没呼吸。
          It is louder than 逾期 on purpose — an overdue commitment is late,
          this one is work somebody has been assigned and does not know about.
        */}
        {/*
          三值信号下板 (v4.21 第一档④)。

          `signal` 这个字段在线上躺了很久，而板一个字都没显——于是「登记完就再没有
          下文」的那条，和一条有回执有产物的事，在同一行里长得一模一样。**「没消息」
          不等于「没问题」**，这句话此前只在目标页兑现，第一缩放级看不见。

          终态行不显：一件已经结束的事，「多久没动静」不是一个问题。
        */}
        {/*
          待验收 —— **断头路修好了，路标也得竖起来** (v4.21 第一档⑥)。

          承诺仍然 `open`（在有人验收之前它确实还欠着），所以不单独说的话，这条行看
          起来和「在跑」一模一样，而它其实在等你。它排在三值信号前面：等你答的事，
          比「多久没动」更该先被看见。
        */}
        {/*
          **目标降为行内 chip** —— 从骨架降为上下文 (决策 #56)。

          透镜一开，目标组整个退场：那一屏问的是「张锐那边怎么样」，不是「目标第三条
          怎么样」。但**一跳指路不能丢**——所以目标以一枚 chip 留在行上，点它就回到那个
          目标的枢纽。

          只在行**不在目标组里**时出现：组里那一行头上就顶着组名，再挂一枚 chip 是把
          同一句话说两遍。
        */}
        {!inGoal && row.goalRef !== undefined && goalNameOf.get(row.goalRef) !== undefined && (
          <button
            type="button"
            className={css.goalChip}
            title="回到这个目标：决断、执行清单、产出、评估都在里面"
            onClick={() => {
              pushFrame(
                {
                  kind: 'goal',
                  goalRef: row.goalRef as string,
                  goalName: goalNameOf.get(row.goalRef as string) as string,
                },
                scrollTop(),
              )
            }}
          >
            ◎ {goalNameOf.get(row.goalRef)}
          </button>
        )}
        {row.status === 'open' && row.awaitingAcceptance === true && (
          <span className={css.awaiting} title="对方主张已经交付，等你验收或打回">
            待验收
          </span>
        )}
        {row.status === 'open' && row.awaitingAcceptance !== true && row.signal !== 'evidence' && (
          <span
            className={row.signal === 'silent' ? css.sigSilent : css.sigStale}
            title={row.signal === 'silent'
              ? '登记之后再没有任何东西碰过它——没消息不等于没问题'
              : `最后一次有动静是${sinceText(row.lastSignalAt)}，之后就没动了`}
          >
            {row.signal === 'silent' ? '无信号' : `${sinceText(row.lastSignalAt)}没动`}
          </span>
        )}
        {/*
          **就近动词** —— 板上看得见「待验收」，就该在这一行上按得下去。

          这一格是被一次真装配闭环逼出来的：agent 正确地拒绝了代人验收，并告诉操作者
          「去承诺板上那张卡按验收」——而板上当时**没有那颗按钮**。徽标竖起来了、动词
          没跟上，等于把人指到一堵墙上。「信号即门·逐级兑付」说的就是这件事：没有不可
          兑付的信号。

          只有待验收时出现：没有交付可验的时候摆一颗「验收」，是请人去验收一份不存在
          的产出（此前修过的僵尸问题）。
        */}
        {row.status === 'open' && row.awaitingAcceptance === true && (
          <>
            <button
              type="button"
              className={css.acceptGo}
              disabled={busy === row.id}
              title="收下这份交付——承诺就此终态"
              onClick={() => { judge(row, 'accept') }}
            >
              验收
            </button>
            <button
              type="button"
              className={css.rejectGo}
              disabled={busy === row.id}
              title="打回重做——承诺没死，死的是这一版交付；轮次会记在卡上"
              onClick={() => { judge(row, 'reject') }}
            >
              打回
            </button>
          </>
        )}
        {row.notified === 'failed' && (
          <span className={css.unnotified} title="登记落库了，但这条消息没能发到执行者所在的会话——对方并不知道。请自己去说一声。">
            未通知 · 请亲发
          </span>
        )}
        {row.remindable && row.stewardedBy === undefined && (
          <button
            type="button"
            className={css.remind}
            disabled={busy === row.id}
            title="跳到这条承诺所在的会话，composer 里会有一句拟好的稿——改不改、发不发，都还是你的"
            onClick={() => { nudge(row) }}
          >
            催一下
          </button>
        )}
        {/*
          修理动词**就近** (v4.21 第一档③)。

          三个动词（顺延/移交/合并）此前只在目标页上，而没挂目标的承诺没有目标页——
          于是它在整个产品里都修不了。收起来是因为行的常显只有四要素 + 三值信号；
          灰阶是因为颜色预算只留给状态与异常。
        */}
        {/*
          **无主权的动词不渲染** (v4.22 裁决②)。

          修理动词族的主权 = 这条承诺的 owner——当初把它说出口、登记下来的那个人。
          v4.21 把这几颗按钮做成了**全行渲染**，而设计把那次实现点名成了裁决②的第一
          违规者：主权法则缺位时，实现者必然用「全给」填空。

          不渲染，不是灰化：灰按钮是「你不配」的展示。**不渲染也不禁言**——人人可以在
          会话里直接说一句，系统只是不替无主权者造一个按钮。
        */}
        {row.status === 'open' && row.stewardedBy === undefined && (
          <button
            type="button"
            className={css.repairOpen}
            title="顺延期限 / 移交他人 / 合并到另一条 / 作废 / 收养或摘除——改的都是当初说出口的话"
            onClick={() => {
              setRepair(current => (current?.row.id === row.id ? undefined : { kind: 'postpone', row }))
              setField(row.due?.text ?? '')
              setField2('')
            }}
          >
            修理
          </button>
        )}
        {/*
          过程 = 一跳可达，绝不搬运 (v4.9).
          One line of summary so the reader can decide whether to make the hop;
          the trajectory itself stays in the conversation, where it belongs.
          A digest of it here would be the second timeline §7.4 forbids.
        */}
        {row.sessionId !== undefined && (
          <button
            type="button"
            className={css.open}
            title={row.progress === undefined
              ? '打开这条承诺所在的会话——过程在那里，不搬到这里'
              : `最近：${row.progress}　（过程在会话里，这里只放一行）`}
            onClick={() => { openSession(row.sessionId as string) }}
          >
            {row.placeName ?? '打开'} ›
          </button>
        )}
        {row.progress !== undefined && (
          <span className={css.progress} title={row.progress}>{row.progress}</span>
        )}
        {/*
          三个动词并排在面板里，而不是三颗按钮排在行上：行的常显有预算，
          而「顺延还是移交还是合并」是打开之后才需要分的岔路。
        */}
        {repair?.row.id === row.id && (
          <div className={css.repairPanel}>
            {/*
              披露二级 —— **不靠 hover**。触屏没有 hover，读屏软件也不念 title，
              所以这一行不是补充，是出生故事可达性本身。
            */}
            <div className={css.detail}>
              来源：{via === '' ? '未挂任何目标' : via}
              {row.placeName === undefined ? '' : ` · 登记在 ${row.placeName}`}
              {row.notified === 'failed' ? ' · 本人未被通知' : ''}
            </div>
            <div className={css.repairPick}>
              {/*
                **修理条 = 可执行的动词条，不是说明文字** (决策 #57).

                作废与收养/摘除此前不在这里：作废只长在目标组头上，摘除是行上一颗单独的
                按钮，而**无归属行没有目标页可去，板就是它唯一的修理入口**——占位即全域
                不可达。收养（无归属）与摘除（有归属）**互斥**：同一格的加减法。
              */}
              {([
                ['postpone', '顺延期限'], ['handoff', '移交'], ['merge', '合并'],
                ['void', '作废…'], ['attach', row.goalRef === undefined ? '收养' : '摘除'],
              ] as const)
                .map(([kind, label]) => (
                  <button
                    type="button"
                    key={kind}
                    className={`${css.repairTab} ${repair.kind === kind ? css.repairTabOn : ''}`}
                    onClick={() => { setRepair({ kind, row }); setField(kind === 'postpone' ? row.due?.text ?? '' : '') }}
                  >
                    {label}
                  </button>
                ))}
            </div>
            <RepairVerbs
              repair={repair}
              siblings={siblingsOf(row)}
              goals={goalOptions}
              cascadeOpen={view.goals.find(entry => entry.goalRef === row.isGoal)?.counts.open ?? 0}
              inject={inject}
              busy={busy !== ''}
              field={field}
              setField={setField}
              field2={field2}
              setField2={setField2}
              close={() => { setRepair(undefined) }}
              run={runRepair}
            />
          </div>
        )}
      </div>
    )
  }

  /**
   * 差距简报，以及它的第三个出口。
   *
   * 验收 and 继续 are answered on the card in the conversation (that is where
   * the report was asked for). What lives HERE is 差距项一键变委派 — because the
   * portal lives here, and 评估喂回执行 is only a loop if both ends are in one
   * place. Every gap is one press from being somebody's commitment.
   */
  const reportNode = (goal: BoardGoalWire, report: BoardAssessmentWire): ReactNode => {
    const key = `asm:${goal.goalRef}`
    const gaps = report.lines.filter(line => line.verdict !== 'met').length
    return (
      <div className={css.drawer}>
        <button
          type="button"
          className={css.drawerHead}
          onClick={() => { setOpenDrawer(value => ({ ...value, [key]: value[key] !== true })) }}
        >
          {openDrawer[key] === true ? '▾' : '▸'} 差距简报
          <span className={`${css.reportTag} ${gaps > 0 ? css.reportGap : ''}`}>
            {report.lines.length} 条标准 · {gaps} 条未达成
          </span>
          <span className={css.drawerNote}>
            {report.status === 'accepted' ? '已验收' : report.status === 'continued' ? '已看过 · 继续' : '待你验收'}
          </span>
        </button>
        {openDrawer[key] === true && (
          <div className={css.drawerBody}>
            <div className={css.reportSummary}>{report.summary}</div>
            {report.lines.map((line, index) => (
              <div className={css.reportLine} key={`${report.id}:${String(index)}`}>
                <span className={`${css.verdict} ${
                  line.verdict === 'met' ? css.vMet : line.verdict === 'partial' ? css.vPartial : css.vMissing
                }`}
                >
                  {line.verdict === 'met' ? '已达成' : line.verdict === 'partial' ? '部分' : '缺失'}
                </span>
                <span className={css.criterion}>{line.criterion}</span>
                <span className={css.evidence} title={line.evidence}>{line.evidence}</span>
                {line.verdict !== 'met' && (
                  <button
                    type="button"
                    className={css.gapDelegate}
                    title="把这条缺口变成一次委派——同一个传送门，评估喂回执行"
                    onClick={() => {
                      setPortal({
                       subject: 'goal',
                        goalRef: goal.goalRef,
                        goalName: goal.row?.what ?? goal.goalRef,
                        voice: 'place',
                        seed: gapSeed(goal.row?.what ?? goal.goalRef, line.criterion),
                        title: '把这条缺口变成委派：跳进哪个会话说？',
                        note: '句子还是你自己说——这里只负责把你送到该说话的地方。',
                      })
                    }}
                  >
                    变委派 ↗
                  </button>
                )}
              </div>
            ))}
            {/*
              **板不设决断条，但板要指路** (v4.21 合法增量：对账排列 / 一跳指路 /
              就近动词)。

              验收与「继续」不在这儿答——收件箱是唯一的跨会话聚合处，而那张卡的家
              在它出生的会话里，前后语境就是决断的证据。但只说一句「去那张卡上答」
              而不给门，是把人指到一堵墙上：这一屏既没说卡在哪，也没有一跳可走。
              「报出一件待答的事却按不下去」正是幽灵信号。
            */}
            <div className={css.reportFoot}>
              <span>验收与「继续」在那张简报卡上答——这是材料，不是判决。</span>
              {report.status === 'open' && (
                report.sessionId === undefined
                  // 三值纪律：不知道它在哪，就说不知道，别给一颗点了没反应的按钮。
                  ? <span>（这份简报没有记下它落在哪个会话——去收件箱找「差距简报」那一条。）</span>
                  : (
                    <button
                      type="button"
                      className={css.reportGo}
                      title="跳到这份简报所在的会话——卡留在它出生的地方，语境就是判断的依据"
                      onClick={() => { openSession(report.sessionId as string) }}
                    >
                      去答这份简报 ›
                    </button>
                  )
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const goalNode = (goal: BoardGoalWire): ReactNode => {
    const closed = shut.includes(goal.goalRef)
    return (
    <div className={css.goalBlock} key={goal.goalRef}>
      {/*
        虚线框 = 真身在云之家，不在图上. The dashes are the claim: this row is a
        handle on a document we do not own, and the link is the only honest
        way to see the thing itself.
      */}
      <div className={css.goal}>
        {/*
          披露列在行的最左边，和侧栏**同位同行为**（同构复制原则）——同一个手势在两个
          地方意思一样，人才不用为第二个地方重新学一遍。
        */}
        <button
          type="button"
          className={`${css.chev} ${closed ? css.chevClosed : ''}`}
          aria-label={closed ? '展开这个目标组' : '折叠这个目标组'}
          title={closed ? '展开' : '折叠——组头的计数会留下，折叠组仍然可对账'}
          onClick={() => {
            setShut(value => (
              value.includes(goal.goalRef)
                ? value.filter(ref => ref !== goal.goalRef)
                : [...value, goal.goalRef]
            ))
          }}
        >
          <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
            <path
              d="M2 3.5 5 6.5 8 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className={css.goalTag}>目标</span>
        {/*
          放大 = 缩放语法的第四次复用 (v4.12):板 → 目标页。

          它是**同一份数据的第二级**,不是另一个要打开的地方——Back 回来时板还在
          原来那个滚动位置。这一条是竞品的死因:Viva Goals 功能最全,死在「又一个
          要打开的 app」上。
        */}
        <button
          type="button"
          className={css.goalName}
          title="放大这个目标：决断、执行清单、产出、评估都在里面（‹ 返回 回到板上原位）"
          onClick={() => {
            pushFrame(
              { kind: 'goal', goalRef: goal.goalRef, goalName: goal.row?.what ?? goal.goalRef },
              scrollTop(),
            )
          }}
        >
          {goal.row?.what ?? goal.goalRef} ›
        </button>
        {goal.row?.who !== undefined && <span className={css.goalOwner}>owner {goal.row.who}</span>}
        <span className={css.goalSig}>
          {goal.counts.open} 在跟
          {goal.counts.overdue > 0 && <b className={css.sigOverdue}> · {goal.counts.overdue} 逾期</b>}
          {goal.counts.settled > 0 && ` · ${String(goal.counts.settled)} 已了`}
        </span>
        {/* 聚合是信号不是状态: the counts never close the parent. */}
        <span className={css.manual}>终态：人工验收</span>
        {safeHref(goal.goalRef) === undefined
          ? (
            <span className={css.goalUnsafe} title={goal.goalRef}>
              这个引用不是一个链接
            </span>
          )
          : (
            <a
              className={css.goalLink}
              href={safeHref(goal.goalRef)}
              target="_blank"
              rel="noreferrer noopener"
            >
              看真身 ↗
            </a>
          )}
        {/*
          委派 = 传送门，不是表单 (v4.9 入口 A①).

          The board picks the two things only a person can decide — which goal,
          and WHICH ROOM — and then gets out of the way. 场所（听众）是委派话语
          的一等参数，人选不推导: delegating in public is pressure and
          transparency, delegating privately leaves room, and a machine that
          chose between them would have made a social decision for somebody.
          Building an assignment form here instead would re-invent a project
          management tool AND rebuild the split entrance this product exists to
          close.
        */}
        {goal.row !== undefined && goal.row.status === 'open' && goal.row.stewardedBy === undefined && (
          <button
            type="button"
            className={css.delegate}
            title="选一个会话跳进去，用你自己的话说——这一列不做分配表单"
            onClick={() => {
              setPortal({
               subject: 'goal',
                goalRef: goal.goalRef,
                goalName: goal.row?.what ?? goal.goalRef,
                voice: 'place',
                // 两维真选择：先问谁来做，再问在哪儿说——执行者决定场所的选项集。
                pick: 'executor',
                // 起头，不是稿子：派什么、什么时候前，都是他要说的话。
                seed: delegateSeed(goal.row?.what ?? goal.goalRef),
                title: '委派：跳进哪个会话说？',
                note: '公开委派是施压与透明，私下委派是留余地——这个选择不该由系统替你做。',
              })
            }}
          >
            委派 ↗
          </button>
        )}
        {/*
          评估**不是传送门** —— 按下即是对 agent 说了那句话 (§5.3 A6.1 ①).

          它此前和左边的「委派 ↗」共用一套动作：弹一屏问「在哪个会话里私下问？」，
          跳过去，把一句现成的话放进输入框等人按发送。可这两颗按钮问的根本不是同一
          个问题——**委派要问场所**（听众是社交决策，人选不推导），**评估的落点是
          规则**：简报只在私语域生成，因为它汇集的证据跨场所，投进群里会被可见域
          悄悄削掉一半。对一个只有一个合法答案的问题弹一屏，收的是纯损耗的摩擦。
        */}
        {goal.row !== undefined && goal.row.status === 'open' && goal.row.stewardedBy === undefined && (
          <button
            type="button"
            className={css.assess}
            disabled={busy === `asm:${goal.goalRef}`}
            title="按下就是对 agent 说「评估一下」：它拿子承诺终态与产出对着成功标准备料出简报——验收还是你的动作"
            onClick={() => {
              const label = goal.row?.what ?? goal.goalRef
              setBusy(`asm:${goal.goalRef}`)
              /*
                句子里带 `goalRef`——**agent 唯一推导不出来的那件事**：成功标准住在
                云之家那份文档的正文里，不给引用它只能拿手上那份副本对账，而那份副本
                恰恰是可能已经过时的那一份 (4h②)。工具名不写进去：那是实现细节，而
                这句话是操作者说出口的话。
              */
              void commission(assessAsk(label, goal.goalRef)).then((error) => {
                setBusy('')
                if (error !== undefined) setToast(error)
              })
            }}
          >
            评估
          </button>
        )}
        {/* A goal declared here has no card in any place's stream, so this is
            the only route that can retire it. A door that only opens one way
            is not a door. */}
        {goal.row !== undefined && goal.row.status === 'open' && goal.row.stewardedBy === undefined && (
          <button
            type="button"
            className={`${css.voidGoal} ${armed === goal.row.id ? css.voidArmed : ''}`}
            disabled={busy === goal.row.id}
            /*
              作废只作废这一条。子承诺的 parentGoalRef 没人改，也不该由一次
              作废去改——它们仍是真实的活。板子刻意让退休目标继续持有还有活的
              那一组，所以「会回到无归属」是句假话。

              **两段式** (决策 #57)：第一段把级联说清（底下有几条、它们不会自动作废），
              第二段才动手。目标级作废的波及面比一行大得多，而它此前是一下点掉的。
            */
            title="作废这个目标。它下面的工作不会自动移走——仍在原处，可以逐条「摘除」"
            onClick={() => {
              const id = goal.row?.id ?? ''
              if (armed !== id) {
                setArmed(id)
                setToast(`作废目标是不可逆的人签发终态。${cascadeLine(goal.counts.open)}再点一次确认。`)
                return
              }
              setArmed('')
              voidRow(goal.row as BoardRowWire)
            }}
          >
            {voidGate(armed === goal.row.id).label}
          </button>
        )}
      </div>
      {/*
        折叠收起的是**身体**，不是**账**：成功标准、执行清单、产出都收起来，而组头那一行
        （计数与异常）留在上面。折叠组仍然可对账——这是折叠与「藏起来」的分界。
      */}
      {!closed && goal.criteria !== undefined && (
        <div className={css.criteria}>
          <span className={css.criteriaLabel}>怎么算完成</span>
          {goal.criteria}
        </div>
      )}
      {!closed && <div className={css.goalChildren}>
        {/*
          这里只剩**一种**空了。

          此前这一格分两种：真的空，和「被方向轴筛掉了」——因为方向轴当时是个过滤器，
          会在一个挂满了别人的活的目标下印出「还没有工作挂在这个目标下」这句假话。
          决策 #56 之后透镜激活时整个目标分组退场，这一支根本到不了；留着一个到不了
          的分支，就是留着一句没人能验证的话。
        */}
        {goal.children.length === 0
          ? <div className={css.goalEmpty}>还没有工作挂在这个目标下。</div>
          : goal.children.map(child => rowNode(child, false, true))}
      </div>}
      {/*
        产出 = 两跳派生归集（目标→承诺→工件）.
        Folded by default: the goal view answers "where does this stand" first,
        and a wall of artifacts would bury the signal it exists to show.
      */}
      {!closed && goal.artifacts.length > 0 && (
        <div className={css.drawer}>
          <button
            type="button"
            className={css.drawerHead}
            onClick={() => {
              setOpenDrawer(value => ({
                ...value, [`out:${goal.goalRef}`]: value[`out:${goal.goalRef}`] !== true,
              }))
            }}
          >
            {openDrawer[`out:${goal.goalRef}`] === true ? '▾' : '▸'} 产出 {goal.artifacts.length}
            <span className={css.drawerNote}>
              {goal.artifacts.some(artifact => artifact.shared === true)
                ? '这些是这个目标下的工作留下的；带「共用会话」的那几条产在同时服务多个目标的会话里'
                : '这些工件是这个目标下的工作留下的，不是存在目标里的'}
            </span>
          </button>
          {openDrawer[`out:${goal.goalRef}`] === true && (
            <div className={css.drawerBody}>
              {/*
                和流里、右栏里画的是同一张卡(v4.11 工件统一),只是紧凑一档——
                一屏要放下十几条产出。

                「共用会话」这条提醒不能丢:工件是**话题**产出的,图上没有承诺→
                工件这条边可走。所以一个同时服务两个目标的会话,它的产出归给谁
                都不准确——丢掉是丢真数据,独占是说假话,标出来才两样都不是。
              */}
              {goal.artifacts.map(artifact => (
                <ArtifactCard
                  key={artifact.uri}
                  dense
                  artifact={artifactRefOf({
                    uri: artifact.uri,
                    title: artifact.title,
                    action: artifact.action,
                    marks: [artifact.shared === true
                      ? {
                        label: '共用会话',
                        why: '这个会话同时在服务不止一个目标，无法把产出独归其一',
                      }
                      : undefined],
                  })}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {/*
        差距简报**折叠时也收起**：它是这个目标的身体，不是它的账。组头的计数已经
        回答了「这个组现在什么样」。
      */}
      {!closed && goal.assessment !== undefined && reportNode(goal, goal.assessment)}
    </div>
    )
  }


  /**
   * 一场会一行 —— 会前那一眼 (§5.6 事件枢纽).
   *
   * 一行上只有三样东西：几点、叫什么、**准备好没有**。挂着的活折在下面，因为会前
   * 真正要决定的只有一件事：还差什么、要不要现在补一刀。
   */
  const eventNode = (event: BoardEventWire): ReactNode => {
    const clock = new Date(event.startAt)
    const at = event.startAt === 0
      ? ''
      : `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`
    return (
      <div className={css.eventRow} key={event.eventId}>
        <div className={css.eventHead}>
          <span className={css.eventAt}>{at}</span>
          {/*
            **每一行是门** (§5.6「日程锚是门」/ 信号即门).

            一行上装得下的只有三样：几点、叫什么、准备好没有。而看见「还差一些」之后，
            人下一个动作永远是「差什么」——那一屏放不进这一行，也不该把板撑成第二个
            日历（板的合法增量只有对账排列、一跳指路、就近动词）。所以这一下是**指路**：
            右栏接管，那里摊开挂了哪几件活、材料在不在、日程描述里写了什么。

            只有标题是按钮，不是整行：行里还站着「为此会准备」，按钮套按钮既不合法也
            会让人不知道自己按到了哪一个。
          */}
          <button
            type="button"
            className={css.eventTitle}
            title="看进去：挂了哪几件活、材料在不在、日程描述写了什么（在右栏打开）"
            onClick={() => {
              setSpotlight({ kind: 'event', eventId: event.eventId, title: event.title })
              /*
                抽屉开不出来时**说一声**。实测过：当前会话为空时宿主的右栏打不开，
                而从板上点一场会恰恰常常处在这个状态——那时人看到的是「什么都没
                发生」，所有 bug 里最难被报告的一种。

                这句话由 `revealAside` **等它一拍之后**才喊：抽屉是带过渡动画开的，
                当场量必然量到 0，那样每一次正常的打开都会附赠一句假错误。
              */
              revealAside(() => {
                /*
                  **说事实，别断因。**

                  这句话第一版写的是「（当前没有会话）」——那是我们知道的一种成因，
                  不是量出来的那一个。实测在 863px 宽的窗口里，抽屉是**因为窗口太窄**
                  才开不出来的，而那句话言之凿凿地说是会话的问题，把人支去开会话。
                  一个查不出的假因，比不给原因更费时间。
                */
                setToast('右栏没能打开——窗口太窄，或者当前还没有会话。拉宽窗口、或从左边打开一个会话，再点这场会。')
              })
            }}
          >
            {event.title}
          </button>
          <span className={`${css.eventReady} ${css[`ready_${event.readiness}`] ?? ''}`}>
            {event.readinessLine}
          </span>
          {/*
            「为此会准备」是**传送门**，不是表单 (§5.6 CTA).

            它不替你派活：跳进你选的那个会话，话由你说。派活是社交决策，机器代做的
            那一刻就错了——和目标那边的委派 CTA 同一个组件、同一条纪律。
          */}
          <button
            type="button"
            className={css.eventPrep}
            title="选一个会话跳进去，用你自己的话把会前要准备的事派出去"
            onClick={() => {
              setPortal({
                subject: 'event',
                goalRef: `yzj://event/${event.eventId}`,
                goalName: event.title,
                voice: 'place',
                /*
                  连催办都拟稿了，这一颗没有理由让人从零打起——起头把「为哪场会」
                  摆好，要补的那一刀是什么、派给谁，仍然是他说。
                */
                seed: eventPrepSeed(event.title),
                title: '为这场会准备：跳进哪个会话说？',
                note: '会前要补的那一刀，说给谁听、在哪说，只有你知道。',
              })
            }}
          >
            为此会准备 ↗
          </button>
        </div>
        {event.prepares.length > 0 && (
          <div className={css.eventPreps}>
            {event.prepares.map(item => (
              <div className={css.eventPrep_} key={item.commitmentId}>
                <span className={css.eventPrepWhat}>{item.what}</span>
                <span className={css.eventPrepWho}>{item.who} · {item.status}</span>
                {item.artifacts.map(artifact => (
                  <a
                    key={artifact.uri}
                    className={css.eventArtifact}
                    href={safeHref(artifact.uri)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {artifact.title}
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}
        {/*
          材料清单进没进日程描述，是**参会的人看不看得到**的分界线。
          图上齐全不等于开会的人知道——他们看的是日程条目。
        */}
        {event.prepares.some(item => item.artifacts.length > 0) && event.postedMaterials === undefined && (
          <div className={css.eventNote}>
            材料还没写进日程描述——参会的人在日程里看不到它们。
          </div>
        )}
      </div>
    )
  }

  /*
    方向轴只**取舍**，不改事实：它不重排、不改状态，只决定哪些行此刻在视野里。
    目标组里同样生效——否则「我欠的」切过去，组里还躺着一堆别人的活。
  */
  const inAxis = (row: BoardRowWire): boolean => axis === 'all' || row.direction === axis

  /*
    **透镜 = 换组织轴，不是过滤器** (决策 #56)。

    症状是「欠我的显示的都是目标名称列表」。病根不在筛选，在**组织轴没换**：「欠我的」
    的原生问题是**债务人 × 账龄/信号**，横切目标——催张锐的时候人想的是「张锐那边怎么
    样」，不是「目标第三条怎么样」（会计的应收报表按债务人×账龄组织，从不按项目）。

    目标分组是「全部」视图的**正确骨架**，而透镜一开它就成了噪音：一屏的组头、组 CTA、
    出生线，全都在回答一个此刻没人在问的问题。所以透镜激活时它整个退场，行按信号序
    平铺，目标**降为行内一枚 chip**——从骨架降为上下文，一跳指路一点没丢。

    两册同规则：「我欠的」是行动清单，同样不顶目标组头。
  */
  const axisOn = boardShape(axis, lens) === 'flat' && axis !== 'all'
  /** 行内那枚 chip 要显示的名字。查不到就不显示——不拿 URI 冒充名字。 */
  const goalNameOf = new Map(
    view.goals.map(entry => [entry.goalRef, entry.row?.what] as const),
  )

  /*
    可以合并进去的同伴。

    **同组之内**：挂同一个目标的，或者同为「无归属」的。跨目标合并不在这里给——
    两条服务于不同目标的承诺长得再像，合并它们也是一次改变归属的判断，不该藏在
    一颗「合并」按钮后面。
  */
  const siblingsOf = (row: BoardRowWire): readonly BoardRowWire[] => (
    view.rows.filter(one => one.id !== row.id && one.status === 'open' && one.goalRef === row.goalRef)
  )

  return (
    <div className={`${tokens.tokens} ${css.board}`}>
      <div className={css.head}>
        <span className={css.title}>承诺板</span>
        <span className={css.sub}>
          跨执行者 · 共 {String(view.rows.length)} 条
          {/*
            **每个数字都是门** —— 逐级兑付定律 (v4.21 第一档②的原则，在板上的适用)。

            这个「N 逾期」此前是一个 `span`：它报出一个异常，却不告诉你它在哪儿——而
            「报出 3 项逾期却不可点」正是幽灵信号的定义。板的合法增量里有**一跳指路**，
            所以它该把你送到第一条逾期那一行，而不是新造一个「只看逾期」的透镜
            （透镜只有系统的三个：方向/时间/目标，板级明拒用户自铸视图）。
          */}
          {overdue > 0 && (
            <button
              type="button"
              className={css.overdueCount}
              title="跳到第一条逾期的承诺"
              onClick={() => {
                const plan = jumpPlan({ rows: view.rows, axis, shut })
                if (plan === undefined) return
                // 先把视野调到那一行在的地方，再跳——否则这颗按钮报出一个异常却带不到现场。
                if (plan.clearAxis) setAxis('all')
                if (plan.expand !== undefined) setShut(open => open.filter(ref => ref !== plan.expand))
                /*
                  下一帧再滚：这一帧里那一行可能还没被画出来（透镜刚摘、组刚展开）。
                  同一次点击里直接 query，拿到的是 null，而那正是这颗按钮此前的样子。
                */
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    bodyRef.current?.querySelector(`[data-row="${plan.rowId}"]`)
                      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                  })
                })
              }}
            >
              · {String(overdue)} 逾期 ›
            </button>
          )}
        </span>
        {/*
          方向轴三元 chips (v4.21)。

          **第三格「我旁观的」由「全部」承载**，而「全部」是默认——板 = 查看者可见域的
          并集，不是「公开承诺板」，也不是私人待办。看得见但既不欠也不被欠的那些行是
          真实关系：组织透明是特性不是缺陷。默认落在两栏中的任何一栏，都是在替人把一
          部分同事的工作从视野里摘掉。

          它是**透镜不是清单**：三个都是系统给的（无用户自铸视图），切换只改排列与取舍，
          不改任何事实。
        */}
        <div className={css.lens}>
          {([['all', '全部'], ['owed-to-me', '欠我的'], ['mine', '我欠的']] as const)
            .map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={`${css.lensBtn} ${axis === id ? css.lensOn : ''}`}
                title={id === 'all'
                  ? '可见域里的全部——包含我旁观的（既不欠也不被欠）'
                  : id === 'owed-to-me' ? '别人欠我的' : '我欠别人的'}
                onClick={() => { setAxis(id) }}
              >
                {label}
              </button>
            ))}
        </div>
        <div className={css.lens}>
          {([['all', '全部'], ['goals', '按目标']] as const).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={`${css.lensBtn} ${lens === id ? css.lensOn : ''}`}
              onClick={() => { setLens(id) }}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className={css.back} onClick={back}>返回会话</button>
      </div>

      <div className={css.body} ref={bodyRef}>
        {view.rows.length === 0 && (
          <div className={css.calm}>
            还没有承诺。
            <br />
            agent 做了写操作、或你说了期限时，会自动记一条；
            「让张三周五前给结论」这类交给<b>人</b>的事，agent 会登记成一条可跟踪的承诺，
            并把卡投回那个群，让本人能自己回「完成」。
          </div>
        )}

        {/*
          今天的会，排在承诺前面：会有开始时间，承诺没有——**今天几点** 是这一屏上唯一
          带截止感的东西。没有会就整段不画（空段等于一行噪音）。
        */}
        {events.length > 0 && (
          <div className={css.events}>
            <div className={css.eventsHead}>
              <span className={css.eventsTitle}>今天的会</span>
              <span className={css.eventsNote}>
                {events.length} 场未开始 · 准备好没有是从挂着的活推出来的，没有人维护它
              </span>
            </div>
            {events.map(eventNode)}
          </div>
        )}

        {/*
          全部视图里也要分清两种空：板上真的没有承诺（那是空板的出生故事，上面那段
          `view.rows.length === 0` 管），和**这个方向上没有**（切回去就看得到）。
        */}
        {/*
          透镜激活：目标分组退场，一屏按信号序平铺（决策 #56）。

          这一段**盖过档位**（全部/按目标）——不是忽略它，是它此刻问的不是同一个问题。
          说出来，比让一颗按下去没反应的档位按钮杵在那儿好。
        */}
        {axisOn && (
          <>
            <div className={css.axisNote}>
              {axis === 'mine'
                ? <><b>我欠的</b> · 行动清单——按急迫序平铺，目标退成行内一枚 chip</>
                : <><b>欠我的</b> · 应收账簿——按债务人的账龄与信号平铺；这一问横切目标，所以目标组退场</>}
            </div>
            {view.rows.filter(inAxis).length === 0
              ? (
                <div className={css.calm}>
                  可见域里有 {String(view.rows.length)} 条承诺，
                  但<b>没有一条是「{axis === 'mine' ? '我欠的' : '欠我的'}」</b>——切回「全部」看得到。
                </div>
              )
              : view.rows.filter(inAxis).map(row => rowNode(row))}
          </>
        )}

        {!axisOn && lens === 'all' && view.rows.map(row => rowNode(row))}

        {!axisOn && lens === 'goals' && (
          <>
            <div className={css.goalsHead}>
              <span className={css.goalsCount}>{view.goals.length} 个目标</span>
              <button type="button" className={css.declare} onClick={() => { setDeclaring(true) }}>
                ＋ 立目标
              </button>
            </div>
            {view.goals.map(goalNode)}

            {/*
              无归属：对齐债务可拉视.
              An empty one is worth saying too — it means everything in view is
              accounted for, which is a fact, not a blank.
            */}
            <div className={css.unattached}>
              <div className={css.unattachedHead}>
                <span className={css.unattachedTitle}>无归属</span>
                <span className={css.unattachedNote}>
                  {view.unattached.length} 条不服务于任何目标——
                  <b>这是合法状态</b>，不是错误；勾上几条可以一次补挂。
                </span>
              </div>
              {/* 同上：透镜激活时这一整节都退场，所以「被筛掉了」那一支到不了。 */}
              {view.unattached.length === 0
                ? <div className={css.goalEmpty}>看得见的工作都挂上了。</div>
                : view.unattached.map(row => rowNode(row, true))}
              {picked.length > 0 && (
                <div className={css.batch}>
                  <span className={css.batchCount}>已选 {picked.length} 条 → 挂到</span>
                  {goalOptions.length === 0
                    ? <span className={css.batchNone}>还没有目标可挂——先「立目标」。</span>
                    : goalOptions.map(option => (
                      <button
                        type="button"
                        key={option.ref}
                        className={css.batchBtn}
                        disabled={busy === 'link'}
                        onClick={() => { linkPicked(option.ref) }}
                      >
                        {option.label}
                      </button>
                    ))}
                  <button
                    type="button"
                    className={css.batchClear}
                    onClick={() => { setPicked([]) }}
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {declaring && (
        <DeclareGoal
          inject={inject}
          openSession={openSession}
          {...(fromSessionId === undefined ? {} : { fromSessionId })}
          close={() => { setDeclaring(false) }}
          done={(message) => {
            setToast(message)
            setDeclaring(false)
            void refresh()
          }}
        />
      )}
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
      {toast !== '' && <div className={css.toast}>{toast}</div>}
    </div>
  )
}

/**
 * 立目标 — the board form of the registration verb.
 *
 * The form IS the confirmation card: the operator types it and presses it, and
 * that press is the signature. 人签发 is the iron law here — the agent has no
 * tool that writes one, because "this looks like a goal" is a proposal and a
 * goal is a commitment somebody has to own.
 *
 * The body link is required rather than generated: the goal's real body lives
 * in Yunzhijia, and a goal row with nothing behind it is the "copy we do not
 * have" this whole design refuses to draw.
 */
function DeclareGoal(props: {
  inject: SurfaceInject
  fromSessionId?: string
  /** 磨稿的出口：这张表通往一次对话，而不是通往第二张表。 */
  openSession(sessionId: string): void
  close(): void
  done(message: string): void
}): ReactNode {
  const { inject, close, done, fromSessionId, openSession } = props
  const [what, setWhat] = useState('')
  const [goalRef, setGoalRef] = useState('')
  /**
   * owner 是**选中的那个人**，不是打出来的那串字。
   *
   * 此前这里是一个自由文本框，而它的值被端点直接当成了 openId——通讯录里五位李婷在
   * 那种记法里是同一个人。搜与选归 `PersonPicker`（移交那边用的是同一个）。
   */
  const [owner, setOwner] = useState<PersonWire | undefined>(undefined)
  const [due, setDue] = useState('')
  const [criteria, setCriteria] = useState('')
  const [busy, setBusy] = useState(false)
  /** Why the last press did not land. Shown in place, with the form intact. */
  const [refusal, setRefusal] = useState('')

  const ready = what.trim() !== '' && goalRef.trim() !== ''

  return (
    <div className={css.mask} onClick={close}>
      <div
        className={css.sheet}
        role="dialog"
        aria-label="立目标"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.sheetHead}>
          <span className={css.sheetTitle}>立目标</span>
          <button type="button" className={css.sheetClose} onClick={close} aria-label="关闭">×</button>
        </div>
        <div className={css.sheetNote}>
          目标是一条<b>复合承诺</b>——立目标就是登记一条「你自己 own、人工验收」的承诺。
          真身留在云之家的目标文档/表格里，这里只挂一个把手。
        </div>
        <label className={css.field}>
          <span className={css.fieldLabel}>目标</span>
          <input
            className={css.input}
            value={what}
            autoFocus
            placeholder="例：Q3 把对账周期压到 3 天内"
            onChange={(event) => { setWhat(event.target.value) }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>真身链接</span>
          <input
            className={css.input}
            value={goalRef}
            placeholder="云之家目标文档 / 表格的链接"
            spellCheck={false}
            onChange={(event) => { setGoalRef(event.target.value) }}
          />
        </label>
        {/*
          磨点在「可验收」(v4.10).

          A goal nobody can say "done" about cannot be accepted later, and the
          assessment has nothing to compare against — which is how OKR
          check-ins degenerate into self-reported numbers. These words are the
          ones the operator signed; the authoritative copy belongs in the
          Yunzhijia body, and the hint says so rather than pretending this is
          the 真身.
        */}
        <label className={css.field}>
          <span className={css.fieldLabel}>怎么算完成</span>
          <textarea
            className={css.area}
            value={criteria}
            rows={3}
            placeholder="例：月结 T+3 日内出报表；四个部门都用同一张模板；对账差异条目 < 5"
            onChange={(event) => { setCriteria(event.target.value) }}
          />
          <span className={css.fieldHint}>
            也请把这几句写进云之家目标正文——那里才是真身。这里留一份你签发时的原话，
            日后 agent 写差距简报就是拿它逐条比对。
          </span>
        </label>
        <div className={css.fieldRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>owner</span>
            <PersonPicker
              inject={inject}
              picked={owner}
              onPick={setOwner}
              placeholder="留空 = 我；或搜通讯录选一个人"
              clearTitle="取消这次指定（改回「我」）"
              emptyTail="没选中人 = 这个目标算我的。"
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>验收期</span>
            <input
              className={css.input}
              value={due}
              placeholder="例：季度末"
              onChange={(event) => { setDue(event.target.value) }}
            />
          </label>
        </div>
        {refusal !== '' && <div className={css.refusal}>{refusal}</div>}
        <div className={css.sheetFoot}>
          <span className={css.sheetHint}>按下就是签发——agent 只能提案，不能立目标。</span>
          {/*
            🤝 先和 agent 磨一磨 —— **作者权 ≠ 思考伙伴** (v4.10).

            这一格此前整个缺席：表单只给了「想清楚了的人」一条路，而立目标最常见的
            处境恰恰是**还没想清楚**——尤其是「怎么算完成」这一栏，它是日后差距简报
            唯一的对账基准，也是最磨人的一栏。没有这条路，人要么填一句糊弄过去的
            标准（那份糊弄会在三个月后变成一份没法验收的目标），要么自己跳出去找
            agent 聊、聊完再回来重填一遍表。

            磨稿的家在私语会话里，不在这张表上：**对话就是制定界面，没有第二个表单**。
            磨完回来签发时，`fromSessionId` 就是那个会话——出生血缘因此指向磨稿处，
            而不是指向「桌面」。
          */}
          <button
            type="button"
            className={css.sheetGrind}
            disabled={busy}
            title="磨点在「怎么算完成」：agent 追问、检索你可见域里的相关材料，磨好了递提案——签发仍然是你的动作"
            onClick={() => {
              if (fromSessionId === undefined) {
                setRefusal('磨稿要有个说话的地方——先从左边打开一个会话，再回来。')
                return
              }
              sendErrand({
                subject: 'draft',
                goalRef: '',
                goalName: what.trim(),
                voice: 'private',
                seed: goalCraftSeed(what),
              })
              close()
              openSession(fromSessionId)
            }}
          >
            🤝 先和 agent 磨一磨
          </button>
          <button
            type="button"
            className={css.sheetGo}
            disabled={!ready || busy}
            onClick={() => {
              setBusy(true)
              setRefusal('')
              void inject.declareGoal({
                what: what.trim(),
                goalRef: goalRef.trim(),
                ...(owner === undefined ? {} : { ownerOpenId: owner.openId, ownerName: owner.name }),
                ...(due.trim() === '' ? {} : { due: due.trim() }),
                ...(criteria.trim() === '' ? {} : { criteria: criteria.trim() }),
                // 出生血缘：磨稿会话,而不是「桌面」。
                ...(fromSessionId === undefined ? {} : { sessionId: fromSessionId }),
              }).then((result) => {
                setBusy(false)
                /*
                  拒绝不该清空表单.

                  「这个真身已经立过目标了」 arrives as an ordinary refusal, and
                  closing the sheet threw away the 目标 / 真身 / owner / 验收期
                  and the whole 「怎么算完成」 — which is the one field v4.10 is
                  about. The refusal is shown IN the sheet, with everything the
                  operator typed still in it.
                */
                if (result.error !== undefined) {
                  setRefusal(result.error)
                  return
                }
                done(`已立目标「${what.trim()}」。`)
              })
            }}
          >
            {busy ? '登记中…' : '立目标'}
          </button>
        </div>
      </div>
    </div>
  )
}
