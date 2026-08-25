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

export interface SurfaceInject {
  inbox(): Promise<InboxView | undefined>
  board(): Promise<BoardViewWire>
  /** 立目标 = 登记动词的看板形态：落真身 + 登记一步完成。 */
  declareGoal(input: {
    what: string
    goalRef: string
    owner?: string
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
  /** 移交：换人，不换承诺——出生边、听众、回执都还在这一条上。 */
  handoffCommitment(id: string, openId: string, name?: string): Promise<{ error?: string }>
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
  ): Promise<{ msgId?: string; error?: string }>
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
  ): Promise<{
    msgId?: string; ignited?: boolean; refused?: 'not-on-duty' | 'feed'; error?: string
  }>
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
  people(keyword: string): Promise<PersonWire[]>
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
    async handoffCommitment(id, openId, name) {
      const { error } = await write<{ id: string }>('handoff-commitment', {
        id, openId, ...(name === undefined ? {} : { name }),
      })
      return error === undefined ? {} : { error }
    },
    async objects(sessionId) {
      return await call<ObjectFaceWire>(
        'objects', sessionId === undefined ? {} : { sessionId },
      ) ?? { current: [], memory: [], resources: [] }
    },
    fused: sessionId => call<FusedWindowWire>('fused', { sessionId }),
    async sendToPlace(sessionId, text, replyTo) {
      const result = await write<{ msgId?: string }>('send-to-place', {
        sessionId, text, ...(replyTo === undefined ? {} : { replyTo }),
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
    async sendInPlace(placeKey, text, replyTo) {
      const result = await write<{
        msgId?: string; ignited: boolean; refused?: 'not-on-duty' | 'feed'
      }>('send-in-place', {
        placeKey, text, ...(replyTo === undefined ? {} : { replyTo }),
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
    async people(keyword) {
      return (await call<{ people: PersonWire[] }>('people', { keyword }))?.people ?? []
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
