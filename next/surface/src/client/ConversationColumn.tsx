/**
 * The center column — the product's main surface.
 *
 * It occupies the whole `conversation` seat, which means the harness's own
 * chat/trajectory views are gone and everything a session needs is rendered
 * here. That is a deliberate, expensive choice: "一个话题一个窗口" is the
 * design's first criterion, and a fused timeline living as a tab beside the
 * unfused one is a claim the product does not actually make. The cost is real
 * and is not fully repayable: the composer's model SELECT is declared by the
 * host's composer bar, so it cannot be re-declared from here. What is
 * recoverable is the fact — the head shows which model is in force and says
 * where it is changed — and that is stated rather than quietly dropped.
 *
 * What is NOT duplicated is the data. The session's conversation nodes still
 * come from the host's snapshot — we render them, we do not store them. The
 * work block is the entry into that detail (§2 「产品只做入口」), expanded in
 * place rather than in a separate view we would have to keep in sync.
 *
 * The one thing this column insists on: **every row says who could hear it.**
 * A 公 rail means it is in the room, a 私 rail means it is between the operator
 * and the agent, and they are different colours from across the desk.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import {
  avatarOf, buildStream, clockOf, durationOf,
  type LiveWork, type StreamRow, type TrajectoryNode,
} from './stream.ts'
import { CardRow } from './CardRow.tsx'
import { YzjDecisionBar } from './DecisionBar.tsx'
import { YzjBoard } from './Board.tsx'
import { YzjGoalPage } from './GoalPage.tsx'
import { YzjPlaceView } from './PlaceView.tsx'
import { YzjContractPanel } from './ContractPanel.tsx'
import { YzjTracePanel } from './TracePanel.tsx'
import { CopyButton, EmojiButton, ForwardPicker, MentionPicker } from './Compose.tsx'
import { Attachments, isPlaceholderOnly, withoutImageMarks } from './Attachments.tsx'
import { ArtifactCard } from './ArtifactCard.tsx'
import { artifactRefOf } from './artifacts.ts'
import { closePreview } from './preview.ts'
import {
  backTarget, currentFrame, popFrame, setFrame, setSpotlight, subscribeFrame, takeErrand,
} from './store.ts'
import type { FusedWindowWire, SurfaceInject } from './rpc.ts'
import tokens from './tokens.module.css'
import css from './column.module.css'

/** Where the words in the composer land. */
type Voice = 'private' | 'place' | 'ask'

/**
 * The live conversation snapshot, as much of it as this column reads.
 *
 * `nodes` is the FINALIZED log; the other three are the turn in flight. An
 * earlier version read only `nodes` and `running`, which is why the column
 * stood still for an entire run and then produced a finished work block: the
 * facts that say "still going" were all in the fields it never read.
 */
interface Snapshot {
  readonly nodes?: readonly TrajectoryNode[]
  readonly running?: boolean
  /** Tool calls out with no result yet. */
  readonly runningCalls?: LiveWork['calls']
  /** Assistant output mid-stream. */
  readonly partial?: LiveWork['partial']
}

export interface ConversationColumnProps {
  sessionId?: string
  /**
   * The framework's snapshot selector for the current session. A selector
   * rather than an object: the column re-renders on the slices it actually
   * reads, and reads nothing while no session is current.
   */
  useSession<T>(selector: (snapshot: Snapshot) => T): T | undefined
  inject: SurfaceInject
  /** Speak to the agent. Supplied by the registration, which holds the session face. */
  prompt(sessionId: string, text: string, mode: 'queue' | 'steer'): Promise<string | undefined>
  /** Topic-tree navigation. */
  openSession(sessionId: string): void
  /** Reveal the object column; the workbench is three columns, not two. */
  openDetails(): void
}

const EMPTY: FusedWindowWire = { messages: [], chips: [], cards: [], artifacts: [] }

export function YzjConversationColumn(props: ConversationColumnProps): ReactNode {
  const { sessionId, useSession, inject, prompt, openSession, openDetails } = props
  const frame = useSyncExternalStore(subscribeFrame, currentFrame)
  const nodes = useSession(snapshot => snapshot.nodes) ?? []
  const running = useSession(snapshot => snapshot.running) === true
  const runningCalls = useSession(snapshot => snapshot.runningCalls)
  const partial = useSession(snapshot => snapshot.partial)
  const [window_, setWindow] = useState<FusedWindowWire>(EMPTY)
  const [voice, setVoice] = useState<Voice>('private')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [openWork, setOpenWork] = useState<Record<string, boolean>>({})
  const [tree, setTree] = useState<{
    open: boolean
    places: { placeKey: string; groupName: string; topics: { sessionId: string; label: string }[] }[]
  }>({ open: false, places: [] })
  const [model, setModel] = useState<{ provider?: string; model?: string }>({})
  /** The place contract, opened from the agent chip — where the question occurs. */
  const [contractOpen, setContractOpen] = useState(false)
  /** 完整轨迹 (§7.1 trace-link): what the column folds, unfolded. */
  const [traceOpen, setTraceOpen] = useState(false)
  /**
   * 落点 (v4.7): which message this send attaches to.
   *
   * Undefined = the topic's own root, which is what the anchor bar calls
   * 「发到本话题」. Set = 挂链 to that message. It is STATE rather than a mode,
   * and the anchor bar shows it before the send key is pressed — the four
   * questions one send answers (落点/受话/指涉/可见域) share a key, so the one
   * that decides where the words land has to be visible without asking.
   */
  const [replyTo, setReplyTo] = useState<{ msgId: string; who: string; text: string } | undefined>(undefined)
  const streamRef = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)
  const boxRef = useRef<HTMLTextAreaElement | null>(null)
  const [forwarding, setForwarding] = useState<string | undefined>(undefined)
  /**
   * 目标 chip — what the portal handed over, before it becomes a fact.
   *
   * 装载发生在「说出口」那一刻，不是「跳进来」那一刻: teleporting in and closing
   * the tab must leave nothing behind, because a chip somebody looked at is not
   * a statement about what this room is working on. So this is PENDING state,
   * and the armed truth comes back from the graph in `window_.goalContext`.
   */
  const [pendingGoal, setPendingGoal] = useState<
    { goalRef: string; goalName: string } | undefined
  >(undefined)
  /** 带着一场会跳进来时的那句提示。**不是语境**——它什么都不装载，说完就没了。 */
  const [pendingEvent, setPendingEvent] = useState<string | undefined>(undefined)
  /**
   * 这一句欠一个**受话**，而触发词还没到 (委派五步③).
   *
   * 存的是**我们刚放进框里的那串字**，不是一个布尔：补的时候要先确认框里还是它。
   * 人如果已经动手改过了，那句话就是他的了——在别人正在写的句子前面插字，是这套
   * 设计一直在拒绝的那种代做。
   */
  const [pendingCall, setPendingCall] = useState<string | undefined>(undefined)
  /** Scroll position handed back by a pop, for the frame we return to. */
  const [restoreScroll, setRestoreScroll] = useState<number | undefined>(undefined)
  const back = backTarget()

  useEffect(() => { openDetails() }, [openDetails])
  // A landing point belongs to the conversation it was chosen in.
  useEffect(() => { setReplyTo(undefined) }, [sessionId])
  /*
    切会话即收 (v4.11)——和上面那条锚点是同一条纪律的两个面。

    宿主换会话时本来就会把右栏关掉,但关掉的是**抽屉**,不是抽屉里那份文档:
    再打开右栏,上一个话题里的东西还在那儿看着,像是属于眼前这段对话。
  */
  useEffect(() => {
    closePreview()
    // 事件枢纽同律：一场会的放大态属于打开它的那个语境,换了会话它就该退场。
    setSpotlight(undefined)
  }, [sessionId])
  /*
    传送门落地 (v4.9 入口 A①).

    Reading the errand CONSUMES it, so a conversation opened later carries
    nothing. Keyed on the frame as well as the session because the operator may
    teleport into the room they were already in — the session id would not
    change, and the errand would sit unread until the next navigation.

    Nothing is sent. The seed is a starting point for the operator's own
    sentence, and the voice is preselected because a delegation nobody can hear
    is not a delegation — both remain visible and switchable before the key.
  */
  useEffect(() => {
    if (frame.kind !== 'session') return
    const errand = takeErrand()
    if (errand === undefined) {
      // A pending chip belongs to the conversation it was carried into, and
      // arriving anywhere else without an errand means there is nothing to
      // carry. Clearing HERE rather than in its own effect keeps the two out
      // of a race the declaration order would decide.
      setPendingGoal(undefined)
      setPendingEvent(undefined)
      return
    }
    setVoice(errand.voice)
    /*
      不覆盖没发完的话.

      Teleporting into the conversation you are ALREADY in keeps the column
      mounted, so whatever was half-typed is still there — and seeding used to
      overwrite it with no undo. A draft is the operator's, and a convenience
      string is not worth losing one. Verified live: 「半写的一段话」 vanished.
    */
    const opening = errand.seed ?? ''
    if (opening !== '') {
      setDraft(current => (current.trim() === '' ? opening : current))
      setToast(value => (
        boxRef.current !== null && boxRef.current.value.trim() !== ''
          ? '你有一段没发完的话，没覆盖它——这次的提问请自己写。'
          : value
      ))
    }
    /*
      受话**等触发词到齐了再补** (委派五步③).

      一句没有触发词的委派 agent 根本不会听见：它落进群里像一句同事之间的话，没有人
      登记、板上不长行——幽灵承诺的另一种成因。所以传送门说了「这句是对 agent 说的」，
      这一头就得把这个部署的触发词摆进去。

      **不能在这儿直接摆**：这一拍读到的 `window_` 还是**上一个会话**的（刚跳过来，
      新会话那次 fused 还没回来），而从板上跳进来时上一个会话常常压根没有——于是
      `aliases` 是空的，受话被静静地丢掉。实测就是这么丢的：句子进了框，@ 没有。
      记下「这句欠一个受话」，等下面那个 effect 拿到触发词再补。
    */
    setPendingCall(errand.call === true ? opening : undefined)
    /*
      **一场会不装载语境。**

      目标 chip 的意思是「在这个话题里登记的承诺从此继承这个目标」。一场会没有这层
      含义——把会的 id 当成 goalRef 装载进去，那个话题里每一条新承诺都会挂上一个根本
      不是目标的 URI，把目标图污染掉，而没有任何地方会报错。
      带会来的时候只带一句提示：句子由人说，会前那一刀派给谁、在哪派，本来就是他的事。
    */
    setPendingGoal(errand.voice === 'place' && errand.subject === 'goal'
      ? { goalRef: errand.goalRef, goalName: errand.goalName }
      : undefined)
    setPendingEvent(errand.subject === 'event' ? errand.goalName : undefined)
    requestAnimationFrame(() => { boxRef.current?.focus() })
  }, [sessionId, frame.kind])
  /*
    A new topic opens at its newest message.

    `atBottom` is remembered across renders, so scrolling up in one topic and
    then opening another left the new one parked in history — the reader lands
    in the middle of something already read, in a conversation they have never
    seen.
  */
  useEffect(() => { atBottom.current = true }, [sessionId])
  // A response for the PREVIOUS conversation must not paint this one.
  useEffect(() => { fetchSeq.current += 1 }, [sessionId])
  // Read once: the default selection changes in 设置, not on this screen.
  useEffect(() => { void inject.model().then(setModel) }, [inject])

  /*
    轻问只在云之家话题里成立 —— 够不着就**当场说**，不要等到按下发送才报错。

    `lightAsk` 对一个不是话题的会话直接抛错（它要的是一条能投影回群里的路由）。
    传送门可以把「问这个目标」送进轻问语态，可落地的会话未必有话题——那时候
    继续摆着一个「轻问」的输入框，等人打完一段话再回一句英文错误，是把失败推迟
    到代价最大的时刻。降级到私语并说清楚：**问答仍然落在会话日志里**（那才是这
    颗按钮的本意），只是这一次不是只读投影。
  */
  useEffect(() => {
    /*
      `EMPTY` 同时是「还没读到」和「读失败」的哨兵（`setWindow` 放进去的就是它
      本身，所以比得出来）。**看不了 ≠ 没有**：窗口读不到的时候不下「这不是话题」
      这个断言——那正是三值纪律要挡的那种把无信号当成证据的话。
    */
    if (voice !== 'ask' || window_ === EMPTY || window_.topic !== undefined) return
    setVoice('private')
    setToast('这个会话不是云之家话题，轻问在这里用不了——已经切回「对 agent 说 · 私」，问答一样落在会话日志里。')
  }, [voice, window_])

  /*
    触发词到了，把受话补进框里 —— **摆进去，不是偷偷加上**。

    它在框里，看得见、删得掉；删掉就降级成一句普通的话。这和「发送时替人改写句子」是
    两件事：后者是越权，前者是把一个默认交到人手上（hover 的 ⚡@agent 早就是这个做法）。

    只在框里还是我们放的那串字时补。人改过了就不补，那句话已经是他的了——`goalChip`
    上那行提醒仍然会说「句子里带上 @next，这次委派才会被登记成可跟踪的承诺」。
  */
  useEffect(() => {
    const alias = window_.aliases?.[0]
    if (pendingCall === undefined || alias === undefined) return
    setDraft(current => (current === pendingCall ? `${alias} ${current}`.trimEnd() : current))
    setPendingCall(undefined)
  }, [pendingCall, window_.aliases])

  // A toast is a receipt, not a log: it says its piece and leaves.
  useEffect(() => {
    if (toast === '') return undefined
    const timer = setTimeout(() => { setToast('') }, 6_000)
    return () => { clearTimeout(timer) }
  }, [toast])

  /**
   * Fetch order is not arrival order.
   *
   * `fused` awaits a live Yunzhijia read, so a poll that started earlier can
   * land later — and an unguarded `setState` then overwrites a fresher view.
   * Concretely: press 确认 on a proposal item, its own refresh paints 已确认,
   * and a poll that was already in flight repaints 待裁决 with live buttons.
   * The operator presses again and gets a receipt for nothing.
   *
   * A monotonic ticket is the whole fix: only the newest request may paint.
   */
  const fetchSeq = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    if (sessionId === undefined) return
    fetchSeq.current += 1
    const ticket = fetchSeq.current
    const next = await inject.fused(sessionId) ?? EMPTY
    if (ticket !== fetchSeq.current) return
    setWindow(next)
  }, [inject, sessionId])

  useEffect(() => {
    let alive = true
    void refresh()
    // Yunzhijia has no push (F1); the message half is polled. Honest cost of
    // the transport, not a design choice.
    const timer = setInterval(() => { if (alive) void refresh() }, 5_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  const topic = window_.topic
  const rows = useMemo(
    () => buildStream(
      nodes, window_.messages, window_.cards, window_.artifacts, topic !== undefined,
      { calls: runningCalls ?? [], partial: partial ?? null, running },
    ),
    [nodes, window_.messages, window_.cards, window_.artifacts, topic, runningCalls, partial, running],
  )

  /**
   * A clock that only ticks while something is running.
   *
   * A step out for 40 seconds must not look identical at second 2 and second
   * 39 — a number that moves is the cheapest possible proof that the thing is
   * alive. It is gated on `running` so an idle session re-renders never.
   */
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    setTick(Date.now())
    const timer = setInterval(() => { setTick(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [running])

  // Follow the conversation only while the reader is already at the end of it:
  // yanking somebody out of what they were reading is how a live view becomes
  // one people scroll away from and stop trusting.
  useEffect(() => {
    const node = streamRef.current
    if (node !== null && atBottom.current) node.scrollTop = node.scrollHeight
  }, [rows])

  /**
   * Turn the pending chip into a fact, once the words are actually out.
   *
   * The message has already been sent by the time this runs, so a failure here
   * must not read as 「你的消息没发出去」: the receipt names both halves and the
   * chip stays up, because it is still true that this conversation is not
   * attached to anything.
   */
  const armPending = useCallback(async (): Promise<void> => {
    if (pendingGoal === undefined || sessionId === undefined) return
    const armed = await inject.armTopicGoal(
      sessionId, pendingGoal.goalRef, pendingGoal.goalName,
    )
    if (armed.error !== undefined) {
      setToast(`话已经发出去了，但这个话题没能挂到目标上：${armed.error}`)
      return
    }
    setPendingGoal(undefined)
  }, [inject, pendingGoal, sessionId])

  const send = useCallback((): void => {
    const text = draft.trim()
    /*
      三条拒绝里，**只有一条可以静默**。

      `text === ''` 与 `busy` 都有可见的对应物：按钮此刻是灰的、或者正在转。而
      `sessionId === undefined` 此前**只在这里挡**，按钮却照常亮着——于是点下去
      什么都不发生、也不说一个字。这正是这套设计点名过的那种失败：「一次沉默的
      不回应，是产品教人相信它会随机罢工的方式」。

      现在这一条挡在按钮上（灰掉）并在落点行里说明白；这里留着它只是兜底——键盘
      回车也走这条路。
    */
    if (text === '' || busy || sessionId === undefined) return
    setBusy(true)
    setToast('')
    if (voice === 'place') {
      void inject.sendToPlace(sessionId, text, replyTo?.msgId).then(async (result) => {
        if (result.error !== undefined) setToast(result.error)
        else {
          /*
            说出口了，语境才装载 (v4.9).

            The utterance is what makes this room work toward that goal, so the
            arming rides on the send succeeding — and only on that. Arming on
            arrival would let a glance at the portal rewrite what the next
            registration in this room inherits.
          */
          await armPending()
          setDraft('')
          setReplyTo(undefined)
          // Back to private after each public utterance: a remembered public
          // mode is how something meant for the agent ends up in a group.
          setVoice('private')
        }
        setBusy(false)
        void refresh()
      })
      return
    }
    if (voice === 'ask') {
      void inject.lightAsk(sessionId, text).then((result) => {
        // Clear only on success, like the other two branches. Clearing first
        // meant a channel outage ate the question — and a 轻问 worth typing is
        // usually one worth not retyping.
        if (result.error !== undefined) setToast(result.error)
        else {
          setDraft('')
          setVoice('private')
        }
        setBusy(false)
        void refresh()
      })
      return
    }
    // Mid-run words are steering; between runs they are the next instruction.
    void prompt(sessionId, text, running ? 'steer' : 'queue')
      .then(async (error) => {
        if (error !== undefined) {
          setToast(error)
          return
        }
        /*
          装载跟着「说出口」走，而不是跟着语态走.

          The chip says 「这句发出去之后，这个话题就带着它了」 and rendered in
          every voice, but arming lived only in the 公 branch — so carrying a
          goal in and then deciding to ask the agent instead left the promise
          silently unkept, and the next registration here inherited nothing.
          挂接零操作 failing in the direction nobody can notice is the worst
          direction available.
        */
        await armPending()
        setDraft('')
      })
      .finally(() => { setBusy(false) })
  }, [draft, busy, voice, sessionId, running, prompt, inject, refresh, replyTo, armPending])

  /**
   * 委托一句话给 agent —— **CTA 只是话语的按钮形态** (§5.3 A6.1 ①).
   *
   * 板与目标页上的 ⚡ 拆解 / ✓ 评估 走这里。它们此前是传送门：弹一屏问「在哪个
   * 会话里私下问？」，跳过去，把一句自己写好的话塞进输入框，等人按发送。三步里
   * 有两步是纯损耗——**那个问题只有一个合法答案**（落点 = 操作者私语域），而那句
   * 话不是人要说的话，是那颗按钮的名字。
   *
   * 关键在于它走的是**和 composer 一模一样的那条路**（`prompt`），不是一条新的
   * RPC。规格把这一条写成了机械保证：「无独立 RPC 路径——执行入口统一律」。按下
   * 按钮和自己打出那句话，在图上必须是同一件事，否则「一个动词，语境来源不同」
   * 就成了一句只在文档里成立的话。
   *
   * 送完就跳进那个会话：备料的 work 块、随后的提案卡都长在那里，而**按钮不豁免
   * 四答**——落点得看得见，不能是一次悄悄发生的提交。
   */
  const commission = useCallback(async (text: string): Promise<string | undefined> => {
    if (sessionId === undefined) {
      // 一颗点下去没有下文的按钮比没有按钮更坏；说出是哪一堵墙。
      return '这里还没有会话可说话——从左边打开或新建一个，再回来按这颗按钮。'
    }
    /*
      **这个缝不许抛。**

      它的契约是「返回一句话 = 没送出去，为什么」，而调用方（板与目标页）拿它来
      开关按钮：`setBusy(key)` → `.then` 里 `setBusy('')`。宿主的 `prompt` 是可以
      reject 的（`await face.prompt(...)` 没有兜底），而一次 reject 会让 `.then`
      永远不跑——那颗按钮就**永久灰在那里**，页面不刷新永远回不来，而且一个字都不说。
      这正是这套设计点名过的那种失败，只是这次由我自己的代码制造。
    */
    const error = await prompt(sessionId, text, running ? 'steer' : 'queue')
      .catch((cause: unknown) => (cause instanceof Error ? cause.message : '通道无响应'))
    if (error !== undefined) return error
    setFrame({ kind: 'session' })
    openSession(sessionId)
    return undefined
  }, [sessionId, prompt, running, openSession])

  /** Put text where the caret is; a picker that appends is a picker you fight. */
  const insert = useCallback((text: string): void => {
    const box = boxRef.current
    if (box === null) {
      setDraft(value => value + text)
      return
    }
    const at = box.selectionStart ?? box.value.length
    setDraft(value => value.slice(0, at) + text + value.slice(box.selectionEnd ?? at))
    requestAnimationFrame(() => {
      box.focus()
      box.setSelectionRange(at + text.length, at + text.length)
    })
  }, [])

  const act = useCallback((kind: string, id: string, actionId: string, input?: string): void => {
    setBusy(true)
    void inject.cardAct(kind, id, actionId, input).then((result) => {
      setToast(result?.receipt ?? '这张卡没有回应，可能已经被别人答过了。')
      setBusy(false)
      void refresh()
    })
  }, [inject, refresh])

  /**
   * 决断条 → 对象 (v4.14 逐级兑付的最后一跳)。
   *
   * **滚过去，不是拔上来**。卡留在它出生的位置，前后语境强制在场——因为语境就是
   * 决断的证据：一张「确认删除」的卡，上一条消息说的是删哪个、为什么删。
   *
   * 找不到时说实话。卡可能在这一屏之外（窗口只装最近若干条），这时候要给的是
   * 「它在更早的地方」，而不是一次什么都没发生的点击——一个点了没反应的信号，就是
   * 这条定律要禁的那种不可兑付的信号。
   */
  const jumpToCard = useCallback((kind: string, id: string): void => {
    /*
      扫属性，不拼选择器。

      `[data-card="${kind}:${id}"]` 把**数据**塞进了选择器语法：今天的对象 id 全是
      哈希，看着安全，可 id 是数据不是常量——哪天某一族的 id 里带上一个引号或方括号，
      这里抛的是语法错，而抛错的时刻恰恰是有人正想找一件事在哪。
    */
    const anchor = `${kind}:${id}`
    const node = [...(streamRef.current?.querySelectorAll('[data-card]') ?? [])]
      .find(candidate => candidate.getAttribute('data-card') === anchor)
    if (node === undefined) {
      setToast('这件事不在当前这一屏里——往上翻能找到它，它还在原地等着。')
      return
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    node.setAttribute('data-flash', '1')
    setTimeout(() => { node.removeAttribute('data-flash') }, 1_400)
  }, [])

  const showTree = useCallback((): void => {
    void inject.tree().then((value) => {
      setTree({
        open: true,
        places: value.places.map(entry => ({
          placeKey: entry.place.placeKey,
          groupName: entry.place.groupName,
          topics: entry.topics.map(item => ({ sessionId: item.sessionId, label: item.label })),
        })),
      })
    })
  }, [inject])

  if (frame.kind === 'place') {
    return (
      <YzjPlaceView
        /*
          Keyed by the place, so switching rooms REMOUNTS.
          Without it the same instance keeps `draft`, `replyTo`, `view` and the
          refusal strip across a switch: the header showed the previous room's
          name over the previous room's messages while `placeKey` already
          pointed at the new one, so a send landed in a room the operator
          could not see, anchored to a message in a different conversation.
        */
        key={frame.placeKey}
        placeKey={frame.placeKey}
        groupName={frame.groupName}
        inject={inject}
        openSession={openSession}
        back={() => { popFrame() }}
        {...(restoreScroll === undefined ? {} : { restoreScroll })}
      />
    )
  }

  if (frame.kind === 'board') {
    return (
      <YzjBoard
        inject={inject}
        commission={commission}
        {...(sessionId === undefined ? {} : { fromSessionId: sessionId })}
        {...(restoreScroll === undefined ? {} : { restoreScroll })}
        openSession={(id) => {
          setFrame({ kind: 'session' })
          openSession(id)
        }}
        back={() => { setFrame({ kind: 'session' }) }}
      />
    )
  }

  /*
    目标放大态 —— 承诺板的第二缩放级别 (v4.12).

    Back 走 `popFrame()` 并把板离开时的滚动位置交回去,和群→话题那一级完全
    同构:缩放语法只有一套,新增一级不该新增一套导航。
  */
  if (frame.kind === 'goal') {
    return (
      <YzjGoalPage
        key={frame.goalRef}
        goalRef={frame.goalRef}
        goalName={frame.goalName}
        inject={inject}
        commission={commission}
        {...(sessionId === undefined ? {} : { deskSessionId: sessionId })}
        openSession={(id) => {
          setFrame({ kind: 'session' })
          openSession(id)
        }}
        back={() => { setRestoreScroll(popFrame()) }}
      />
    )
  }

  if (sessionId === undefined) {
    return (
      <div className={`${tokens.tokens} ${css.column}`}>
        <div className={css.hero}>
          <div className={css.coldhint}>
            <div className={css.coldTitle}>云之家 · 会话图</div>
            左栏按注意力排序：<b>需要我 / 进行中 / 等待中</b>，下面是场所和它们各自的话题。
            <br />
            一个<b>话题</b>就是一个窗口。在测试群里 <code>{window_.aliases?.[0] ?? '@agent'}</code> 说一句话，这里会长出一个；
            群里对同一条消息的回复都归进同一个话题。
            <br />
            这一列里，<b>蓝色「公」</b>是群里所有人都看得见的，<b>米色「私」</b>只有你和 agent 看得见。
          </div>
        </div>
      </div>
    )
  }

  const agentLabel = running ? '运行中' : '空闲'
  /** 受话：一个键把触发词放进去，再按一次拿出来。 */
  const alias = window_.aliases?.[0]
  const calling = alias !== undefined && draft.includes(alias)
  const toggleCall = (): void => {
    if (alias === undefined) return
    setDraft(value => (
      value.includes(alias) ? value.split(alias).join('').trimStart() : `${alias} ${value}`.trimEnd()
    ))
    requestAnimationFrame(() => { boxRef.current?.focus() })
  }

  return (
    <div className={`${tokens.tokens} ${css.column}`}>
      <header className={css.head}>
        <div className={css.headTop}>
          {/*
            Back 与 Up 分立 (D13②). Back returns to the frame you came from, at
            the pixel you left it; Up climbs to this place's own view. Two
            questions, so two controls — the breadcrumb answering both is the
            bug, not the design.
          */}
          {back !== undefined && (
            <button
              type="button"
              className={css.backBtn}
              title="返回上一屏，并回到离开时的位置"
              onClick={() => { setRestoreScroll(popFrame()) }}
            >
              ‹ 返回
            </button>
          )}
          <button
            type="button"
            className={css.place}
            title="到群视图（主楼 + 内联话题卡）"
            disabled={topic === undefined}
            onClick={() => {
              if (topic === undefined) return
              setFrame({ kind: 'place', placeKey: topic.placeKey, groupName: topic.groupName })
            }}
          >
            {topic === undefined ? '本地会话' : topic.groupName}
          </button>
          <span className={css.sep}>·</span>
          <span className={css.title}>{topic === undefined ? '（不是云之家话题）' : topic.label}</span>
          <button
            type="button"
            className={css.headBtn}
            title="完整轨迹：每个节点、每个参数、每次重试，按发生顺序"
            onClick={() => { setTraceOpen(true) }}
          >
            ≡ 完整轨迹
          </button>
          <button type="button" className={css.headBtn} onClick={showTree}>话题 ⌄</button>
        </div>
        <div className={css.headMeta}>
          <button
            type="button"
            className={`${css.chip} ${css.chipAgent} ${css.chipButton} ${running ? '' : css.chipAgentOff}`}
            title="这个 agent 在这个场所被允许做什么"
            disabled={topic === undefined}
            onClick={() => { setContractOpen(true) }}
          >
            {running && <span className={css.pulse} />}
            云小助 · {agentLabel}
          </button>
          {topic !== undefined && (
            <span className={`${css.chip} ${css.chipMono}`}>
              {topic.conversationKind === 'direct' ? '私聊' : '群'} · {topic.groupId}
            </span>
          )}
          {topic !== undefined && topic.generation > 1 && (
            <span className={css.chip}>第 {String(topic.generation)} 代</span>
          )}
          {model.model !== undefined && (
            <span
              className={`${css.chip} ${css.chipMono}`}
              title="当前默认模型。这一列替换了宿主中栏，composer 里的模型选择器随之消失；改模型请到左下角「设置」。"
            >
              {model.model}
            </span>
          )}
          {window_.chips.map(chip => (
            <span
              key={chip.id}
              className={`${css.chip} ${chip.inferred ? css.chipInferred : css.chipVow}`}
              title={chip.parentGoalRef ?? ''}
            >
              承 {chip.what}{chip.due === undefined ? '' : ` · ${chip.due}`}
              {chip.inferred ? ' · 推断待核' : ''}
            </span>
          ))}
        </div>
      </header>

      {tree.open && (
        <div className={css.treePop} onClick={() => { setTree(value => ({ ...value, open: false })) }}>
          <div className={css.treeBox} onClick={(event) => { event.stopPropagation() }}>
            {tree.places.length === 0 && <div className={css.calm}>还没有云之家话题。</div>}
            {tree.places.map(place => (
              <div key={place.placeKey}>
                <div className={css.treePlace}>{place.groupName}</div>
                {place.topics.map(item => (
                  <button
                    type="button"
                    key={item.sessionId}
                    className={css.treeTopic}
                    onClick={() => {
                      openSession(item.sessionId)
                      setTree(value => ({ ...value, open: false }))
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {window_.staleReason !== undefined && (
        <div className={css.stale}>云之家消息读取失败，下面只有本地轨迹：{window_.staleReason}</div>
      )}

      {/*
        决断条 (v4.14/15)。

        在滚动容器**外面**：它是常显的一条线，随对话滚走的话，「有事等你」这件事
        就又变成了要靠翻找才知道的东西——而它存在的全部理由正是寻路归零。

        `cards` 直接传下去，不在这里过滤：条与流内卡是同一个数组的两次渲染，同源
        因此是结构性的，不是两处代码碰巧同意。
      */}
      <YzjDecisionBar
        cards={window_.cards}
        jumpTo={jumpToCard}
        {...(topic === undefined ? {} : { onLease: () => { setContractOpen(true) } })}
      />

      <div
        className={css.stream}
        ref={streamRef}
        onScroll={(event) => {
          const node = event.currentTarget
          atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60
        }}
      >
        {rows.length === 0 && (
          <div className={css.calm}>这个话题还没有内容。</div>
        )}
        {rows.map(row => renderRow(row, {
          now: tick,
          openWork,
          toggleWork: (key: string) => {
            setOpenWork(value => ({ ...value, [key]: !(value[key] ?? false) }))
          },
          act,
          busy,
          placeName: topic?.groupName ?? '本地会话',
          openTrace: () => { setTraceOpen(true) },
          forward: (text: string) => { setForwarding(text) },
          replyTo: (msgId, who, text) => {
            setReplyTo({ msgId, who, text: clip(text) })
            setVoice('place')
            // 回复 = 挂链；⚡ = 挂链 + 受话。选了前者就摘掉后者那半，否则两个
            // 动词按下去效果一样，第二个键看起来像「点了没反应」。
            for (const word of window_.aliases ?? []) {
              setDraft(value => value.split(word).join('').trimStart())
            }
          },
          askAgentAbout: (msgId, who, text) => {
            setReplyTo({ msgId, who, text: clip(text) })
            setVoice('place')
            // Prefilled, not hidden: the @ is in the box where it can be read
            // and deleted, and deleting it downgrades this to a plain reply.
            const alias = window_.aliases?.[0]
            if (alias !== undefined) {
              setDraft(value => (value.includes(alias) ? value : `${alias} ${value}`.trim()))
            }
          },
          jumpTo: (msgId: string) => {
            const node = streamRef.current?.querySelector(`[data-msg="${msgId}"]`)
            if (node === null || node === undefined) {
              setToast('被引用的那条不在这一屏里——它可能在更早的历史里，或者根本不在这个话题。')
              return
            }
            node.scrollIntoView({ block: 'center', behavior: 'smooth' })
            // An attribute rather than a generated class name: CSS-module keys
            // are typed as possibly-absent, and `classList.add(undefined)`
            // throws at the exact moment somebody is trying to find something.
            node.setAttribute('data-flash', '1')
            setTimeout(() => { node.removeAttribute('data-flash') }, 1_400)
          },
          inject,
          publish: (text: string) => {
            if (sessionId === undefined) return
            setBusy(true)
            void inject.sendToPlace(sessionId, text).then((result) => {
              setBusy(false)
              setToast(result.error ?? `已以你的名义发到「${topic?.groupName ?? '本群'}」。`)
              void refresh()
            })
          },
          hasPlace: topic !== undefined,
          openPlace: () => {
            if (topic === undefined) return
            setFrame({ kind: 'place', placeKey: topic.placeKey, groupName: topic.groupName })
          },
        }))}
      </div>

      {forwarding !== undefined && (
        <ForwardPicker
          text={forwarding}
          inject={inject}
          close={() => { setForwarding(undefined) }}
          done={setToast}
        />
      )}

      {traceOpen && (
        <YzjTracePanel
          nodes={nodes}
          title={topic === undefined ? '本地会话' : `${topic.groupName} · ${topic.label}`}
          close={() => { setTraceOpen(false) }}
        />
      )}

      {contractOpen && topic !== undefined && (
        <YzjContractPanel
          placeKey={topic.placeKey}
          inject={inject}
          close={() => { setContractOpen(false) }}
        />
      )}

      {toast !== '' && <div className={css.toast}>{toast}</div>}

      <div className={css.composer}>
        {/*
          目标 chip (v4.9) — 挂接引用是语境的属性，这是它在 UI 里的真身。

          Two states, and the difference is worth showing: a PENDING chip came
          in through the portal and becomes true when the sentence is sent; an
          ARMED chip is already a fact about this conversation, read back from
          the graph, and every commitment registered here inherits it. Drawing
          them the same would make the operator guess which one they are
          looking at — and the whole value of 继承不是推断 is that you can see
          which it is.
        */}
        {pendingEvent !== undefined && (
          <div className={`${css.goalChip} ${css.eventChip}`}>
            <span className={css.goalChipTag}>为这场会准备</span>
            <span className={css.goalChipName}>{pendingEvent}</span>
            <span className={css.goalChipNote}>
              只是一句提示：这个话题**不会**因此挂到这场会上，句子发出去也不会自动登记
            </span>
            <button
              type="button"
              className={css.goalChipOff}
              title="不带了"
              onClick={() => { setPendingEvent(undefined) }}
            >
              ×
            </button>
          </div>
        )}
        {(pendingGoal ?? window_.goalContext) !== undefined && (
          <div className={`${css.goalChip} ${pendingGoal === undefined ? css.goalArmed : ''}`}>
            <span className={css.goalChipTag}>{pendingGoal === undefined ? '本话题的目标' : '带着目标来的'}</span>
            <span className={css.goalChipName}>
              {pendingGoal?.goalName ?? window_.goalContext?.goalName ?? window_.goalContext?.goalRef}
            </span>
            <span className={css.goalChipNote}>
              {pendingGoal === undefined
                ? '在这里登记的承诺会继承它（继承不是推断，ack 会亮出来，说错了直接说）'
                : '这句发出去之后，这个话题就带着它了'}
            </span>
            {/*
              登记是 agent 观察到的，不是发消息的副作用——所以这一句必须说出来，
              而不是替操作者把触发词塞进句子里。改写别人要发出去的话是越权。
            */}
            {pendingGoal !== undefined && voice === 'place' && !calling && (
              <span className={css.goalChipWarn}>
                句子里带上 {alias ?? '@agent'}，这次委派才会被登记成可跟踪的承诺
              </span>
            )}
            <button
              type="button"
              className={css.goalChipOff}
              title={pendingGoal === undefined
                ? '让这个话题不再挂在这个目标下——未挂是合法状态'
                : '不挂了'}
              onClick={() => {
                if (pendingGoal !== undefined) {
                  setPendingGoal(undefined)
                  return
                }
                if (sessionId === undefined) return
                void inject.armTopicGoal(sessionId).then((result) => {
                  if (result.error !== undefined) setToast(result.error)
                  void refresh()
                })
              }}
            >
              ×
            </button>
          </div>
        )}
        {/*
          锚定条 (D13④) — A0 的锚定层级在 UI 里的真身。
          一次发送同时回答四个正交问题（落点/受话/指涉/可见域）而只有一个发送
          键，所以决定"话落在哪"的那个必须在按下之前常显。
        */}
        <div className={`${css.anchorBar} ${replyTo === undefined ? '' : css.anchorPinned}`}>
          <span className={css.anchorLabel}>落点</span>
          {/*
            **没有落点就说没有落点。**

            这一格此前假设「总有一个会话在下面」，而一个还没有 session 的本地会话
            不满足它：发送键照常亮着，点下去什么都不发生。说出是哪一堵墙，比给一颗
            点了没反应的按钮诚实——后者会让人以为是自己打错了什么。
          */}
          {sessionId === undefined
            ? <span className={css.anchorWhere}>这里还没有会话——从左边新建一个，或者打开一个已有的</span>
            : replyTo === undefined
            ? (
              <span className={css.anchorWhere}>
                {voice === 'place'
                  ? topic === undefined ? '本地会话' : `发到本话题 · ${topic.label}`
                  : '只到 agent · 不落在群里'}
              </span>
            )
            : (
              <>
                <span className={css.anchorWhere}>
                  ↩ 挂到 {replyTo.who} 的这句
                  <span className={css.anchorQuote}>{replyTo.text}</span>
                </span>
                {/* 点火预告：已挂链时输入 @，整条链会被收纳成话题 */}
                {draft.includes('@') && (
                  <span className={css.anchorIgnite}>整条链将收纳为话题</span>
                )}
                <button
                  type="button"
                  className={css.anchorClear}
                  title="回默认落点"
                  onClick={() => { setReplyTo(undefined) }}
                >
                  ×
                </button>
              </>
            )}
        </div>

        <div className={css.voiceRow}>
          <div className={css.voiceSeg}>
            <button
              type="button"
              className={`${css.voiceBtn} ${voice === 'private' ? css.voiceOn : ''}`}
              onClick={() => { setVoice('private') }}
            >
              <span className={`${css.vdot} ${css.vdotPri}`} />对 Agent 说 · 私
            </button>
            <button
              type="button"
              className={`${css.voiceBtn} ${voice === 'place' ? css.voiceOn : ''}`}
              onClick={() => { setVoice('place') }}
              disabled={topic === undefined}
            >
              <span className={`${css.vdot} ${css.vdotPub}`} />发到群里 · 公
            </button>
          </div>
          <button
            type="button"
            className={`${css.askBtn} ${voice === 'ask' ? css.askOn : ''}`}
            title="一次性只读投影：问一个数得一个数，不开任务、不写任何东西"
            disabled={topic === undefined}
            onClick={() => { setVoice(value => (value === 'ask' ? 'private' : 'ask')) }}
          >
            ⚡ 轻问
          </button>
          <span className={css.tools}>
            <EmojiButton insert={insert} />
            {/* @成员补全 (4h④)：只在公语态出现——私语里 @ 谁都没人听得见。 */}
            {voice === 'place' && <MentionPicker inject={inject} insert={insert} />}
            {alias !== undefined && voice === 'place' && (
              <button
                type="button"
                className={`${css.callBtn} ${calling ? css.callOn : ''}`}
                title={`把 ${alias} 加进这条——agent 才会应答`}
                onClick={toggleCall}
              >
                ⚡ 叫上 {alias}
              </button>
            )}
          </span>
          <span className={`${css.hint} ${voice === 'place' ? css.hintPub : ''}`}>
            {voice === 'place'
              ? `以你本人名义发到「${topic?.groupName ?? ''}」，群里所有人可见`
              : voice === 'ask'
                ? '只读：任何写工具都会被拒绝，不产生任务，也不发到群里'
                : running ? '运行中，这句会作为 steering 插入' : '只有你和 agent 看得见'}
          </span>
        </div>
        <div className={`${css.cbox} ${voice === 'place' ? css.cboxPub : voice === 'ask' ? css.cboxAsk : css.cboxPri}`}>
          <textarea
            className={css.input}
            ref={boxRef}
            value={draft}
            disabled={busy}
            placeholder={
              voice === 'place' ? '发到群里…' : voice === 'ask' ? '问一个数…' : '对 agent 说…'
            }
            onChange={(event) => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              /*
                输入法正在选字时，回车是「选这个词」，不是「发出去」.

                A composing Enter is the IME's own key: intercepting it sends a
                half-typed sentence — into a real group, in front of colleagues.
                `isComposing` is the browser's own answer to exactly this, and
                the `229` check covers the engines that report the keyCode but
                not the flag.
              */
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <button
            type="button"
            className={`${css.send} ${voice === 'place' ? css.sendPub : voice === 'ask' ? css.sendAsk : css.sendPri}`}
            disabled={busy || draft.trim() === '' || sessionId === undefined}
            onClick={send}
          >
            {voice === 'place' ? '发到群' : voice === 'ask' ? '轻问' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** One quoted line, short enough to sit in the anchor bar. */
function clip(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > 42 ? `${flat.slice(0, 42)}…` : flat
}

interface RowContext {
  /** Wall clock, re-read once a second while a turn is open. */
  now: number
  openWork: Record<string, boolean>
  toggleWork(key: string): void
  act(kind: string, id: string, actionId: string, input?: string): void
  busy: boolean
  placeName: string
  openTrace(): void
  forward(text: string): void
  replyTo(msgId: string, who: string, text: string): void
  askAgentAbout(msgId: string, who: string, text: string): void
  /** Scroll to a message in THIS topic — the 「那句话在哪」 door. */
  jumpTo(msgId: string): void
  /** Whether this session is a Yunzhijia topic at all; a local one has no place. */
  hasPlace: boolean
  /** Up to the group's own thread — the 「这段对话在聊什么」 door. */
  openPlace(): void
  /** Put an agent answer into the room, under the operator's name. */
  publish(text: string): void
  /** Attachments fetch their own bytes; the rows need the host handle. */
  inject: SurfaceInject
}

/** One row, with its rail. The rail is the point of this whole column. */
function shell(
  key: string,
  voice: 'public' | 'private',
  children: ReactNode,
  /**
   * 卡的落点，`kind:id` (v4.14 决断条→对象)。
   *
   * 由渲染那一行的分支显式交出来，而不是从 `key` 的前缀猜——`data-msg` 那一条
   * 已经是按约定切字符串了，再来一条，这个约定就成了两处代码必须同时记得的事。
   */
  cardAnchor?: string,
): ReactNode {
  return (
    <div
      className={`${css.msg} ${voice === 'public' ? css.pub : css.pri}`}
      key={key}
      /*
        The jump target. Row keys are prefixed (`m:<msgId>`), so the raw id is
        published separately rather than making every caller know the prefix —
        a selector built out of a convention is a selector that breaks when the
        convention moves.
      */
      data-msg={key.startsWith('m:') ? key.slice(2) : undefined}
      data-card={cardAnchor}
    >
      <div className={css.rail}>
        <span className={css.railTag}>{voice === 'public' ? '公' : '私'}</span>
        <span className={css.railLine} />
      </div>
      <div className={css.body}>{children}</div>
    </div>
  )
}

/** Step marks. A failed call is not a finished one, so it gets its own. */
const STEP_MARK: Record<string, string> = { running: '◐', failed: '✕', done: '✓' }
const STEP_CLASS: Record<string, string> = {
  running: css.stepRun ?? '',
  failed: css.stepFail ?? '',
  done: css.stepDone ?? '',
}

const SPEAKER: Record<string, string> = {
  operator: '你',
  steering: '你 · steering',
  ask: '你 · 轻问',
  askAnswer: '云小助 · 轻问答复',
  agent: '云小助',
}

function renderRow(row: StreamRow, context: RowContext): ReactNode {
  const clock = clockOf(row.time)
  switch (row.kind) {
    case 'divider':
      return <div className={css.divider} key={row.key}><span>{row.label}</span></div>

    case 'sysline':
      return (
        <div className={css.sysline} key={row.key}>
          <span className={css.syslineInner}>{row.text}</span>
        </div>
      )

    case 'message': {
      const avatar = avatarOf(row.who)
      return shell(row.key, row.voice, (
        <>
          <div className={css.mhead}>
            <span className={css.avatar} style={{ background: avatar.color }}>{avatar.text}</span>
            <span className={css.name}>{row.who}</span>
            <span className={css.clock}>{clock}</span>
            {/*
              hover 双动词 (v4.7)：↩ 回复 是挂链；⚡@agent 是挂链+受话的复合
              动词，实现成预填一个 @ —— 零隐藏状态，删掉 @ 就降级回普通回复。
            */}
            <span className={css.verbs}>
              <button
                type="button"
                className={css.verb}
                title="回复这句（挂到它的链上）"
                onClick={() => { context.replyTo(row.key.slice(2), row.who, row.text) }}
              >
                ↩ 回复
              </button>
              <button
                type="button"
                className={css.verb}
                title="就这事让 agent 干：挂链并 @ 它"
                onClick={() => { context.askAgentAbout(row.key.slice(2), row.who, row.text) }}
              >
                ⚡ @agent
              </button>
              <CopyButton text={row.text} className={css.verb} />
              <button
                type="button"
                className={css.verb}
                title="转发到另一个会话"
                onClick={() => { context.forward(row.text) }}
              >
                ↗ 转发
              </button>
            </span>
          </div>
          {/*
            引用行上的两个门。

            群视图早就有「跳到被回复的那条」，这一列却只画了一行死文本——同一
            件事在两个 surface 上一个能点一个不能，本身就是缺陷。两个按钮回答
            两个不同的问题：**跳过去**是「那句话在哪」（同话题内滚动定位），
            **看整串**是「这段对话到底在聊什么」（回群时间线看它的上下文，
            因为被引用的那句往往来自主楼）。
          */}
          {row.quote !== undefined && (
            <div className={css.quoteRow}>
              {row.quoteId === undefined
                ? <span className={css.quote}>↳ {row.quote}</span>
                : (
                  <button
                    type="button"
                    className={`${css.quote} ${css.quoteLink}`}
                    title="跳到被回复的那条"
                    onClick={() => { context.jumpTo(row.quoteId as string) }}
                  >
                    ↳ {row.quote}
                  </button>
                )}
              {context.hasPlace && (
                <button
                  type="button"
                  className={css.quoteTopic}
                  title="回群里看这段话的上下文（被引用的那句常常来自主楼）"
                  onClick={context.openPlace}
                >
                  看整串 ›
                </button>
              )}
            </div>
          )}
          {/*
            附件消息的正文就是附件自己的占位符（`[文件]:r29-summary.md`），
            卡片已经把名字画出来了——两个都画等于把同一个文件名说两遍。
          */}
          {(() => {
            const body = withoutImageMarks(row.text, (row.images ?? []).length > 0)
            return isPlaceholderOnly(body, row.file?.name)
              ? null
              : <div className={css.bubble}>{body}</div>
          })()}
          <Attachments
            inject={context.inject}
            message={{
              msgId: row.key, fromOpenId: '', fromName: row.who, content: row.text,
              msgType: '', time: row.time, own: false,
              ...(row.images === undefined ? {} : { images: row.images }),
              ...(row.file === undefined ? {} : { file: row.file }),
            }}
          />
          <div className={css.mfoot}>云之家 · {context.placeName}</div>
        </>
      ))
    }

    case 'said': {
      const label = SPEAKER[row.speaker] ?? row.speaker
      const projection = row.speaker === 'ask' || row.speaker === 'askAnswer'
      const avatar = row.speaker === 'agent' || row.speaker === 'askAnswer'
        ? { text: 'AI', color: '#1D2432' }
        : avatarOf(label)
      return shell(row.key, row.voice, (
        <>
          <div className={css.mhead}>
            <span className={css.avatar} style={{ background: avatar.color }}>{avatar.text}</span>
            <span className={css.name}>{label}</span>
            {projection && (
              <span className={css.askMark}>
                {row.speaker === 'ask' ? '⚡ 只读' : '⚡ 一次性投影 · 未发到群'}
              </span>
            )}
            <span className={css.clock}>{clock}</span>
            {/*
              私语域里的回答，没有一扇通往群里的门。

              现场：群里的任务被一次 502 判死，操作者在桌面私语里说「继续完成」，
              agent 把活干完了、答案写得很好——**然后停在这一列里**。私语的答案
              不该自动发到群里（那是把社交决策代做了），但它必须**有一个动作**
              能送过去，否则唯一的出路是复制粘贴。
            */}
            {row.speaker === 'agent' && row.voice === 'private' && context.hasPlace && (
              <span className={css.verbs}>
                <button
                  type="button"
                  className={css.verb}
                  title="以你的名义把这段发到群里——发不发是你决定的，不是它"
                  onClick={() => { context.publish(row.text) }}
                >
                  ↗ 发到群里
                </button>
                <CopyButton text={row.text} className={css.verb} />
              </span>
            )}
          </div>
          <div className={`${css.bubble} ${projection ? css.askBubble : ''}`}>{row.text}</div>
          {row.speaker === 'askAnswer' && (
            <div className={css.mfoot}>问一个数得一个数 · 没有开任务，也没有写任何东西</div>
          )}
          {row.voice === 'public' && (
            <div className={css.mfoot}>已发到 {context.placeName} · 群内所有人可见</div>
          )}
        </>
      ))
    }

    case 'work': {
      const open = context.openWork[row.key] ?? false
      /*
        The head has to answer 「在跑还是跑完了」 without being opened.
        Wording alone did not: 「Agent 正在工作」 and 「Agent 工作过程」 are two
        similar phrases in the same weight and colour, and the state they
        distinguish is the first thing a reader looks for.
      */
      const doing = row.steps.findLast(step => step.state === 'running')
      const failed = row.steps.filter(step => step.state === 'failed').length
      /**
       * A call younger than the tick it is measured against reads as 0, and
       * `durationOf` refuses to print a zero — so the separator has to be
       * conditional on the number, not on the step. A dangling 「bash ·」 was
       * exactly that bug, caught in the browser.
       */
      const elapsed = (since: number | undefined): string => (
        since === undefined || since <= 0
          ? ''
          : durationOf(Math.max(0, context.now - since))
      )
      const live = elapsed(doing?.since)
      const badge = row.state === 'running'
        ? <span className={`${css.workState} ${css.workRunning}`}><span className={css.pulse} />进行中</span>
        : row.state === 'failed'
          ? <span className={`${css.workState} ${css.workFailed}`}>⚠ {failed} 步失败</span>
          : <span className={`${css.workState} ${css.workDone}`}>✓ 已完成</span>
      return shell(row.key, row.voice, (
        <div className={`${css.work} ${row.state === 'running' ? css.workLive : ''} ${row.state === 'failed' ? css.workBad : ''}`}>
          <button type="button" className={css.workHead} onClick={() => { context.toggleWork(row.key) }}>
            <span className={`${css.workTw} ${open ? css.workTwOpen : ''}`}>▶</span>
            {badge}
            <span className={css.workCount}>{row.steps.length} 步</span>
            {/* While it runs, WHAT it is doing is the useful fact; once it is
                over, how long it took is. */}
            {row.state === 'running' && doing !== undefined && (
              <>
                {/* 在干什么,用工具自己的说法 —— 不是它的参数。 */}
                <span className={css.workNow} title={doing.detail}>
                  {doing.tool}{doing.detail === '' ? '' : ` · ${doing.detail}`}
                </span>
                {live !== '' && <span className={css.workMs}>{live}</span>}
              </>
            )}
            {row.state !== 'running' && row.ms > 0 && (
              <span className={css.workMs}>用时 {durationOf(row.ms)}</span>
            )}
            <span className={css.clock} style={{ marginLeft: 'auto' }}>{clock}</span>
          </button>
          {open && (
            <div className={css.steps}>
              {/* 「产品只做入口」: the block is the door, and a door has to be
                  visible from inside the room it opens off. */}
              <button type="button" className={css.traceLink} onClick={context.openTrace}>
                看完整轨迹 ›
              </button>
              {row.steps.map((step, index) => (
                <div
                  className={`${css.step} ${STEP_CLASS[step.state]} ${step.memory ? css.stepMemory : ''}`}
                  key={`${row.key}:${String(index)}`}
                >
                  <span className={css.stepMark}>{STEP_MARK[step.state]}</span>
                  <span className={css.stepTool}>{step.tool}</span>
                  {/* 精简,不是原始:参数、输出、重试都在完整轨迹里。 */}
                  <span className={css.stepDetail} title={step.detail}>{step.detail}</span>
                  <span className={css.stepMs}>
                    {step.state === 'running'
                      ? elapsed(step.since) || '进行中'
                      : durationOf(step.ms ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))
    }

    case 'live':
      // The turn, while it is happening. Private: an answer is not in the
      // room until it has been sent, and it has not been sent yet.
      return shell(row.key, 'private', (
        <>
          <div className={css.mhead}>
            <span className={css.avatar} style={{ background: '#1D2432' }}>AI</span>
            <span className={css.name}>云小助</span>
            <span className={css.liveMark}>
              <span className={css.pulse} />
              {row.mode === 'text' ? '正在回答' : row.mode === 'thinking' ? '正在思考' : '等待模型'}
            </span>
          </div>
          {row.mode === 'text' && <div className={`${css.bubble} ${css.liveBubble}`}>{row.text}</div>}
          {row.mode === 'thinking' && <div className={css.thinking}>{row.text}</div>}
          {row.mode === 'waiting' && <div className={css.thinking}>请求已发出，还没收到第一个字。</div>}
        </>
      ))

    case 'artifact':
      /*
        agent 劳动的产出,和同事拖进群的文件是同一种物,所以是同一张卡
        (v4.11 工件统一)。

        上传的文件能就地打开来看:`yzj://file/<id>` 里的 id 就是附件的 fileId。
        在线文档只给门——它是一个活的东西,此刻可能已经被别人改了,从我们自己
        那条边渲染出来的任何正文都可能和文档现在说的话不一致(数据律 1)。
      */
      return shell(row.key, 'public', (
        <ArtifactCard
          artifact={artifactRefOf({
            uri: row.artifact.uri,
            title: row.artifact.title,
            action: row.artifact.action,
            ...(row.artifact.toolName === undefined ? {} : { toolName: row.artifact.toolName }),
            notes: [clock],
            marks: [row.artifact.foreign
              ? {
                label: '写到了别的场所',
                why: '这次劳动写出去的东西落在了别的场所——越境是要被看见的，不是一句备注',
              }
              : undefined],
          })}
        />
      ))

    default:
      return shell(row.key, 'private', (
        <>
          <div className={css.mhead}><span className={css.clock}>{clock}</span></div>
          <CardRow card={row.card} busy={context.busy} act={context.act} />
        </>
      ), `${row.card.kind}:${row.card.id}`)
  }
}
