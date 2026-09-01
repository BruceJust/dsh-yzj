/**
 * Browser-side face of the surface channel. Thin on purpose: the view asks,
 * the host answers, nothing accumulates here. A cache in the browser would be
 * a third copy of a conversation that already has a body of truth.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

/** One Yunzhijia message, as the fused timeline renders it. */
export interface TopicMessageWire {
  msgId: string
  fromOpenId: string
  fromName: string
  content: string
  msgType: string
  time: number
  own: boolean
  replyToSummary?: string
  /** The message this replies to — what makes the quote line a door. */
  replyToId?: string
  /** Root of the reply chain this message hangs on. */
  chainRootId?: string
  /** Attachments. Each carries an ID, never a URL — the bytes come from the host. */
  images?: {
    fileId: string; w?: number; h?: number
    name?: string; ext?: string; size?: number
  }[]
  file?: { fileId: string; name: string; ext?: string; size?: number }
}

export interface TopicDescriptorWire {
  topicKey: string
  sessionId: string
  placeKey: string
  groupId: string
  groupName: string
  topicRootId: string
  label: string
  generation: number
  conversationKind: 'group' | 'direct'
}

export interface TopicChipWire {
  kind: 'commitment'
  id: string
  what: string
  status: string
  due?: string
  parentGoalRef?: string
  inferred: boolean
}

/** 六交互模式 (v4.15 全名册)。模式有限、场景实例开放。 */
export type AnswerableMode =
  | 'single-confirm' | 'per-item-verdict' | 'two-verb-acceptance'
  | 'issuance' | 'multi-exit-assessment' | 'open-question'

/** 全局三层定律。只有 `blocking` 进决断面。 */
export type AnswerableLayer = 'blocking' | 'default-effective' | 'signal'

/** 一个未应答对象自己说的「我是什么在等你」。家族声明，视图不认识类型。 */
export interface AnswerableDemandWire {
  layer: AnswerableLayer
  mode: AnswerableMode
  label: string
  badge?: string
}

export interface StreamCard {
  kind: string
  id: string
  state: unknown
  /** When the object came into being — where the column sorts it. */
  at: number
  /** 出生序。条按它排——时间戳会撞，序号不会。 */
  seq: number
  resolved: boolean
  /** 它此刻在等什么。决断条读的就是它——和流内卡同一个数组，同源不靠纪律。 */
  demand?: AnswerableDemandWire
  /**
   * 后视镜条 —— 仅你可见，**永不进文本通道** (私账层 接缝⑤).
   *
   * 它由服务端的**桌面渲染管道**组合上来；文本投影那条路上没有这个字段。默认不开、
   * 随时可关——它是你在金库签发的规则，agent 只执行显示。
   */
  strip?: MirrorStripWire
  /** 条尾两读 —— 「这类确认还需要你吗›」，租约入口的语义扩员 (接缝④)。 */
  twoRead?: TwoReadWire
  /** 档位生效面。默认档不发——默认档下界面一个字都不该变。 */
  gearEffect?: GearEffectWire
  actions: { id: string; label: string; style?: string; needsInput: boolean; available: boolean }[]
}

export interface StreamArtifactWire {
  uri: string
  title: string
  action: string
  kind?: string
  toolName?: string
  time: number
  foreign: boolean
}

export interface FusedWindowWire {
  topic?: TopicDescriptorWire
  messages: TopicMessageWire[]
  chips: TopicChipWire[]
  cards: StreamCard[]
  artifacts: StreamArtifactWire[]
  /** The words that address the agent, from the channel's config. */
  aliases?: string[]
  /** 这个话题正为哪个目标干活——从图上读，不是视图记的。 */
  goalContext?: { goalRef: string; goalName?: string }
  staleReason?: string
}

export interface PlaceTopicCardWire {
  sessionId: string
  topicKey: string
  topicRootId: string
  label: string
  badge: string
  hot: boolean
  /** 有一件事在里面等你答时，它自己那句话——徽标只装得下四个字。 */
  owes?: string
}

export interface PlaceViewWire {
  placeKey: string
  groupName: string
  messages: TopicMessageWire[]
  topics: PlaceTopicCardWire[]
  /** The agent answers here. Off = people talking; addressing it is refused. */
  onDuty?: boolean
  /** 助手/系统号是订阅，不是对话——那里没有 composer。 */
  kind?: 'group' | 'direct' | 'assistant'
  /**
   * 操作者自己和自己的那间屋子 —— **私语通道** (私账层 §7).
   *
   * 立约邀约与校准回执落在这里。它不是新 surface：磨稿在工作夹、轻问在各会话、
   * 立约与对表在这儿，同为私语侧的三个住客，零新 surface。
   */
  selfChat?: boolean
  /** The words that address the agent, from the channel's config. */
  aliases?: string[]
  staleReason?: string
}

export interface ContractViewWire {
  placeKey: string
  groupName: string
  /** The agent answers here. Everything else is conditional on it. */
  onDuty?: boolean
  version: number
  memoryPolicy: 'normal' | 'facts-only' | 'never'
  processSummary: boolean
  oaRequiredCategories: string[]
  strongTools: { name: string; reason: string }[]
  standardCount: number
  bannedTools: string[]
  revocations: { messageId: string; reason: string; time: number }[]
  /** 这个开关最近几次是谁按的（v3.15 裁决⑤：记下来而没人读得到，等于没记）。 */
  servedChanges?: { served: boolean; by?: string; time: number }[]
  leasesAvailable: boolean
}

export type AttachmentBodyWire =
  | { kind: 'image'; mime: string; base64: string; size: number }
  | { kind: 'pdf'; base64: string; size: number }
  | { kind: 'text'; text: string; size: number; clipped: boolean }
  | { kind: 'binary'; size: number; savedTo: string; why: string }

/** 通讯录里的一个人。`openId` 是它唯一能跨面用的身份。 */
export interface PersonWire {
  openId: string
  name: string
  department?: string
  jobTitle?: string
}

/** 今天还没开完的一场会，读作会前那一眼。 */
export interface BoardEventWire {
  eventId: string
  title: string
  startAt: number
  endAt?: number
  readiness: 'ready' | 'partial' | 'none'
  readinessLine: string
  /** 地点 / 组织者 / 日程描述——平台那条 list 本来就回，看进去的时候才用得上。 */
  location?: string
  organizer?: string
  description?: string
  prepares: {
    commitmentId: string
    what: string
    who: string
    status: string
    /** 一跳可达：会前发现还差一件，下一步永远是去看那一件到哪儿了。 */
    sessionId?: string
    artifacts: { uri: string; title: string }[]
    /** 修理动词要的三样（决策 #57：板与 hub 同构）。 */
    due?: string
    stewardedBy?: string
    goalRef?: string
  }[]
  postedMaterials?: string
  known: boolean
}

export interface TreeWire {
  places: {
    place: { placeKey: string; groupName: string }
    topics: TopicDescriptorWire[]
  }[]
}

/**
 * 委派第②维的一行 —— 一个**场所**（群或私聊），以及它底下已经在跑的话题。
 *
 * `onDuty` 缺席时是「读不到」，不是「没接单」：这一行可能只从图上的话题拼出来，接单
 * 名单里没有它的位置。界面因此有三种说法而不是两种。
 */
/**
 * 登记先验 —— 传送门第②步选执行者时就定下的分类（v3.15 裁决④）。
 *
 * `parentCommitmentId` 是**转包**那一格（决策 #59）：拆出来的这条挂在我那条底下，责任链
 * 加深而不是转移。不带它，转出去的活就成了一条和我无关的平行承诺——那正是「脱责」。
 */
export interface RegisterPrior {
  openId: string
  name: string
  goalRef?: string
  parentCommitmentId?: string
}

/**
 * 移交先验 —— 这一句话是**哪条边的重新签发**（决策 #59）。
 *
 * 和登记先验同一个位置、同一条纪律：**说出去才算数**。旧模型先改图、再让人去说，而那
 * 句「记得说一声」把三方知情派回给了人的记性。
 */
export interface HandoffPrior {
  fromCommitmentId: string
  openId: string
  name?: string
}

/** 桌面往一个场所里说一句话，回来是什么。 */
export interface SentInPlace {
  msgId?: string
  ignited?: boolean
  refused?: 'not-on-duty' | 'feed'
  /** 点着了的话，新长出来的那个话题——目标语境要挂到它头上。 */
  sessionId?: string
  /** 这一句构成了一次移交时，新签发出来的那条边。 */
  toCommitmentId?: string
  /** 移交里那些「话发了但有一半没成」的实话（解除告知没落上、主权不对…）。 */
  note?: string
  error?: string
}

export interface DelegateRoomWire {
  placeKey: string
  name: string
  kind: 'group' | 'direct'
  onDuty?: boolean
  /** 他在这儿有过登记（事实）。不等于「他在这个群里」——那一问平台答不了。 */
  known: boolean
  /** 这就是和他的那个私聊。 */
  theirDm: boolean
  topics: { sessionId: string; label: string }[]
}

export type TopicTone = 'confirm' | 'review' | 'running' | 'waiting' | 'idle'

export interface InboxItemWire {
  /** Work is in flight right now, whatever louder demand the badge shows. */
  live?: boolean
  sessionId: string
  placeKey: string
  title: string
  placeName: string
  /** What this topic is doing right now, in the words of the object doing it. */
  preview: string
  tone: TopicTone
  badge: string
  /** 这一行此刻在等的那件事。有它才叫「需要你」。 */
  demand?: AnswerableDemandWire
}

export interface InboxPlaceWire {
  placeKey: string
  groupName: string
  conversationKind: 'group' | 'direct'
  tone: TopicTone
  badge: string
  /** How many topics the attention lease is holding back in the group view. */
  archived: number
  topics: InboxItemWire[]
}

/** One row of the conversation base — 「谁在找我」 (v4.8). */
export interface InboxConversationWire {
  placeKey: string
  name: string
  kind: 'group' | 'direct' | 'assistant'
  lastMsgTime: number
  preview: string
  unread: number
  avatarUrl?: string
  onDuty: boolean
  selfChat: boolean
}

export interface InboxView {
  counts: { confirm: number; review: number; running: number }
  firstOf: Partial<Record<TopicTone, string>>
  places: InboxPlaceWire[]
  /** Every conversation, newest activity first. Absent before the first poll. */
  conversations?: InboxConversationWire[]
  /** 演示隐身档 (D10): fold the base, zero the badges, hide the previews. */
  stealth?: boolean
  /** The words that address the agent, from the channel's config. */
  aliases?: string[]
  /** Every topic session, visible or leased away — the local list subtracts it. */
  topicSessionIds: string[]
  commitments: {
    open: number
    overdue: number
    /** 子承诺全部终态的目标数——「该评估了」，评估触发的推那一半。 */
    toAssess?: number
  }
  /**
   * 私账层在不在 —— **一个布尔，永远没有计数** (私账层 接缝⑥).
   *
   * 「我的判断（金库）」那一行读它决定画不画；自聊行的未读收窄读它决定豁不豁免。
   * 两处都不需要知道里面有几条：**金库入口永无徽标**，那就是三不入在这一列上的
   * 样子——未答的邀约与回执不老化、不可催、不成欠账。
   */
  pledger?: { enabled: boolean }
}

export interface BoardRowWire {
  id: string
  what: string
  executorKind: 'agent' | 'human'
  who: string
  /**
   * 何时 —— **两层** (v4.21 时间透镜)。
   *
   * `text` 是当初说出口的那句话（真身），`ts` 是解析投影、可空。界面**只显示 text**：
   * 把「下周初」渲染成一个具体日期，是拿我们的解析冒充他的承诺。`ts` 只参与排序。
   */
  due?: { text: string; ts?: number }
  /** 我欠的 / 欠我的 / 我旁观的 —— 板是可见域的并集，第三格是真实关系不是兜底。 */
  direction: 'mine' | 'owed-to-me' | 'observed'
  /** 谁验收，恒为人；等于本人时不下发（本人省略）。 */
  acceptor?: string
  /**
   * 这条归谁管 —— **动词主权 = 节点主权的派生** (v4.22 裁决②).
   *
   * 有值 = owner 不是查看者，修理动词族与催**不渲染**（非灰化——灰按钮是「你不配」
   * 的展示；不渲染不禁言，人人可以在会话里直接说）。等于本人时服务端不下发。
   */
  stewardedBy?: string
  overdue: boolean
  status: string
  goalRef?: string
  sessionId?: string
  placeName?: string
  remindable: boolean
  /**
   * 三值状态 (v4.12)：有证据 / 无信号 / 信号过时。
   *
   * 「没消息」不等于「没问题」——一条人欠的事登记完就没有下文，和一条有回执有
   * 产物的事，在「进行中」三个字底下长得一模一样。
   */
  signal: 'evidence' | 'silent' | 'stale'
  /** 交付已主张、等人验收——承诺仍然 open，所以这一格要单独说。 */
  awaitingAcceptance?: boolean
  /** 受领三态：缺席 = 已登记（正常起点）／accepted 受领证据／declined 拒领。 */
  acceptance?: { state: 'accepted' | 'declined'; note?: string }
  /** 移交出去了，接手的是谁（决策 #59）。有它这一行才不是断头路。 */
  transferredTo?: string
  /** 最后一次有动静是什么时候。 */
  lastSignalAt: number
  inferredGoal: boolean
  /** This commitment IS a goal; the value is its body's URI in Yunzhijia. */
  isGoal?: string
  /** 语境继承 / 显式 / 推断 / 事后补挂 — shown so it can be corrected. */
  attachedVia?: string
  /** 过程摘要：一行就够，过程本身在一跳之外（绝不搬运）。 */
  progress?: string
  /** 幽灵承诺禁令：登记落库了，本人到底有没有被告知。 */
  notified?: 'sent' | 'failed'
  /**
   * 父目标已经结束了，而这条还挂在上面（v4.12 级联显形）。
   *
   * 显形，但**不自动作废**——目标死了不等于底下每件事都该停，那是人的判断。
   */
  parentRetired?: boolean
}

/** One goal and the work serving it, joined by URI (v4.8). */
export interface BoardGoalWire {
  goalRef: string
  row?: BoardRowWire
  children: BoardRowWire[]
  counts: { open: number; overdue: number; settled: number }
  /** 产出归集：目标→承诺→工件两跳派生，不是第二存储。 */
  artifacts: GoalArtifactWire[]
  /** 立目标时签发的成功标准（磨点在「可验收」）。 */
  criteria?: string
  /** 最近一份差距简报——缺口在这里一键变委派。 */
  assessment?: BoardAssessmentWire
  /** 图内最后一次有动静——事实驱动的 staleness，不是谁去打的卡。 */
  lastActivityAt?: number
  /** 标准改过，而最近这份简报是照着旧版写的（真身之变）。 */
  criteriaDrifted?: boolean
  /** agent 最近一次看出真身被改动了，它当时说了什么。 */
  truthChanged?: { at: number; detail: string }
  /**
   * 非操作者听众已经多少天没有可读的对账 (v4.22 裁决③ 配套信号)。
   *
   * 板上一切正常，而组里打开那份文档看到的还是上次回写时的样子——**信号，不是可应答
   * 对象**：动词是「评估」，就近长在目标上；**不给上级加自动推送**。
   */
  truthSilentDays?: number
}

export interface GoalArtifactWire {
  uri: string
  title: string
  action: string
  time: number
  /** 产在一个同时服务多个目标的会话里——归给谁都不准确，所以标出来。 */
  shared?: boolean
}

export interface BoardAssessmentWire {
  id: string
  summary: string
  status: string
  at: number
  seq?: number
  /** 这份简报当时照着哪一版标准写的。 */
  criteriaBasis?: string
  /**
   * 它躺在哪个会话里 —— **一跳指路**，板的合法增量之一。
   *
   * 服务端一直带着这个字段（`BoardAssessment.sessionId`，注释写着「决断层要能一跳
   * 过去答它」），只是客户端的类型没声明，于是它在线上跑了很久而没有任何一处读它。
   * 后果是板上那句「验收与继续在那张简报卡上答」既不说卡在哪、也不给门——**报得出
   * 一份待答的东西却按不下去，就是幽灵信号的定义**。
   */
  sessionId?: string
  lines: { criterion: string; verdict: string; evidence: string }[]
}

/** 空态三义（v4.12）：在跑 / 停摆（全在等第三方）/ 空转（无子承诺）。 */
export type GoalPulseWire = 'running' | 'stalled' | 'idle'

/** 目标页：承诺板的第二缩放级别。 */
export interface GoalPageWire {
  goal: BoardGoalWire
  /** 决断层 = 收件箱同源可应答对象的过滤投影（先答先赢，不是复制列表）。 */
  decisions: InboxItemWire[]
  pulse: GoalPulseWire
  staleDays?: number
  retired: boolean
  /**
   * **我的切片** = 我执行的 ∪ 我委派的 (v4.22 参与者视角).
   *
   * 一页 N 个查看者 N 种渲染的落点。是**排列**不是过滤：切片里的行照旧留在执行清单
   * 里，只是被顶到前面——这一页的合法增量只有决断落座、一跳导航、就近动词，多一个
   * 筛子就是多一个要维护的视图。
   */
  mySlice: string[]
}

export interface BoardViewWire {
  rows: BoardRowWire[]
  goals: BoardGoalWire[]
  /** 未挂是合法状态；这一组把对齐债务从「看不见」变成「拉一下就看见」。 */
  unattached: BoardRowWire[]
}

export interface ObjectRowWire {
  uri: string
  title: string
  action: string
  placeKey: string
  time: number
}

export interface MemoryRowWire {
  id: string
  axis: 'place' | 'entity' | 'org'
  summary: string
  scope: string
  sourceAnchors: string[]
}

export interface ObjectFaceWire {
  current: ObjectRowWire[]
  memory: MemoryRowWire[]
  /** Live memories filed under other places — an absence with a reason. */
  memoryElsewhere?: number
  resources: ObjectRowWire[]
  /** Where the three radii are centred — 本群 or 本机. */
  scope?: { kind: 'place' | 'local'; placeName?: string }
}

/** 一个知识库：真身可以建在哪儿。 */
export interface WorkspaceWire {
  id: string
  name: string
  /** 个人知识库——只有你看得见。选它意味着这个目标的真身别人打不开。 */
  personal?: boolean
  /** 同名的库是真的存在（实测一个账号里两对）。这两个数是唯一现成的区分依据。 */
  members?: number
  docs?: number
  /** 谁建的。同名两个库时，这一格比数字更认得出来。 */
  owner?: string
}

export interface SurfaceInject {
  inbox(): Promise<InboxView | undefined>
  board(): Promise<BoardViewWire>
  /** 立目标 = 登记动词的看板形态：落真身 + 登记一步完成。 */
  declareGoal(input: {
    what: string
    goalRef: string
    /**
     * 目标的 owner —— **一个可核对的人，不是一个名字**。
     *
     * 留空 = 我（由端点从桌面身份读，客户端不替它编）。填了人就必须是从通讯录里
     * **选中**的那一位：名字当 id 用，通讯录里五位李婷就成了同一个人。
     */
    ownerOpenId?: string
    ownerName?: string
    due?: string
    /** 怎么算完成——磨目标磨出来的那句，也是日后差距简报的比对基准。 */
    criteria?: string
    /** 磨稿会话：出生血缘指向它，而不是指向一个「桌面」。 */
    sessionId?: string
  }): Promise<{ error?: string }>
  /**
   * 语境装载：让这个话题从此带着目标引用。
   *
   * 传 goalRef 是装载，不传是卸载。发送时才调用——只是路过看了一眼，不该在图上
   * 留下「这个房间在为某目标干活」这种断言。
   */
  armTopicGoal(
    sessionId: string, goalRef?: string, goalName?: string,
  ): Promise<{ error?: string }>
  /** 事后补挂：把「无归属」里选中的几条挂到同一个目标。 */
  linkCommitments(goalRef: string, ids: readonly string[]): Promise<{ linked?: number; error?: string }>
  /** 移出目标：补挂的出口——未挂是合法状态，回得去。 */
  unlinkCommitments(ids: readonly string[]): Promise<{ unlinked?: number; error?: string }>
  /** 作废一条承诺（含在这里立的目标）——立目标不能是单向门。 */
  voidCommitment(id: string, reason?: string): Promise<{ error?: string }>
  /** 目标页：承诺板放大一级，读的是同一个查询。 */
  goalPage(goalRef: string): Promise<GoalPageWire | undefined>
  /**
   * 顺延期限——改的是当初说出口的那个日子（公事）。
   *
   * 与「顺延提醒」分立：后者只动操作者自己的计划，不该让一次私下的「我知道了」
   * 冒充一次公开的改期。提醒那一半要有 scheduler 才谈得上，这套系统里还没有。
   */
  postponeCommitment(id: string, due: string): Promise<{ error?: string }>
  /** 合并：两个人在做同一件事——不自动合，但必须能手动合。 */
  mergeCommitment(id: string, into: string): Promise<{ error?: string }>
  /**
   * 移交前那一屏要预选的**当前值** —— 现任是谁、现在在哪儿说（决策 #59）。
   *
   * 预选态本身承载语义：**它就是「这是移交，不是新委派」这句话的 UI 形态**。所以它不能
   * 靠界面记，得问图——板上那一行带的是显示名不是 openId，场所也只带话题名。
   */
  handoffContext(id: string): Promise<{
    what?: string
    due?: string
    executor?: { openId: string; name: string }
    placeKey?: string
    /** 旧边上还等着人裁决的东西（移交不吞裁决）。移交之前要亮出来，但不阻塞。 */
    pending?: string[]
    error?: string
  }>
  objects(sessionId?: string): Promise<ObjectFaceWire>
  fused(sessionId: string): Promise<FusedWindowWire | undefined>
  /**
   * Say one thing INTO the place.
   *
   * `replyTo` is the 落点: absent means the topic's own root (the anchor bar's
   * default), present means this attaches to that message's chain. 回复 = 挂链
   * (v4.7), so the landing point is a parameter of the send, not a mode the
   * composer remembers.
   */
  sendToPlace(
    sessionId: string, text: string, replyTo?: string,
    /**
     * 登记路径的**结构化先验** —— 委派五步④ (v3.15 裁决④).
     *
     * 有它 = 这句话是在登记那个人的承诺（传送门第②步选执行者时就定了）。发送成功之后
     * 落库 + 由既有监听器代发 ack，**不开话题**：登记的是别人的承诺，不是给 agent 的任务。
     */
    register?: RegisterPrior,
    /** 移交先验：这一句是**这条边的重新签发**（决策 #59）。 */
    handoff?: HandoffPrior,
  ): Promise<SentInPlace>
  /** One read-only turn: answers, writes nothing, opens no task. */
  lightAsk(sessionId: string, text: string): Promise<{ answer?: string; error?: string }>
  forgetMemory(memoryId: string): Promise<boolean>
  /** Re-deliver a commitment card into the place it was registered in. */
  /** The model actually in force, for the head chip. */
  model(): Promise<{ provider?: string; model?: string }>
  /** 群视图: the place's own thread with its topics laid over it. */
  place(placeKey: string): Promise<PlaceViewWire | undefined>
  /** 场所合同: what the agent may do here, read off the guard's own inputs. */
  contract(placeKey: string): Promise<ContractViewWire | undefined>
  /**
   * 接单 / 移出服务。
   *
   * 立刻生效（白名单是一个活的集合），且**跨重启存活**（决定记在通道状态里，
   * 不改仓库里的配置——一个会改写自己出厂配置的程序，会让「这套部署到底被
   * 允许碰什么」在仓库里查不出来）。
   */
  setServed(placeKey: string, on: boolean): Promise<{ served?: boolean; error?: string }>
  /** 就地展开: the last few lines of a topic, for a glance without navigating. */
  topicTail(sessionId: string): Promise<string[]>
  /**
   * Say something into a place: the main thread, or onto a message's chain.
   * `ignited` means the agent was addressed and a topic caught fire;
   * `refused` means it was addressed where it is not on duty and NOTHING was
   * sent.
   */
  sendInPlace(
    placeKey: string, text: string, replyTo?: string,
    /**
     * 登记路径的结构化先验 —— 传送门第②步选的那个人 (v3.15 裁决④)。
     *
     * 会话那一侧一直带着它；主楼这一侧此前不带，于是「委派到这个群」这条路发出去的是
     * 一句普通消息：话在群里，板上不长行。
     */
    register?: RegisterPrior,
    /** 移交先验：这一句是**这条边的重新签发**（决策 #59）。 */
    handoff?: HandoffPrior,
  ): Promise<SentInPlace>
  /**
   * 给一个**还没聊过**的人发第一句 —— 私聊的出生 (v4.24 场所选项集)。
   *
   * 云之家没有「创建私聊」这个动作，落点要等平台在回包里给，所以这一条不认 placeKey
   * 只认 openId。回包里的 `placeKey` 就是那间刚出生的屋子。
   */
  sendToPerson(
    openId: string, text: string,
    register?: RegisterPrior,
    handoff?: HandoffPrior,
  ): Promise<SentInPlace & { placeKey?: string }>
  /** 附件真身：字节走宿主取（没有公开地址），按 fileId 缓存。 */
  attachment(fileId: string, name?: string): Promise<AttachmentBodyWire | undefined>
  /** 下载：宿主放进「下载」文件夹，回真实路径——预览不等于拿到手。 */
  saveAttachment(
    fileId: string, name?: string,
  ): Promise<{ savedTo?: string; error?: string }>
  tree(): Promise<TreeWire>
  /**
   * 按名字找人 —— @成员补全的数据源 (4h④).
   *
   * 搜的是**全组织**：群成员列表平台没有 API（三墙之一），所以搜不出「这个人在不在
   * 这个群」。那一问由选场所的人自己知道；界面如实说明，不假装校验过。
   */
  /**
   * 按名字搜通讯录。
   *
   * **返回的是三值，不是一个数组**：搜到了 / 一个也没有 / **读不了**。此前它是
   * `Promise<PersonWire[]>`，而失败被 `?? []` 抹成空数组——于是通讯录读不动的时候，
   * 界面斩钉截铁地说「通讯录里没有叫这个名字的人」。**看不了不等于没有**，而这句话
   * 恰好会在最伤人的场合出现：CLI 挂了、token 过期时，人得到的是「查无此人」。
   */
  people(keyword: string): Promise<{ people: PersonWire[]; error?: string }>
  /**
   * 近处候选 —— 执行者选择的第②层，**每个带出处**（v4.24 选项集条款）。
   *
   * 候选只缩小选项集，从不代选：搜索那一层始终在。出处是硬要求（预填出处律的延伸）
   * ——一个说不出自己为什么在这里的候选，和「系统觉得你想找谁」没有区别。
   */
  delegateCandidates(goalRef?: string): Promise<{ openId: string; name: string; why: string }[]>
  /**
   * 委派第②维的选项集 —— **场所**（群与私聊），不是「已经存在的话题」。
   *
   * 传 `openId`/`name` 就多两样事实：他在哪些场所**有过登记**（不是「他在哪些群」——
   * 平台没有群成员列表 API，那一问答不了），以及哪个私聊是和他的（只能按名字认）。
   */
  delegateRooms(who?: { openId: string; name: string }): Promise<DelegateRoomWire[]>
  /**
   * 我有哪些知识库 —— 真身建在哪儿，由人选。
   *
   * 和通讯录同一条纪律：三值（列到了 / 一个也没有 / 读不了）。落点是社交决策，不推导
   * ——「建在哪个知识库」这一问只有人答得了，系统替他挑一个默认，就是替他决定谁看得见
   * 这个目标。
   */
  workspaces(): Promise<{ workspaces: WorkspaceWire[]; error?: string }>
  /** 在云之家建一条目标真身，回链接。人选知识库、系统建文档。 */
  createGoalBody(input: { workspace: string; title: string; criteria?: string }): Promise<{
    url?: string
    /** 建出来了但正文没写进去时的实话。 */
    note?: string
    error?: string
  }>
  /** 今天还没开完的会 —— 事件枢纽在板上的那一段。 */
  events(): Promise<BoardEventWire[]>
  /**
   * 新建一个专项群 —— **创设 + 记出生 + 按勾选接入，一次办完** (设计 v4.18).
   *
   * 桌面上按下那个按钮**就是签发**：建群是创造一个新的听众集合，比在现成的听众集合里
   * 挑一个更须人批，而这里按下按钮的人就是要签字的那个人——不该为同一件事再弹一张确认
   * 卡（一次主权时刻一次确认）。agent 那条路另有工具，且在 guard 里是强确认。
   *
   * 失败时回的是**宿主的原话**，不是一句「通道无响应」：其中一种失败是「建群命令回来了
   * 但读不出群 id」——那意味着群**可能已经建好了**，人得去核对而不是重来一次。
   */
  createPlace(input: {
    name: string
    members: string[]
    serve: boolean
    sourceAnchor: string
    goalRef?: string
  }): Promise<{ groupId?: string; placeKey?: string; served?: boolean; error?: string }>
  cardAct(
    kind: string, id: string, actionId: string, input?: string,
  ): Promise<{ receipt: string; outcome: string } | undefined>

  /* ——— 私账层（金库）· 只在 `inbox.pledger.enabled` 时用得上 ——— */

  /** 金库四区 + 换挡台 + 模式。未启用 / 身份未就绪时是 undefined。 */
  vault(windowDays?: number): Promise<VaultViewWire | undefined>
  /** 私语流：未答的立约邀约与校准回执 + 折叠归并条。不老化、不可催、不成欠账。 */
  privateRows(): Promise<{ rows: readonly PrivateRowWire[]; fold?: PrivateFoldWire }>
  /** 证据面。不给 id = 默认态（待对表首项备料）。 */
  vaultEvidence(kind?: 'calibration' | 'expectation', id?: string): Promise<EvidenceFaceWire | undefined>
  /** 金库内检索（P1 搜索面，零组织侧接缝）。 */
  vaultSearch(query: string): Promise<readonly { zone: string; id: string; text: string }[]>
  /** 取走：判例册 + README。**读操作**，不写事件。 */
  vaultExport(): Promise<{ casebook: string; readme: string } | undefined>
  /** 调全局日配额（0-3；0 = 全关邀约）。 */
  setQuota(quota: number): Promise<{ error?: string }>
  /** 答一张私账卡。走私账自己的动作总线——它读写的是第二本账。 */
  pledgerAct(
    kind: string, id: string, actionId: string, input?: string,
  ): Promise<{ receipt: string; outcome: string } | undefined>
  /**
   * 立约 —— 你的那一句赌注，一个字节不改地落账（原话直存律）。
   *
   * 三种拒绝各说各的：重复（先撤回）/ 越窗（等下一次裁决）/ 无邀约（这次裁决
   * 没开过口）。界面把原话带回来，不合成一句「不行」。
   */
  pledge(verdictKind: string, verdictId: string, text: string): Promise<{ error?: string }>
  declineInvite(inviteId: string): Promise<{ error?: string }>
  /** 撤回 —— 唯一退出动词。前提消失时撤回是诚实，不是失败。 */
  withdrawExpectation(expectationId: string, reason?: string): Promise<{ error?: string }>
  /** 补登事实 —— 图外事实的唯一入口。系统不猜图外。 */
  noteFact(input: {
    text: string
    expectationId?: string
    verdictKind?: string
    verdictId?: string
  }): Promise<{ error?: string }>
  /** 改归因 —— 更正即追加，最新生效，史不改。 */
  reattribute(calibrationId: string, attribution: 'q1' | 'q2' | 'q3' | 'q4'): Promise<{ error?: string }>
  /** 换挡 —— 档位是你的私有设置，组织侧无人知晓。`receipt` = 就地合环入口。 */
  shiftGear(family: string, gear: 'lease' | 'default' | 'weight', entry: 'tail' | 'vault' | 'receipt'): Promise<{ error?: string }>
  /** 后视镜开关 —— 你签发的私账规则，默认不开、随时可关。 */
  toggleMirror(family: string, patternKey: string, on: boolean, entry?: 'vault' | 'receipt'): Promise<{ error?: string }>
  /** 重新打开这一族的立约邀约 —— 降频的唯一恢复动词。 */
  reopenInvites(family: string): Promise<{ error?: string }>
  /** 销毁整本账 —— 两段式，第二段要把那句话原样打出来。 */
  destroyVault(confirm: string): Promise<{ error?: string }>
}

/* ——— 私账层的线上形状。**只在桌面这条通道上存在**（接缝④⑤⑥）。 ——— */

/** 后视镜条：这张组织侧卡片旁边、仅你可见的那几条判例。 */
export interface MirrorStripWire {
  family: string
  patternLabel: string
  cases: { calibrationId: string; thenText: string; factText: string }[]
  note: string
}

/** 条尾两读：这类裁决还需要你吗——一个出口扩成两个，零新入口。 */
export interface TwoReadWire {
  family: string
  label: string
  gear: 'lease' | 'default' | 'weight'
  evidence: string[]
  leaseAvailable: boolean
  leaseNote?: string
  note: string
}

/** 档位生效面：负重档要摆开证据、不预选、无一键通过。 */
export interface GearEffectWire {
  family: string
  gear: 'lease' | 'default' | 'weight'
  preselect: boolean
  quickAccept: boolean
  spreadEvidence: boolean
}

/** 立此存照律的线上形状：**文本必填、锚可空**。正文渲染只读 `text`。 */
export interface AnchoredTextWire {
  text: string
  at: string
  anchor?: { kind: string; id: string; graphSeq?: number }
}

export interface VaultExpectationWire {
  expectationId: string
  text: string
  checkpointText: string
  checkpointTs?: number
  /** 当时那次裁决的**照片**——断了组织图也读得出来。 */
  verdict: AnchoredTextWire
  bornAt: number
  due: boolean
  asked: boolean
  withdrawnReason?: string
  /** 前提还在不在。`unknown` **不显形**（认识论诚实）。 */
  premise: 'live' | 'changed' | 'unknown'
  zone: 'live' | 'settled'
  verbs: ('withdraw' | 'note-fact' | 'settle-anyway')[]
}

export interface VaultCaseWire {
  calibrationId: string
  attribution: 'q1' | 'q2' | 'q3' | 'q4'
  attributionLabel: string
  thenText: string
  fact: AnchoredTextWire
  verdict: AnchoredTextWire
  family: string
  at: number
  /** 改归因 + **就地合环**（开镜/调档就在这一行上——入口不垄断律）。 */
  verbs: ('reattribute' | 'loopback')[]
}

export interface VaultPatternWire {
  patternKey: string
  family: string
  label: string
  count: number
  mirror: boolean
  cases: { calibrationId: string; thenText: string; factText: string; at: number }[]
  verbs: 'mirror'[]
}

export interface VaultGearWire {
  family: string
  label: string
  what: string
  gear: 'lease' | 'default' | 'weight'
  /** 换挡依据也立此存照——否则半年后只剩一个「我换过挡」的空记录。 */
  evidence: AnchoredTextWire[]
  entry: 'tail' | 'vault' | 'receipt' | 'none'
  leaseAvailable: boolean
  leaseNote?: string
  verbs: 'shift'[]
}

/** 归因分布镜 —— **四个数字，零判词**（返回类型里没有一个 string）。 */
export interface VaultDistributionWire {
  q1: number
  q2: number
  q3: number
  q4: number
  cases: Record<'q1' | 'q2' | 'q3' | 'q4', string[]>
  labels: Record<'q1' | 'q2' | 'q3' | 'q4', string>
  verbs: 'open-cell'[]
}

/** 全局日配额行 —— 扩触发面的对偶。 */
export interface VaultQuotaWire {
  quota: number
  usedToday: number
  range: { min: number; max: number }
  verbs: 'set-quota'[]
}

/** 证据面一行：摘要为主、锚为辅、锚死显形。 */
export interface EvidenceRowWire {
  text: string
  at: string
  anchor?: { kind: string; id: string; graphSeq?: number }
  premise: 'live' | 'changed' | 'unknown'
  mark?: string
}

export interface EvidenceFaceWire {
  title: string
  rows: EvidenceRowWire[]
  note: string
}

export interface VaultInviteWire {
  family: string
  label: string
  quiet: boolean
  declinedInARow: number
  verbs: 'invite-reopen'[]
}

export interface VaultViewWire {
  owner?: string
  /** 销毁口令 —— **服务端说了算**，界面不写第二份字面。 */
  destroyPhrase: string
  /** 取走的落点。说不出在哪儿的「可取走」不是可取走。 */
  directory?: string
  contract: { label: string; how: string }[]
  refusals: string[]
  window: { days: number }
  /** 六区（v2.0 由四区扩）。 */
  testing: VaultExpectationWire[]
  awaiting: VaultExpectationWire[]
  settled: VaultCaseWire[]
  /** 未对表（沉降）——沉了不代表不可动。 */
  sunk: VaultExpectationWire[]
  withdrawn: VaultExpectationWire[]
  patterns: VaultPatternWire[]
  distribution: VaultDistributionWire
  gears: VaultGearWire[]
  invites: VaultInviteWire[]
  quota: VaultQuotaWire
  settleDays: number
  foldThreshold: number
  /** 空账要如实解释自己为什么空——「还没有」和「不可能有」是两句话。 */
  emptyBecause?: string
}

export interface PrivateRowWire {
  kind: 'invite' | 'calibration'
  id: string
  at: number
  seq: number
  state: Record<string, unknown>
  resolved: boolean
  /** 静默沉降三态。**三不变**：不变红、不计数、不催。 */
  zone: 'live' | 'folded' | 'settled'
  actions: { id: string; label: string; style?: string; needsInput: boolean; available: boolean }[]
  /** 就地合环行 —— `answered` 终态必带（金库是汇总处，不是唯一入口）。 */
  loopback?: {
    family: string
    familyLabel: string
    patternKey?: string
    mirrorOn: boolean
    gear: 'lease' | 'default' | 'weight'
    note: string
  }
}

/** 折叠归并条 —— **是门不是徽标**。 */
export interface PrivateFoldWire {
  count: number
  label: string
  to: 'vault'
}

export function createSurfaceInject(connection: ConnectionHandle | undefined): SurfaceInject {
  /**
   * The host's own words, when it refused.
   *
   * `call` collapses every failure into `undefined`, which is right for a
   * READ — a lagging projection is not a broken view. It is wrong for a
   * write: the host refuses with a reason («这个真身已经立过目标了…»,
   * «找不到承诺…», «这条承诺已经完成了…»), and turning all of them into
   * 「通道无响应」 is a claim about the transport for failures that are not
   * transport failures — a guard whose explanation is discarded teaches
   * people the product randomly does nothing.
   */
  const write = async <T>(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<{ value?: T; error?: string }> => {
    if (connection === undefined) return { error: '通道未就绪' }
    try {
      const result = await connection.rpc.call('/yzj-next-surface', endpoint, payload)
      return result.ok
        ? { value: result.value as T }
        : { error: result.error?.message ?? '操作失败' }
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : '通道无响应' }
    }
  }

  const call = async <T>(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<T | undefined> => {
    if (connection === undefined) return undefined
    try {
      const result = await connection.rpc.call('/yzj-next-surface', endpoint, payload)
      return result.ok ? result.value as T : undefined
    } catch {
      // A transport failure is a lagging projection, not a broken view: the
      // caller renders what it last had and says the read failed.
      return undefined
    }
  }

  return {
    inbox: () => call<InboxView>('inbox', {}),
    async board() {
      return await call<BoardViewWire>('board', {}) ?? { rows: [], goals: [], unattached: [] }
    },
    async declareGoal(input) {
      const { error } = await write<{ commitmentId: string }>('declare-goal', { ...input })
      return error === undefined ? {} : { error }
    },
    async armTopicGoal(sessionId, goalRef, goalName) {
      const { error } = await write<{ topicKey: string }>('arm-topic-goal', {
        sessionId,
        ...(goalRef === undefined ? {} : { goalRef }),
        ...(goalName === undefined ? {} : { goalName }),
      })
      return error === undefined ? {} : { error }
    },
    async linkCommitments(goalRef, ids) {
      const result = await write<{ linked: number }>('link-commitments', { goalRef, ids: [...ids] })
      return result.error === undefined ? result.value ?? {} : { error: result.error }
    },
    async unlinkCommitments(ids) {
      const result = await write<{ unlinked: number }>('unlink-commitments', { ids: [...ids] })
      return result.error === undefined ? result.value ?? {} : { error: result.error }
    },
    async voidCommitment(id, reason) {
      const { error } = await write<{ id: string }>('void-commitment', {
        id, ...(reason === undefined ? {} : { reason }),
      })
      return error === undefined ? {} : { error }
    },
    goalPage: goalRef => call<GoalPageWire>('goal-page', { goalRef }),
    async postponeCommitment(id, due) {
      const { error } = await write<{ id: string }>('postpone-commitment', { id, due })
      return error === undefined ? {} : { error }
    },
    async mergeCommitment(id, into) {
      const { error } = await write<{ id: string }>('merge-commitment', { id, into })
      return error === undefined ? {} : { error }
    },
    async handoffContext(id) {
      const { value, error } = await write<{
        what?: string; due?: string
        executor?: { openId: string; name: string }; placeKey?: string; pending?: string[]
      }>('handoff-context', { id })
      return error === undefined ? value ?? {} : { error }
    },
    async objects(sessionId) {
      return await call<ObjectFaceWire>(
        'objects', sessionId === undefined ? {} : { sessionId },
      ) ?? { current: [], memory: [], resources: [] }
    },
    fused: sessionId => call<FusedWindowWire>('fused', { sessionId }),
    async sendToPlace(sessionId, text, replyTo, register, handoff) {
      const result = await write<SentInPlace>('send-to-place', {
        sessionId, text,
        ...(replyTo === undefined ? {} : { replyTo }),
        ...(register === undefined ? {} : { register }),
        ...(handoff === undefined ? {} : { handoff }),
      })
      return result.error === undefined ? result.value ?? {} : { error: result.error }
    },
    async lightAsk(sessionId, text) {
      const result = await write<{ answer: string }>('light-ask', { sessionId, text })
      return result.error === undefined ? result.value ?? {} : { error: result.error }
    },
    async forgetMemory(memoryId) {
      return await call<{ memoryId: string }>('memory-forget', { memoryId }) !== undefined
    },
    place: placeKey => call<PlaceViewWire>('place', { placeKey }),
    contract: placeKey => call<ContractViewWire>('contract', { placeKey }),
    async sendInPlace(placeKey, text, replyTo, register, handoff) {
      const result = await write<SentInPlace>('send-in-place', {
        placeKey,
        text,
        ...(replyTo === undefined ? {} : { replyTo }),
        ...(register === undefined ? {} : { register }),
        ...(handoff === undefined ? {} : { handoff }),
      })
      return result.error === undefined ? result.value ?? {} : { error: result.error }
    },
    async sendToPerson(openId, text, register, handoff) {
      const result = await write<SentInPlace & { placeKey?: string }>('send-to-person', {
        openId,
        text,
        ...(register === undefined ? {} : { register }),
        ...(handoff === undefined ? {} : { handoff }),
      })
      return result.error === undefined ? result.value ?? {} : { error: result.error }
    },
    async topicTail(sessionId) {
      return (await call<{ lines: string[] }>('topic-tail', { sessionId }))?.lines ?? []
    },
    async model() {
      return await call<{ provider?: string; model?: string }>('model', {}) ?? {}
    },
    /*
      A card action is a WRITE, so it goes through the helper that keeps the
      host's own words. `call` collapses every failure to `undefined`, which the
      column then explains as 「这张卡没有回应，可能已经被别人答过了」 — a
      confident, false diagnosis of an unknown action or a dead channel.
    */
    async cardAct(kind, id, actionId, input) {
      const { value, error } = await write<{ receipt: string; outcome: string }>(
        'card-act', { kind, id, actionId, ...(input === undefined ? {} : { input }) },
      )
      return value ?? { receipt: error ?? '这张卡没有回应。', outcome: 'failed' }
    },
    async setServed(placeKey, on) {
      const { value, error } = await write<{ served: boolean }>('set-served', { placeKey, on })
      return error === undefined ? { served: value?.served ?? on } : { error }
    },

    /* ——— 私账层（金库）. 每一个写动词都走 `write`：拒绝的原话必须原样带回来。 ——— */

    vault: windowDays => call<VaultViewWire>(
      'vault', windowDays === undefined ? {} : { windowDays },
    ),
    async privateRows() {
      const value = await call<{ rows: PrivateRowWire[]; fold: PrivateFoldWire | null }>(
        'private-rows', {},
      )
      return {
        rows: value?.rows ?? [],
        ...(value?.fold == null ? {} : { fold: value.fold }),
      }
    },
    async vaultEvidence(kind, id) {
      return await call<EvidenceFaceWire | null>(
        'pledger-evidence', kind === undefined || id === undefined ? {} : { kind, id },
      ) ?? undefined
    },
    async vaultSearch(query) {
      return (await call<{ hits: { zone: string; id: string; text: string }[] }>(
        'pledger-search', { query },
      ))?.hits ?? []
    },
    async vaultExport() {
      return await call<{ casebook: string; readme: string }>('pledger-export', {})
    },
    async setQuota(quota) {
      const { error } = await write<unknown>('pledger-quota', { quota })
      return error === undefined ? {} : { error }
    },
    async pledgerAct(kind, id, actionId, input) {
      const { value, error } = await write<{ receipt: string; outcome: string }>(
        'pledger-act', { kind, id, actionId, ...(input === undefined ? {} : { input }) },
      )
      return value ?? { receipt: error ?? '这张卡没有回应。', outcome: 'failed' }
    },
    async pledge(verdictKind, verdictId, text) {
      /*
        拒绝的**原话**要带回来 (断言⑭).

        「[window-closed] 那次裁决的立约邀约已经关上了…」和「[duplicate] 这次裁决
        已经立过预期了…」是两句不同的话，各自指向不同的下一步。合成一句「立不了」，
        人只能猜——而猜错的代价是白等一个检验点。
      */
      const { error } = await write<{ expectationId: string }>(
        'pledger-pledge', { verdictKind, verdictId, text },
      )
      return error === undefined ? {} : { error }
    },
    async declineInvite(inviteId) {
      const { error } = await write<{ receipt: string }>('pledger-decline', { inviteId })
      return error === undefined ? {} : { error }
    },
    async withdrawExpectation(expectationId, reason) {
      const { error } = await write<{ expectationId: string }>('pledger-withdraw', {
        expectationId, ...(reason === undefined ? {} : { reason }),
      })
      return error === undefined ? {} : { error }
    },
    async noteFact(input) {
      const { error } = await write<{ factId: string }>('pledger-note', { ...input })
      return error === undefined ? {} : { error }
    },
    async reattribute(calibrationId, attribution) {
      const { error } = await write<unknown>('pledger-reattribute', { calibrationId, attribution })
      return error === undefined ? {} : { error }
    },
    async shiftGear(family, gear, entry) {
      const { error } = await write<unknown>('pledger-shift', { family, gear, entry })
      return error === undefined ? {} : { error }
    },
    async toggleMirror(family, patternKey, on, entry) {
      const { error } = await write<unknown>('pledger-mirror', {
        family, patternKey, on, ...(entry === undefined ? {} : { entry }),
      })
      return error === undefined ? {} : { error }
    },
    async reopenInvites(family) {
      const { error } = await write<unknown>('pledger-reopen-invites', { family })
      return error === undefined ? {} : { error }
    },
    async destroyVault(confirm) {
      const { error } = await write<unknown>('pledger-destroy', { confirm })
      return error === undefined ? {} : { error }
    },
    attachment: (fileId, name) => call<AttachmentBodyWire>(
      'attachment', { fileId, ...(name === undefined ? {} : { name }) },
    ),
    async saveAttachment(fileId, name) {
      const { value, error } = await write<{ savedTo: string; size: number }>(
        'attachment-save', { fileId, ...(name === undefined ? {} : { name }) },
      )
      if (error !== undefined) return { error }
      return value?.savedTo === undefined ? {} : { savedTo: value.savedTo }
    },
    async tree() {
      return await call<TreeWire>('tree', {}) ?? { places: [] }
    },
    async delegateCandidates(goalRef) {
      const value = await call<{ candidates: { openId: string; name: string; why: string }[] }>(
        'delegate-candidates', goalRef === undefined ? {} : { goalRef },
      )
      // 读不到就是没有候选可摆——搜索那一层照旧在，人不会被卡住。
      return value?.candidates ?? []
    },
    async delegateRooms(who) {
      const value = await call<{ rooms: DelegateRoomWire[] }>(
        'delegate-rooms', who === undefined ? {} : { ...who },
      )
      // 读不到就是没有落点可摆——弹窗那一头会如实说，而不是显示一个空列表。
      return value?.rooms ?? []
    },
    async workspaces() {
      const { value, error } = await write<{ workspaces: WorkspaceWire[] }>('workspaces', {})
      if (error !== undefined) return { workspaces: [], error }
      return { workspaces: value?.workspaces ?? [] }
    },
    async createGoalBody(input) {
      const { value, error } = await write<{ url: string; note?: string }>('create-goal-body', { ...input })
      if (error !== undefined) return { error }
      // 没拿到链接就说没拿到——一个空的成功比一次失败更难查。
      if (value?.url === undefined) return { error: '云之家没有回传真身链接' }
      return value.note === undefined ? { url: value.url } : { url: value.url, note: value.note }
    },
    async people(keyword) {
      // 用 `write` 那条路不是因为它是写，是因为**只有它把宿主的原话带回来**：
      // 「云之家通道未就绪」和「一个也没搜到」必须是两句不同的话。
      const { value, error } = await write<{ people: PersonWire[] }>('people', { keyword })
      if (error !== undefined) return { people: [], error }
      return { people: value?.people ?? [] }
    },
    async events() {
      return (await call<{ events: BoardEventWire[] }>('events', {}))?.events ?? []
    },
    async createPlace(input) {
      // 走 `write` 不走 `call`：这是一次写，宿主拒绝的理由必须原样带回来。
      const { value, error } = await write<{ groupId: string; placeKey: string; served: boolean }>(
        'create-place',
        { ...input, ...(input.goalRef === undefined ? {} : { goalRef: input.goalRef }) },
      )
      return error === undefined ? { ...value } : { error }
    },
  }
}
