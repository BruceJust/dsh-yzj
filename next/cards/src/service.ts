/**
 * `ctx.yzjCards` — the card registry and the action bus.
 *
 * The bus is the single arbitration point for every surface (卡片三定律 ③).
 * Three properties it has to hold at once:
 *
 * 1. **First answer wins.** Answers are serialized per card, so two surfaces
 *    racing produce one `applied` and one `superseded` — never two effects.
 * 2. **Every answer leaves a trace.** `answer/recorded` is appended BEFORE the
 *    state events and regardless of outcome; a losing or unauthorized answer
 *    is still evidence that a human answered (§1.9-2).
 * 3. **Authorization is here, not in the UI.** The keyword channel makes
 *    acting cost one sentence, so `allowedActors` must run where every path
 *    converges.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  asObjectRef, asRecord, asString, asStringArray,
  type GraphActor, type GraphObject, type GraphViewer, type JsonValue,
} from '@yzj-next/graph'
import {
  CARD_TEXT_MAX_CHARS, MODE_BADGE,
  type AnswerableDemand,
  type CardActResult, type CardAction, type CardDefinition, type CardProjection,
  type CardRef, type CardTextProjection, type CardVia, type YzjCardChannel,
} from './types.ts'

/** One unanswered object, as the decision surfaces see it. */
export interface PendingDemand {
  readonly ref: CardRef
  readonly demand: AnswerableDemand
  /** 出生时刻——决断面按它排序，早等的先说。 */
  readonly at: number
  /** 它归属哪段语境。决断条「只收本语境直属」靠它。 */
  readonly topicKey?: string
  /**
   * 它升在哪个会话里 —— **本地会话是一等可应答语境** (v3.15 裁决③).
   *
   * 不是每张卡都住在云之家话题里：写确认常常升在一个本地会话中，那时 `topicKey` 是
   * 空的。只按话题定位的收件箱因此报得出数、却指不了路——「✋1」点下去跳到一个无关的
   * 群话题，逐级兑付在那里断掉。**兑付落点 = 对象真实所在面。**
   */
  readonly sessionAnchor?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjCards: YzjCards
    /** Provided by the channel plugin; absent when no transport is mounted. */
    yzjCardChannel?: YzjCardChannel
  }
  interface Events {
    /** A card reached a terminal state; carries the echo owed to text surfaces. */
    'yzj-cards/resolved'(payload: {
      cardRef: CardRef
      echoText: string
      projections: readonly CardProjection[]
    }): void
    /**
     * 一次**裁决**落地了 —— 通用事件，**总线不知道有谁在听**。
     *
     * 它带的只有**这次裁决的锚**：卡的 ref、动作 id、谁下的、什么时候。没有查询
     * 能力、没有任何订阅者专属的字段。一个专用钩子会让这里的代码知道下游是谁；
     * 一条通用事件不会，而「组织侧代码里不出现下游的名字」是一条**架构事实**比
     * 一条 lint 规则值钱的地方。
     *
     * 哪些动作算裁决由**家族自己**声明（{@link CardAction.verdict}）：这里既不
     * 枚举类型，也不判断轻重。
     */
    'yzj-cards/verdict-settled'(payload: {
      cardRef: CardRef
      /** 组织自己的话说的裁决种类，来自 {@link CardAction.verdict}。 */
      kind: string
      actionId: string
      actor: GraphActor
      at: number
      /**
       * 这张卡此刻的标题原文.
       *
       * **组织侧是唯一知道标题的人**，所以它随事件一起走。下游要拿它做什么，这里
       * 不知道也不该知道——但下游若拿不到，它就只能回头解析锚，而那正是「判例是
       * 空壳」的成因。**携锚必携文**，从这条事件的 payload 就开始。
       */
      titleText?: string
      /**
       * 分母两数的原料（v3.24r = #64 v1.2）：这张卡开出来的时刻与裁决落地的时刻——
       * 「等你多久」是组织付的摩擦；`dwellMs` 是桌面量到的停留（人的注意力成本），
       * 由发起动作的那一面带来，总线只转达。仍然不携任何查询能力。
       */
      openedAt?: number
      decidedAt?: number
      dwellMs?: number
    }): void
  }
}

const refKeyOf = (ref: CardRef): string => `${ref.kind}:${ref.id}`

export class YzjCards extends Service {
  private readonly definitions = new Map<string, CardDefinition<never>>()
  /** Per-card serialization: the whole point of "first answer wins". */
  private readonly gates = new Map<string, Promise<unknown>>()

  constructor(ctx: Context) {
    super(ctx, 'yzjCards')
  }

  register<S>(definition: CardDefinition<S>): () => void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`card type "${definition.type}" is already registered`)
    }
    this.definitions.set(definition.type, definition as unknown as CardDefinition<never>)
    return () => {
      if (this.definitions.get(definition.type) === (definition as unknown)) {
        this.definitions.delete(definition.type)
      }
    }
  }

  definition(type: string): CardDefinition<JsonValue> | undefined {
    return this.definitions.get(type) as CardDefinition<JsonValue> | undefined
  }

  /**
   * Who the desktop surface acts as. Set by the transport once the operator
   * identity is known; until then it is a bare `operator` that no card's
   * `allowedActors` will accept — fail closed, not fail open.
   */
  private operator: GraphActor = { kind: 'operator' }

  /**
   * 操作者自己叫什么。
   *
   * **和 actor 分开存**：`GraphActor` 上不加 `name`，否则每一条事件里都躺着一份显示
   * 用的名字，而名字是会变的——那就是第二本名录，且是永不更新的那种。这里存的是**当前
   * 会话的显示名**，只用来渲染与登记那一刻抄下的那份快照。
   *
   * 不知道就是 undefined。**不猜**：没有名字的时候写「我」，对任何第二个查看者都是
   * 一句假话。
   */
  private operatorDisplayName: string | undefined

  /** Bind the desktop's actor identity. Called by the channel at boot. */
  setDesktopActor(actor: GraphActor, name?: string): void {
    this.operator = actor
    this.operatorDisplayName = name
  }

  desktopActor(): GraphActor {
    return this.operator
  }

  /** 操作者的显示名；通道还没拿到身份时是 undefined。 */
  operatorName(): string | undefined {
    return this.operatorDisplayName
  }

  /** One card type's definition, for surfaces that render it themselves. */
  definitionOf(type: string): CardDefinition | undefined {
    return this.definitions.get(type)
  }

  /** Every registered card type, for prompt assembly and diagnostics. */
  types(): readonly string[] {
    return [...this.definitions.keys()]
  }

  /**
   * The keyword-bearing actions one card type declares. The loop-completeness
   * check reads this to assert that every answerable object actually has an
   * IM exit — a card with actions and no delivery path is an object nobody can
   * answer from where they are.
   */
  actionsOf(type: string): readonly string[] {
    const definition = this.definitions.get(type)
    if (definition === undefined) return []
    return definition.actions
      .filter(action => action.keywords.length > 0)
      .map(action => action.id)
  }

  /**
   * Resolve one free-text reply against this card's own `keywords[]` — the
   * single place text becomes an action. The leftover text comes back with it
   * (「取消 价格没定」 → reject + "价格没定"), because only the card knows
   * where its keyword ends; triage guessing at the first token would eat the
   * reason whenever no space separated it.
   */
  resolveKeyword(cardRef: CardRef, text: string): { actionId: string; input?: string } | undefined {
    const definition = this.definitions.get(cardRef.kind)
    if (definition === undefined) return undefined
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const normalized = normalize(trimmed)
    for (const action of definition.actions) {
      for (const keyword of action.keywords) {
        const target = normalize(keyword)
        if (target === '' || !normalized.startsWith(target)) continue
        const input = leftoverAfter(trimmed, keyword)
        return { actionId: action.id, ...(input === undefined ? {} : { input }) }
      }
    }
    return undefined
  }

  /** Text projection with the length contract applied. */
  /**
   * 文本投影，带上**它要去哪间屋子**。
   *
   * `placeKey` 不是装饰：一张卡里引用的别的对象（比如它挂的那个目标）未必和这张卡有
   * 同一个听众集合，而三态投影的第一问正是「这个查看者看得见它吗」(v4.22 裁决①)。
   * 缺席 = 投给操作者本人。
   */
  renderText(cardRef: CardRef, placeKey?: string): CardTextProjection | undefined {
    const definition = this.definitions.get(cardRef.kind)
    const object = this.ctx.yzjGraph.rawObject(cardRef.kind, cardRef.id)
    if (definition === undefined || object === undefined) return undefined
    const rendered = definition.renderText(
      object.state as never,
      placeKey === undefined ? undefined : { placeKey },
    )
    if (rendered.body.length <= CARD_TEXT_MAX_CHARS) {
      return { body: rendered.body, replyHints: rendered.replyHints, degraded: false }
    }
    const notice = '\n…（内容过长已截断，详见桌面工作台）'
    return {
      body: `${rendered.body.slice(0, CARD_TEXT_MAX_CHARS - notice.length)}${notice}`,
      replyHints: rendered.replyHints,
      degraded: true,
    }
  }

  /** Register one rendering of a card on a surface. Every fragment is recorded. */
  async project(projection: CardProjection): Promise<void> {
    await this.ctx.yzjGraph.append({
      type: 'card/projected',
      data: {
        cardRef: { kind: projection.cardRef.kind, id: projection.cardRef.id },
        surface: projection.surface,
        msgAnchors: [...projection.msgAnchors],
        ...(projection.placeKey === undefined ? {} : { placeKey: projection.placeKey }),
      },
      actor: { kind: 'agent' },
    })
  }

  /** Every surface this card has been rendered onto. */
  projectionsOf(cardRef: CardRef): readonly CardProjection[] {
    const key = refKeyOf(cardRef)
    return this.allProjections().filter(projection => refKeyOf(projection.cardRef) === key)
  }

  /**
   * Find the card a Yunzhijia message reply is addressing. Any registered
   * fragment anchors the whole card, so a multi-part projection still answers.
   */
  cardForAnchor(anchor: string): CardProjection | undefined {
    return this.allProjections().find(projection => projection.msgAnchors.includes(anchor))
  }

  private allProjections(): readonly CardProjection[] {
    const out: CardProjection[] = []
    for (const event of this.ctx.yzjGraph.rawEvents(['card/projected'])) {
      const data = asRecord(event.data)
      if (data === undefined) continue
      const cardRef = asObjectRef(data.cardRef)
      const surface = asString(data.surface)
      if (cardRef === undefined || surface === undefined) continue
      const placeKey = asString(data.placeKey)
      out.push({
        cardRef,
        surface,
        msgAnchors: asStringArray(data.msgAnchors),
        ...(placeKey === undefined ? {} : { placeKey }),
      })
    }
    return out
  }

  /**
   * The card a given tool call is blocked on, if any. Generic on purpose: the
   * desktop toolview knows a `callId`, not an object family, and the card
   * system should not learn what an approval is in order to answer.
   */
  cardForCall(sessionAnchor: string, callId: string): GraphObject | undefined {
    for (const kind of this.definitions.keys()) {
      for (const object of this.ctx.yzjGraph.query({ kind: 'operator', openId: '' }, { kind })) {
        const state = asRecord(object.state)
        if (state === undefined) continue
        if (state.callId === callId && state.sessionAnchor === sessionAnchor) return object
      }
    }
    return undefined
  }

  /** Pending cards a viewer may still answer — the restart-recovery entry. */
  pending(viewer: GraphViewer): readonly GraphObject[] {
    const known = new Set(this.definitions.keys())
    return this.ctx.yzjGraph.pendingAnswerables(viewer).filter(object => known.has(object.kind))
  }

  /**
   * 这个对象此刻在等什么 —— 家族说了算，视图不认识类型 (v4.15 家族即接口)。
   *
   * 没声明的按 `blocking` 收编，字面取文本投影的第一行:漏声明会发生,漏显示
   * 不可以——一个在等人答却哪儿都不出现的对象,正是 UI 自己开的幽灵承诺。
   */
  demandOf(object: GraphObject): AnswerableDemand | undefined {
    const definition = this.definitions.get(object.kind)
    if (definition === undefined) return undefined
    if (definition.isResolved(object.state as never)) return undefined
    const declared = definition.demand?.(object.state as never) ?? {
      layer: 'blocking' as const,
      mode: 'open-question' as const,
      label: headlineOf(definition.renderText(object.state as never).body),
    }
    /*
      徽标在**这里**定下来，不留给每一处投影各自去推。

      `badge ?? MODE_BADGE[mode]` 这一句一旦散在侧栏、群视图和决断条里，六种模式就有
      了三份映射表：加第七种的那天，三处得同时想起来改，而漏掉的那一处不会报错，只会
      把新模式画成一个别的词。所以出服务的门之前它就已经是一个定值。
    */
    return { ...declared, badge: declared.badge ?? MODE_BADGE[declared.mode] }
  }

  /**
   * 「本语境内未应答的可应答对象」——决断面读的**唯一**那个查询 (v4.15)。
   *
   * 会话决断条、收件箱的「需要你」、目标页决断层都投影自这里。它不枚举类型:
   * 家族增员(定向询问过门、转办认领上线)时,三处一行不改自动收编。
   *
   * `layer` 的过滤留给调用方,因为三层各有各的去处:`blocking` 进决断面,
   * `signal` 进留意层,`default-effective` 哪都不进只等被纠。
   */
  demands(viewer: GraphViewer): readonly PendingDemand[] {
    const out: PendingDemand[] = []
    for (const object of this.pending(viewer)) {
      const demand = this.demandOf(object)
      if (demand === undefined) continue
      const topicKey = contextOf(object)
      const sessionAnchor = asString(asRecord(object.state)?.sessionAnchor)
      out.push({
        ref: { kind: object.kind, id: object.id },
        demand,
        at: object.createdAt,
        ...(topicKey === undefined ? {} : { topicKey }),
        ...(sessionAnchor === undefined ? {} : { sessionAnchor }),
      })
    }
    return out
  }

  /**
   * Answer one card. Serialized per card so the arbitration is real rather
   * than hopeful.
   */
  async act(
    cardRef: CardRef,
    actionId: string,
    actor: GraphActor,
    via: CardVia,
    input?: string,
    /** 桌面量到的停留（毫秒）——只随裁决广播转达，不落组织图。 */
    meta?: { readonly dwellMs?: number },
  ): Promise<CardActResult> {
    const key = refKeyOf(cardRef)
    const previous = this.gates.get(key) ?? Promise.resolve()
    const running = previous
      .catch(() => undefined)
      .then(() => this.actExclusive(cardRef, actionId, actor, via, input, meta))
    this.gates.set(key, running)
    void running.catch(() => undefined).finally(() => {
      if (this.gates.get(key) === running) this.gates.delete(key)
    })
    return running
  }

  private async actExclusive(
    cardRef: CardRef,
    actionId: string,
    actor: GraphActor,
    via: CardVia,
    input?: string,
    meta?: { readonly dwellMs?: number },
  ): Promise<CardActResult> {
    const definition = this.definitions.get(cardRef.kind)
    if (definition === undefined) throw new Error(`unknown card type "${cardRef.kind}"`)
    const object = this.ctx.yzjGraph.rawObject(cardRef.kind, cardRef.id)
    if (object === undefined) throw new Error(`card ${refKeyOf(cardRef)} does not exist`)
    const state = object.state as never
    const action = definition.actions.find(candidate => candidate.id === actionId) as
      CardAction<never> | undefined
    if (action === undefined) throw new Error(`card "${cardRef.kind}" has no action "${actionId}"`)

    if (!action.allowedActors(actor, state)) {
      await this.recordAnswer(cardRef, actionId, actor, via, 'unauthorized')
      return { outcome: 'unauthorized', receipt: '你不是这张卡的决策人，本次应答已记录但未生效。' }
    }

    // Terminal first, availability second. Pressing the same button twice on a
    // settled card is a DUPLICATE (the honest description of a double tap);
    // only a card that is still live but has moved on gets the "not accepted
    // in this state" answer.
    if (definition.isResolved(state)) {
      const resolvedBy = lastAppliedAnswer(this.ctx, cardRef)
      const duplicate = resolvedBy?.actionId === actionId && resolvedBy.actor === actorKey(actor)
      const outcome = duplicate ? 'duplicate' : 'superseded'
      await this.recordAnswer(cardRef, actionId, actor, via, outcome)
      return {
        outcome,
        receipt: duplicate
          ? '这张卡已经按你的选择处理过了，本次重复应答未产生新动作。'
          : conflictReceipt(resolvedBy),
      }
    }

    if (action.available !== undefined && !action.available(state)) {
      await this.recordAnswer(cardRef, actionId, actor, via, 'superseded')
      return {
        outcome: 'superseded',
        receipt: `这张卡当前状态不接受「${action.label}」，本次应答已记录但未生效。`,
      }
    }

    // Answer first, effect second: the evidence that somebody answered must
    // survive even a crash between the two appends.
    await this.recordAnswer(cardRef, actionId, actor, via, 'applied')
    const transition = definition.apply(state, action, actor, input)
    for (const event of transition.events) await this.ctx.yzjGraph.append(event)

    const next = this.ctx.yzjGraph.rawObject(cardRef.kind, cardRef.id)
    const nextState = next?.state as never

    /*
      裁决落地的通用广播 —— 发完就算，谁也不等。

      发在状态事件**之后**：一个订阅者读到这条事件时，被裁决的那个对象必须已经是
      裁决之后的样子，否则它看见的是一个还没发生的裁决。发完不 await 任何东西——
      一条广播不该让答卡的人多等一次磁盘。

      `titleText` 从**裁决之后**的状态取：那才是这次裁决盖章的那份东西的名字。
    */
    if (action.verdict !== undefined) {
      const settled = asRecord(next?.state)
      const titleText = asString(settled?.what)
        ?? asString(settled?.summary)
        ?? asString(settled?.reason)
      const decidedAt = Date.now()
      this.ctx.emit('yzj-cards/verdict-settled', {
        cardRef,
        kind: action.verdict,
        actionId,
        actor,
        at: decidedAt,
        ...(titleText === undefined ? {} : { titleText }),
        openedAt: object.createdAt,
        decidedAt,
        ...(meta?.dwellMs === undefined ? {} : { dwellMs: meta.dwellMs }),
      })
    }

    if (next === undefined || !definition.isResolved(nextState)) {
      return { outcome: 'applied', receipt: '已记录。' }
    }
    const echo = definition.onResolved?.(nextState)
    const projections = this.projectionsOf(cardRef)
    if (echo !== undefined) {
      this.ctx.emit('yzj-cards/resolved', { cardRef, echoText: echo.echoText, projections })
    }
    return {
      outcome: 'applied',
      receipt: '已记录。',
      ...(echo === undefined ? {} : { echoText: echo.echoText }),
      projections,
    }
  }

  private async recordAnswer(
    cardRef: CardRef,
    actionId: string,
    actor: GraphActor,
    via: CardVia,
    outcome: 'applied' | 'superseded' | 'duplicate' | 'unauthorized',
  ): Promise<void> {
    await this.ctx.yzjGraph.append({
      type: 'answer/recorded',
      data: {
        cardRef: { kind: cardRef.kind, id: cardRef.id },
        actionId,
        actor: actorKey(actor),
        via,
        outcome,
      },
      actor,
    })
  }
}

interface AppliedAnswer {
  readonly actionId: string
  readonly actor: string
  readonly via: string
  readonly time: number
}

/** The answer that actually took effect on this card, when there was one. */
function lastAppliedAnswer(ctx: Context, cardRef: CardRef): AppliedAnswer | undefined {
  const key = refKeyOf(cardRef)
  let found: AppliedAnswer | undefined
  for (const event of ctx.yzjGraph.rawEvents(['answer/recorded'])) {
    const data = asRecord(event.data)
    if (data === undefined || data.outcome !== 'applied') continue
    const ref = asObjectRef(data.cardRef)
    if (ref === undefined || refKeyOf(ref) !== key) continue
    found = {
      actionId: asString(data.actionId) ?? '',
      actor: asString(data.actor) ?? '',
      via: asString(data.via) ?? '',
      time: event.time,
    }
  }
  return found
}

/**
 * A late answer that lost the race gets a LOUD receipt, not silence: the
 * design's ruling is that an already-executed action cannot be undone, so the
 * only honest thing left to do is say exactly who decided it, where, and when.
 */
function conflictReceipt(applied: AppliedAnswer | undefined): string {
  if (applied === undefined) return '这张卡已经处理完毕，本次应答未生效。'
  const when = new Date(applied.time).toLocaleString('zh-CN', { hour12: false })
  const where = applied.via === 'desktop' ? '桌面工作台' : applied.via === 'yzj-text' ? '云之家' : '系统'
  return `⚠️ 已于 ${when} 在${where}由 ${applied.actor} 选择「${applied.actionId}」并执行，本次应答未生效。`
}

function actorKey(actor: GraphActor): string {
  return actor.openId ?? actor.kind
}

/**
 * The text after a matched keyword, with the separator punctuation dropped.
 * Matching ignores whitespace, so the keyword may be spelt with spaces inside
 * it; walk the original text until as many non-space characters as the keyword
 * has have been consumed.
 */
function leftoverAfter(text: string, keyword: string): string | undefined {
  const wanted = normalize(keyword).length
  let consumed = 0
  let index = 0
  while (index < text.length && consumed < wanted) {
    if (!/\s/u.test(text[index] ?? '')) consumed += 1
    index += 1
  }
  const rest = text.slice(index).replace(/^[\s，,。．.：:；;!！?？]+/u, '').trim()
  return rest === '' ? undefined : rest
}

function normalize(text: string): string {
  return text.replace(/\s+/gu, '').replace(/[。．.!！?？,，;；:：]+$/u, '').toLowerCase()
}

/**
 * 一个对象归属哪段语境。
 *
 * 读的是**字段约定**（每个家族都写 `topicKey`；agent 执行者的承诺把它写在
 * `executor` 里）而不是类型判断——所以新家族只要照写这个字段就归位了，决断条
 * 「只收本语境直属」的那条空间规则也就自动对它成立。
 */
function contextOf(object: GraphObject): string | undefined {
  const state = asRecord(object.state)
  return asString(state?.topicKey) ?? asString(asRecord(state?.executor)?.topicKey)
}

/** 文本投影的第一行，短到能当 chip。没声明 `demand` 的家族靠它说话。 */
function headlineOf(body: string): string {
  const first = body.split('\n')[0]?.replace(/\s+/gu, ' ').trim() ?? ''
  if (first === '') return '有一件事等你答'
  return first.length <= 24 ? first : `${first.slice(0, 24)}…`
}
