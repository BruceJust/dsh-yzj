/**
 * Card contracts. A card is not a widget — it is one renderable projection of
 * a graph object (卡片三定律 ①). Its state always comes from the graph, never
 * from host memory, so a restart cannot lose a pending question (§1.9-1).
 *
 * The node half owns the type registry, the state machine and the text
 * projection; the browser half owns `renderDesktop` and is registered
 * separately in the client bundle. Keeping React out of this module is what
 * lets the action bus be the single arbiter for BOTH surfaces.
 */

import type { GraphActor, GraphAppendInput, JsonValue, ObjectRef } from '@yzj-next/graph'

/** Where an answer arrived from. Recorded on every `answer/recorded`. */
export type CardVia = 'desktop' | 'yzj-text' | 'system'

/** Address of one card = address of its graph object. */
export type CardRef = ObjectRef

/** Contract cap for one text projection (F2: content ≤ 4000 chars on the wire). */
export const CARD_TEXT_MAX_CHARS = 3_800

/** One action a card offers. */
export interface CardAction<S = JsonValue> {
  readonly id: string
  readonly label: string
  readonly style?: 'primary' | 'danger' | 'neutral'
  /**
   * Text-channel keywords that resolve to this action. THE single source of
   * truth for turning a Yunzhijia reply ("确认") into an action id — triage
   * code never grows a branch per card type (§2 registration surface).
   */
  readonly keywords: readonly string[]
  /**
   * Authorization predicate. Lives in the state machine, never in a UI: the
   * keyword channel drops the cost of acting to one sentence, so the check
   * has to sit where every surface passes through (卡片三定律 ③).
   */
  allowedActors(actor: GraphActor, state: S): boolean
  /**
   * Whether this action is offered in the CURRENT state — distinct from who
   * may take it. Answering "确认" to a card that has since been interrupted is
   * not an authorization failure, and telling the operator it is would be a
   * lie about why nothing happened.
   */
  available?(state: S): boolean
  /** Whether this action consumes the free text that came with the answer. */
  readonly needsInput?: boolean
  /**
   * 这个动作是一次**人签发的裁决**，而这个字符串是它的**种类** —— 家族自己说。
   *
   * 声明它的家族会在这个动作落地时经动作总线发一条通用的
   * `yzj-cards/verdict-settled`。**总线不知道有谁在听**，也不需要知道：这是
   * 「家族即接口」的又一次落点，和 {@link CardDefinition.demand} 同一条纪律。
   *
   * **为什么是种类而不是布尔**：布尔逼着发射点自己判断「这一次值不值得下游关心」
   * ——那就是把下游的判据搬进了组织侧。种类只是**用组织自己的话说清这是哪一种
   * 裁决**（`acceptance` / `rework` / `assessment` / `delegation` / `write-confirm`
   * …），值不值得关心由听的人自己决定。于是这里可以**如实声明全部人签发裁决终态**，
   * 而组织侧代码里一个下游的判据分支都不出现。
   */
  readonly verdict?: string
}

/**
 * 六交互模式 (v4.15 可应答分类学全名册)。
 *
 * **模式有限，场景实例开放**——这是同构复制原则在类型上的样子。Bruce 问的是
 * 「确认是其中一种状态，还有其他状态吗」，而任何以枚举场景作答的名册都会在下一
 * 个场景出现时再被问一次。所以归类按**人要做的那个动作**，不按事情叫什么名字：
 * 六种动作是封闭的，用这六种动作的场景永远开放。
 *
 * 一个新家族只要声明自己属于哪一种，「需要你」的每一处投影就自动收编了它——
 * 不改视图、不改收件箱、不改决断条。
 */
export type AnswerableMode =
  /** ①单答确认：确认卡／授权租约创建／冲突确认。一个问题一个答案。 */
  | 'single-confirm'
  /** ②逐条裁决：裁决卡／提案裁决／移交裁决。一张卡上 N 条各自定生死。 */
  | 'per-item-verdict'
  /** ③双动词验收：验收卡。验收/拒收，拒收→返工→再验收在同一张卡上循环。 */
  | 'two-verb-acceptance'
  /** ④签发：目标签发卡。方向承诺落库——只有人能按。 */
  | 'issuance'
  /** ⑤多出口评估：差距简报。验收／差距变委派／继续／作废。 */
  | 'multi-exit-assessment'
  /** ⑥待答询问：定向询问卡／转办认领。回复即应答。 */
  | 'open-question'

/**
 * 全局三层定律 (v4.15)。**只有 `blocking` 进决断面。**
 *
 * - `blocking` **阻塞待答**：上面那六种。进决断条、进收件箱的「需要你」、进目标页
 *   决断层，先答先赢。
 * - `default-effective` **默认生效可纠**：挂接推断 ack／回执状态提议／蒸馏公示。
 *   宁默认勿阻塞。塞进决断条 = 把「可纠」升格成「待答」，用户被迫为每一个默认值
 *   签一次字——零维护当场阵亡。
 * - `signal` **信号 + 就近动词**：逾期／等待超期／无信号老化／staleness／真身之变。
 *   它们是信号不是对象，动词就近长在行上，进留意层不进决断层。
 */
export type AnswerableLayer = 'blocking' | 'default-effective' | 'signal'

/**
 * 一个未应答对象自己说的「我是什么在等你」。
 *
 * 由**家族自己**声明，而不是由视图按类型判断——这是「家族即接口」条款的落点：
 * 决断条、收件箱、目标页决断层读的都是这一个抽象，谁也不认识 approval 或 task。
 */
export interface AnswerableDemand {
  readonly layer: AnswerableLayer
  readonly mode: AnswerableMode
  /** chip 与行预览的字面。短到能并排放下，且自己说清在等什么。 */
  readonly label: string
  /**
   * 徽标的短字面。默认由 {@link MODE_BADGE} 从 `mode` 推出。
   *
   * 声明它只为一件事：**模式相同但「等的是什么」在人眼里不同**——冲突待裁与
   * 普通确认同属单答确认，可它们在一屏上必须一眼能分开。这仍不是类型枚举：说话
   * 的是家族自己，视图照读不误。
   */
  readonly badge?: string
}

/** 六种模式各自的徽标字面。新家族声明模式即得徽标，无需改任何视图。 */
export const MODE_BADGE: Readonly<Record<AnswerableMode, string>> = {
  'single-confirm': '待确认',
  'per-item-verdict': '待裁决',
  'two-verb-acceptance': '待验收',
  issuance: '待签发',
  'multi-exit-assessment': '待验收',
  'open-question': '待答',
}

/** The events one accepted action appends, decided by the card's state machine. */
export interface CardTransition {
  /** State events to append, in order, after the answer has been recorded. */
  readonly events: readonly GraphAppendInput[]
  /**
   * 这一次落地是哪一种裁决——由 `apply` 按状态说，压过动作上静态声明的 {@link CardAction.verdict}。
   * 同一张卡两种模式（拆解提案 vs 发现裁决）时，同一个「确认」动词是两种裁决；逐条裁决时
   * `key` 把条目带进裁决键（`confirmed:2`），否则第二条的裁决会被第一条的幂等锚吸收。
   */
  readonly verdict?: { readonly kind: string; readonly key?: string }
}

/**
 * How a card's projection is refreshed on a surface that already shows it.
 * `append-echo` is the only strategy an ordinary Yunzhijia message supports
 * (F1:普通消息不可编辑). `edit-in-place` names its future carrier — the native
 * message card, the one editable message on the platform — so the projection
 * coordinator has somewhere to branch when that channel lands.
 */
export type CardUpdateStrategy = 'append-echo' | 'edit-in-place'

/**
 * Node-half definition of one card type.
 *
 * `renderDesktop` from the design's interface lives in the BROWSER half and is
 * registered per card type there: a node bundle that imported React would drag
 * it into the host process for nothing. Both halves answer through this one
 * action bus, which is what the split has to preserve.
 */
export interface CardDefinition<S = JsonValue> {
  /** Card type == graph object kind. */
  readonly type: string
  /**
   * The card's own state shape. The graph family validates on write; this is
   * what narrows the state for rendering and — once LLM-authored cards land —
   * what a named narrow tool derives its parameters from (§4: 参数即 schema).
   */
  readonly schema?: { parse(value: unknown): S }
  /** Refresh strategy for an already-projected surface. */
  readonly updateStrategy?: CardUpdateStrategy
  readonly actions: readonly CardAction<S>[]
  /**
   * 这个对象此刻在等什么 (v4.15 家族即接口)。
   *
   * 不声明也会被收编——缺省是 `blocking` + `open-question`，字面取 `renderText`
   * 的第一行。**默认必须是「进决断面」**：一个在等人答却哪儿都不显示的对象，正是
   * 幽灵承诺禁令要禁的那种东西，而漏声明是会发生的，漏显示不可以。
   *
   * 反过来，`signal` 与 `default-effective` 必须**显式**说出来：把一条逾期承诺
   * 或一次可纠的默认值塞进决断条，用户就得为每个默认值签一次字。
   */
  demand?(state: S): AnswerableDemand | undefined
  /** Terminal states take no further action; a late answer gets a receipt. */
  isResolved(state: S): boolean
  /**
   * Text projection for a Yunzhijia surface: self-sufficient prose (a native
   * user with no client must be able to act on it) plus reply hints. The bus
   * enforces {@link CARD_TEXT_MAX_CHARS} and degrades overflow.
   */
  /**
   * 这张卡投到某个面上时的文本。
   *
   * `view.placeKey` 是**要投进哪间屋子**——只有需要按可见域裁剪的家族才读它（目标标题
   * 的三态投影，v4.22 裁决①）。缺席 = 投给操作者本人，他看的是自己那份分区。
   *
   * 大多数家族用不上它：一张卡的正文本来就只说这张卡自己的事。会用到的是那些**引用了
   * 别的对象**的行——被引用的那个东西未必和这张卡有同一个听众集合。
   */
  renderText(
    state: S, view?: { readonly placeKey?: string },
  ): { body: string; replyHints: readonly string[] }
  /**
   * Terminal echo, posted to every text surface this card was projected onto.
   * Yunzhijia messages cannot be edited (F1), so without this the "please
   * confirm" call to action hangs forever after the decision (卡片三定律 ②).
   */
  /**
   * 一次**没有**走到终态的动作落地后，卡想对文字面说的话（回声）。缺席 = 「已记录。」。
   * 用处：同侪实例的镜像行要靠带句柄的回声前进（#63 镜像行——打回不是终态，但对面的图得知道）。
   */
  onUpdated?(state: S, action: CardAction<S>): { readonly echoText: string } | undefined

  onResolved?(state: S): { echoText: string } | undefined
  /** Apply one authorized action to the current state. */
  apply(state: S, action: CardAction<S>, actor: GraphActor, input?: string): CardTransition
}

/** Outcome of one `act()`, mirroring the `answer/recorded` vocabulary. */
export type CardActOutcome = 'applied' | 'superseded' | 'duplicate' | 'unauthorized'

export interface CardActResult {
  readonly outcome: CardActOutcome
  /** Operator-facing receipt. A losing answer gets a LOUD conflict receipt. */
  readonly receipt: string
  /** Present when the action drove the card to a terminal state. */
  readonly echoText?: string
  /** Text surfaces to echo onto, resolved from `card/projected`. */
  readonly projections?: readonly CardProjection[]
}

/** One registered rendering of a card on a surface. */
export interface CardProjection {
  readonly cardRef: CardRef
  readonly surface: string
  readonly msgAnchors: readonly string[]
  readonly placeKey?: string
}

/**
 * Transport seam: how a card reaches the operator's Yunzhijia surfaces. The
 * card system never learns what Yunzhijia is — the channel plugin provides
 * this on the context and object families consume it optionally, so an object
 * family stays testable with no transport at all.
 */
export interface YzjCardChannel {
  /**
   * Deliver one card's text projection to the operator's own chat and return
   * the projection that was registered, or undefined when the channel is
   * offline (the caller degrades rather than blocking).
   */
  deliverToOperator(cardRef: CardRef): Promise<CardProjection | undefined>
  /**
   * Put one card in the place the work is happening in, and register the
   * projection so its keywords resolve there. A conflict has to be visible to
   * the people who caused it, and a registered commitment has to be
   * correctable by the person it names — delivering either to the operator's
   * own chat would put the answer path in the wrong room.
   */
  deliverToPlace(cardRef: CardRef, placeKey: string, replyTo?: string): Promise<CardProjection | undefined>
  /** Post one line onto an already-registered projection. */
  echo(projection: CardProjection, text: string): Promise<void>
}

/** Rendered text projection of one card. */
export interface CardTextProjection {
  readonly body: string
  readonly replyHints: readonly string[]
  /** True when the body was clipped and points at the desktop instead. */
  readonly degraded: boolean
}
