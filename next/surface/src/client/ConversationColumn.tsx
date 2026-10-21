/**
 * 中栏 —— 产品的主面 (界面重设计 §4.3 / §5.1).
 *
 * 它占了整个 `conversation` 座位：宿主自己的聊天与轨迹视图不在了，一个会话需要的一切都
 * 在这里画。这是一个有代价的选择——「一个话题一个窗口」是设计的第一条判据，而一条融合
 * 时间线若只是挂在未融合那条旁边的一个标签页，就是一句产品并没有兑现的话。代价之一是
 * 宿主输入框里的模型选择器没法在这里重新声明；能补回来的是事实：⋯ 里写着在用哪个模型、
 * 去哪改。
 *
 * **不复制的是数据**：会话节点仍然来自宿主的快照，这里只渲染、不存。
 *
 * 这一列坚持的一件事：**每一句话都说得清谁听得见**——私下的收进纸色带，群里的在带外；
 * 输入框下面那颗听众标签说的是你下一句会被谁听见。
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import { buildStream, type LiveWork, type TrajectoryNode } from './stream.ts'
import { STALL_MS, StreamRows } from './StreamView.tsx'
import { YzjDecisionPointer } from './DecisionPointer.tsx'
import { YzjBoard } from './Board.tsx'
import { YzjGoalPage } from './GoalPage.tsx'
import { YzjPlaceView } from './PlaceView.tsx'
import { YzjJudg } from './Judg.tsx'
import { YzjContractPanel } from './ContractPanel.tsx'
import { YzjTracePanel } from './TracePanel.tsx'
import { EmojiButton, ForwardPicker, MentionPicker } from './Compose.tsx'
import { Composer, audienceRiskOf, registrationLine, type Hint, type Voice } from './Composer.tsx'
import { closePreview } from './preview.ts'
import {
  dropAnsweredElsewhere, pressOnCard, stage, stagedNow, subscribeStaged, type Answer,
} from './answers.ts'
import {
  FRAME_SCROLL, backLabel, backTarget, currentFrame, currentLanding, landOn, needsNow, popFrame, pushFrame,
  restoreOf, setFrame, setSpotlight, subscribeFrame, subscribeLanding, subscribeNeeds, takeErrand,
} from './store.ts'
import { commandKey, useBackKey, useLayerEscape } from './keys.ts'
import { keepLastMessages, usePoll } from './poll.ts'
import { UnreadLine } from './Unread.tsx'
import { AgentFace, Icon } from './icons.tsx'
import { AGENT, plainError } from './words.ts'
import type { FusedWindowWire, StreamCard, SurfaceInject } from './rpc.ts'
import tokens from './tokens.module.css'
import css from './column.module.css'
import composerCss from './composer.module.css'

/**
 * 宿主快照里这一列读的那几样。
 *
 * `nodes` 是**已定稿**的日志；另外三样是正在进行的这一轮。只读 `nodes` 的话，这一列会在
 * 整轮运行期间纹丝不动、然后一下子蹦出一个做完的工作块——「还在做」的事实全在没读的字段里。
 */
interface Snapshot {
  readonly nodes?: readonly TrajectoryNode[]
  readonly running?: boolean
  readonly runningCalls?: LiveWork['calls']
  readonly partial?: LiveWork['partial']
}

export interface ConversationColumnProps {
  sessionId?: string
  useSession<T>(selector: (snapshot: Snapshot) => T): T | undefined
  inject: SurfaceInject
  /** 对云小助说话。由装配处给，它拿着会话的 face。 */
  prompt(sessionId: string, text: string, mode: 'queue' | 'steer'): Promise<string | undefined>
  /** 停下正在跑的这一轮（排着队的话还在）。 */
  cancel?(sessionId: string): Promise<string | undefined>
  openSession(sessionId: string): void
  openDetails(): void
}

const EMPTY: FusedWindowWire = { messages: [], chips: [], cards: [], artifacts: [] }

/** 扫属性，不拼选择器：id 是数据，不是常量。 */
function cardNodeIn(stream: HTMLElement | null, kind: string, id: string): Element | undefined {
  const anchor = `${kind}:${id}`
  return [...(stream?.querySelectorAll('[data-card]') ?? [])]
    .find(candidate => candidate.getAttribute('data-card') === anchor)
}

/**
 * 一份产出长出来的那句话：有消息 id 就是那一条；没有（桌面上直接说的）就是那个时刻之前
 * 最近的一句人话。
 */
function originNodeIn(stream: HTMLElement | null, kind: 'message' | 'at', id: string): Element | undefined {
  if (kind === 'message') {
    return [...(stream?.querySelectorAll('[data-msg]') ?? [])].find(candidate => candidate.getAttribute('data-msg') === id)
  }
  const at = Number(id)
  let best: Element | undefined
  for (const candidate of stream?.querySelectorAll('[data-said-at]') ?? []) {
    if (Number(candidate.getAttribute('data-said-at')) <= at) best = candidate
  }
  return best
}

/** 指一下：闪 1.4 秒。用属性不用生成的类名——后者在找东西的那一刻可能是 undefined。 */
function flash(node: Element): void {
  node.setAttribute('data-flash', '1')
  setTimeout(() => { node.removeAttribute('data-flash') }, 1_400)
}

/** 快照里最晚的那个时刻：最后一个定稿节点、或还没回来的调用发出去的那一刻。 */
function latestTime(nodes: readonly TrajectoryNode[], calls: LiveWork['calls']): number | undefined {
  let latest: number | undefined
  for (const time of [nodes[nodes.length - 1]?.time, ...(calls ?? []).map(call => call.time)]) {
    if (typeof time === 'number' && Number.isFinite(time) && time > 0 && (latest === undefined || time > latest)) latest = time
  }
  return latest
}

/** 一句引用，短到能放进提示条。 */
function clip(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > 42 ? `${flat.slice(0, 42)}…` : flat
}

const RETRY_STEP = '上一步好像卡住了，一直没有进展。请重试这一步；如果还是不行，停下来告诉我卡在哪。'

export function YzjConversationColumn(props: ConversationColumnProps): ReactNode {
  const { sessionId, useSession, inject, prompt, cancel, openSession, openDetails } = props
  const frame = useSyncExternalStore(subscribeFrame, currentFrame)
  const landing = useSyncExternalStore(subscribeLanding, currentLanding)
  const needs = useSyncExternalStore(subscribeNeeds, needsNow)
  const staged = useSyncExternalStore(subscribeStaged, stagedNow)
  const nodes = useSession(snapshot => snapshot.nodes) ?? []
  const running = useSession(snapshot => snapshot.running) === true
  const runningCalls = useSession(snapshot => snapshot.runningCalls)
  const partial = useSession(snapshot => snapshot.partial)
  const [window_, setWindow] = useState<FusedWindowWire & { kept?: true }>(EMPTY)
  /** 上一次整个没读到（连工作台都没答）。读不到 ≠ 这个话题没有话。 */
  const [unread, setUnread] = useState(false)
  const [voice, setVoice] = useState<Voice>('private')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [openWork, setOpenWork] = useState<Record<string, boolean>>({})
  const [tree, setTree] = useState<{
    open: boolean
    places: { placeKey: string; groupName: string; topics: { sessionId: string; label: string }[] }[]
  }>({ open: false, places: [] })
  const closeTree = useCallback((): void => { setTree(value => ({ ...value, open: false })) }, [])
  useLayerEscape(closeTree, tree.open)
  const [model, setModel] = useState<{ provider?: string; model?: string }>({})
  const [rulesOpen, setRulesOpen] = useState(false)
  const [traceOpen, setTraceOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  /** 回复谁：这句话挂到哪条消息的链上。undefined = 话题本身。 */
  const [replyTo, setReplyTo] = useState<{ msgId: string; who: string; text: string } | undefined>(undefined)
  const streamRef = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)
  const boxRef = useRef<HTMLTextAreaElement | null>(null)
  const [forwarding, setForwarding] = useState<string | undefined>(undefined)
  /**
   * 传送门带过来、**还没说出口**的东西 (v4.9).
   *
   * 装载发生在说出口那一刻，不是跳进来那一刻：跳进来又关掉，什么都不该留下。所以它们
   * 都是待定态，跟着这一次发送走，发不出去就什么都没发生。
   */
  const [pendingGoal, setPendingGoal] = useState<{ goalRef: string; goalName: string } | undefined>(undefined)
  /** 带着一场会进来时的那句提示。**不是语境**：它什么都不装载。 */
  const [pendingEvent, setPendingEvent] = useState<string | undefined>(undefined)
  /** 催：带着一份拟好的稿。不装载语境，也不另记一条。 */
  const [pendingNudge, setPendingNudge] = useState<string | undefined>(undefined)
  /** 这句欠一个受话，等触发词到齐再补（存的是我们放进框里的那串字）。 */
  const [pendingCall, setPendingCall] = useState<string | undefined>(undefined)
  /** 移交先验（决策 #59）。 */
  const [pendingHandoff, setPendingHandoff] = useState<
    { fromCommitmentId: string; openId: string; name?: string } | undefined
  >(undefined)
  /** 传送门算过的听众风险：他可能不在这个群（v4.24 #58）。说，不拦。 */
  const [audienceRisk, setAudienceRisk] = useState('')
  /** 登记先验（v3.15 裁决④）：这句话在登记谁的承诺。 */
  const [pendingRegister, setPendingRegister] = useState<
    { openId: string; name: string; parentCommitmentId?: string } | undefined
  >(undefined)
  /** 刚弹回来的那一屏离开时滚到了哪儿；之后任何一次换屏它就失效（store 管）。 */
  const restoreScroll = restoreOf(frame)
  /** 流里「当前」的那张卡：J/K 走到的、落点落到的、点过的。数字键答它。 */
  const [currentCard, setCurrentCard] = useState<string | undefined>(undefined)
  /** 刚在这里答过的那张：它下面接「下一件」。 */
  const [justAnswered, setJustAnswered] = useState<string | undefined>(undefined)
  const back = backTarget()
  const goBack = useCallback((): void => { popFrame() }, [])
  // Esc 的最后一步：从群里点进来的话题，回到那个群、回到离开时的位置。
  useBackKey(frame.kind === 'session' && back !== undefined ? goBack : undefined)

  /*
    右栏跟着焦点走（律六）：回到会话、群、「我定过的」时打开它——那几屏的右栏有东西摆；
    承诺、目标两屏没选中什么时它自己收起，选中一行再打开。
  */
  useEffect(() => {
    if (frame.kind === 'session' || frame.kind === 'place' || frame.kind === 'judg') openDetails()
  }, [frame.kind, openDetails])
  // 回复、当前卡、刚答过的——都属于选它们的那段对话。
  useEffect(() => {
    setReplyTo(undefined)
    setCurrentCard(undefined)
    setJustAnswered(undefined)
  }, [sessionId])
  // 切会话即收：预览与放大的那场会属于打开它们的语境。
  useEffect(() => {
    closePreview()
    setSpotlight(undefined)
  }, [sessionId])
  /*
    传送门落地 (v4.9 入口 A①)。读即消费，所以之后打开的会话不带任何东西。按帧也按会话：
    人可能传送进他本来就在的那个话题。什么都不发——起头是给人自己那句话的。
  */
  useEffect(() => {
    if (frame.kind !== 'session') return
    const errand = takeErrand()
    if (errand === undefined) {
      setPendingGoal(undefined)
      setPendingEvent(undefined)
      setPendingNudge(undefined)
      setPendingRegister(undefined)
      setPendingHandoff(undefined)
      return
    }
    setVoice(errand.voice)
    const opening = errand.seed ?? ''
    if (opening !== '') {
      // 不覆盖没发完的话：草稿是人的。
      setDraft(current => (current.trim() === '' ? opening : current))
      setToast(value => (
        boxRef.current !== null && boxRef.current.value.trim() !== ''
          ? '你有一段没发完的话，没覆盖它——这次要说的请自己写。'
          : value
      ))
    }
    setPendingCall(errand.call === true ? opening : undefined)
    setPendingRegister(errand.register)
    setPendingHandoff(errand.handoff)
    setAudienceRisk(errand.audienceRisk ?? '')
    // 一场会不装载语境：会的 id 当成 goalRef 会把目标图污染掉。
    setPendingGoal(errand.voice === 'place' && errand.subject === 'goal'
      ? { goalRef: errand.goalRef, goalName: errand.goalName }
      : undefined)
    setPendingEvent(errand.subject === 'event' ? errand.goalName : undefined)
    setPendingNudge(errand.subject === 'nudge' ? errand.goalName : undefined)
    requestAnimationFrame(() => { boxRef.current?.focus() })
  }, [sessionId, frame.kind])
  // 新话题从最新一条开始看——除非是带着一张卡来的（下面的落点优先）。
  useEffect(() => { atBottom.current = true }, [sessionId])
  // 上一个会话的回包不许画到这一个上。
  useEffect(() => { fetchSeq.current += 1 }, [sessionId])
  useEffect(() => { void inject.model().then(setModel) }, [inject])

  /*
    快问只在云之家话题里成立——够不着就当场说，不等按下发送才报错。窗口读不到的时候
    不下「这不是话题」的断言：看不了 ≠ 没有。
  */
  useEffect(() => {
    if (voice !== 'ask' || window_ === EMPTY || window_.topic !== undefined) return
    setVoice('private')
    setToast(`这里不是云之家的话题，快问用不了——已切回「仅你和${AGENT}」。`)
  }, [voice, window_])

  // 触发词到了，把受话摆进框里——看得见、删得掉；人改过了就不补。
  useEffect(() => {
    const alias = window_.aliases?.[0]
    if (pendingCall === undefined || alias === undefined) return
    setDraft(current => (current === pendingCall ? `${alias} ${current}`.trimEnd() : current))
    setPendingCall(undefined)
  }, [pendingCall, window_.aliases])

  // 回执说完就走。
  useEffect(() => {
    if (toast === '') return undefined
    const timer = setTimeout(() => { setToast('') }, 6_000)
    return () => { clearTimeout(timer) }
  }, [toast])

  useEffect(() => {
    if (!menuOpen) return undefined
    const away = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node) !== true) setMenuOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => { document.removeEventListener('mousedown', away) }
  }, [menuOpen])

  /** 只有最新那一次取窗可以画：先发的请求可能后到。 */
  const fetchSeq = useRef(0)
  /** 屏上画的是谁的窗。刚切换的那一拍还是上一个话题的。 */
  const paintedFor = useRef<string | undefined>(undefined)
  const refresh = useCallback(async (): Promise<void> => {
    if (sessionId === undefined) return
    fetchSeq.current += 1
    const ticket = fetchSeq.current
    const next = await inject.fused(sessionId)
    if (ticket !== fetchSeq.current) return
    const same = paintedFor.current === sessionId
    // 整个没读到：同一个话题就留着屏上的，只说一句；换了话题就是空窗加那一句。
    setUnread(next === undefined)
    if (next === undefined) {
      if (!same) setWindow(EMPTY)
      return
    }
    paintedFor.current = sessionId
    setWindow(previous => keepLastMessages(same ? previous : undefined, next))
  }, [inject, sessionId])

  // 云之家没有推送（F1），消息那一半靠轮询。
  usePoll(refresh)

  // 撤回窗里的回答，别处先答了就以别处为准（先答先赢）。
  useEffect(() => {
    dropAnsweredElsewhere(window_.cards.filter(card => card.resolved))
  }, [window_.cards])

  const topic = window_.topic
  /** 这个话题在一间私聊里：听众是一个人，处处说「发给李婷」，不说「发到群里」。 */
  const direct = topic?.conversationKind === 'direct'
  const rows = useMemo(
    () => buildStream(
      nodes, window_.messages, window_.cards, window_.artifacts, topic !== undefined,
      { calls: runningCalls ?? [], partial: partial ?? null, running },
    ),
    [nodes, window_.messages, window_.cards, window_.artifacts, topic, runningCalls, partial, running],
  )

  /*
    一只只在有事时走的钟：在跑、或者有回答在撤回窗里倒数。闲着的会话一次都不重画。
  */
  const [tick, setTick] = useState(() => Date.now())
  const ticking = running || staged.length > 0
  useEffect(() => {
    if (!ticking) return undefined
    setTick(Date.now())
    const timer = setInterval(() => { setTick(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [ticking])

  /*
    运行健康度 (§5.1)：最后一次有进展是什么时候。

    「进展」= 宿主快照里任何一样动了：多了一个定稿节点、多了或少了一个在跑的调用、流式
    输出多了几个字。都没动，就是在空转——这正是「空转 20 分钟毫不知情」要的那个数。
  */
  const progressKey = `${String(nodes.length)}:${String(runningCalls?.length ?? 0)}:${String(JSON.stringify(partial ?? null).length)}`
  /*
    第一次看到这个会话时，从**最后一样留下了时刻的进展**算起，而不是从打开这一屏算起：
    一件已经空转了二十分钟的活，不该因为人刚点进来就重新计时、再装五分钟没事。之后
    每一次快照动了，就是此刻。
  */
  const lastNodeAt = latestTime(nodes, runningCalls)
  const lastProgress = useRef(Date.now())
  const progressFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    const first = progressFor.current !== sessionId
    progressFor.current = sessionId
    lastProgress.current = first && lastNodeAt !== undefined && partial == null ? lastNodeAt : Date.now()
  }, [progressKey, running, sessionId, lastNodeAt, partial])
  const quietFor = running ? Math.max(0, tick - lastProgress.current) : undefined
  /** 顶上那颗转圈和流里那一块说同一句话：同一个数、同一道门。 */
  const stalled = quietFor !== undefined && quietFor >= STALL_MS

  // 只在读者本来就在末尾时跟到底：把人从正在读的地方拽走，是实时视图失去信任的方式。
  useEffect(() => {
    const node = streamRef.current
    if (node !== null && atBottom.current) node.scrollTop = node.scrollHeight
  }, [rows])

  /*
    **带着卡进来的，落在卡上** (v4.14 逐级兑付的最后一跳)。落下之后它就是「当前」那张：
    人是来答它的，数字键应该直接答到它身上。

    「找不到」只在流真的在屏上、而且画的就是这个会话时才算数。
  */
  useEffect(() => {
    if (landing === undefined || landing.sessionId !== sessionId) return
    if (frame.kind !== 'session' || streamRef.current === null) return
    // 回到一份产出长出来的那句话（律六）：不是卡，是一句话——落下、闪一下，不改「当前卡」。
    if (landing.kind === 'message' || landing.kind === 'at') {
      const node = originNodeIn(streamRef.current, landing.kind, landing.id)
      if (node === undefined) {
        if (paintedFor.current !== sessionId) return
        landOn(undefined)
        setToast('那句话不在这一段里了——可能太早，已经翻过去了。')
        return
      }
      landOn(undefined)
      atBottom.current = false
      node.scrollIntoView({ block: 'center', behavior: 'instant' })
      flash(node)
      return
    }
    const node = cardNodeIn(streamRef.current, landing.kind, landing.id)
    if (node === undefined) {
      if (paintedFor.current !== sessionId) return
      landOn(undefined)
      setToast('那张卡不在这个话题里了——它可能刚在别处答掉，或者已经挪走。')
      return
    }
    landOn(undefined)
    atBottom.current = false
    setCurrentCard(`${landing.kind}:${landing.id}`)
    node.scrollIntoView({ block: 'center', behavior: 'instant' })
    flash(node)
  }, [landing, sessionId, rows, frame.kind])

  /** 说出口了，目标才装载。话已经发出去了，所以失败要把两半都说清。 */
  const armPending = useCallback(async (): Promise<void> => {
    if (pendingGoal === undefined || sessionId === undefined) return
    const armed = await inject.armTopicGoal(sessionId, pendingGoal.goalRef, pendingGoal.goalName)
    if (armed.error !== undefined) {
      setToast(`话已经发出去了，但这个话题没能挂到目标上：${plainError(armed.error).text}`)
      return
    }
    setPendingGoal(undefined)
  }, [inject, pendingGoal, sessionId])

  const say = (error: string): void => { setToast(plainError(error).text) }

  const send = useCallback((): void => {
    const text = draft.trim()
    if (text === '' || busy || sessionId === undefined) return
    setBusy(true)
    setToast('')
    if (voice === 'place') {
      // 登记先验跟着这句话一起走：发送成功即落库，发不出去就什么都没发生。
      void inject.sendToPlace(
        sessionId, text, replyTo?.msgId,
        pendingRegister === undefined
          ? undefined
          : { ...pendingRegister, ...(pendingGoal === undefined ? {} : { goalRef: pendingGoal.goalRef }) },
        pendingHandoff,
      ).then(async (result) => {
        if (result.error !== undefined) say(result.error)
        else {
          if (result.note !== undefined) setToast(result.note)
          else if (result.toCommitmentId !== undefined) setToast('转好了：新的一条从这句话算起。')
          setPendingHandoff(undefined)
          setAudienceRisk('')
          setPendingNudge(undefined)
          await armPending()
          setDraft('')
          setReplyTo(undefined)
          setPendingRegister(undefined)
          // 说完一句公开的就回到私下：记住的公开语态，是本该说给云小助的话落进群里的方式。
          setVoice('private')
        }
        setBusy(false)
        void refresh()
      })
      return
    }
    if (voice === 'ask') {
      void inject.lightAsk(sessionId, text).then((result) => {
        if (result.error !== undefined) say(result.error)
        else {
          setDraft('')
          setVoice('private')
        }
        setBusy(false)
        void refresh()
      })
      return
    }
    // 私语道出站拦截（决策 #64）：「押：…」「以后…」是人对自己账本的动词，不经 agent。
    void inject.privateSay(sessionId, text).then(async (said) => {
      if (said.handled) {
        setToast(said.ack ?? '记下了。只有你能看到。')
        setDraft('')
        setBusy(false)
        void refresh()
        return
      }
      if (said.error !== undefined) say(said.error)
      // 在跑的时候说的话是插话；不在跑的时候是下一句吩咐。
      const error = await prompt(sessionId, text, running ? 'steer' : 'queue')
      if (error !== undefined) { say(error); setBusy(false); return }
      await armPending()
      setDraft('')
      setBusy(false)
    })
  }, [draft, busy, voice, sessionId, running, prompt, inject, refresh, replyTo, armPending, pendingRegister, pendingGoal, pendingHandoff])

  /**
   * 委托一句话给云小助 —— **CTA 只是话语的按钮形态** (§5.3 A6.1 ①).
   *
   * 板与目标页上的「拆解」「评估」走这里，走的是和输入框**一模一样**的那条路（`prompt`）。
   * 这个缝不许抛：调用方拿返回值开关按钮，一次 reject 会让按钮永久灰着。
   */
  const commission = useCallback(async (text: string, into?: string): Promise<string | undefined> => {
    // 给了会话就说在那里（那条承诺自己的话题）；否则说在当前会话。
    const target = into ?? sessionId
    if (target === undefined) {
      return '这里还没有会话可说话——从左边打开或新建一个，再回来按这颗按钮。'
    }
    const error = await prompt(target, text, running && target === sessionId ? 'steer' : 'queue')
      .catch((cause: unknown) => (cause instanceof Error ? cause.message : '通道无响应'))
    if (error !== undefined) return plainError(error).text
    // 从承诺、目标那一屏交出去的：钻进那个会话，返回回得到原处。
    pushFrame({ kind: 'session' })
    openSession(target)
    return undefined
  }, [sessionId, prompt, running, openSession])

  /** 放在光标处；只会追加的选择器是要跟它较劲的选择器。 */
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

  /**
   * 答一张卡 —— **先进撤回窗** (律七)。5 秒后才真的走动作总线；输了先答先赢的那一笔，
   * 回执原话报出来（谁、在哪、什么时候答的）。
   */
  const answerCard = useCallback((answer: Answer): void => {
    setJustAnswered(`${answer.kind}:${answer.id}`)
    setCurrentCard(undefined)
    stage(answer, async (entry) => {
      // 几笔一次请求：撤回窗里关页面时，只来得及发出一个。
      const results = await inject.cardActSteps(entry.kind, entry.id, entry.steps)
      const missed = results.find(result => result.outcome !== 'applied')
      if (missed !== undefined) setToast(missed.receipt.replace(/^⚠️?\s*/u, ''))
      await refresh()
    })
  }, [inject, refresh])

  /** 滚过去、闪一下。卡留在它发问的位置，前后语境在场。 */
  const jumpToCard = useCallback((kind: string, id: string): void => {
    const node = cardNodeIn(streamRef.current, kind, id)
    if (node === undefined) {
      setToast('这件事不在当前这一屏里——往上翻能找到它，它还在原地等着。')
      return
    }
    setCurrentCard(`${kind}:${id}`)
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    flash(node)
  }, [])

  /** 律九：起草一条规矩。草稿是一张等你签的卡，长在这段对话里。 */
  const proposeRule = useCallback((hint: NonNullable<StreamCard['ruleHint']>): void => {
    void inject.proposeRule(
      { toolClass: hint.toolClass, placeKey: hint.placeKey, ...(hint.placeName === undefined ? {} : { placeName: hint.placeName }) },
      sessionId,
    ).then(async (result) => {
      if (result.error !== undefined) { say(result.error); return }
      if (result.note !== undefined) { setToast(result.note); return }
      await refresh()
      setToast('规矩的草稿在下面——你签了才生效。')
      const leaseId = result.leaseId
      if (leaseId !== undefined) setTimeout(() => { jumpToCard('lease', leaseId) }, 60)
    })
  }, [inject, sessionId, refresh, jumpToCard])

  /*
    键盘 (律八)：数字答当前这张卡，`V` 并排看，`⏎` 定下逐条裁决，`J` / `K` 在卡之间走，
    `/` 回到输入框。打字的时候一个都不拦。
  */
  useEffect(() => {
    if (frame.kind !== 'session') return undefined
    const visible = (node: Element, box: DOMRect): boolean => {
      const rect = node.getBoundingClientRect()
      return rect.bottom > box.top + 8 && rect.top < box.bottom - 8
    }
    const onKey = (event: KeyboardEvent): void => {
      if (!commandKey(event)) return
      const target = event.target as HTMLElement | null
      // 焦点在按钮上时，回车是按那颗按钮。
      if (target?.tagName === 'BUTTON' && event.key === 'Enter') return
      const stream = streamRef.current
      if (stream === null) return
      const box = stream.getBoundingClientRect()
      const open = [...stream.querySelectorAll('[data-card][data-open]')]
      const key = event.key
      if (key === '/') {
        event.preventDefault()
        boxRef.current?.focus()
        return
      }
      if (key === 'j' || key === 'J' || key === 'k' || key === 'K') {
        if (open.length === 0) return
        const down = key === 'j' || key === 'J'
        const at = open.findIndex(node => node.getAttribute('data-card') === currentCard)
        const next = at >= 0
          ? open[Math.min(open.length - 1, Math.max(0, at + (down ? 1 : -1)))]
          : down
            ? open.find(node => node.getBoundingClientRect().bottom > box.top) ?? open.at(-1)
            : [...open].reverse().find(node => node.getBoundingClientRect().top < box.bottom) ?? open[0]
        if (next === undefined) return
        event.preventDefault()
        setCurrentCard(next.getAttribute('data-card') ?? undefined)
        next.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      }
      if (!/^([1-9]|v|V|Enter)$/u.test(key)) return
      // 当前那张在视野里就答它；否则答视野里最靠中间的那张还开着的。
      const current = open.find(node => node.getAttribute('data-card') === currentCard)
      const middle = (box.top + box.bottom) / 2
      const anchor = current !== undefined && visible(current, box)
        ? currentCard
        : open
          .filter(node => visible(node, box))
          .sort((left, right) => {
            const a = left.getBoundingClientRect()
            const b = right.getBoundingClientRect()
            return Math.abs((a.top + a.bottom) / 2 - middle) - Math.abs((b.top + b.bottom) / 2 - middle)
          })[0]?.getAttribute('data-card') ?? undefined
      if (anchor === undefined) return
      if (pressOnCard(anchor, key)) {
        event.preventDefault()
        if (key === 'v' || key === 'V') setCurrentCard(anchor)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [frame.kind, currentCard])

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
        // 按场所重新挂载：换屋子时不许带着上一间的草稿和回复对象。
        key={frame.placeKey}
        placeKey={frame.placeKey}
        groupName={frame.groupName}
        inject={inject}
        openSession={openSession}
        back={() => { popFrame() }}
        {...(restoreScroll === undefined ? {} : { restoreScroll })}
        {...(frame.newDm === undefined ? {} : { newDm: frame.newDm })}
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
          pushFrame({ kind: 'session' })
          openSession(id)
        }}
        back={() => { popFrame() }}
      />
    )
  }

  if (frame.kind === 'judg') {
    return <YzjJudg inject={inject} back={() => { popFrame() }} />
  }

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
          pushFrame({ kind: 'session' })
          openSession(id)
        }}
        {...(restoreScroll === undefined ? {} : { restoreScroll })}
        back={() => { popFrame() }}
      />
    )
  }

  const alias = window_.aliases?.[0]
  if (sessionId === undefined) {
    return (
      <div className={`${tokens.tokens} ${css.column}`}>
        <div className={css.empty}>
          <AgentFace size={40} />
          <div className={css.emptyTitle}>从左边选一个群或话题</div>
          <div className={css.emptyText}>在群里对 {alias ?? `@${AGENT}`} 说一句话，这里就会长出一个话题。</div>
        </div>
      </div>
    )
  }

  const calling = alias !== undefined && draft.includes(alias)
  const toggleCall = (): void => {
    if (alias === undefined) return
    setDraft(value => (
      value.includes(alias) ? value.split(alias).join('').trimStart() : `${alias} ${value}`.trimEnd()
    ))
    requestAnimationFrame(() => { boxRef.current?.focus() })
  }
  const openPlace = (): void => {
    if (topic === undefined) return
    setFrame({ kind: 'place', placeKey: topic.placeKey, groupName: topic.groupName })
  }

  /* ——— 输入框上方那一格：同一时刻只说一件事 ——— */
  const people = [...new Set(window_.messages.filter(message => !message.own).map(message => message.fromName))]
  const unheard = topic === undefined ? undefined : audienceRiskOf(draft, voice, people)
  const hint: Hint | undefined = pendingNudge !== undefined
    ? { kind: 'draft', about: pendingNudge, drop: () => { setPendingNudge(undefined) } }
    : audienceRisk !== ''
      ? { kind: 'risk', text: audienceRisk }
      : unheard !== undefined
        ? {
          kind: 'risk',
          who: unheard,
          text: `${unheard}听不见这句——只有你和${AGENT}看得见，这件事不会算到${unheard}头上。`,
          fix: { label: direct ? `改为发给${topic?.groupName ?? '对方'}` : '改为发到群里', run: () => { setVoice('place'); boxRef.current?.focus() } },
        }
        : pendingRegister !== undefined && voice === 'place'
          ? { kind: 'register', ...registrationLine(draft, pendingRegister), drop: () => { setPendingRegister(undefined) } }
          : pendingHandoff !== undefined && voice === 'place'
            ? {
              kind: 'register',
              ok: true,
              line: `发出后：这件事转给${pendingHandoff.name ?? '对方'}，原来那条留档。`,
              drop: () => { setPendingHandoff(undefined) },
            }
            : replyTo !== undefined
              ? { kind: 'reply', who: replyTo.who, text: replyTo.text, drop: () => { setReplyTo(undefined) } }
              : pendingGoal !== undefined
                ? {
                  kind: 'context',
                  text: voice === 'place' && !calling
                    ? `带着目标「${pendingGoal.goalName}」——句子里带上 ${alias ?? `@${AGENT}`}，它才会接下、记成承诺。`
                    : `带着目标「${pendingGoal.goalName}」——这句发出去之后，这个话题就挂在它下面。`,
                  drop: () => { setPendingGoal(undefined) },
                }
                : pendingEvent !== undefined
                  ? { kind: 'context', text: `为「${pendingEvent}」准备——只是提示，这个话题不会因此挂到这场会上。`, drop: () => { setPendingEvent(undefined) } }
                  : undefined
  const sendLabel = voice === 'place'
    ? direct ? `发给${topic?.groupName ?? '对方'}` : '发到群里'
    : voice === 'ask'
      ? '快问'
      : unheard !== undefined ? `仍只发给${AGENT}` : `发给${AGENT}`
  const placeholder = voice === 'place'
    ? replyTo === undefined ? direct ? `发给${topic?.groupName ?? '对方'}…` : `发到「${topic?.groupName ?? '群里'}」…` : `回复 ${replyTo.who}…`
    : voice === 'ask'
      ? '问一个数…'
      : running ? `${AGENT}在做，这句会插进去…` : `对${AGENT}说…${window_.privateHint ?? ''}`

  const staleLine = window_.staleReason === undefined ? undefined : plainError(window_.staleReason)
  /** 说明条的后半句：底下摆的是什么。 */
  const staleTail = window_.kept === true ? ' · 下面是上次读到的' : ' · 下面只有本地记下的内容'
  const answeredRefs = new Set(staged.map(entry => `${entry.kind}:${entry.id}`))
  const nextNeed = needs.find(need => (
    !answeredRefs.has(`${need.ref.kind}:${need.ref.id}`) && `${need.ref.kind}:${need.ref.id}` !== justAnswered
  ))

  return (
    <div className={`${tokens.tokens} ${css.column}`}>
      <header className={css.head}>
        {back !== undefined && (
          <>
            <button
              type="button"
              className={css.back}
              title="回到上一屏离开时的位置（Esc）"
              onClick={goBack}
            >
              <Icon name="chevL" size={14} />{backLabel(back)}
            </button>
            <span className={css.headRule} />
          </>
        )}
        <div className={css.crumbs}>
          {topic === undefined
            ? <span className={css.crumbLocal}><Icon name="local" size={14} />本地</span>
            : (
              <button type="button" className={css.crumb} title="到群里看全部" onClick={openPlace}>
                <Icon name={topic.conversationKind === 'direct' ? 'users' : 'hash'} size={14} />{topic.groupName}
              </button>
            )}
          <span className={css.slash}>/</span>
          <span className={css.title}>{topic?.label ?? '这个会话'}</span>
          {window_.goalContext !== undefined && (
            <span className={css.goal} title="在这里登记的承诺会挂在这个目标下">
              <Icon name="target" size={12} />{window_.goalContext.goalName ?? '一个目标'}
            </span>
          )}
        </div>
        <button
          type="button"
          className={css.agent}
          title={topic === undefined ? undefined : `${AGENT}在这里的规则`}
          disabled={topic === undefined}
          onClick={() => { setRulesOpen(true) }}
        >
          {running ? <span className={`${css.spin} ${stalled ? css.spinStall : ''}`} /> : <span className={css.onDot} />}
          {running ? stalled ? `${AGENT}可能卡住了` : `${AGENT}在做` : `${AGENT}在岗`}
        </button>
        <div className={css.moreWrap} ref={menuRef}>
          <button
            type="button"
            className={css.more}
            aria-label="更多"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            <Icon name="more" size={16} />
          </button>
          {menuOpen && (
            <div className={css.menu} role="menu">
              {topic !== undefined && (
                <button type="button" role="menuitem" className={css.menuItem} onClick={() => { setRulesOpen(true); setMenuOpen(false) }}>
                  <AgentFace size={16} />{AGENT}在这里的规则
                </button>
              )}
              <button type="button" role="menuitem" className={css.menuItem} onClick={() => { setTraceOpen(true); setMenuOpen(false) }}>
                <Icon name="steps" size={16} />完整过程
              </button>
              <button type="button" role="menuitem" className={css.menuItem} onClick={() => { showTree(); setMenuOpen(false) }}>
                <Icon name="list" size={16} />别的话题
              </button>
              {window_.goalContext !== undefined && (
                <button
                  type="button"
                  role="menuitem"
                  className={css.menuItem}
                  title="让这个话题不再挂在这个目标下——不挂也是合法的"
                  onClick={() => {
                    setMenuOpen(false)
                    void inject.armTopicGoal(sessionId).then((result) => {
                      if (result.error !== undefined) say(result.error)
                      void refresh()
                    })
                  }}
                >
                  <Icon name="x" size={16} />不再挂在「{window_.goalContext.goalName ?? '这个目标'}」下
                </button>
              )}
              {model.model !== undefined && (
                <div className={css.menuNote}>用的模型：{model.model} · 在左下角「设置」里改</div>
              )}
            </div>
          )}
        </div>
      </header>

      {tree.open && (
        <div className={css.treePop} onClick={closeTree}>
          <div className={css.treeBox} role="dialog" aria-label="所有话题" onClick={(event) => { event.stopPropagation() }}>
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
                      closeTree()
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

      {unread && <UnreadLine had={window_ !== EMPTY} className={css.stale} />}
      {!unread && staleLine !== undefined && (
        <div className={css.stale} title={window_.staleReason}>
          {staleLine.text}{staleLine.retrying ? '，稍后自动重试' : ''}{staleTail}
        </div>
      )}

      <div
        className={css.stream}
        {...{ [FRAME_SCROLL]: '' }}
        ref={streamRef}
        onScroll={(event) => {
          const node = event.currentTarget
          atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60
        }}
      >
        {/* 决断指针 (律二)：等你的卡滚出视野时才浮出来指路。 */}
        <YzjDecisionPointer cards={window_.cards} stream={streamRef} jumpTo={jumpToCard} />
        {rows.length === 0 && <div className={css.calm}>这个话题还没有内容。</div>}
        <StreamRows
          rows={rows}
          context={{
            now: tick,
            hasPlace: topic !== undefined,
            directWith: direct ? topic?.groupName : undefined,
            inject,
            sessionId,
            openWork,
            toggleWork: (key: string) => {
              setOpenWork(value => ({ ...value, [key]: !(value[key] ?? rows.some(row => row.key === key && row.kind === 'work' && row.state === 'running')) }))
            },
            openTrace: () => { setTraceOpen(true) },
            forward: (text: string) => { setForwarding(text) },
            replyTo: (msgId, who, text) => {
              setReplyTo({ msgId, who, text: clip(text) })
              setVoice('place')
              // 回复 = 挂链；交给云小助 = 挂链 + 受话。选了前者就摘掉后者那半。
              for (const word of window_.aliases ?? []) {
                setDraft(value => value.split(word).join('').trimStart())
              }
              requestAnimationFrame(() => { boxRef.current?.focus() })
            },
            askAgentAbout: (msgId, who, text) => {
              setReplyTo({ msgId, who, text: clip(text) })
              setVoice('place')
              // 摆在框里，不藏：删掉 @ 就降级成一句普通的回复。
              if (alias !== undefined) {
                setDraft(value => (value.includes(alias) ? value : `${alias} ${value}`.trim()))
              }
              requestAnimationFrame(() => { boxRef.current?.focus() })
            },
            pledgeOn: (handle: string) => {
              setReplyTo(undefined)
              setVoice('private')
              setDraft(`押 ${handle}：`)
              requestAnimationFrame(() => { boxRef.current?.focus() })
            },
            jumpTo: (msgId: string) => {
              const node = [...(streamRef.current?.querySelectorAll('[data-msg]') ?? [])]
                .find(candidate => candidate.getAttribute('data-msg') === msgId)
              if (node === undefined) {
                setToast('被回复的那条不在这一屏里——它在更早的历史里，或者不在这个话题。')
                return
              }
              node.scrollIntoView({ block: 'center', behavior: 'smooth' })
              flash(node)
            },
            openPlace,
            publish: (text: string) => {
              setBusy(true)
              void inject.sendToPlace(sessionId, text).then((result) => {
                setBusy(false)
                if (result.error !== undefined) say(result.error)
                else setToast(direct ? `已以你的名义发给${topic?.groupName ?? '对方'}。` : `已以你的名义发到「${topic?.groupName ?? '群里'}」。`)
                void refresh()
              })
            },
            answer: answerCard,
            currentCard,
            setCurrentCard,
            justAnswered,
            nextNeed,
            proposeRule,
            quietFor,
            retryStep: () => {
              void prompt(sessionId, RETRY_STEP, 'steer').then((error) => {
                setToast(error === undefined ? `已经让${AGENT}重试这一步。` : plainError(error).text)
              })
            },
            stop: () => {
              if (cancel === undefined) { setToast('这个会话停不下来——宿主没有给停止的动词。'); return }
              void cancel(sessionId).then((error) => {
                setToast(error === undefined ? '停下了。排着队的话还在，会接着做。' : plainError(error).text)
              })
            },
          }}
        />
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
          title={topic === undefined ? '本地会话' : `${topic.groupName} / ${topic.label}`}
          close={() => { setTraceOpen(false) }}
        />
      )}

      {rulesOpen && topic !== undefined && (
        <YzjContractPanel
          placeKey={topic.placeKey}
          inject={inject}
          close={() => { setRulesOpen(false) }}
        />
      )}

      {toast !== '' && <div className={css.toast} role="status">{toast}</div>}

      <Composer
        voice={voice}
        voices={topic === undefined ? ['private'] : ['private', 'place', 'ask']}
        setVoice={setVoice}
        placeName={topic?.groupName}
        direct={direct}
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        send={send}
        boxRef={boxRef}
        hint={hint}
        sendLabel={sendLabel}
        placeholder={placeholder}
        tools={(
          <>
            <EmojiButton insert={insert} />
            {/* @ 某人只在群里有意义——私下 @ 谁，谁都听不见。 */}
            {voice === 'place' && <MentionPicker inject={inject} insert={insert} />}
            {alias !== undefined && voice === 'place' && (
              <button
                type="button"
                className={`${composerCss.tool} ${calling ? composerCss.toolOn : ''}`}
                title={`把 ${alias} 加进这句——${AGENT}才会接`}
                onClick={toggleCall}
              >
                <Icon name="at" size={14} />叫上{AGENT}
              </button>
            )}
          </>
        )}
      />
    </div>
  )
}
