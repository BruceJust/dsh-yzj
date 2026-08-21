/**
 * The commitment family's named narrow tools.
 *
 * Narrow rather than general on purpose (TD-8): the parameters ARE the object's
 * schema, so the validation gate cannot be walked around. A general
 * "emit any card" tool would hand the model a way to author objects nobody
 * declared, which is the opposite of what the gate is for.
 *
 * Neither tool takes a viewer or an idempotency anchor. Both are computed here
 * from the turn — a model that could name its own anchor could split one
 * commitment into two, and a model that could name its own viewer could read
 * across places and then say it out loud.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { asRecord, asString } from '@yzj-next/graph'
import { commitmentIdFor, commitmentIdemKeyFor, type CommitmentState } from './family.ts'
import { armedGoalOf } from '../goal/family.ts'
import type { TurnBinding } from '../turns.ts'

const output = {
  schema: {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: {
      content: { type: 'string' as const, required: true as const },
      commitmentId: { type: 'string' as const },
    },
  },
  render: (_args: unknown, value: { content: string }) => [
    { type: 'text' as const, text: value.content },
  ],
}

/** The turn's binding, or undefined outside a bound turn. */
function bindingOf(ctx: Context, agent: Agent | undefined): TurnBinding | undefined {
  if (agent === undefined) return undefined
  const turns = ctx.get('yzjTurns')
  return turns?.bindingFor(agent) ?? turns?.defaultBinding()
}

/**
 * The anchor a registration is attributed to: the inbound message when the
 * turn came from Yunzhijia, the session otherwise. It is also what the
 * idempotency key is derived from, so "the same utterance registered twice"
 * collapses while "two utterances that sound alike" do not.
 */
function sourceAnchorOf(binding: TurnBinding | undefined, agent: Agent | undefined): string {
  if (binding?.messageId !== undefined) return `yzj:${binding.messageId}`
  return `session:${String(agent?.session.id ?? 'unknown')}`
}

/**
 * The goal this topic is already working toward, if any.
 *
 * Two sources, in that order (v4.9 判定序：显式 > 语境继承 > 保守推断):
 *
 * 1. **What the conversation was ARMED with.** Teleporting from a goal into a
 *    conversation and speaking there is a human act that says "this window
 *    serves that goal" — 挂接引用是语境的属性, and this is the property. It wins
 *    because it is a fact somebody stated, not a pattern something noticed.
 * 2. **What the work already here serves.** If every open commitment in this
 *    topic points at one goal, new work started here serves it too. Two
 *    different goals means the context is ambiguous, and an ambiguous context
 *    inherits nothing — 宁空勿错.
 *
 * Neither is inference. Both are facts about where the work was born, which is
 * why the ack calls it 继承 and offers correction rather than apology.
 */
function goalOfTopic(ctx: Context, topicKey: string | undefined): string | undefined {
  if (topicKey === undefined) return undefined
  const armed = armedGoalOf(ctx.yzjGraph.rawObject('goal-context', topicKey))
  if (armed !== undefined) return armed
  const refs = new Set<string>()
  for (const object of ctx.yzjGraph.query(
    { kind: 'operator', openId: '' }, { kind: 'commitment', status: ['open'] },
  )) {
    const state = asRecord(object.state)
    // Registered in this topic, whoever ends up doing it. Reading
    // `executor.topicKey` alone matched only agent-executed rows, which is why
    // this could never fire on the commitments the design is actually about.
    const where = asString(state?.topicKey) ?? asString(asRecord(state?.executor)?.topicKey)
    if (where !== topicKey) continue
    const ref = asString(state?.parentGoalRef)
    if (ref !== undefined) refs.add(ref)
  }
  return refs.size === 1 ? [...refs][0] : undefined
}

export function applyCommitmentTools(ctx: Context): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'commitment_register',
    description: 'Register a commitment that a PERSON (not you) has taken on, when somebody in this conversation said they would do something. Use it for "让张三负责 B" / "我明天给你" / "老王来对一下" — one call per commitment, quoting what was actually promised. Do NOT use it for your own work; your own tasks are recorded automatically. Only attach parentGoalRef when the goal was actually mentioned — leave it out when unsure.',
    parameters: {
      what: { type: 'string', required: true, description: 'What was promised, in the promiser\'s own terms.' },
      executorOpenId: { type: 'string', description: 'openId of the person who owes it (resolve via yzj_contact_search). Omit only when the commitment is yours.' },
      executorName: { type: 'string', description: 'Display name of that person, for readable cards.' },
      due: { type: 'string', description: 'Deadline exactly as stated ("明天下班前", "8/20"); omit when none was given.' },
      parentGoalRef: { type: 'string', description: 'URI/link of the Yunzhijia goal document or table this serves, when it was actually referenced.' },
      inferred: { type: 'boolean', description: 'True when you INFERRED the parent goal rather than being told it. Inferred links are shown for correction.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const anchor = sourceAnchorOf(binding, exec.agent)
      const idemKey = commitmentIdemKeyFor(anchor, args.what)
      const existing = ctx.yzjGraph.findByIdemKey(idemKey)
      if (existing !== undefined) {
        return {
          content: `已登记过同一条承诺（${existing.id}），未重复创建。`,
          commitmentId: existing.id,
        }
      }
      const commitmentId = commitmentIdFor(anchor, args.what)
      /*
        出生时刻 · 语境继承 (v4.8).

        挂接引用是语境的属性：work started inside a topic that already serves a
        goal serves that goal too, and asking the model to notice and repeat
        the URI is asking it to re-derive something the context already holds.
        Most attachment should cost zero operations, and this is where.

        Inheritance is NOT inference — it is a fact about where the work was
        born, so it is marked `inherited` and the ack shows it. 未挂是合法状态:
        when the context carries nothing, nothing is attached, and that is a
        legal outcome rather than a gap to fill with a guess.
      */
      /*
        判定序：显式提及 > 语境继承（确定性）> 保守推断 (v4.9).

        The order matters and it was wrong: any `parentGoalRef` the model
        supplied won, including one it had merely GUESSED — so a guess
        overrode a fact a person had stated by teleporting in and speaking
        here. That is exactly backwards. 继承 is deterministic (somebody put
        the reference on this conversation); 推断 is the model noticing a
        resemblance, and 错挂即汇报污染.

        So inference is separated from statement and drops below inheritance:
        it only decides when the context carries nothing at all.
      */
      const stated = args.inferred === true ? undefined : args.parentGoalRef
      const guessed = args.inferred === true ? args.parentGoalRef : undefined
      const inherited = stated === undefined ? goalOfTopic(ctx, binding?.topicKey) : undefined
      const goalRef = stated ?? inherited ?? guessed
      const via = stated !== undefined
        ? 'explicit'
        : inherited !== undefined ? 'inherited' : 'inferred'
      const executor = args.executorOpenId === undefined
        ? { kind: 'agent' as const, topicKey: binding?.topicKey ?? 'desktop' }
        : {
          kind: 'human' as const,
          openId: args.executorOpenId,
          ...(args.executorName === undefined ? {} : { name: args.executorName }),
        }
      await ctx.yzjGraph.append({
        type: 'commitment/opened',
        data: {
          commitmentId,
          what: args.what,
          executor,
          sourceAnchor: anchor,
          // Where it was promised — the context inheritance reads this, and it
          // is true for a human executor as much as for the agent.
          ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
          ...(args.due === undefined ? {} : { due: args.due }),
          ...(goalRef === undefined ? {} : { parentGoalRef: goalRef, attachedVia: via }),
          // Inherited from the utterance that registered it — the manager's
          // frame and the listener-set rule are the same rule.
          ...(binding?.audience === undefined ? {} : { audience: [...binding.audience] }),
          idemKey,
        },
        actor: { kind: 'agent' },
      })
      // The registration is announced in the place it was made, with its own
      // answer path: the person named is usually not the operator, and making
      // the operator relay "he says it is done" is the pumping the design
      // forbids. An inferred parent goal is shown on that same card so it can
      // be corrected in public.
      const delivered = binding?.placeKey === undefined
        ? undefined
        : await ctx.get('yzjCardChannel')?.deliverToPlace(
          { kind: 'commitment', id: commitmentId }, binding.placeKey,
        )
      // The ack names how the reference actually got attached — off `via`, not
      // off what the model asked for. When a guess loses to the context, the
      // ack must say 继承, because that is what happened.
      const inferredNote = goalRef === undefined
        ? ''
        : via === 'inferred'
          ? '（父目标为推断，已在卡上标出可纠正）'
          : via === 'inherited'
            ? `（父目标从本话题的语境继承：${goalRef}，说错了直接说）`
            : ''
      return {
        content: delivered === undefined
          ? `已登记承诺：${args.what}${args.due === undefined ? '' : `（期限 ${args.due}）`}${inferredNote}。请在你的回复里向大家说明这条登记，让他们能纠正。`
          : `已登记承诺并在会话里公示：${args.what}${args.due === undefined ? '' : `（期限 ${args.due}）`}${inferredNote}。`,
        commitmentId,
      }
    },
  }))

  register(defineTool({
    name: 'commitment_receipt',
    /*
      「作废」不是这个工具能干的事，而它长得太像了。

      实跑里出现过一次：操作者说「把这两条探针作废掉」，agent 手上**没有作废工具**
      （作废是主权动作，只从卡与承诺板出——那个边界是对的），于是它退而求其次记了
      两条回执。后果不是少做一件事，是**记录变成了假话**：操作者要杀掉的那条承诺，
      图上留下的是「有人报告了进展」，而这套系统全部的价值就押在记录诚实上。

      少一个动词是设计，悄悄换一个动词不是。所以把这条写进工具描述里——没有的动词
      就说没有，指回那个按钮。
    */
    description: 'Record a reply you observed about an existing commitment — "分析发了" / "明天给" / "做不了了". This is how a commitment breathes after registration; without it the operator has to relay every status by hand. Apply the change the reply actually implies, nothing more. NEVER use this as a stand-in for a verb you do not have: 作废 / 顺延 / 移交 / 合并 are the operator\'s own, and they live on the commitment board and the cards. If you are asked for one of those, say plainly that it is their button to press and where it is — filing a receipt instead leaves the graph saying somebody reported progress on work the operator wanted killed.',
    parameters: {
      commitmentId: { type: 'string', required: true, description: 'The commitment this reply is about (from graph_query).' },
      text: { type: 'string', required: true, description: 'What they said, quoted.' },
      kind: { type: 'string', enum: ['human-reply', 'external'], description: 'human-reply for a colleague in this system; external for somebody reached off-platform.' },
      newDue: { type: 'string', description: 'New deadline, when the reply moved it.' },
      completed: { type: 'boolean', description: 'True only when the reply says the work is DONE.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const object = ctx.yzjGraph.rawObject('commitment', args.commitmentId)
      if (object === undefined) {
        return { content: `找不到承诺 ${args.commitmentId}，请先用 graph_query 查一下。` }
      }
      const state = object.state as unknown as CommitmentState
      const proposedChange: Record<string, string | boolean> = {}
      if (args.newDue !== undefined) proposedChange.due = args.newDue
      if (args.completed === true) proposedChange.completed = true

      await ctx.yzjGraph.append({
        type: 'receipt/recorded',
        data: {
          objectRef: { kind: 'commitment', id: args.commitmentId },
          kind: args.kind ?? 'human-reply',
          anchor: asString(asRecord(object.state)?.sourceAnchor) ?? state.sourceAnchor,
          text: args.text,
          ...(Object.keys(proposedChange).length === 0 ? {} : { proposedChange }),
        },
        actor: { kind: 'agent' },
      })

      // Effective IMMEDIATELY, with the correction shown — not held in a
      // "proposed" limbo. Correction is an append, so applying now and letting
      // somebody fix it beats making everybody wait for an approval nobody
      // asked for.
      if (args.completed === true) {
        await ctx.yzjGraph.append({
          type: 'commitment/closed',
          data: { commitmentId: args.commitmentId, cause: 'receipt' },
          actor: { kind: 'agent' },
        })
      } else {
        await ctx.yzjGraph.append({
          type: 'commitment/updated',
          data: {
            commitmentId: args.commitmentId,
            lastReceipt: args.text,
            ...(args.newDue === undefined ? {} : { due: args.newDue }),
          },
          actor: { kind: 'agent' },
        })
      }
      return {
        content: args.completed === true
          ? `已记录回执并关闭承诺「${state.what}」。请在回复里公示这一变更（说错了可以直接纠正）。`
          : `已记录回执${args.newDue === undefined ? '' : `，期限更新为 ${args.newDue}`}。请在回复里公示（说错了可以直接纠正）。`,
        commitmentId: args.commitmentId,
      }
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
