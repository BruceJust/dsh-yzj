/**
 * The private action bus — **组件与状态机复用、存储不复用** (分册 §4).
 *
 * It answers cards the way `ctx.yzjCards` does, and it deliberately is NOT
 * `ctx.yzjCards`. That bus reads and writes `ctx.yzjGraph`; a private card
 * answered through it would put an expectation in the organization's ledger,
 * and `pendingAnswerables()` would then have to FILTER private objects out of
 * the inbox. 三不入靠存储分离不靠 filter (PTD-2): the failure class where
 * somebody forgets the filter has to be structurally absent, so the private
 * cards live on the private store and reach it through this bus instead.
 *
 * What IS reused is the whole contract — {@link CardDefinition},
 * {@link CardAction}, the resolved test, the keyword resolution, first-answer-
 * wins arbitration. A private card is written exactly like an organization
 * card; only its store differs.
 *
 * One vocabulary difference from the organization bus, and it is a rule rather
 * than an omission: **there is no `answer/recorded` in this ledger.** The
 * private vocabulary is closed (§3 全量), and the state events themselves are
 * the trace — 先答先赢 is decided by pgraph append order, which is what §6 says
 * it is. A losing answer still gets a loud receipt; it just does not mint a
 * private event to say somebody pressed a button twice.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CardAction, CardDefinition, CardVia } from '@yzj-next/cards'
import type { GraphActor, GraphObject, JsonValue } from '@yzj-next/graph'
import type { PledgerAppendInput, PledgerRef } from './types.ts'

/** Outcome of one private `act()`. Mirrors the organization bus's vocabulary. */
export type PledgerActOutcome = 'applied' | 'superseded' | 'duplicate' | 'unauthorized'

export interface PledgerActResult {
  readonly outcome: PledgerActOutcome
  /** Operator-facing receipt. A losing answer gets a loud one, never silence. */
  readonly receipt: string
}

const refKeyOf = (ref: PledgerRef): string => `${ref.kind}:${ref.id}`

/**
 * One private card type's definition. The organization's shape, narrowed:
 * `updateStrategy` and `demand` are absent from every private card by
 * construction — 三不入 means a private object never declares a demand, so
 * nothing that reads demands can ever pick it up even if the stores were
 * somehow merged.
 */
export type PledgerCardDefinition<S = JsonValue> = Omit<CardDefinition<S>, 'demand' | 'updateStrategy'>

export class PledgerCards {
  private readonly definitions = new Map<string, PledgerCardDefinition<never>>()
  /** Per-card serialization: 先答先赢 has to be real rather than hopeful. */
  private readonly gates = new Map<string, Promise<unknown>>()

  constructor(private readonly ctx: Context) {}

  register<S>(definition: PledgerCardDefinition<S>): () => void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`pledger card type "${definition.type}" is already registered`)
    }
    this.definitions.set(definition.type, definition as unknown as PledgerCardDefinition<never>)
    return () => {
      if (this.definitions.get(definition.type) === (definition as unknown)) {
        this.definitions.delete(definition.type)
      }
    }
  }

  definition(type: string): PledgerCardDefinition<JsonValue> | undefined {
    return this.definitions.get(type) as PledgerCardDefinition<JsonValue> | undefined
  }

  types(): readonly string[] {
    return [...this.definitions.keys()]
  }

  /** Text projection of one private card, for the self-chat DM. */
  renderText(ref: PledgerRef): { body: string; replyHints: readonly string[] } | undefined {
    const definition = this.definitions.get(ref.kind)
    const object = this.ctx.yzjPledger?.object(ref.kind, ref.id)
    if (definition === undefined || object === undefined) return undefined
    return definition.renderText(object.state as never)
  }

  /**
   * Resolve one free-text reply against a private card's own keywords.
   *
   * The self-chat DM is a real answer path (§4 投影通道②): a receipt read on a
   * phone must be answerable from the phone, and the keyword route is what
   * makes acting cost one sentence there.
   */
  resolveKeyword(ref: PledgerRef, text: string): { actionId: string; input?: string } | undefined {
    const definition = this.definitions.get(ref.kind)
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

  /** Every unanswered private card of one kind — what the private stream shows. */
  open(kind: string): readonly GraphObject[] {
    const definition = this.definitions.get(kind)
    if (definition === undefined) return []
    return (this.ctx.yzjPledger?.query(kind) ?? [])
      .filter(object => !definition.isResolved(object.state as never))
  }

  /** Answer one private card. Serialized per card. */
  async act(
    ref: PledgerRef,
    actionId: string,
    actor: GraphActor,
    via: CardVia,
    input?: string,
  ): Promise<PledgerActResult> {
    const key = refKeyOf(ref)
    const previous = this.gates.get(key) ?? Promise.resolve()
    const running = previous
      .catch(() => undefined)
      .then(() => this.actExclusive(ref, actionId, actor, via, input))
    this.gates.set(key, running)
    void running.catch(() => undefined).finally(() => {
      if (this.gates.get(key) === running) this.gates.delete(key)
    })
    return running
  }

  private async actExclusive(
    ref: PledgerRef,
    actionId: string,
    actor: GraphActor,
    _via: CardVia,
    input?: string,
  ): Promise<PledgerActResult> {
    const pledger = this.ctx.yzjPledger
    if (pledger === undefined) throw new Error('私账层未启用')
    const definition = this.definitions.get(ref.kind)
    if (definition === undefined) throw new Error(`unknown pledger card type "${ref.kind}"`)
    const object = pledger.object(ref.kind, ref.id)
    if (object === undefined) throw new Error(`私账卡 ${refKeyOf(ref)} 不存在`)
    const state = object.state as never
    const action = definition.actions.find(candidate => candidate.id === actionId) as
      CardAction<never> | undefined
    if (action === undefined) throw new Error(`私账卡 "${ref.kind}" 没有动作 "${actionId}"`)

    /*
      **这本账的债主是你自己** —— 所以授权只有一个人能过，而且不是靠界面藏按钮。
      文本通道让应答的代价降到一句话，检查就必须落在每条路径的交汇处。
    */
    if (!action.allowedActors(actor, state)) {
      return { outcome: 'unauthorized', receipt: '这是别人的账本，本次应答未生效。' }
    }
    if (definition.isResolved(state)) {
      return {
        outcome: 'duplicate',
        receipt: '这一条已经答过了。归因可以改（改归因是追加一条，最新生效），撤回不可悔棋。',
      }
    }
    if (action.available !== undefined && !action.available(state)) {
      return {
        outcome: 'superseded',
        receipt: `这张卡当前状态不接受「${action.label}」，本次应答未生效。`,
      }
    }
    const transition = definition.apply(state, action, actor, input)
    for (const event of transition.events) {
      await pledger.append(event as unknown as PledgerAppendInput)
    }
    return { outcome: 'applied', receipt: '已记在你的账上。' }
  }
}

/**
 * The text after a matched keyword, with separator punctuation dropped.
 * Copied in shape from the organization bus for one reason: the two must agree
 * about where a keyword ends, or「取消 价格没定」means different things on the
 * two ledgers.
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
