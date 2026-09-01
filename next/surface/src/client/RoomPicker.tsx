/**
 * 传送门的唯一一屏：选一个会话。
 *
 * 单独一个文件，因为**板和目标页都要用它**——它长在其中一个消费者体内的话，
 * 另一个要么去 import 一个组件的私处，要么自己抄一份；而抄的那一份迟早在
 * 「该不该问场所」这件事上和原件分道扬镳。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DelegateRoomWire, PersonWire, SurfaceInject } from './rpc.ts'
import { handoffDraft } from './handoff.ts'
import { registerSeed } from './commission.ts'
import { pushFrame, sendErrand, type Errand } from './store.ts'
import css from './board.module.css'

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
  readonly title: string
  readonly note: string
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
    ? `还没见过${executor.person.name}在这个群里有过登记——他在不在，平台不给成员名单，`
      + '我们答不了。发出去之后记得让他知道一声。'
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
    title: '移交：交给谁、在哪儿说？',
    note: '移交 = 这条边的重新签发：旧的一条转为「已移交」留档，新的一条从你说出去的那句话出生。'
      + '两维都预选了当前值——换人是换执行权，只换场所不换人也是移交。',
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
 * 传送门的唯一一屏：选一个会话。
 *
 * Everything else a delegation needs — who, what, by when — is said in the
 * conversation, in the operator's own words. This asks only the one thing that
 * cannot be derived and must not be guessed: WHERE. 场所是委派话语的一等参数，
 * 人选不推导 (§1.6).
 *
 * The list is conversations, not groups, because a commitment breathes in a
 * window: the registration card lands there, the receipt is read there, and the
 * board's 「打开」 hops back to it. A place with no conversation yet is shown
 * with the reason rather than hidden — an empty list that does not say why is
 * indistinguishable from a broken one.
 */
export function RoomPicker(props: {
  portal: Portal
  inject: SurfaceInject
  close(): void
  go(landing: Landing, choice?: PortalChoice): void
}): ReactNode {
  const { portal, inject, close, go } = props
  /** `undefined` = 还没读回来；`[]` = 真的一间屋子都没有。两句话不能混。 */
  const [rooms, setRooms] = useState<readonly DelegateRoomWire[] | undefined>(undefined)
  const [filter, setFilter] = useState('')
  /** 展开了哪个场所底下的已有话题（次级落点，不是默认落点）。 */
  const [opened, setOpened] = useState<string | undefined>(undefined)
  /*
    ① 谁来做 —— 只有委派问这一步 (委派五步②).

    `undefined` 是「还没选」，不是「没人」：这一屏在选定之前不该显示任何场所，因为
    **场所的选项集由执行者决定**，先摆出来的那一份必然是猜的。
  */
  /*
    移交**预选现任**（决策 #59）——预选态本身就是那句「这是移交，不是新委派」。

    review 曾把这一格写成「排除现执行者」，那是错的：它堵死了**换场所不换人**这条合法
    路径（/handoff 的本义就是听众变更）。预选而不是排除，两维因此都任意可改。
  */
  const [executor, setExecutor] = useState<Executor | undefined>(
    portal.handoff?.executor === undefined
      ? undefined
      : { kind: 'person', person: portal.handoff.executor },
  )
  const needsExecutor = portal.pick === 'executor' && executor === undefined
  /*
    没有合适的场所时，可以**当场造一个** (设计 v4.18「新建专项群」格).

    这一格是这样长出来的：选场所这一屏此前默认「合适的听众集合已经存在」，而一个刚
    定下来的目标最常见的情形恰恰是**还没有它自己的群**。缺了这一格，人要跳出去、在
    云之家建群、回来、刷新、再选——四步搬运，而其中三步是纯损耗。

    但它不能做成「顺手就建」：建群是**创造一个新的听众集合**，从此这批人听得见这里的
    每一句话。所以它是一张要填的表、要按的签发键，而不是列表里一个一点就有的选项。
  */
  const [minting, setMinting] = useState(false)

  /*
    选项集跟着执行者重新读一次 —— 「他在哪儿有过登记」「哪个私聊是和他的」都是**关于
    这个人**的事实，换个人就是另一份答案。
  */
  const who = executor?.kind === 'person' ? executor.person : undefined
  useEffect(() => {
    setRooms(undefined)
    void inject.delegateRooms(
      who === undefined ? undefined : { openId: who.openId, name: who.name },
    ).then(setRooms)
  }, [inject, who])

  const needle = filter.trim()
  const { theirDm, withHim, others, offDuty, places } = roomSections(rooms ?? [], needle, executor)
  /*
    「和他还没有私聊」这一问要看**没过滤的那份名单**。

    照着过滤后的 `theirDm` 判，一次「打几个字缩小范围」就会让那间明明存在的私聊消失，
    界面接着说「还没有过私聊」并请你开一个——一句因为筛选而变成假话的话。
  */
  const hasDm = (rooms ?? []).some(room => room.theirDm)

  const move = portal.handoff
  /**
   * **都不改 = 无事发生**（决策 #59 的守卫）。
   *
   * 不是省一次写：一次「什么都没改的移交」会在图上留下一条 transferred 的旧边和一条
   * 内容完全相同的新边，而板上看起来就是这件活自己抖了一下、换了个 id——已有的回执与
   * 轨迹全留在了那条没人再看的旧边上。**代价全付，什么都没换到。**
   */
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

  if (needsExecutor) {
    return (
      <div className={css.mask} onClick={close}>
        <div
          className={css.sheet}
          role="dialog"
          aria-label={portal.title}
          onClick={(event) => { event.stopPropagation() }}
        >
          <div className={css.sheetHead}>
            <span className={css.sheetTitle}>① 谁来做？</span>
            <button type="button" className={css.sheetClose} onClick={close} aria-label="关闭">×</button>
          </div>
          <div className={css.sheetNote}>
            {portal.subject === 'event' ? '这场会' : '目标'}：<b>{portal.goalName}</b>
            <br />
            先定人，再定在哪儿说——<b>执行者决定场所的选项集</b>：派给 agent 的活只在群里说得通，
            派给人的活公开说与私下说是两句不同的话。
          </div>
          <button
            type="button"
            className={css.execPick}
            onClick={() => { setExecutor({ kind: 'agent' }) }}
          >
            🤖 交给 agent 做
            <span className={css.execNote}>它在群里接单、回帖、交付；私聊里没有它</span>
          </button>
          {/*
            **第②层：近处候选，每个带出处**（v4.24 选项集三层）。

            此前这一格只有两层——agent 恒首位，然后直接掉进全组织通讯录搜索。于是最常见
            的那次委派（就是刚才那个目标里的那个人）也要重新打一遍名字，而**打字是在重新
            回忆一件系统已经知道的事**。

            出处是硬要求：一个说不出自己为什么在这里的候选，和「系统觉得你想找谁」没有
            区别，而后者正是「人选不推导」禁止的东西。候选只缩小选项集——搜索那一层
            始终在，谁都没被挡住。
          */}
          <NearbyExecutors
            inject={inject}
            {...(portal.subject === 'goal' ? { goalRef: portal.goalRef } : {})}
            pick={person => { setExecutor({ kind: 'person', person }) }}
          />
          <ExecutorSearch inject={inject} pick={person => { setExecutor({ kind: 'person', person }) }} />
          <div className={css.sheetFoot}>
            <span className={css.sheetHint}>
              选完直接传送——这不是一张表单：要做什么、什么时候前，都在会话里用你自己的话说。
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={css.mask} onClick={close}>
      <div
        className={css.sheet}
        role="dialog"
        aria-label={portal.title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.sheetHead}>
          <span className={css.sheetTitle}>
            {executor === undefined ? portal.title : '② 在哪儿说？'}
          </span>
          <button type="button" className={css.sheetClose} onClick={close} aria-label="关闭">×</button>
        </div>
        <div className={css.sheetNote}>
          {/* 一场会不是一个目标。标签跟着东西走，不跟着组件走。 */}
          {portal.subject === 'event' ? '这场会' : '目标'}：<b>{portal.goalName}</b>
          {executor !== undefined && (
            <>
              {' · '}
              {executor.kind === 'agent' ? '交给 agent' : `交给 ${executor.person.name}`}
              {/* 选错了人不该只能关掉重来——两维里的第一维要回得去。 */}
              <button
                type="button"
                className={css.execBack}
                onClick={() => { setExecutor(undefined) }}
              >
                换个人
              </button>
            </>
          )}
          <br />
          {executor === undefined
            ? portal.note
            : move !== undefined
              ? '移交的那句话由你说，发出去才算数；原来那个场所会自动落一帖解除告知。'
              : executor.kind === 'agent'
                ? 'agent 在群里接单——挑一个它在岗的群，这句话说出去就是一次公开委派。'
                : '当着全组说是施压与透明，私下说是留余地——两种都合法，这个选择不该由系统替你做。'}
        </div>
        {/*
          **移交不吞裁决**（v3.19r③）—— 亮出来，但不拦。

          旧边一转吸收态，挂在它上面的验收卡就收口了：一份「他交了、等你验收」的交付会被
          这一次移交无声地吞掉——没人拒绝过它，也没人接受过它，它只是不见了。换人是 owner
          的主权，所以这里不设门；但「绝不静默丢失」要求他至少看见这一句。
        */}
        {(move?.pending ?? []).length > 0 && (
          <div className={css.handoffPending}>
            <b>移交之后，下面这些会随旧边一起封存：</b>
            {(move?.pending ?? []).map(line => <span key={line}>· {line}</span>)}
            <span className={css.handoffPendingTail}>
              验收权仍然在你手上——可以先回去裁决，也可以就这样移交。
            </span>
          </div>
        )}
        <input
          className={css.input}
          value={filter}
          autoFocus
          placeholder="过滤群、私聊或话题…"
          onChange={(event) => { setFilter(event.target.value) }}
        />
        <div className={css.rooms}>
          {/*
            **和他还没聊过 → 就在这儿开一个**（v4.24 场所出生）。

            这一格此前是一句说明文字：「先在云之家给 TA 发一句，话题长出来之后就会出现
            在这里」——把人赶去另一个 app 说一句废话，回来刷新，再委派。而云之家的私聊
            根本没有「创建」这个动作：**它的出生就是第一句话**，而那句话正是此刻要说的
            这一句。第一次把活派给一个人，恰恰是最常见的一次私下登记。
          */}
          {who !== undefined && !hasDm && rooms !== undefined && (
            <div className={css.roomGroup}>
              <div className={css.roomSection}>和他的私聊</div>
              <button
                type="button"
                className={css.roomNew}
                onClick={() => {
                  go({ kind: 'new-dm', openId: who.openId, name: who.name }, choice())
                }}
              >
                ＋ 开一个和 {who.name} 的私聊 —— 你这一句就是它的第一句
              </button>
            </div>
          )}
          {rooms === undefined
            ? <div className={css.goalEmpty}>正在读会话…</div>
            : places.length === 0
              ? (
                <div className={css.goalEmpty}>
                  {needle === ''
                    ? '一个可以说话的地方都没有——会话列表还没拉到，或者这个账号确实还没有任何群与私聊。'
                    : `没有匹配「${needle}」的群或私聊。`}
                </div>
              )
              : places.map(room => (
                <div className={css.roomGroup} key={room.placeKey}>
                  {/*
                    **分节说清依据**：哪些是「他在这儿有过登记」（事实），哪些是「不确定
                    他在不在」（我们答不了的那一问）。收敛本身是可见的设计事实——所以第一
                    节为空时那句话必须出现，而不是让人以为这个产品只会列一堆群。
                  */}
                  {room.placeKey === theirDm[0]?.placeKey && (
                    <div className={css.roomSection}>和他的私聊</div>
                  )}
                  {who !== undefined && room.placeKey === withHim[0]?.placeKey && (
                    <div className={css.roomSection}>他在这些群里有过登记</div>
                  )}
                  {who !== undefined && room.placeKey === others[0]?.placeKey && (
                    <div className={css.roomSection}>
                      {withHim.length === 0
                        ? `还没见过 ${who.name} 在任何群里有过登记——共同场所无从确认。`
                          + '下面这些群里他在不在，平台不给成员名单，我们答不了：'
                        : '其余的群（他在不在，我们答不了——平台不给成员名单）：'}
                    </div>
                  )}
                  {room.placeKey === offDuty[0]?.placeKey && (
                    <div className={css.roomSection}>
                      这些群 agent 没接单 —— 委派发过去不会有人应，登记也无从落地：
                    </div>
                  )}
                  {/*
                    **场所本身就是落点**，所以它是一颗按得下去的键，不再是一行标题。

                    这一改是这次的主刀：此前场所只是话题的分组标题，能按的只有话题，于是
                    「在哪儿说」被偷换成「在哪个已经存在的话题里说」——而一个刚定下来的
                    目标，那个群里通常一个话题都没有。这一句发到主楼，话题从它长出来。
                  */}
                  <button
                    type="button"
                    className={css.roomPlace}
                    disabled={noop(room.placeKey)}
                    title={noop(room.placeKey)
                      ? '人没换、场所也没换——这样的移交什么都不会发生'
                      : undefined}
                    onClick={() => {
                      go({ kind: 'place', placeKey: room.placeKey, groupName: room.name }, choice(room))
                    }}
                  >
                    {room.kind === 'direct' ? '💬 ' : '# '}
                    {room.name}
                    {/*
                      **现场所要标出来**（决策 #59 预选当前值）。

                      「就在这儿」是一个要被看见的选项：它既是「不换场所」的那一格，也是
                      「都不改 = 无事发生」这条守卫唯一说得清楚的地方。不标的话，人只会
                      看到一颗莫名其妙点不动的按钮。
                    */}
                    {move !== undefined && room.placeKey === move.placeKey && (
                      <span className={css.roomNow}>现在就在这儿</span>
                    )}
                    {/*
                      **这句话会让谁听见**，写在场所名旁边而不是等人自己推断。
                      公开登记与私下登记是两句不同的话，而它们在列表里长得一模一样。
                    */}
                    <span className={css.roomKind}>
                      {room.kind === 'direct'
                        ? '私下登记 · 只有你和 TA'
                        : executor?.kind === 'agent' ? '公开委派 · 全群可见' : '公开登记 · 全群可见'}
                      {room.onDuty === false ? ' · agent 没接单' : ''}
                    </span>
                  </button>
                  {/*
                    已有话题是**次级落点**，不是唯一落点。

                    默认落点是主楼（这句话自成话题根）；挂进一个正在跑的话题是另一件事
                    ——那条承诺会继承那个话题的语境，所以它要人主动点开、主动选，而不是
                    平铺在这里跟主楼抢那一眼。
                  */}
                  {room.topics.length > 0 && (
                    <button
                      type="button"
                      className={css.roomMore}
                      onClick={() => {
                        setOpened(current => (current === room.placeKey ? undefined : room.placeKey))
                      }}
                    >
                      {opened === room.placeKey ? '▾' : '▸'} 或挂进这里正在跑的
                      {' '}{room.topics.length} 个话题
                    </button>
                  )}
                  {opened === room.placeKey && room.topics.map(topic => (
                    <button
                      type="button"
                      className={`${css.room} ${css.roomTopic}`}
                      key={topic.sessionId}
                      /*
                        挂进同一个场所里的某个话题，**听众还是那批人**——移交那一维一个都
                        没变。守卫跟着场所走而不是跟着话题走，否则「换个话题说」会伪装成
                        一次移交。
                      */
                      disabled={noop(room.placeKey)}
                      onClick={() => { go({ kind: 'topic', sessionId: topic.sessionId }, choice(room)) }}
                    >
                      {topic.label}
                    </button>
                  ))}
                </div>
              ))}
          {/*
            尾项，不是首项。

            一屏之内「造一个新的」永远排在「用现成的」后面：默认该是复用一个已经存在的
            听众集合，新建是那个默认不成立时才走的路。
          */}
          {rooms !== undefined && !minting && (
            <button
              type="button"
              className={css.roomNew}
              onClick={() => { setMinting(true) }}
            >
              ＋ 新建专项群 —— 没有合适的场所时
            </button>
          )}
        </div>
        {minting && (
          <NewPlace
            portal={portal}
            inject={inject}
            cancel={() => { setMinting(false) }}
          />
        )}
        <div className={css.sheetFoot}>
          <span className={css.sheetHint}>
            {portal.subject === 'event'
              ? '跳过去之后 composer 会带着这场会的提示——句子由你说，发出去才算数；这一步不给话题装载任何语境。'
              : '跳过去之后 composer 会带着目标 chip——句子由你说，发出去才算数。'}
          </span>
        </div>
      </div>
    </div>
  )
}


/**
 * 近处候选 —— 执行者选择的第②层。
 *
 * 三条来源**都是事实**：这个目标里已经有谁在干（已在语境）、你最近委派过谁（时间事实）。
 * 设计里还有第三条「当前场所成员（在场事实）」，而**平台没有群成员列表 API**（三墙之
 * 一）——拿不到就不摆，不假装有。
 *
 * 一个候选都没有时**整格消失**，不留一句「暂无候选」：第一次用这个产品的人本来就没有
 * 近处，那不是缺失。
 */
function NearbyExecutors(props: {
  inject: SurfaceInject
  goalRef?: string
  pick(person: PersonWire): void
}): ReactNode {
  const { inject, goalRef, pick } = props
  const [rows, setRows] = useState<readonly { openId: string; name: string; why: string }[]>([])

  useEffect(() => {
    void inject.delegateCandidates(goalRef).then(setRows)
  }, [inject, goalRef])

  if (rows.length === 0) return null
  return (
    <div className={css.rooms}>
      {rows.map(row => (
        <button
          type="button"
          className={css.room}
          key={row.openId}
          onClick={() => { pick({ openId: row.openId, name: row.name }) }}
        >
          {row.name}
          {/* 出处就印在候选上：它凭什么在这里，人一眼看得见，也就一眼能否掉。 */}
          <span className={css.roomWhy}>{row.why}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 按名字找那个人 —— 两维真选择的第一维。
 *
 * 搜的是**全组织通讯录**：群成员列表平台没有 API（三墙之一），所以搜不出「这个人在
 * 不在那个群」。那一问由选场所的人自己知道，界面如实说明，不假装校验过。
 *
 * 和建群那一格是同一份搜索纪律（单调票号：后发先至的旧回包不许覆盖新的），但**不共用
 * 一份实现**——那一格选的是一群人、这一格选的是一个人，合并之后第一次改动就会在
 * 「选完之后要不要继续留在列表里」这件事上分道扬镳。
 */
function ExecutorSearch(props: {
  inject: SurfaceInject
  pick(person: PersonWire): void
}): ReactNode {
  const { inject, pick } = props
  const [keyword, setKeyword] = useState('')
  const [found, setFound] = useState<PersonWire[]>([])
  /** 通讯录读不了时宿主的原话；空串 = 读得动。 */
  const [broken, setBroken] = useState('')
  const ticket = useRef(0)

  useEffect(() => {
    const query = keyword.trim()
    if (query === '') { setFound([]); return undefined }
    const mine = ticket.current + 1
    ticket.current = mine
    const timer = setTimeout(() => {
      void inject.people(query).then((result) => {
        if (ticket.current !== mine) return
        setFound(result.people)
        // 读不了 ≠ 没有：把一次故障说成「没搜到这个名字」，人会照着假答案往下做。
        setBroken(result.error ?? '')
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [keyword, inject])

  return (
    <>
      <input
        className={css.input}
        value={keyword}
        placeholder="或者交给一个人——按名字找…"
        onChange={(event) => { setKeyword(event.target.value) }}
      />
      {found.length > 0 && (
        <div className={css.rooms}>
          {found.map(person => (
            <button
              type="button"
              className={css.room}
              key={person.openId}
              onClick={() => { pick(person) }}
            >
              {person.name}
              {person.department === undefined ? '' : ` · ${person.department}`}
            </button>
          ))}
        </div>
      )}
      {keyword.trim() !== '' && found.length === 0 && broken === '' && (
        <div className={css.goalEmpty}>
          通讯录里没搜到这个名字。
          {/*
            **外部人押门：明标不可选，而不是假装不存在**（v4.24 选择器边界）。
            搜不到有两种可能，而它们的下一步完全不同：名字打错了（再搜一次），或者
            这个人根本不在本组织（这条路还没开，得换别的方式）。
          */}
          <br />
          通讯录只包含<b>本组织</b>的人——组织外的人（客户、外包）这条路还没开，
          他们的承诺目前只能你自己盯。
        </div>
      )}
      {broken !== '' && (
        <div className={css.goalEmpty}>通讯录读不了（{broken}）——这不等于没有这个人。</div>
      )}
    </>
  )
}

/**
 * 新建一个专项群 —— 一次主权时刻，同时裁三件事 (设计 v4.18).
 *
 * 建群 = **创造一个新的听众集合**。从此这批人听得见这里说的每一句话，而这件事没有
 * 撤销键：群可以解散，谁在那段时间里听见了什么收不回来。所以它长成一张要填的表、
 * 一枚要按的签发键，而不是列表里一个一点就有的选项——**摩擦刀的用法**：平台让建群
 * 变容易了，而建群的难度本来在保护听众集合，所以设计的动向是把新能力放进门里。
 *
 * 三件事一次裁完，因为它们是同一个决定的三个面：
 *
 * - **谁听得见**（群名 + 成员）；
 * - **agent 在不在岗**（「接入」勾选）——合同默认最严是**系统的**默认，不是不许人在
 *   签发的同一刻一并开启；专项群默认勾上，因为它存在的理由就是让 agent 在这儿干活；
 * - **它从哪句话里长出来**（出生血缘，表上不出现——它由发起这次传送门的语境自动携带）。
 *
 * 不勾「接入」也可以，但**代发之前要警示**：agent 听不见这个群，登记卡发过去没有人
 * 接收回执。出生要有呼吸，而呼吸包括**回执可达**——一条落了库却没人应答得了的承诺，
 * 正是幽灵承诺换了个形状。
 *
 * **建完不自动跳进去**，这是一处如实的缺口而不是设计取舍：新群里一条消息都没有，
 * 因而没有话题可跳；能说话的地方是它的主楼，而主楼要按 `placeKey` 导航——那条路由
 * 此刻只到宿主手里（`setFrame`），传送门够不着。所以这里如实说「它会出现在会话
 * 列表里」，而不是跳去一个应用还不认识的场所然后显示一片空白。
 */
function NewPlace(props: {
  portal: Portal
  inject: SurfaceInject
  cancel(): void
}): ReactNode {
  const { portal, inject, cancel } = props
  const [name, setName] = useState(portal.subject === 'goal' ? portal.goalName : '')
  const [keyword, setKeyword] = useState('')
  const [found, setFound] = useState<PersonWire[]>([])
  /** 通讯录读不了时宿主的原话；空串 = 读得动。 */
  const [broken, setBroken] = useState('')
  const [picked, setPicked] = useState<PersonWire[]>([])
  const [serve, setServe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ served: boolean } | undefined>(undefined)
  const [error, setError] = useState('')
  /*
    搜人是**单调的**：后发先至的那一次回包不许覆盖更新的一次。

    输入框的每一次改动都开一次搜索，而网络不保证顺序——不记票号的话，一次慢的旧查询
    回来会把新查询的结果盖掉，看起来就是「搜出来的人和我打的字对不上」。
  */
  const ticket = useRef(0)
  useEffect(() => {
    const query = keyword.trim()
    if (query === '') { setFound([]); return undefined }
    const mine = ticket.current + 1
    ticket.current = mine
    const timer = setTimeout(() => {
      void inject.people(query).then((result) => {
        if (ticket.current !== mine) return
        setFound(result.people)
        // 读不了 ≠ 没有：把一次故障说成「没搜到这个名字」，人会照着假答案往下做。
        setBroken(result.error ?? '')
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [keyword, inject])

  const toggle = (person: PersonWire): void => {
    setPicked(current => (current.some(one => one.openId === person.openId)
      ? current.filter(one => one.openId !== person.openId)
      : [...current, person]))
  }

  if (result !== undefined) {
    return (
      <div className={css.newPlace}>
        <div className={css.newPlaceHead}>群建好了：<b>{name.trim()}</b></div>
        <div className={css.newPlaceNote}>
          {result.served
            ? 'agent 已经接入这个群，登记卡的回执有人接收。'
            /*
              这一句是这一格存在的一半理由。

              不接入就建群，登记消息发过去没有任何东西在听——承诺落了库、群里也看得见
              那句话，可**回执没有接收方**。板上会一直显示「在跟」，而它永远等不到动静。
              说清楚，并给出那条仍然走得通的路（自己盯、自己回来记）。
            */
            : '⚠️ agent 不在这个群里：登记卡发过去也不会有人接收回执，板上那条承诺会一直等不到动静。'
              + '要么到「场所合同」里把接单打开，要么这次自己亲发、自己回来把回执记上。'}
          <br />
          它会在下一次轮询之后出现在左边的会话列表里；委派那句话到那儿去说——句子由你说，发出去才算数。
        </div>
        <div className={css.newPlaceActions}>
          <button type="button" className={css.newPlacePrimary} onClick={cancel}>知道了</button>
        </div>
      </div>
    )
  }

  return (
    <div className={css.newPlace}>
      <div className={css.newPlaceHead}>新建专项群 —— 这会创造一个新的听众集合</div>
      <input
        className={css.input}
        value={name}
        placeholder="群名称"
        onChange={(event) => { setName(event.target.value) }}
      />
      <input
        className={css.input}
        value={keyword}
        placeholder="按名字找人加进来（2-10 人，不含你自己）…"
        onChange={(event) => { setKeyword(event.target.value) }}
      />
      {picked.length > 0 && (
        <div className={css.newPlacePicked}>
          {picked.map(person => (
            <button
              type="button"
              className={css.newPlaceChip}
              key={person.openId}
              onClick={() => { toggle(person) }}
            >
              {person.name} ×
            </button>
          ))}
        </div>
      )}
      {found.length > 0 && (
        <div className={css.newPlaceFound}>
          {found.map(person => (
            <button
              type="button"
              className={css.room}
              key={person.openId}
              onClick={() => { toggle(person) }}
            >
              {person.name}
              {person.department === undefined ? '' : ` · ${person.department}`}
              {picked.some(one => one.openId === person.openId) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      {/* 读不了 ≠ 没有。建群这一步尤其不能糊弄：名单错了，听众集合就错了。 */}
      {broken !== '' && (
        <div className={css.newPlaceError}>通讯录读不了（{broken}）——这不等于没有这个人。</div>
      )}
      {/*
        搜的是**全组织**，不是这个群——群成员列表平台没有 API（三墙之一）。
        如实说，不假装校验过。
      */}
      <div className={css.newPlaceHint}>搜的是全公司通讯录 · 谁该进这个群，只有你知道</div>
      <label className={css.newPlaceServe}>
        <input
          type="checkbox"
          checked={serve}
          onChange={(event) => { setServe(event.target.checked) }}
        />
        接入 agent（不勾的话，发到这个群的登记卡不会有人接收回执）
      </label>
      {error !== '' && <div className={css.newPlaceError}>{error}</div>}
      <div className={css.newPlaceActions}>
        <button type="button" className={css.newPlaceGhost} onClick={cancel} disabled={busy}>取消</button>
        <button
          type="button"
          className={css.newPlacePrimary}
          disabled={busy || name.trim() === '' || picked.length < 2 || picked.length > 10}
          onClick={() => {
            setBusy(true)
            setError('')
            void inject.createPlace({
              name: name.trim(),
              members: picked.map(person => person.openId),
              serve,
              // 出生血缘：这次传送门是从哪个目标/哪场会发起的，群就从那儿长出来。
              sourceAnchor: `portal:${portal.subject}:${portal.goalRef}`,
              ...(portal.subject === 'goal' ? { goalRef: portal.goalRef } : {}),
            }).then((outcome) => {
              setBusy(false)
              if (outcome.error !== undefined) { setError(outcome.error); return }
              setResult({ served: outcome.served === true })
            })
          }}
        >
          {busy ? '正在建…' : `签发并建群（${String(picked.length)} 人）`}
        </button>
      </div>
      <div className={css.newPlaceHint}>
        按下就是签发——建群是创造一个新的听众集合，比在现成的群里挑一个更需要你点头。
      </div>
    </div>
  )
}
