/**
 * 群视图 (§7.3) — the place seen whole, one zoom level out from a topic.
 *
 * The main thread with the topics that were born in it rendered INLINE, at the
 * message each one grew from. That placement is the whole idea: a topic is not
 * a folder somebody filed a conversation into, it is a branch that grew at a
 * particular sentence, and this is the only view where you can still see the
 * sentence it grew from.
 *
 * Hot card = something in that topic still wants attention (its status badge
 * says which). Cold card = a permanent address for finished work — the design
 * calls it the archived topic's home, and an archive you cannot walk back into
 * is a delete with extra steps.
 *
 * **It has a composer, and that is the point.** An earlier version of this file
 * argued that a place is not a conversation with an agent, so it needed no way
 * to write — which rebuilt, exactly, the complaint that produced v4.6:
 * 「群里发不了普通消息/回复不了别人」. A place IS a conversation; it is a
 * conversation between PEOPLE, and 委派是对话的特例，不是对话的全部. Rendering
 * the room while refusing to let anybody speak in it is carrying over half an
 * IM idiom and calling it a product.
 *
 * So: 发到主楼 by default, ↩ to hang on somebody's message, ⚡@agent to hang and
 * address in one gesture. The anchor bar shows which of those is in force
 * before the send key is pressed.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clockOf, dayLabel } from './stream.ts'
import { Avatar } from './Avatar.tsx'
import { FRAME_SCROLL, backLabel, backTarget, landOn, pushFrame, replaceFrame, takeErrand } from './store.ts'
import { YzjContractPanel } from './ContractPanel.tsx'
import { CopyButton, EmojiButton, ForwardPicker } from './Compose.tsx'
import { Composer, registrationLine, type Hint } from './Composer.tsx'
import { Icon } from './icons.tsx'
import { AGENT, plainError } from './words.ts'
import composerCss from './composer.module.css'
import { Attachments, isPlaceholderOnly, withoutImageMarks } from './Attachments.tsx'
import type { PlaceViewWire, SurfaceInject, TopicMessageWire } from './rpc.ts'
import { useBackKey } from './keys.ts'
import { keepLastMessages, usePoll } from './poll.ts'
import { UnreadLine } from './Unread.tsx'
import tokens from './tokens.module.css'
import css from './place.module.css'

export interface PlaceViewProps {
  placeKey: string
  groupName: string
  inject: SurfaceInject
  openSession(sessionId: string): void
  back(): void
  /** Scroll position to restore — the pixel the reader left this view at. */
  restoreScroll?: number
  /**
   * 这个私聊**还不存在** —— 这一屏是它出生前的样子 (v4.24 场所选项集).
   *
   * 云之家的私聊没有「创建」动作：它的出生就是第一句话。所以这里没有 `placeKey` 可读、
   * 没有历史可拉，输入框走的也是另一条出站（按 openId 发，落点由平台在回包里给）。
   */
  newDm?: { openId: string; name: string }
}

type Filter = 'all' | 'topics'

const EMPTY: PlaceViewWire = { placeKey: '', groupName: '', messages: [], topics: [], aliases: [] }

export function YzjPlaceView(props: PlaceViewProps): ReactNode {
  const { placeKey, groupName, inject, openSession, back, restoreScroll, newDm } = props
  useBackKey(back)
  const [view, setView] = useState<PlaceViewWire & { kept?: true }>(EMPTY)
  /** 上一次整个没读到（连工作台都没答）。读不到 ≠ 这个群没有话。 */
  const [unread, setUnread] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [earlierOpen, setEarlierOpen] = useState(false)
  /** Topic cards the reader asked to peek into (D13③: 展开是手势不是默认). */
  const [peeked, setPeeked] = useState<Record<string, string[]>>({})
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLTextAreaElement | null>(null)
  /** Whether this room has already been scrolled to its newest message. */
  const landed = useRef(false)

  /**
   * 挂链之后，光标就该在输入框里.
   *
   * 「回复」是一个动词，它的下一步永远是打字。让人再点一次输入框，是把一个动作
   * 拆成两个。
   */
  const anchor = useCallback((
    to: { msgId: string; who: string; text: string; agent?: boolean },
  ): void => {
    setReplyTo(to)
    // After the state lands, so the box exists and is not about to re-render.
    requestAnimationFrame(() => { boxRef.current?.focus() })
  }, [])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  /**
   * 未接单的出生故事 (v4.8).
   *
   * The agent answers only where the deployment put it on duty. Addressing it
   * anywhere else is refused BEFORE the send, and refusing without saying why
   * is how a product teaches people that it randomly does nothing — so the
   * refusal carries the reason, the way into the place contract, and the door
   * out (send it as an ordinary message to colleagues).
   */
  const [notOnDuty, setNotOnDuty] = useState(false)
  const [contractOpen, setContractOpen] = useState(false)
  /** The message being passed on, while the target picker is open. */
  const [forwarding, setForwarding] = useState<string | undefined>(undefined)

  /**
   * 跳到被回复的那条.
   *
   * A quote you cannot follow is a label. When the original has scrolled out
   * of the loaded window there is nothing to jump to, and saying that is
   * better than a click that silently does nothing.
   */
  const [flash, setFlash] = useState<string | undefined>(undefined)
  const jumpTo = useCallback((msgId: string): void => {
    const node = bodyRef.current?.querySelector(`[data-msg="${msgId}"]`)
    if (node === null || node === undefined) {
      setToast('原消息不在这一屏里——它在更早的历史里。')
      return
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(msgId)
    setTimeout(() => { setFlash(undefined) }, 1_600)
  }, [])

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

  /**
   * 受话 —— 叫上 agent，一个键.
   *
   * 落点 has had a visible control since the anchor bar landed; 受话 is the
   * sibling question in the same four (D13④) and had none — the only way to
   * address the agent on a NEW message was to remember the trigger word and
   * type it. It toggles rather than appends, so pressing it twice is an undo.
   */
  const alias = view.aliases?.[0]
  const calling = alias !== undefined && draft.includes(alias)
  const toggleCall = useCallback((): void => {
    if (alias === undefined) return
    setDraft(value => (
      value.includes(alias) ? value.split(alias).join('').trimStart() : `${alias} ${value}`.trimEnd()
    ))
    requestAnimationFrame(() => { boxRef.current?.focus() })
  }, [alias])
  /** 落点: undefined = 主楼; set = hang this send on that message's chain. */
  const [replyTo, setReplyTo] = useState<
    { msgId: string; who: string; text: string; agent?: boolean } | undefined
  >(undefined)

  useEffect(() => {
    if (toast === '') return undefined
    const timer = setTimeout(() => { setToast('') }, 6_000)
    return () => { clearTimeout(timer) }
  }, [toast])



  /*
    私语流画哪些 —— 未答的，**加上刚答完的那一张**。

    刚答完那一张留下来，是因为它带着合环行：判断刚出炉、动机最热的那一刻在这里
    （断言⑳ 入口不垄断）。服务端只给最近答完的一张挂合环行，所以这里不会堆积——
    这一刀在 desk 那一侧，两个客户端读的是同一个决定。
  */

  /**
   * Enter a topic, remembering where we were.
   *
   * Back must return to the pixel, not to the top: a reader who scrolled far
   * into a busy group and opened one topic has lost their place otherwise —
   * which is the whole complaint D13② names.
   */
  /** 卡上写着「等你验收」的，进门落在那张卡上，不落在话题末尾。 */
  const enter = useCallback((sessionId: string, cardRef?: { kind: string; id: string }): void => {
    landOn(cardRef === undefined ? undefined : { sessionId, ...cardRef })
    pushFrame({ kind: 'session' }, bodyRef.current?.scrollTop ?? 0)
    openSession(sessionId)
  }, [openSession])

  /** Peek at a topic's tail without leaving the room. */
  const peek = useCallback((topicKey: string, sessionId: string): void => {
    if (peeked[topicKey] !== undefined) {
      setPeeked(({ [topicKey]: _dropped, ...rest }) => rest)
      return
    }
    void inject.topicTail(sessionId).then((tail) => {
      setPeeked(value => ({ ...value, [topicKey]: tail }))
    })
  }, [inject, peeked])

  const refresh = useCallback(async (): Promise<void> => {
    // 还没出生的私聊没有历史可拉——问一个不存在的 placeKey 只会拿回一次失败。
    if (newDm !== undefined) return
    const next = await inject.place(placeKey)
    setUnread(next === undefined)
    // 整个没读到：留着屏上的；从没读到过，就是一个只有名字的空屋加那一句。
    if (next === undefined) {
      setView(current => (current.placeKey === placeKey ? current : { ...EMPTY, placeKey, groupName }))
      return
    }
    setView(current => keepLastMessages(current.placeKey === placeKey ? current : undefined, next))
  }, [inject, placeKey, groupName, newDm])

  /*
    待建私聊也要知道触发词。

    受话是「这句话说给 agent 听」的那半边，而它的字面来自部署（`@next` / `@云小助`）。
    场所视图平时从 `place` 那一趟顺回来，这条路没有那一趟——不补一次，从传送门带过来的
    受话会静静地丢掉，那句委派落进新私聊时没有人在听。
  */
  useEffect(() => {
    if (newDm === undefined) return
    void inject.inbox().then((view_) => {
      setView(current => ({ ...current, groupName: newDm.name, aliases: view_?.aliases ?? [] }))
    })
  }, [inject, newDm])

  usePoll(refresh)

  /**
   * 传送门带过来的那件差事 —— **主楼也是落点** (v4.24 场所选项集).
   *
   * 这一屏此前不认识 errand，于是「委派到这个群」这条路整个走不通：人被送进屋子，
   * 输入框却是空的，选执行者时定下的登记先验也一起丢了——那句话发出去只是一句普通
   * 消息，板上不长行。**话题是委派的产物**，所以委派的落点本来就常常是一间还没有
   * 任何话题的屋子；接得住它的只能是这里。
   *
   * 和会话那一侧同一条纪律：不覆盖没发完的话（草稿是操作者的），受话等触发词到齐了
   * 再补（那时才知道这个部署的 agent 叫什么）。
   */
  const [pendingGoal, setPendingGoal] = useState<
    { goalRef: string; goalName: string } | undefined
  >(undefined)
  const [pendingCall, setPendingCall] = useState<string | undefined>(undefined)
  /** 催：带着一份拟好的稿，不装载语境，也不另记一条。 */
  const [pendingNudge, setPendingNudge] = useState<string | undefined>(undefined)
  const [pendingRegister, setPendingRegister] = useState<
    { openId: string; name: string; parentCommitmentId?: string } | undefined
  >(undefined)
  /**
   * 这一句是**那条边的重新签发** —— 移交先验（决策 #59）。
   *
   * 和登记先验并排而不是共用：登记让一条新的活出生，移交是一条已有的活换边（还要把旧边
   * 转进吸收态、往旧场所落一帖解除告知）。挤进同一格，第一次改动就会有一边带跑另一边。
   */
  const [pendingHandoff, setPendingHandoff] = useState<
    { fromCommitmentId: string; openId: string; name?: string } | undefined
  >(undefined)
  /**
   * **最小听众不变量**的警示 —— 听众可能少了执行者那一头 (v4.24 决策 #58).
   *
   * 选场所那一屏算过「他在这个群里有过登记吗」；答不了「他在不在」（平台不给成员名单）。
   * 这句话必须活到**发送键跟前**：一条群里其他人以为说好了、而当事人一个字没听见的
   * 承诺，从出生起听众就不完整。
   *
   * **不拦**——选一个他可能不在的群是合法的社交选择（拉人／改场所／照发都由人定）。
   */
  const [audienceRisk, setAudienceRisk] = useState('')
  useEffect(() => {
    const errand = takeErrand()
    if (errand === undefined) return
    const opening = errand.seed ?? ''
    if (opening !== '') {
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
    // 一场会不装载语境：会的 id 当成 goalRef 会把目标图污染掉（和会话那一侧同源）。
    if (errand.subject === 'goal' && errand.goalRef !== '') {
      setPendingGoal({ goalRef: errand.goalRef, goalName: errand.goalName })
    }
    setPendingNudge(errand.subject === 'nudge' ? errand.goalName : undefined)
  }, [placeKey])

  /*
    受话补在**输入框里**，看得见、删得掉——删掉就降级成一句普通的话。

    等 `aliases` 到齐再补：刚跳进来时这一屏还没读回它的场所，`view.aliases` 是空的，
    这一拍直接拼会把受话静静地丢掉（会话那一侧踩过同一个坑）。
  */
  useEffect(() => {
    if (pendingCall === undefined || alias === undefined) return
    setDraft(current => (current === pendingCall ? `${alias} ${current}`.trimEnd() : current))
    setPendingCall(undefined)
  }, [pendingCall, alias])

  /*
    Where a room opens.

    Restoring a remembered pixel wins — that is Back's whole promise. Otherwise
    the room opens at its NEWEST message, because that is what opening a
    conversation means everywhere else; landing in history is landing in the
    middle of something that has already been read.

    `landed` makes it once per room: after that the reader owns the scroll, and
    a six-second poll that yanked them back to the bottom would make the view
    unusable for reading anything older.
  */
  useEffect(() => {
    const node = bodyRef.current
    if (node === null || view.messages.length === 0 || landed.current) return
    landed.current = true
    node.scrollTop = restoreScroll ?? node.scrollHeight
  }, [restoreScroll, view.messages.length])

  /**
   * The thread with each topic laid over the message it grew from.
   *
   * A root message becomes its topic's card rather than sitting beside one:
   * showing both would say the sentence and the branch are two things, and the
   * entire claim of this view is that they are one.
   */
  /**
   * The topic a quoted message belongs to, when its chain has become one.
   *
   * A reply chain is the embryo of a topic (v4.7): the moment somebody
   * addresses the agent on it, the whole chain is taken up as a topic and the
   * group timeline keeps showing only the root. So a quote is often the visible
   * tip of a conversation that already has a window — and there was no way to
   * walk from the tip into the window.
   */
  const topicOfQuote = useCallback((message: TopicMessageWire): string | undefined => {
    const root = message.chainRootId ?? message.replyToId
    if (root === undefined) return undefined
    return view.topics.find(topic => topic.topicRootId === root)?.sessionId
  }, [view.topics])

  const rows = useMemo(() => {
    const byRoot = new Map(view.topics.map(topic => [topic.topicRootId, topic]))
    const out: (
      | { kind: 'message'; key: string; message: PlaceViewWire['messages'][number] }
      | { kind: 'topic'; key: string; topic: PlaceViewWire['topics'][number]; time: number }
      | { kind: 'day'; key: string; label: string }
    )[] = []
    /*
      The divider is decided when the day's first VISIBLE row is emitted.

      Pushing it before the `continue` below produced orphan dividers: a day
      whose messages were all chain replies folded into an already-carded
      topic rendered its date with nothing under it — the room claiming a day
      of silence while that day's traffic sat inside a card filed under an
      earlier date.
    */
    let lastDay = ''
    let pendingDay: string | undefined
    const openDay = (): void => {
      if (pendingDay === undefined) return
      out.push({ kind: 'day', key: `d:${pendingDay}`, label: pendingDay })
      pendingDay = undefined
    }
    for (const message of view.messages) {
      const day = dayLabel(message.time)
      if (day !== '' && day !== lastDay) {
        lastDay = day
        pendingDay = day
      }
      const topic = byRoot.get(message.msgId)
      if (topic !== undefined) {
        // 热链收纳: the chain that ignited is drawn ONCE, as a card, in the
        // place its root message occupied.
        openDay()
        out.push({ kind: 'topic', key: `t:${topic.topicKey}`, topic, time: message.time })
        continue
      }
      // …and the rest of that chain is inside the card, so it does not also
      // sit in the thread. Drawing both would say the chain and the topic are
      // two things; the whole claim of 收纳 is that they are one.
      if (message.chainRootId !== undefined && byRoot.has(message.chainRootId)) continue
      // 冷链平铺: a human-human chain stays flat in the main thread with its
      // quote line, exactly as Yunzhijia and WeChat draw it. One 「收到」 must
      // not restructure the room, and a pure human chain does not even earn a
      // card (§7.3 补充裁决).
      openDay()
      out.push({ kind: 'message', key: `m:${message.msgId}`, message })
    }
    return filter === 'topics' ? out.filter(row => row.kind === 'topic') : out
  }, [view, filter])

  /**
   * Topics whose root has scrolled out of the window.
   *
   * They still need an address — the design calls a cold card the archived
   * topic's permanent home — but they must not be dumped inline. The first
   * version pushed them to the top of the thread, and a place with thirteen
   * topics rendered thirteen cards above one visible sentence: the group view
   * stopped being the room and became a list of doors out of it. So they live
   * in a strip that is collapsed by default.
   */
  const earlier = useMemo(() => {
    const inWindow = new Set(rows.filter(row => row.kind === 'topic').map(row => row.topic.topicKey))
    return view.topics.filter(topic => !inWindow.has(topic.topicKey))
  }, [rows, view.topics])

  const hot = view.topics.filter(topic => topic.hot).length
  /*
    受话判定，用通道自己的别名，而不是「有没有 @」.

    `@张三 明天有空吗` 是在跟同事说话，不是委派。用一个 `@` 的正则去预告
    「将长出一个新话题」，是在按下之前就许一个服务端不会兑现的诺。
  */
  const aliases = view.aliases ?? []
  /*
    显式叫了人的回复不算向 agent 受话（v4.7 澄清，与通道 `mentionsPeopleInText` 同一条
    规则）：草稿里剥掉触发词后还有 `@某人`，这句话是说给那个人的，锚定条不该预告点火。
  */
  const mentionsPeople = /(?<![\p{L}\p{N}_.-])[@＠][^\s@＠]+/u
    .test(aliases.reduce((rest, alias) => rest.split(alias).join(' '), draft))
  const addressed = aliases.some(alias => draft.includes(alias))
    || (replyTo !== undefined && replyTo.agent === true && !mentionsPeople)
  /** 私聊：听众是一个人。图标、听众标签、发送键都说「发给李婷」，不说「发到群里」。 */
  const direct = newDm !== undefined || view.kind === 'direct'
  const roomName = newDm?.name ?? (view.groupName || groupName)
  /** 本实例不在岗时，观察到的对群在岗的同侪实例——锚定条与发送键都按它说话。 */
  const peerOnDuty = view.presence?.peers[0]

  /**
   * 说出口了，语境才装载 (v4.9) —— 和会话那一侧一字不差。
   *
   * 主楼委派点着之后长出来的是一个**新话题**，而那个话题该继承这个目标：否则「委派
   * 带着目标语境」和「委派可以落在主楼」两件各自正确的事合起来会撒谎——板上那条承诺
   * 挂着目标，它在跑的那个话题却什么都不继承，后面在那儿登记的第二条活就挂不上了。
   */
  /**
   * @returns 有话要说时的那句话；`undefined` 表示按常规回执报就行。
   *
   * **不自己 setToast**：调用方在这之后还要报一次「已发出」，两个人抢同一行字，后写
   * 的那个赢——而后写的恰好是最没信息量的那句。谁说话由一处决定。
   */
  const armBorn = async (sessionId: string | undefined): Promise<string | undefined> => {
    if (pendingGoal === undefined) return undefined
    /*
      **没长出话题就没有东西可挂** —— 说一次，然后把 chip 收起来。

      主楼那一句如果没点着 agent（没带受话），它不会生出话题，于是「话题继承这个目标」
      这件事此刻没有落点。留着那枚 chip 会一直显示成「带着目标」，而它已经不带任何人
      去任何地方了——下一句无关的话还会继续带着它。承诺那一半没有丢：登记先验里的
      goalRef 已经跟着这条承诺进了图。
    */
    if (sessionId === undefined) {
      setPendingGoal(undefined)
      return pendingRegister === undefined
        ? `已发出。这一句没叫上${AGENT}，没有长出话题，目标这次没挂上。`
        : `已发出。那条承诺挂在这个目标下；这一句没叫上${AGENT}，所以没有长出话题。`
    }
    const armed = await inject.armTopicGoal(sessionId, pendingGoal.goalRef, pendingGoal.goalName)
    if (armed.error !== undefined) {
      return `话已经发出去了，但新长出来的话题没能挂到目标上：${armed.error}`
    }
    setPendingGoal(undefined)
    return undefined
  }

  const settle = (result: {
    error?: string; refused?: string; ignited?: boolean; sessionId?: string
    toCommitmentId?: string; note?: string
    deferredTo?: { openId: string; name: string }
  }): void => {
    if (result.refused === 'not-on-duty') {
      // Nothing was sent. 人看人发不受限制,但在没接单的场所 @ agent 会在同事
      // 面前留下一个永远不会有人应答的 @ —— 那比在这里说清楚糟得多。
      setNotOnDuty(true)
    } else if (result.deferredTo !== undefined) {
      /*
        桌面出站对称 (决策 #63)：话发出去了，本实例没点火——本群在岗的是同侪实例，
        将由它接单。这不是失败，是「谁接」这个问题的另一个答案。
      */
      setDraft('')
      setReplyTo(undefined)
      setPendingRegister(undefined)
      setPendingHandoff(undefined)
      setAudienceRisk('')
      setToast(`已发出。这个群在岗的是 ${result.deferredTo.name}，这句会由它接。`)
    } else if (result.error !== undefined) setToast(plainError(result.error).text)
    else {
      setDraft('')
      setReplyTo(undefined)
      setPendingNudge(undefined)
      // 说出口了，这次先验就用掉了——下一句话是新的一句话。
      setPendingRegister(undefined)
      setPendingHandoff(undefined)
      setAudienceRisk('')
      void armBorn(result.sessionId).then((note) => {
        /*
          移交那一头**自己会说话**：解除告知落没落上、主权对不对、是不是「什么都没改」。
          它比「已发到群里」具体，所以它先说；`armBorn` 那句次之，通用回执垫底。
        */
        setToast(result.note ?? note ?? (result.toCommitmentId !== undefined
          ? '转好了：新的一条从这句话算起。'
          : result.ignited === true
            ? '已发出，正在长出一个话题。'
            : direct ? `已发给${roomName}。` : '已发到群里。'))
      })
    }
    setBusy(false)
    void refresh()
  }

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    setBusy(true)
    /*
      **登记先验跟着这句话一起走** (v3.15 裁决④).

      选执行者的那一下已经把「这句是登记别人的承诺」定下来了，不必等群里跑一次 turn。
      发送成功才落库：发不出去的委派不该在板上长出一条谁都没听说过的承诺。
    */
    const register = pendingRegister === undefined
      ? undefined
      : {
        ...pendingRegister,
        ...(pendingGoal === undefined ? {} : { goalRef: pendingGoal.goalRef }),
      }
    if (newDm !== undefined) {
      void inject.sendToPerson(newDm.openId, text, register, pendingHandoff).then((result) => {
        if (result.error === undefined && result.placeKey !== undefined) {
          /*
            私聊出生了 —— 从占位切到真的那间屋子。

            `setFrame` 而不是 push：待建态不是一个人会想「返回」到的地方，它已经变成
            了这间屋子本身。
          */
          const born = result.placeKey
          void armBorn(result.sessionId)
          setPendingRegister(undefined)
          setDraft('')
          setBusy(false)
          replaceFrame({ kind: 'place', placeKey: born, groupName: newDm.name })
          return
        }
        settle(result)
      })
      return
    }
    void inject.sendInPlace(placeKey, text, replyTo?.msgId, register, pendingHandoff).then(settle)
  }

  /* ——— 输入框上方那一格：同一时刻只说一件事（§5.3） ——— */
  const hint: Hint | undefined = pendingNudge !== undefined
    ? { kind: 'draft', about: pendingNudge, drop: () => { setPendingNudge(undefined) } }
    : audienceRisk !== ''
      ? { kind: 'risk', text: audienceRisk }
      : pendingRegister !== undefined
        ? { kind: 'register', ...registrationLine(draft, pendingRegister), drop: () => { setPendingRegister(undefined) } }
        : pendingHandoff !== undefined
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
                text: addressed
                  ? `带着目标「${pendingGoal.goalName}」——新长出来的话题会挂在它下面。`
                  : `带着目标「${pendingGoal.goalName}」——句子里带上 ${alias ?? `@${AGENT}`}，它才会接下、记成承诺。`,
                drop: () => { setPendingGoal(undefined) },
              }
              : addressed
                // 点火预告——和它的反面。没接单的群里同一个手势结果相反，得在按下之前说。
                ? view.onDuty === false
                  ? peerOnDuty === undefined
                    ? { kind: 'note', warn: true, text: `${AGENT}没接这个群，@ 它不会有人应。` }
                    : { kind: 'note', text: `这个群在岗的是 ${peerOnDuty.name}，这句会由它接。` }
                  : { kind: 'note', text: replyTo === undefined ? '发出去会长出一个新话题。' : '这一串会收成一个话题。' }
                : undefined

  return (
    <div className={`${tokens.tokens} ${css.place}`}>
      <header className={css.head}>
        <button type="button" className={css.back} onClick={back}>
          <Icon name="chevL" size={14} />{backLabel(backTarget() ?? { kind: 'session' })}
        </button>
        <span className={css.headRule} />
        <span className={css.icon}><Icon name={newDm !== undefined || view.kind === 'direct' ? 'user' : 'hash'} size={16} /></span>
        <span className={css.title}>{view.groupName || groupName}</span>
        <span className={css.sub}>
          {newDm === undefined
            ? `${String(view.topics.length)} 个话题${hot > 0 ? ` · ${String(hot)} 个在办` : ''}`
            : '还没有过私聊'}
        </span>
        <span className={css.filters}>
          {(['all', 'topics'] as const).map(value => (
            <button
              type="button"
              key={value}
              className={`${css.filter} ${filter === value ? css.filterOn : ''}`}
              onClick={() => { setFilter(value) }}
            >
              {value === 'all' ? '全部' : '只看话题'}
            </button>
          ))}
        </span>
        {/* 云小助在这里能做什么——这个问题随时会冒出来，所以门常驻在屋子自己的头上。 */}
        <button
          type="button"
          className={`${css.rules} ${view.onDuty === false ? css.rulesOff : ''}`}
          onClick={() => { setContractOpen(true) }}
        >
          {view.onDuty === false ? `${AGENT}没接这个群` : `${AGENT}在这里的规则`}
        </button>
      </header>

      {unread && <UnreadLine had={view.placeKey === placeKey} className={css.stale} />}
      {!unread && view.staleReason !== undefined && (
        <div className={css.stale} title={view.staleReason}>
          {plainError(view.staleReason).text}
          {view.withheld !== true && (
            <>
              {plainError(view.staleReason).retrying ? '，稍后自动重试' : ''}
              {view.kept === true ? ' · 下面是上次读到的' : ' · 下面只有已知的话题'}
            </>
          )}
        </div>
      )}

      <div className={css.body} ref={bodyRef} {...{ [FRAME_SCROLL]: '' }}>
        {/*
          私语通道的两位新住客 —— 立约邀约与校准回执 (私账层 §7).

          **零新 surface**：磨稿在工作夹、轻问在各会话、立约与对表在这儿，同为私语侧。
          它们排在消息之上，因为它们等的是一个判断而不是一次阅读——但它们**不进任何
          聚合**：左栏的计数不会因为它们变化，现在就可以核对。

          未答的静躺在这里：不老化、不可催、不成欠账。
        */}
        {earlier.length > 0 && (
          <div className={css.earlier}>
            <button
              type="button"
              className={css.earlierHead}
              onClick={() => { setEarlierOpen(value => !value) }}
            >
              <Icon name="chevR" size={12} className={`${css.earlierTwist} ${earlierOpen ? css.earlierOpen : ''}`} />
              更早的话题 · {earlier.length}
            </button>
            {earlierOpen && earlier.map(topic => (
              <button
                type="button"
                key={topic.topicKey}
                className={css.earlierItem}
                onClick={() => { enter(topic.sessionId, topic.cardRef) }}
              >
                <Icon name="steps" size={14} className={css.threadIcon} />
                <span className={css.topicTitle}>{topic.label}</span>
                <TopicSignal topic={topic} />
              </button>
            ))}
          </div>
        )}

        {rows.length === 0 && newDm !== undefined && (
          <div className={css.calm}>
            你和 <b>{newDm.name}</b> 还没有过私聊。下面这一句发出去，私聊就有了。
          </div>
        )}
        {rows.length === 0 && newDm === undefined && (
          <div className={css.calm}>
            这个群还没有内容。在群里对 {view.aliases?.[0] ?? `@${AGENT}`} 说一句话，这里会长出一个话题。
          </div>
        )}

        {rows.map((row) => {
          // 日期分隔：一条只写 HH:mm 的时间线说不出是哪天。
          if (row.kind === 'day') {
            return <div className={css.day} key={row.key}><span>{row.label}</span></div>
          }
          if (row.kind === 'topic') {
            return (
              <div className={css.topicWrap} key={row.key}>
              <button
                type="button"
                className={css.topicCard}
                onClick={() => { enter(row.topic.sessionId, row.topic.cardRef) }}
              >
                <Icon name="steps" size={14} className={css.threadIcon} />
                <span className={css.topicTitle}>{row.topic.label}</span>
                <TopicSignal topic={row.topic} />
                <Icon name="chevR" size={14} className={css.arrow} />
              </button>
              {/* 就地展开 (D13③): a gesture, never the default render. */}
              <button
                type="button"
                className={`${css.peek} ${peeked[row.topic.topicKey] === undefined ? '' : css.peekOpen}`}
                onClick={() => { peek(row.topic.topicKey, row.topic.sessionId) }}
              >
                {peeked[row.topic.topicKey] === undefined ? '看最后几条' : '收起'}
              </button>
              {peeked[row.topic.topicKey] !== undefined && (
                <div className={css.peekBody}>
                  {(peeked[row.topic.topicKey] ?? []).length === 0
                    ? <span className={css.peekLine}>这个话题里还没有消息。</span>
                    : (peeked[row.topic.topicKey] ?? []).map((line, at) => (
                      <span className={css.peekLine} key={`${row.key}:p${String(at)}`}>{line}</span>
                    ))}
                </div>
              )}
              </div>
            )
          }
          return (
            <div
              className={`${css.row} ${flash === row.message.msgId ? css.flash : ''}`}
              key={row.key}
              data-msg={row.message.msgId}
            >
              <Avatar
                name={row.message.fromName}
                {...(row.message.fromAvatar === undefined ? {} : { photo: row.message.fromAvatar })}
                className={css.avatar}
                photoClassName={css.photo}
              />
              <span className={css.rowBody}>
                <span className={css.rowHead}>
                  <span className={css.name}>{row.message.fromName}</span>
                  <span className={css.clock}>{clockOf(row.message.time)}</span>
                  <span className={css.verbs}>
                    <button
                      type="button"
                      className={css.verb}
                      title="回复这句（挂到它的链上）"
                      onClick={() => {
                        anchor({
                          msgId: row.message.msgId,
                          who: row.message.fromName,
                          text: clip(row.message.content),
                          agent: row.message.own,
                        })
                        // 回复 = 挂链; ⚡ = 挂链 + 受话。明确选了前者，就把
                        // 后者那半摘掉——否则两个动词按下去没有区别，第二个
                        // 键看起来就是「点了没反应」。
                        for (const word of view.aliases ?? []) {
                          setDraft(value => value.split(word).join('').trimStart())
                        }
                      }}
                    >
                      <Icon name="undo" size={14} />回复
                    </button>
                    <button
                      type="button"
                      className={css.verb}
                      title={`回复这句，并叫上${AGENT}来办`}
                      onClick={() => {
                        anchor({
                          msgId: row.message.msgId,
                          who: row.message.fromName,
                          text: clip(row.message.content),
                          agent: row.message.own,
                        })
                        const alias = view.aliases?.[0]
                        if (alias !== undefined) {
                          setDraft(value => (
                            value.includes(alias) ? value : `${alias} ${value}`.trim()
                          ))
                        }
                      }}
                    >
                      <Icon name="at" size={14} />交给{AGENT}
                    </button>
                    <CopyButton text={row.message.content} className={css.verb} />
                    <button
                      type="button"
                      className={css.verb}
                      title="转发到另一个会话"
                      onClick={() => { setForwarding(row.message.content) }}
                    >
                      <Icon name="redo" size={14} />转发
                    </button>
                  </span>
                </span>
                {row.message.replyToSummary !== undefined && (
                  <span className={css.quoteRow}>
                    {row.message.replyToId === undefined
                      ? <span className={css.quote}>{row.message.replyToSummary}</span>
                      : (
                        <button
                          type="button"
                          className={`${css.quote} ${css.quoteLink}`}
                          title="跳到被回复的那条"
                          onClick={() => { jumpTo(row.message.replyToId as string) }}
                        >
                          {row.message.replyToSummary}
                        </button>
                      )}
                    {/*
                      两个不同的问题，所以两个控件：跳过去是「那句话在哪」，
                      开话题是「这一串到底在聊什么」。引用链一旦点着火就成了
                      话题，而在群时间线上你只看得到它露出来的那一句——顺着
                      引用走进整条链，是这里唯一缺的那一跳。
                    */}
                    {topicOfQuote(row.message) !== undefined && (
                      <button
                        type="button"
                        className={css.quoteTopic}
                        title="打开这条引用链所属的话题，看完整的一串"
                        onClick={() => { enter(topicOfQuote(row.message) as string) }}
                      >
                        打开话题<Icon name="chevR" size={12} />
                      </button>
                    )}
                  </span>
                )}
                {/*
                  正文先去掉图片占位符再判断要不要画。

                  平台在正文里留 `[图片]`/`[Image]`/`[Images]` 是写给画不出图的客户端
                  看的；我们画得出，所以那几个字是一份重复，而不是一句话。
                */}
                {(() => {
                  const body = withoutImageMarks(
                    row.message.content, (row.message.images ?? []).length > 0,
                  )
                  return isPlaceholderOnly(body, row.message.file?.name)
                    ? null
                    : <span className={css.text}>{body}</span>
                })()}
                <Attachments message={row.message} inject={inject} />
              </span>
            </div>
          )
        })}
      </div>

      {toast !== '' && <div className={css.toast}>{toast}</div>}

      {forwarding !== undefined && (
        <ForwardPicker
          text={forwarding}
          inject={inject}
          close={() => { setForwarding(undefined) }}
          done={setToast}
        />
      )}

      {contractOpen && (
        <YzjContractPanel
          placeKey={placeKey}
          inject={inject}
          close={() => { setContractOpen(false) }}
        />
      )}

      {view.kind === 'assistant' && (
        <div className={css.feedNote}>
          <b>这是一个助手/系统号的推送。</b>
          这是订阅号，回复没有人会读到。
        </div>
      )}

      {view.kind !== 'assistant' && notOnDuty && (
        /*
          没接单：什么都没发出去。只说「失败」会教人以为产品随机罢工；说清为什么、给出两扇
          真门，才是一次拒绝而不是一条死路。
        */
        <div className={css.notOnDuty}>
          <span><b>{AGENT}没在这个群接活</b>，这句没有发出去——发出去也没人应。</span>
          <span className={css.notOnDutyActions}>
            <button type="button" className={css.notOnDutyBtn} onClick={() => { setContractOpen(true) }}>
              {AGENT}在这里的规则
            </button>
            {(view.aliases ?? []).some(word => draft.includes(word)) && (
              <button
                type="button"
                className={css.notOnDutyBtn}
                onClick={() => {
                  for (const word of view.aliases ?? []) setDraft(value => value.split(word).join('').trim())
                  setNotOnDuty(false)
                }}
              >
                去掉 {(view.aliases ?? [])[0] ?? '@'}，当普通消息发
              </button>
            )}
            {replyTo?.agent === true && (
              <button type="button" className={css.notOnDutyBtn} onClick={() => { setReplyTo(undefined); setNotOnDuty(false) }}>
                不回复它，当普通消息发
              </button>
            )}
            <button type="button" className={css.notOnDutyBtn} onClick={() => { setNotOnDuty(false) }}>知道了</button>
          </span>
        </div>
      )}

      {view.kind !== 'assistant' && (
        <Composer
          voice="place"
          voices={['place']}
          setVoice={() => undefined}
          placeName={roomName}
          direct={direct}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          send={send}
          boxRef={boxRef}
          hint={hint}
          sendLabel={direct
            ? addressed && view.onDuty !== false ? `发给${roomName} · 交给${AGENT}` : `发给${roomName}`
            : addressed && view.onDuty !== false
              ? `发到群里 · 交给${AGENT}`
              : addressed && peerOnDuty !== undefined
                ? `发到群里 · 由 ${peerOnDuty.name} 接`
                : '发到群里'}
          placeholder={replyTo === undefined
            ? direct ? `发给${roomName}…` : `发到「${roomName}」…`
            : `回复 ${replyTo.who}…`}
          tools={(
            <>
              <EmojiButton insert={insert} />
              {alias !== undefined && (
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
      )}
    </div>
  )
}

/** One quoted line, short enough to sit in the anchor bar. */
function clip(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > 42 ? `${flat.slice(0, 42)}…` : flat
}

/**
 * 话题卡上的那一个信号 (律五：一行一个信号).
 *
 * 有事等你就说那件事（琥珀点 + 动词 + 它自己那句话）；在办就说在办；都没有就是办完了。
 * 「热卡 / 冷卡 / 归档索引」是设计的词，不上屏。
 */
function TopicSignal(props: { topic: PlaceViewWire['topics'][number] }): ReactNode {
  const { topic } = props
  if (topic.owes !== undefined) {
    return (
      <span className={css.signalNeed}>
        <span className={css.needDot} />
        <b>要你{topic.verb ?? '答'}</b>
        <span className={css.signalText}>{topic.owes}</span>
      </span>
    )
  }
  return <span className={css.signal}>{topic.hot ? `${AGENT}在办` : '办完了'}</span>
}
