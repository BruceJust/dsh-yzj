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
import {
  commitmentIdFor, commitmentIdemKeyFor, ownsCommitment, type CommitmentState,
} from './family.ts'
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
/**
 * 这一回合的主权人是谁 —— 修理动词的主权谓词要拿它去问 (v4.22 裁决②).
 *
 * `decider` 是绑定里「谁有权答这一回合开出来的卡」那一格；在桌面就是操作者本人，在
 * 群里是被admit那条消息的发话人。用它而不是「谁在说话」：主权是节点的属性，不是
 * 音量的属性。
 */
function operatorOf(ctx: Context, agent: Agent | undefined): string | undefined {
  const decider = bindingOf(ctx, agent)?.decider
  return decider === undefined || decider === '' ? undefined : decider
}

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

  /*
    修理动词族的**话语兜底** —— 提案 + 确认卡 (v3.15 裁决②).

    此前这三个动词在 agent 手上根本不存在，而 `commitment_receipt` 的描述里写着一句
    「没有的动词就说没有，指回那个按钮」。那句话当时是对的**过渡态**，但它不是终态：
    §7.6 的兜底明标写着「作废/顺延/移交 = 对 agent 说」，一个只能在承诺板上按的动词
    是一种**违规能力**（凡只能在一个面上获得的能力就是违规能力）。

    正确形态是三段：**对象寻址**（哪一条）+ **agent 提案**（它只提，不做）+ **确认卡**
    （人签发）。第三段不必新造：写工具本来就过守卫的确认门——**有主权者的话语 + 确认，
    与按钮同权**（卡片三定律：任一投影经授权者动作全局生效，文本面是四通道之一）。
    所以这里是三个普通的写工具，主权谓词与板、与端点共用同一个 `ownsCommitment`。

    零新机制：没有新家族、没有新事件、没有第二条确认路径。
  */
  const repairable = (
    commitmentId: string, verb: string, openId: string | undefined,
  ): { readonly state: CommitmentState } | { readonly refusal: string } => {
    const object = ctx.yzjGraph.rawObject('commitment', commitmentId)
    if (object === undefined) {
      return { refusal: `找不到承诺 ${commitmentId}，请先用 graph_query 查一下。` }
    }
    const state = object.state as unknown as CommitmentState
    if (state.status !== 'open') {
      return { refusal: `这条承诺已经${state.status === 'closed' ? '完成' : '结束'}了，${verb}没有意义。` }
    }
    /*
      **主权谓词与渲染、与端点是同一个** (v4.22 裁决②)。

      只在界面上不画而工具照收，等于给模型开一条绕过主权的路——而这条路本来就是
      为模型开的。拒绝要说清归谁，并指出那条仍然走得通的：不禁言。
    */
    if (!ownsCommitment(openId, state)) {
      /*
        **无主权的话语：不执行，也不静默** (v3.14r②).

        三种回应里只有一种是对的：
        - **静默忽略** —— 这套设计里最大的罪。人说了一句话，系统当没听见；
        - **公开驳斥**（「你没有权限」）—— 社交羞辱，而且把一个组织关系问题渲染成
          一次权限报错；
        - **指路 + 可选转达拟稿** —— 唯一正解：说清归谁，给出那条走得通的路，并且
          提出**替他把话拟好、由他自己发**（拟稿不是代发——B4 禁借身，那一下必须是
          他按的）。
      */
      const owner = asString(state.delegatedBy)
      return {
        refusal: [
          `${verb}归**登记这条承诺的人**${owner === undefined ? '' : `（${owner}）`}，我不替他按这个动作。`,
          '两条路：直接问他一句；或者我把这句话拟好，你亲自发过去——发不发、怎么措辞都还是你的。',
        ].join('\n'),
      }
    }
    return { state }
  }

  register(defineTool({
    name: 'commitment_void',
    description: 'Propose VOIDING a commitment the operator owns — "把那条探针作废掉" / "这件事不做了". The operator confirms before anything is written: you propose, they sign. 作废 is a tombstone: the commitment can never be revived, so use it only when the work itself is being called off. If they want the deadline moved use commitment_postpone; if they want somebody else to do it use commitment_handoff. Never file a receipt instead of this — that would leave the graph saying somebody reported progress on work they wanted killed.',
    presentCall: args => ({ card: 'generic', title: `作废承诺：${String(args.commitmentId)}`, kind: 'edit' }),
    parameters: {
      commitmentId: { type: 'string', required: true, description: 'The commitment to void (from graph_query).' },
      reason: { type: 'string', description: 'Why, in their words — it goes on the tombstone.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const gate = repairable(args.commitmentId, '作废', operatorOf(ctx, exec.agent))
      if ('refusal' in gate) return { content: gate.refusal }
      await ctx.yzjGraph.append({
        type: 'commitment/voided',
        data: {
          commitmentId: args.commitmentId,
          cause: args.reason ?? '操作者说不做了',
        },
        actor: { kind: 'agent' },
      })
      return { content: `已作废：${gate.state.what}。墓碑律——这条不会再被任何动词唤醒。` }
    },
  }))

  register(defineTool({
    name: 'commitment_postpone',
    description: 'Propose moving the DEADLINE of a commitment — "那条改到下周五" / "推迟到月底". The operator confirms before anything is written. Pass the new deadline in the words they used ("下周五", "月底"), not a parsed date: what was promised is a sentence, and rewriting it into a timestamp is our parse impersonating their promise. This changes the PUBLIC deadline — the one said out loud to somebody; it is not a private snooze.',
    presentCall: args => ({ card: 'generic', title: `顺延期限：${String(args.due)}`, kind: 'edit' }),
    parameters: {
      commitmentId: { type: 'string', required: true, description: 'The commitment (from graph_query).' },
      due: { type: 'string', required: true, description: 'The new deadline, in the words they used.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const gate = repairable(args.commitmentId, '顺延', operatorOf(ctx, exec.agent))
      if ('refusal' in gate) return { content: gate.refusal }
      await ctx.yzjGraph.append({
        type: 'commitment/updated',
        data: { commitmentId: args.commitmentId, due: args.due },
        actor: { kind: 'agent' },
      })
      return {
        content: `已顺延：${gate.state.what} → ${args.due}。`
          + '改的是当初说出口的那个日子，所以对方那边也该知道一声。',
      }
    },
  }))

  register(defineTool({
    name: 'commitment_handoff',
    description: 'Propose HANDING a commitment to a different executor — "这条给李婷做" / "张锐休假，换人". The operator confirms before anything is written. The commitment itself does not change: its birth, its audience and every receipt so far stay on this one record — that is the whole reason to hand off rather than void-and-recreate. Telling the new executor is a separate act: say so in the reply, because a commitment nobody was told about is a ghost.',
    presentCall: args => ({ card: 'generic', title: `移交给：${String(args.name ?? args.openId)}`, kind: 'edit' }),
    parameters: {
      commitmentId: { type: 'string', required: true, description: 'The commitment (from graph_query).' },
      openId: { type: 'string', required: true, description: 'openId of the new executor (from yzj_contact_search).' },
      name: { type: 'string', description: 'Their display name, so the board reads as a name not an id.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const gate = repairable(args.commitmentId, '移交', operatorOf(ctx, exec.agent))
      if ('refusal' in gate) return { content: gate.refusal }
      await ctx.yzjGraph.append({
        type: 'commitment/updated',
        data: {
          commitmentId: args.commitmentId,
          executor: {
            kind: 'human',
            openId: args.openId,
            ...(args.name === undefined ? {} : { name: args.name }),
          },
        },
        actor: { kind: 'agent' },
      })
      return {
        content: `已移交：${gate.state.what} → ${args.name ?? args.openId}。`
          + '出生边、听众、已有的回执都还在这一条上；**新执行者还不知道**，这句话得有人去说。',
      }
    },
  }))

  register(defineTool({
    name: 'commitment_receipt',
    /*
      「作废」不是这个工具能干的事，而它长得太像了。

      实跑里出现过一次：操作者说「把这两条探针作废掉」，agent 手上没有作废工具，于是
      它退而求其次记了两条回执。后果不是少做一件事，是**记录变成了假话**：操作者要
      杀掉的那条承诺，图上留下的是「有人报告了进展」，而这套系统全部的价值就押在记录
      诚实上。

      **那三个动词现在有了**（v3.15 裁决②：`commitment_void` / `commitment_postpone` /
      `commitment_handoff`，各自过写确认门——提案归 agent，签发归人）。所以这句话从
      「没有的动词就说没有、指回按钮」改成「**别拿回执冒充它们**」：少一个动词是设计，
      悄悄换一个动词从来都不是。
    */
    description: 'Record a reply you observed about an existing commitment — "分析发了" / "明天给" / "做不了了". This is how a commitment breathes after registration; without it the operator has to relay every status by hand. Apply the change the reply actually implies, nothing more. NEVER substitute it for a verb of its own: 作废 is commitment_void, 顺延 is commitment_postpone, 移交 is commitment_handoff — each proposes and waits for the operator to confirm. 合并 is still theirs alone, on the board. Filing a receipt in place of any of these leaves the graph saying somebody reported progress on work the operator wanted killed.',
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

      /*
        **生效即出卡** —— 立刻生效，但生效的结果是一张待验收的卡，不是终态
        (v4.21 第一档⑥「验收断链接通」)。

        Effective IMMEDIATELY, with the correction shown — not held in a
        "proposed" limbo. 这一条不变：话语门本属「默认生效可纠」类，没有第二道确认。
        变的是**生效成什么**：此前执行者说一句「做完了」，系统直接判终态——于是
        「他说做完了」和「我认了这份交付」被压成同一件事，而它们是两个人的两次判断。
        板上那条人执行的行因此是断头路：登记有呼吸，交付没有验收落座。

        现在它落成**交付主张**：承诺仍然 `open`（在有人验收之前，它确实还欠着），
        卡换上双动词的脸（验收／打回），拒收→返工→再验收在同一条上循环。

        交付锚：这条回执引用了工件就锚工件，纯话语回执锚回执本身——被验收的是**交付
        主张**，拒收 = 不认可这个主张。
      */
      if (args.completed === true) {
        // 轮次的家在承诺上（打回会删掉 delivery），所以从那里读。
        const round = asRecord(object.state)?.round
        await ctx.yzjGraph.append({
          type: 'commitment/delivered',
          data: {
            commitmentId: args.commitmentId,
            delivery: {
              claim: args.text,
              at: Date.now(),
              anchor: asString(asRecord(object.state)?.sourceAnchor) ?? state.sourceAnchor,
              ...(typeof round === 'number' ? { round } : {}),
            },
          },
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
          ? `已记录交付主张「${state.what}」，现在**等验收**——委派的人会在原来那个场所看到`
            + `一张双动词的卡（验收／打回）。请在回复里公示这一条（说错了可以直接纠正）。`
          : `已记录回执${args.newDue === undefined ? '' : `，期限更新为 ${args.newDue}`}。请在回复里公示（说错了可以直接纠正）。`,
        commitmentId: args.commitmentId,
      }
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
