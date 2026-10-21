/**
 * 传送门的唯一一屏：选一个会话。
 *
 * 单独一个文件，因为**板和目标页都要用它**——它长在其中一个消费者体内的话，
 * 另一个要么去 import 一个组件的私处，要么自己抄一份；而抄的那一份迟早在
 * 「该不该问场所」这件事上和原件分道扬镳。
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DelegateRoomWire, PersonWire, SurfaceInject } from './rpc.ts'
import { handoffDraft } from './handoff.ts'
import { registerSeed } from './commission.ts'
import { pushFrame, sendErrand, type Errand } from './store.ts'
import { Avatar } from './Avatar.tsx'
import { AgentFace, Icon, type IconName } from './icons.tsx'
import { AGENT, plainError } from './words.ts'
import css from './portal.module.css'

/**
 * 谁来做 —— 两维真选择的第一维 (委派五步②).
 *
 * 只有两种执行者，而它们的差别不是「谁比较闲」：**agent 是可以被指派的，人是要被
 * 交代的**。派给 agent 的活会在群里被它接下、干完、回帖；派给人的活是一句登记话语，
 * 它确立的是一个听众集合。所以下一步问的问题也不同。
 */
export type Executor =
  | { readonly kind: 'agent' }
  | { readonly kind: 'person'; readonly person: PersonWire }

/** What a portal is about to carry, while the operator picks the room. */
export interface Portal {
  /** 带过去的是目标还是一场会——两者落地后的后果不同，见 `Errand.subject`。 */
  readonly subject: 'goal' | 'event'
  readonly goalRef: string
  readonly goalName: string
  readonly voice: 'place' | 'private'
  readonly seed?: string
  /** 第一步要问的那句话：「交给谁？」「谁来准备？」「这条差距交给谁？」。第二步一律问在哪儿说。 */
  readonly title: string
  /** 两步都要看见的一句后果（拆出去仍归你负责、移交后旧的那条怎么样）。没有就不写。 */
  readonly note?: string
  /**
   * 先问**谁来做**，再问在哪儿说 —— 委派五步② 的两维真选择 (v4.21+).
   *
   * 顺序不能倒过来：**执行者决定场所的选项集**。派给 agent 的活只在群里说得通（它不
   * 在你和同事的私聊里干活）；派给人的活有两种说法——当着全组说是施压与透明，私下说
   * 是留余地——两种都合法，而选哪一种是社交决策。
   *
   * **这个字段是必填的**，而它此前是可选的。可选的后果实测撞到了：六个传送门里只有
   * 板上那一颗填了它，目标页的「＋ 委派」、两处「差距 → 委派」、事件枢纽的「为此会
   * 准备」全都直接掉进第②维——同一个动词在不同入口给出两种东西，而漏掉的那一维恰恰
   * 是委派最没定的那一格。**一份需要人记得去填的名册就是下一个漏洞的位置**，所以让
   * 类型来问：`'room'` 是「谁早就定了」（催、移交），它必须被说出口，不能靠不写。
   */
  readonly pick: 'executor' | 'room'
  /**
   * 这是一次**转包** —— 拆出来的那条挂在这条底下（决策 #59「可转包不可脱责」）。
   *
   * 转包和委派是同一个动词、同一张选择条，差别只在**血缘**：新的那条是我这条的子承诺，
   * 于是责任链加深而不是转移——我仍然对 owner 负责。不带这一格的话，转出去的活会变成
   * 一条和我无关的平行承诺，而那正是「脱责」，是这条法则要挡住的东西。
   */
  readonly subCommitmentOf?: string
  /**
   * 这是一次**移交** —— 边的重新签发（决策 #59）。
   *
   * 有它，两维都**预选当前值**：执行者预选现任、场所预选现场所。预选态本身就是语义
   * ——它是「这是移交，不是新委派」这句话的 UI 形态。两维任一可变：换人 = 执行权变更，
   * **换场所不换人也是移交**（/handoff 本义，听众变更），都不改 = 无事发生。
   *
   * 此前这一格是一个只能搜人的框，而且**排除不了「不换人」这条合法路径**：一次纯粹的
   * 听众变更在界面上根本没有入口。
   */
  readonly handoff?: {
    readonly fromCommitmentId: string
    readonly what: string
    readonly due?: string
    /** 现任。agent 执行的那条没有——那种「换人」是重新委派，不是这个动词。 */
    readonly executor?: { readonly openId: string; readonly name: string }
    /** 现场所。列表里那一行要标出来，因为「就在这儿」是一个要被看见的选项。 */
    readonly placeKey?: string
    /**
     * 旧边上还等着人裁决的东西 —— **移交不吞裁决** (v3.19r③).
     *
     * 旧边一转吸收态，挂在它上面的验收卡就收口了：一份「他交了、等你验收」的交付会被
     * 一次移交无声地吞掉——没人拒绝过它，也没人接受过它，它只是不见了。
     *
     * **不阻塞**（换人是 owner 的主权），但必须亮出来。
     */
    readonly pending?: readonly string[]
  }
}

/**
 * 第②维摆出来的那几节 —— **一份纯函数，因为这一格已经错过一次**。
 *
 * 分节是三段各自正确的过滤合起来用，而那种组合最会安静地撒谎：写完的第一版里，「按人
 * 分节」与「只留群」两段一叠加，**所有私聊一个不剩地消失**——而催一条承诺最常见的落点
 * 恰恰是私聊。它不报错，只是那一类屋子从此选不着。
 *
 * 抽出来的理由就是这个：住在组件体内的这一段没有办法被钉住。
 */
export function roomSections(
  rooms: readonly DelegateRoomWire[],
  needle: string,
  executor: Executor | undefined,
): {
  readonly theirDm: readonly DelegateRoomWire[]
  readonly withHim: readonly DelegateRoomWire[]
  readonly others: readonly DelegateRoomWire[]
  readonly onDuty: readonly DelegateRoomWire[]
  readonly offDuty: readonly DelegateRoomWire[]
  /** 真正渲染的顺序，分节标题按它的首项落位。 */
  readonly places: readonly DelegateRoomWire[]
} {
  const matched = rooms.filter(room => (
    needle === ''
    || room.name.includes(needle)
    || room.topics.some(topic => topic.label.includes(needle))
  ))
  /*
    场所的选项集由执行者决定 (委派五步②)。

    - **派给 agent**：只有群。它不在你和某个同事的私聊里干活——那间屋子里没有它，
      一句话发过去谁都不会应。
    - **派给人**：两种都合法，而它们是**两句不同的话**——当着全组说是施压与透明，
      私下说是留余地。所以私聊不是被过滤掉的次等选项，它和群并列。
  */
  const groups = matched.filter(room => room.kind === 'group')
  const who = executor?.kind === 'person' ? executor.person : undefined
  const theirDm = who === undefined ? [] : matched.filter(room => room.theirDm)
  /*
    **场所选项集 = 共同场所 + DM + 新建**（v4.24），而「共同场所」这一问平台答不了：
    群成员列表没有 API（三墙之一）。

    答得了的是另一问——**他在这个群里有过登记吗**，那是图上的事实。所以群分成两节：
    有过登记的（事实）与其余的（**不确定他在不在**）。不是把其余的藏起来：他很可能就在
    一个还没登记过任何东西的群里，藏了就是拿「我们不知道」冒充「他不在」。

    事实缩小选项集合法，装作知道不合法——这两句话的分界就画在这一格上。
  */
  const withHim = who === undefined ? [] : groups.filter(room => room.known)
  const others = who === undefined ? [] : groups.filter(room => !room.known)
  /*
    派给 agent 时，**接单与否**是同一位置上的那条事实。

    不接单的群里 @ 不会被应答：一条发过去没人听见的委派就是幽灵承诺换了个形状。所以
    它们排在后面并且明标，而不是藏起来（那个群仍然是个可以说话的地方，只是这句话在
    那儿不会有回音）。第三种是「读不到接单与否」——`onDuty` 缺席时算在岗那一档，不写
    这一句就会有一行把「没查到」显示成「没接单」。
  */
  const onDuty = executor?.kind === 'agent' ? groups.filter(room => room.onDuty !== false) : []
  const offDuty = executor?.kind === 'agent' ? groups.filter(room => room.onDuty === false) : []
  /*
    **没问「谁来做」的传送门，屋子要全摆出来**（催、移交）。

    按人分的那三节建立在「执行者是某个具体的人」之上；没有那个人时照搬那份切法，剩下
    的就只有群。这一支不是省事，是这一格唯一诚实的答案：不知道要说给谁听的时候，没有
    任何事实可以拿来缩小选项集。
  */
  const places = executor?.kind === 'agent'
    ? [...onDuty, ...offDuty]
    : who === undefined ? matched : [...theirDm, ...withHim, ...others]
  return { theirDm, withHim, others, onDuty, offDuty, places }
}

/**
 * 这句话最后落在哪儿 —— **三种落点，不是一种**。
 *
 * 此前只有 `topic` 一种，于是「在哪儿说」被偷换成了「在哪个已经存在的话题里说」。
 * 倒因为果：**话题是委派的产物，不是委派的前提**——一个刚定下来的目标要派给张三，
 * 那个群里通常还一个话题都没有。
 */
export type Landing =
  /** 挂进正在跑的那一段：承诺继承这个话题的语境。 */
  | { readonly kind: 'topic'; readonly sessionId: string }
  /** 场所主楼：这一句自成话题根，话题从它长出来。 */
  | { readonly kind: 'place'; readonly placeKey: string; readonly groupName: string }
  /** 和这个人还没聊过：私聊的出生就是这第一句话。 */
  | { readonly kind: 'new-dm'; readonly openId: string; readonly name: string }

/**
 * 选完之后，这一句话到底会写下什么 —— **抽成纯函数，因为这一格决定的是图**。
 *
 * 它把「人刚才点了谁」翻译成三样东西：起头的话、受话、以及**先验**（这句话是登记、是
 * 移交，还是一次转包）。三者里只有第一样是给人看的，后两样直接决定发送成功之后往图上
 * 写什么——而它住在组件体内时，没有任何办法钉住。
 *
 * 这一段已经在两个方向上出过错：漏掉先验，一次委派就退化成一句普通消息（板上不长行）；
 * 先验带错，一条活会挂到不相干的人或不相干的父承诺底下。
 */
export function portalChoice(
  portal: Portal,
  executor: Executor | undefined,
  /**
   * 选中的那间屋子。**只为一件事而来：最小听众不变量**（v4.24 决策 #58）。
   *
   * 承诺边的听众 **≥ {owner, executor}**——更大是特性（公开是施压与透明），更小则这条边
   * 从出生起就不完整：群里其他人以为这事说好了，而当事人一个字都没听见。
   *
   * 平台不给群成员名单，所以「他在不在」答不了；答得了的是「他在这儿有过登记吗」。这个
   * 事实**上一屏刚算过**，而算完不带走，它就只是一句分节标题——设计要求的是**代发前
   * 警示**，也就是要活到发送键跟前。
   */
  room?: { readonly known: boolean; readonly kind: 'group' | 'direct' },
): PortalChoice | undefined {
  if (executor === undefined) return undefined
  const move = portal.handoff
  /*
    只在**群**里问这一句。私聊的听众是确定的（就你和他），而 agent 不需要「在不在」——
    它的在与不在是接单，另有说法。
  */
  const risk = executor.kind === 'person' && room?.kind === 'group' && !room.known
    ? `不确定${executor.person.name}在不在这个群——发出去之后，记得告诉${executor.person.name}一声。`
    : undefined
  /*
    移交的骨架不是登记句式：**事项与期限继承旧边**，不靠解析这句话得来。移交不发明
    内容——它重新签发的是同一件事。
  */
  if (move !== undefined && executor.kind === 'person') {
    return {
      call: true,
      ...(risk === undefined ? {} : { audienceRisk: risk }),
      seed: handoffDraft({
        what: move.what,
        ...(move.due === undefined ? {} : { due: move.due }),
        toName: executor.person.name,
        ...(move.executor?.name === undefined ? {} : { fromName: move.executor.name }),
        // 换场所不换人是另一句话：事没换手，换的是这件事以后在哪儿说。
        samePerson: executor.person.openId === move.executor?.openId,
      }),
      handoff: {
        fromCommitmentId: move.fromCommitmentId,
        openId: executor.person.openId,
        name: executor.person.name,
      },
    }
  }
  return executor.kind === 'agent'
    // 派给 agent：骨架就是受话本身，做什么由人说。
    ? { call: true }
    : {
      call: true,
      ...(risk === undefined ? {} : { audienceRisk: risk }),
      seed: registerSeed(executor.person.name),
      // 选了人，这句话就是在登记他的承诺——分类在这一刻定，不必等群里跑一次 turn。
      register: {
        openId: executor.person.openId,
        name: executor.person.name,
        // 转包：血缘跟着这一句走，否则拆出去的活会变成一条和我无关的平行承诺。
        ...(portal.subCommitmentOf === undefined
          ? {}
          : { parentCommitmentId: portal.subCommitmentOf }),
      },
    }
}

/**
 * 开一次移交 —— **一份实现，三个消费者**（板 / 目标页 / 事件枢纽）。
 *
 * 预选当前值不能靠界面手里那点东西：板上那一行带的是**显示名**不是 openId，场所也只带
 * 话题名。而预选态本身承载语义（「这是移交，不是新委派」），所以它必须来自图。
 *
 * 三处各写一遍 fetch + 拼 portal 的话，第一次改动就会有一处忘了带 `due`，于是从那一处
 * 发起的移交，拟稿里的期限凭空消失——而期限正是这句话里最不能丢的三样之一。
 */
export async function handoffPortal(
  inject: SurfaceInject,
  row: { readonly id: string; readonly what: string; readonly goalRef?: string },
): Promise<Portal | { readonly error: string }> {
  const now = await inject.handoffContext(row.id)
  if (now.error !== undefined) return { error: now.error }
  return {
    subject: 'goal',
    goalRef: row.goalRef ?? '',
    goalName: now.what ?? row.what,
    voice: 'place',
    pick: 'executor',
    title: '转给谁？',
    note: '原来那条留档，新的一条从你说出去的那句话算起。',
    handoff: {
      fromCommitmentId: row.id,
      what: now.what ?? row.what,
      ...(now.due === undefined ? {} : { due: now.due }),
      ...(now.executor === undefined ? {} : { executor: now.executor }),
      ...(now.placeKey === undefined ? {} : { placeKey: now.placeKey }),
      ...(now.pending === undefined || now.pending.length === 0
        ? {}
        : { pending: now.pending }),
    },
  }
}

/**
 * 传送门落地 —— **一份实现，三个消费者**。
 *
 * 板、目标页、事件枢纽此前各写一遍 `sendErrand + openSession`，三份一字不差。落点从
 * 一种变成三种的这一刻，那三份就会开始分道扬镳：谁改到了、谁没改到，只有点进去才
 * 知道。所以它住在这里，和 `errandFor` 并排。
 */
export function landPortal(
  portal: Portal,
  landing: Landing,
  choice: PortalChoice | undefined,
  openSession: (sessionId: string) => void,
): void {
  sendErrand(errandFor(portal, choice))
  if (landing.kind === 'topic') {
    openSession(landing.sessionId)
    return
  }
  /*
    `pushFrame` 而不是 `setFrame`：从板上跳进一间屋子说完话，「‹ 返回」该回到板上你
    刚才看的那一行。滚动位置这里给不出来（传送门不认识调用方的滚动容器），所以给 0
    ——回到板顶，好过回不去。
  */
  if (landing.kind === 'place') {
    pushFrame({ kind: 'place', placeKey: landing.placeKey, groupName: landing.groupName }, 0)
    return
  }
  pushFrame({
    kind: 'place',
    // 还没有 placeKey——平台要等第一句话发出去才给。这个串只用来让视图重新挂载。
    placeKey: `pending-dm:${landing.openId}`,
    groupName: landing.name,
    newDm: { openId: landing.openId, name: landing.name },
  }, 0)
}

/**
 * 选完之后，那句话的骨架该长什么样。
 *
 * 传送门把**两个只有人能定的东西**带走：谁来做、在哪儿说。骨架跟着这两个走，而内容
 * 一个字都不带——「任务内容由人说，agent 不发明委派内容」。
 */
export interface PortalChoice {
  readonly seed?: string
  readonly call?: boolean
  /** 选了人 = 登记路径的结构化先验 (v3.15 裁决④)。 */
  readonly register?: {
    readonly openId: string
    readonly name: string
    /** 转包：拆出来的这条挂在哪条底下（决策 #59）。 */
    readonly parentCommitmentId?: string
  }
  /** 移交先验：这一句话是那条边的重新签发（决策 #59）。 */
  readonly handoff?: {
    readonly fromCommitmentId: string
    readonly openId: string
    readonly name?: string
  }
  /**
   * 最小听众不变量的**警示**（v4.24 决策 #58）——听众可能少了执行者那一头。
   *
   * 不是拦：选一个他可能不在的群是合法的社交选择（拉人／改场所／照发都由人定）。是**说**：
   * 这句话发出去之后，板上会长出一条他可能根本不知道的活。
   */
  readonly audienceRisk?: string
}

/**
 * 传送门落地时交出去的那件差事 —— **一份实现**。
 *
 * 三个消费者（板、目标页、事件枢纽）此前各拼各的 errand，而它们拼的是同一件事。
 * 这种重复不会报错，只会在某一次改动之后开始各说各话——「两级缩放各写各的句子」
 * 那个裂缝刚补过一次，不必再长一个。
 *
 * 选择盖过默认：选了「交给张三」，起头就该是登记句式，而不是传送门那句泛泛的
 * 「关于目标 X：」。
 */
export function errandFor(portal: Portal, choice?: PortalChoice): Errand {
  const seed = choice?.seed ?? portal.seed
  return {
    subject: portal.subject,
    goalRef: portal.goalRef,
    goalName: portal.goalName,
    voice: portal.voice,
    ...(seed === undefined ? {} : { seed }),
    ...(choice?.call === true ? { call: true } : {}),
    ...(choice?.register === undefined ? {} : { register: choice.register }),
    ...(choice?.handoff === undefined ? {} : { handoff: choice.handoff }),
    ...(choice?.audienceRisk === undefined ? {} : { audienceRisk: choice.audienceRisk }),
  }
}

/**
 * 「交给…」的唯一一层：先问谁来做，再问在哪儿说。
 *
 * Everything else a delegation needs — what, by when — is said in the
 * conversation, in the operator's own words. This asks only the two things that
 * cannot be derived and must not be guessed: WHO, and WHERE (who will hear it).
 * 人选不推导 (§1.6)：近处候选只缩小选项集，每个都写出凭什么在这里。
 *
 * The list is conversations, not groups, because a commitment breathes in a
 * window: the registration card lands there, the receipt is read there, and the
 * board's 「打开」 hops back to it.
 *
 * 每个选项一行：一张脸 · 名字和一句后果 · 右边写谁听得见。说明腔不上屏（律一）；
 * 这一层要回答的「这句话谁听得见」，写在每一行的右边，而不是写成一段话放在顶上。
 */
export function RoomPicker(props: {
  portal: Portal
  inject: SurfaceInject
  close(): void
  go(landing: Landing, choice?: PortalChoice): void
}): ReactNode {
  const { portal, inject, close, go } = props
  const [rooms, setRooms] = useState<readonly DelegateRoomWire[] | undefined>(undefined)
  const [filter, setFilter] = useState('')
  const [opened, setOpened] = useState<string | undefined>(undefined)
  /*
    ① 谁来做 —— 只有委派问这一步 (委派五步②).

    `undefined` 是「还没选」，不是「没人」：这一屏在选定之前不该显示任何场所，因为
    移交**预选现任**（决策 #59）——预选态本身就是那句「这是移交，不是新委派」。
    预选而不是排除：换场所不换人（/handoff 的本义，听众变更）因此走得通。
  */
  const [executor, setExecutor] = useState<Executor | undefined>(
    portal.handoff?.executor === undefined
      ? undefined
      : { kind: 'person', person: portal.handoff.executor },
  )
  const needsExecutor = portal.pick === 'executor' && executor === undefined
  /*
    没有合适的群时，可以**当场建一个** (设计 v4.18)。建群是创造一个新的听众集合，
    所以它是一张要填的小表、要按的键，而不是列表里一点就有的选项。
  */
  const [minting, setMinting] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)

  /*
    选项集跟着执行者重新读一次 —— 「他在哪儿接过活」「哪个私聊是和他的」都是**关于
    这个人**的事实，换个人就是另一份答案。
  */
  const who = executor?.kind === 'person' ? executor.person : undefined
  useEffect(() => {
    setRooms(undefined)
    void inject.delegateRooms(
      who === undefined ? undefined : { openId: who.openId, name: who.name },
    ).then(setRooms)
  }, [inject, who])
  useEffect(() => { setFilter(''); setOpened(undefined); setMinting(false) }, [needsExecutor])

  /*
    键盘一路到底（律八）：框里打字过滤，↓ 进列表、↑↓ 走、⏎ 选；Esc 先收起建群那张
    小表，再关这一层。全站的 Esc 链见到 dialog 就让位，所以这一层自己接。
  */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (minting) setMinting(false)
        else close()
        return
      }
      if (minting || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
      const root = sheet.current
      if (root === null) return
      const options = [...root.querySelectorAll<HTMLButtonElement>('[data-opt]:not(:disabled)')]
      if (options.length === 0) return
      event.preventDefault()
      const at = options.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'ArrowDown') {
        options[at < 0 ? 0 : Math.min(options.length - 1, at + 1)]?.focus()
        return
      }
      if (at <= 0) root.querySelector<HTMLInputElement>('input')?.focus()
      else options[at - 1]?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [close, minting])

  const needle = filter.trim()
  const { theirDm, withHim, others, onDuty, offDuty, places } = roomSections(rooms ?? [], needle, executor)
  /*
    「和他还没有私聊」这一问要看**没过滤的那份名单**：照着过滤后的判，打几个字缩小
    范围就会让那间明明存在的私聊消失，界面接着请你再开一个。
  */
  const hasDm = (rooms ?? []).some(room => room.theirDm)

  const move = portal.handoff
  /* 人没换、地方也没换：这样的移交什么都不会发生。守卫跟着场所走，不跟着话题走。 */
  const noop = (placeKey: string): boolean => (
    move !== undefined
    && executor?.kind === 'person'
    && executor.person.openId === move.executor?.openId
    && placeKey === move.placeKey
  )

  /** 选完之后那句话的骨架：受话 + 句式，内容一个字都不带。 */
  const choice = (room?: DelegateRoomWire): PortalChoice | undefined => portalChoice(
    portal, executor,
    room === undefined ? undefined : { known: room.known, kind: room.kind },
  )

  /** 这句话谁听得见——写在每一行的右边，公开说与私下说在列表里不再长得一样。 */
  const sideOf = (room: DelegateRoomWire): ReactNode => {
    if (room.kind === 'direct') return '只有你们俩'
    // 分节标题已经说了后果；行上只陈述事实，不每行再亮一次颜色（律三）。
    if (executor?.kind === 'agent' && room.onDuty === false) return `${AGENT}没在岗`
    return '全群可见'
  }
  const sectionOf = (room: DelegateRoomWire): string | undefined => {
    if (room.placeKey === theirDm[0]?.placeKey) return '私聊'
    if (who !== undefined && room.placeKey === withHim[0]?.placeKey) return `${who.name}在这些群里接过活`
    if (who !== undefined && room.placeKey === others[0]?.placeKey) return `其他群 · 不确定${who.name}在不在`
    if (offDuty.length > 0 && room.placeKey === onDuty[0]?.placeKey) return `${AGENT}在岗的群`
    if (room.placeKey === offDuty[0]?.placeKey) return `${AGENT}没在岗的群 · 在这儿说没人接`
    return undefined
  }

  const subject = portal.subject === 'event' ? '这场会' : '目标'
  const title = needsExecutor ? portal.title : move !== undefined ? '转给谁、在哪儿说？' : '在哪儿说？'
  const pending = move?.pending ?? []

  return (
    <div className={css.mask} onClick={close}>
      <div
        ref={sheet}
        className={css.sheet}
        role="dialog"
        aria-label={title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.head}>
          <span className={css.title}>{title}</span>
          <button type="button" className={css.iconBtn} onClick={close} aria-label="关闭">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className={css.about}>
          <span className={css.aboutWhat}>{subject} · {portal.goalName}</span>
          {executor !== undefined && (
            <>
              <span className={css.aboutTo}>
                {move === undefined ? '交给' : '转给'} {executor.kind === 'agent' ? AGENT : executor.person.name}
              </span>
              {/* 选错了人不该只能关掉重来——两维里的第一维要回得去。 */}
              {portal.pick === 'executor' && (
                <button type="button" className={css.link} onClick={() => { setExecutor(undefined) }}>换个人</button>
              )}
            </>
          )}
        </div>
        {portal.note !== undefined && portal.note !== '' && <div className={css.note}>{portal.note}</div>}
        {/*
          **移交不吞裁决**（v3.19r③）—— 亮出来，但不拦。旧边一转，挂在它上面的验收卡就
          收口了；换人是 owner 的主权，所以这里不设门，但他至少要看见这一句。
        */}
        {!needsExecutor && pending.length > 0 && (
          <div className={css.pending}>
            <span className={css.pendingHead}>转走之后，这些会一起收起：</span>
            {pending.map(line => <span key={line}>· {line}</span>)}
            <span className={css.pendingTail}>要先验收的，可以先回去。</span>
          </div>
        )}
        {needsExecutor
          ? (
            <WhoStep
              inject={inject}
              {...(portal.subject === 'goal' ? { goalRef: portal.goalRef } : {})}
              pick={setExecutor}
            />
          )
          : minting
            ? <NewPlace portal={portal} inject={inject} cancel={() => { setMinting(false) }} />
            : (
              <>
                <div className={css.searchRow}>
                  <Icon name="search" size={14} className={css.searchIcon} />
                  <input
                    className={css.search}
                    value={filter}
                    autoFocus
                    placeholder="找群、私聊或话题…"
                    onChange={(event) => { setFilter(event.target.value) }}
                  />
                </div>
                <div className={css.list}>
                  {/*
                    **和他还没聊过 → 就在这儿开一个**（v4.24 场所出生）。云之家的私聊没有
                    「创建」这个动作：它的出生就是第一句话，而那句话正是此刻要说的这一句。
                  */}
                  {who !== undefined && !hasDm && rooms !== undefined && (needle === '' || who.name.includes(needle)) && (
                    <>
                      <div className={css.section}>私聊</div>
                      <Option
                        face={<PersonFace name={who.name} />}
                        name={`和${who.name}私聊`}
                        sub="还没聊过——你这一句就是第一句"
                        side="只有你们俩"
                        onPick={() => { go({ kind: 'new-dm', openId: who.openId, name: who.name }, choice()) }}
                      />
                    </>
                  )}
                  {rooms === undefined && <div className={css.calm}>正在读…</div>}
                  {rooms !== undefined && places.length === 0 && (
                    <div className={css.calm}>
                      {needle === '' ? '还没有可以说话的群或私聊。' : `没有「${needle}」。`}
                    </div>
                  )}
                  {places.map((room) => {
                    const section = sectionOf(room)
                    return (
                      <Fragment key={room.placeKey}>
                        {section !== undefined && <div className={css.section}>{section}</div>}
                        {/*
                          **场所本身就是落点**：这一句发到群聊，话题从它长出来。挂进一个
                          正在聊的话题是另一件事（那条承诺会继承那段语境），所以收在下面。
                        */}
                        <Option
                          face={room.kind === 'direct' ? <PersonFace name={room.name} /> : <Glyph name="hash" />}
                          name={room.name}
                          {...(move !== undefined && room.placeKey === move.placeKey ? { sub: '现在在这儿' } : {})}
                          side={sideOf(room)}
                          disabled={noop(room.placeKey)}
                          {...(noop(room.placeKey) ? { title: '人和地方都没换，转了等于没转' } : {})}
                          onPick={() => {
                            go({ kind: 'place', placeKey: room.placeKey, groupName: room.name }, choice(room))
                          }}
                        />
                        {room.topics.length > 0 && (
                          <button
                            type="button"
                            className={css.more}
                            aria-expanded={opened === room.placeKey}
                            onClick={() => {
                              setOpened(current => (current === room.placeKey ? undefined : room.placeKey))
                            }}
                          >
                            <Icon name={opened === room.placeKey ? 'chevD' : 'chevR'} size={12} />
                            挂进正在聊的话题 · {room.topics.length}
                          </button>
                        )}
                        {opened === room.placeKey && room.topics.map(topic => (
                          <Option
                            key={topic.sessionId}
                            indent
                            name={topic.label}
                            disabled={noop(room.placeKey)}
                            onPick={() => { go({ kind: 'topic', sessionId: topic.sessionId }, choice(room)) }}
                          />
                        ))}
                      </Fragment>
                    )
                  })}
                  {/* 尾项，不是首项：默认该是复用一个已经在的听众集合。 */}
                  {rooms !== undefined && needle === '' && (
                    <Option
                      face={<Glyph name="plus" />}
                      name="新建一个群"
                      sub="没有合适的群时"
                      onPick={() => { setMinting(true) }}
                    />
                  )}
                </div>
              </>
            )}
        <div className={css.foot}>选好就跳过去，话由你自己说。</div>
      </div>
    </div>
  )
}

/** 一行选项：一张脸 · 名字和一句后果 · 右边写谁听得见。这一层的选项都长这样。 */
function Option(props: {
  face?: ReactNode
  name: ReactNode
  sub?: ReactNode
  side?: ReactNode
  disabled?: boolean
  title?: string
  indent?: boolean
  onPick(): void
}): ReactNode {
  const { face, name, sub, side, disabled, title, indent, onPick } = props
  return (
    <button
      type="button"
      data-opt=""
      className={indent === true ? `${css.option} ${css.indent}` : css.option}
      disabled={disabled}
      title={title}
      onClick={onPick}
    >
      {face}
      <span className={css.main}>
        <span className={css.name}>{name}</span>
        {sub !== undefined && <span className={css.sub}>{sub}</span>}
      </span>
      {side !== undefined && <span className={css.side}>{side}</span>}
    </button>
  )
}

function PersonFace(props: { name: string }): ReactNode {
  return <Avatar name={props.name} className={css.avatar} photoClassName={css.photo} />
}

function Glyph(props: { name: IconName }): ReactNode {
  return <span className={css.glyph}><Icon name={props.name} size={14} /></span>
}

/**
 * 按名字找人 —— 搜的是**全公司通讯录**（群成员列表平台没有 API，三墙之一）。
 *
 * 搜人是**单调的**：后发先至的旧回包不许覆盖新的一次。网络不保证顺序——不记票号的
 * 话，一次慢的旧查询回来会把新查询的结果盖掉，看起来就是「搜出来的人和我打的字对
 * 不上」。`settled` 是结果对得上的那次查询：没对上之前不说「没有」。
 */
function usePeople(inject: SurfaceInject, keyword: string): {
  readonly found: readonly PersonWire[]
  readonly broken: string
  readonly settled: string
} {
  const [found, setFound] = useState<readonly PersonWire[]>([])
  const [broken, setBroken] = useState('')
  const [settled, setSettled] = useState('')
  const ticket = useRef(0)
  useEffect(() => {
    const query = keyword.trim()
    const mine = ticket.current + 1
    ticket.current = mine
    if (query === '') { setFound([]); setBroken(''); setSettled(''); return undefined }
    const timer = setTimeout(() => {
      void inject.people(query).then((result) => {
        if (ticket.current !== mine) return
        setFound(result.people)
        setBroken(result.error ?? '')
        setSettled(query)
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [keyword, inject])
  return { found, broken, settled }
}

/**
 * 第一步：谁来做。
 *
 * 一个框、一张列表：空着的时候是{@link AGENT}和近处候选，打字就是通讯录。近处候选的
 * 来源**都是事实**——这个目标里已经有谁在跟、你最近交给过谁——每个都写出凭什么在这里；
 * 一个候选都没有时那一节整个不出现（第一次用的人本来就没有近处，那不是缺失）。
 */
function WhoStep(props: {
  inject: SurfaceInject
  goalRef?: string
  pick(executor: Executor): void
}): ReactNode {
  const { inject, goalRef, pick } = props
  const [keyword, setKeyword] = useState('')
  const [nearby, setNearby] = useState<readonly { openId: string; name: string; why: string }[]>([])
  const query = keyword.trim()
  const { found, broken, settled } = usePeople(inject, keyword)

  useEffect(() => {
    void inject.delegateCandidates(goalRef).then(setNearby)
  }, [inject, goalRef])

  return (
    <>
      <div className={css.searchRow}>
        <Icon name="search" size={14} className={css.searchIcon} />
        <input
          className={css.search}
          value={keyword}
          autoFocus
          placeholder="按名字找人…"
          onChange={(event) => { setKeyword(event.target.value) }}
        />
      </div>
      <div className={css.list}>
        {(query === '' || AGENT.includes(query)) && (
          <Option
            face={<AgentFace size={28} />}
            name={AGENT}
            sub="在群里接活、回帖、交付"
            onPick={() => { pick({ kind: 'agent' }) }}
          />
        )}
        {query === '' && nearby.map(row => (
          <Option
            key={row.openId}
            face={<PersonFace name={row.name} />}
            name={row.name}
            sub={row.why}
            onPick={() => { pick({ kind: 'person', person: { openId: row.openId, name: row.name } }) }}
          />
        ))}
        {query !== '' && found.map(person => (
          <Option
            key={person.openId}
            face={<PersonFace name={person.name} />}
            name={person.name}
            {...(person.department === undefined ? {} : { sub: person.department })}
            onPick={() => { pick({ kind: 'person', person }) }}
          />
        ))}
        {/*
          搜不到有两种可能，下一步完全不同：名字打错了（再搜一次），或者这个人不在本
          公司（这条路还没开）。读不了又是第三种——那不等于没有这个人。
        */}
        {query !== '' && settled === query && found.length === 0 && broken === '' && (
          <div className={css.calm}>通讯录里没有「{query}」。这里只能找本公司的人。</div>
        )}
        {broken !== '' && (
          <div className={css.calm}>通讯录暂时读不了（{plainError(broken).text}）——不代表没有这个人。</div>
        )}
      </div>
    </>
  )
}

/**
 * 新建一个群 —— 一次主权时刻，同时裁三件事 (设计 v4.18).
 *
 * 建群 = **创造一个新的听众集合**。从此这批人听得见这里说的每一句话，而这件事没有
 * 撤销键：群可以解散，谁在那段时间里听见了什么收不回来。所以它是一张要填的表、一枚
 * 要按的键，而不是列表里一个一点就有的选项。
 *
 * - **谁听得见**（群名 + 成员）；
 * - **云小助在不在岗**（勾选）——专项群默认勾上，它存在的理由就是让云小助在这儿干活；
 * - **它从哪句话里长出来**（出生血缘，表上不出现，由这次「交给…」的语境自动携带）。
 *
 * 不勾也可以，但要说清后果：在这儿交代的事没人回执——一条落了库却没人应答得了的
 * 承诺，正是幽灵承诺换了个形状。
 *
 * **建完不自动跳进去**：新群里一条消息都没有，能说话的是它的群聊，而那条路由此刻只到
 * 宿主手里。所以如实说「它会出现在左边列表里」，而不是跳去一片空白。
 */
function NewPlace(props: {
  portal: Portal
  inject: SurfaceInject
  cancel(): void
}): ReactNode {
  const { portal, inject, cancel } = props
  const [name, setName] = useState(portal.subject === 'goal' ? portal.goalName : '')
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<PersonWire[]>([])
  const [serve, setServe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ served: boolean } | undefined>(undefined)
  const [error, setError] = useState('')
  const { found, broken } = usePeople(inject, keyword)

  const toggle = (person: PersonWire): void => {
    setPicked(current => (current.some(one => one.openId === person.openId)
      ? current.filter(one => one.openId !== person.openId)
      : [...current, person]))
  }

  if (result !== undefined) {
    return (
      <div className={css.form}>
        <div className={css.formHead}>群建好了：{name.trim()}</div>
        <div className={css.formNote}>
          {result.served
            ? `${AGENT}已经在这个群里接活。`
            : `${AGENT}没在这个群里，在这儿交代的事没人回执。要它接活，到这个群的「${AGENT}在这里的规则」里打开。`}
        </div>
        <div className={css.formNote}>过一会儿它会出现在左边的列表里，到那儿去说。</div>
        <div className={css.formActions}>
          <span className={css.formCount} />
          <button type="button" className={css.primary} autoFocus onClick={cancel}>好</button>
        </div>
      </div>
    )
  }

  const count = picked.length
  const ready = name.trim() !== '' && count >= 2 && count <= 10
  return (
    <div className={css.form}>
      <div className={css.formHead}>新建一个群</div>
      <input
        className={css.field}
        value={name}
        autoFocus
        placeholder="群名"
        onChange={(event) => { setName(event.target.value) }}
      />
      <input
        className={css.field}
        value={keyword}
        placeholder="加人：在全公司通讯录里找…"
        onChange={(event) => { setKeyword(event.target.value) }}
      />
      {count > 0 && (
        <div className={css.chips}>
          {picked.map(person => (
            <button
              type="button"
              className={css.chip}
              key={person.openId}
              aria-label={`去掉 ${person.name}`}
              onClick={() => { toggle(person) }}
            >
              {person.name}<Icon name="x" size={10} />
            </button>
          ))}
        </div>
      )}
      {found.length > 0 && (
        <div className={css.found}>
          {found.map(person => (
            <Option
              key={person.openId}
              face={<PersonFace name={person.name} />}
              name={person.name}
              {...(person.department === undefined ? {} : { sub: person.department })}
              {...(picked.some(one => one.openId === person.openId) ? { side: <Icon name="check" size={14} /> } : {})}
              onPick={() => { toggle(person) }}
            />
          ))}
        </div>
      )}
      {/* 读不了 ≠ 没有。建群这一步尤其不能糊弄：名单错了，听众集合就错了。 */}
      {broken !== '' && (
        <div className={css.formError}>通讯录暂时读不了（{plainError(broken).text}）——不代表没有这个人。</div>
      )}
      <label className={css.check}>
        <input type="checkbox" checked={serve} onChange={(event) => { setServe(event.target.checked) }} />
        让{AGENT}在这个群里接活
      </label>
      {!serve && <div className={css.formNote}>不勾的话，在这个群里交代的事没人回执。</div>}
      {error !== '' && <div className={css.formError}>{error}</div>}
      <div className={css.formActions}>
        <span className={css.formCount}>
          {count < 2 ? '至少加 2 个人' : count > 10 ? '最多 10 个人' : `${String(count)} 人，不含你`}
        </span>
        <button type="button" className={css.ghost} onClick={cancel} disabled={busy}>取消</button>
        <button
          type="button"
          className={css.primary}
          disabled={busy || !ready}
          onClick={() => {
            setBusy(true)
            setError('')
            void inject.createPlace({
              name: name.trim(),
              members: picked.map(person => person.openId),
              serve,
              sourceAnchor: `portal:${portal.subject}:${portal.goalRef}`,
              ...(portal.subject === 'goal' ? { goalRef: portal.goalRef } : {}),
            }).then((outcome) => {
              setBusy(false)
              if (outcome.error !== undefined) { setError(outcome.error); return }
              setResult({ served: outcome.served === true })
            })
          }}
        >
          {busy ? '正在建…' : '建群'}
        </button>
      </div>
    </div>
  )
}
