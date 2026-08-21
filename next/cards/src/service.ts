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
  CARD_TEXT_MAX_CHARS,
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

  /** Bind the desktop's actor identity. Called by the channel at boot. */
  setDesktopActor(actor: GraphActor): void {
    this.operator = actor
  }

  desktopActor(): GraphActor {
    return this.operator
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
  renderText(cardRef: CardRef): CardTextProjection | undefined {
    const definition = this.definitions.get(cardRef.kind)
    const object = this.ctx.yzjGraph.rawObject(cardRef.kind, cardRef.id)
    if (definition === undefined || object === undefined) return undefined
    const rendered = definition.renderText(object.state as never)
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
    const declared = definition.demand?.(object.state as never)
    if (declared !== undefined) return declared
    return {
      layer: 'blocking',
      mode: 'open-question',
      label: headlineOf(definition.renderText(object.state as never).body),
    }
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
      out.push({
        ref: { kind: object.kind, id: object.id },
        demand,
        at: object.createdAt,
        ...(contextOf(object) === undefined ? {} : { topicKey: contextOf(object) as string }),
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
  ): Promise<CardActResult> {
    const key = refKeyOf(cardRef)
    const previous = this.gates.get(key) ?? Promise.resolve()
    const running = previous
      .catch(() => undefined)
      .then(() => this.actExclusive(cardRef, actionId, actor, via, input))
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
