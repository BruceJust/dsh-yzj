/**
 * 目标一生里 agent 能碰的四个动作——全部只有提议权与读取权。
 *
 * 人机分工表 (v4.10) says the human appears at exactly three moments: 签发、
 * 裁决、验收. Everything else can be work, and work is what these tools are:
 *
 * - `goal_propose` — 磨完之后把稿子递上去. Writes a PROPOSAL, never a goal.
 *   作者权 ≠ 思考伙伴: the frozen ban is on a direction entering the record
 *   without a human signature, not on helping somebody think.
 * - `goal_breakdown` — 拆解提案. A list of children with who and by when, each
 *   decided one at a time. Confirming is signing; the utterance that announces
 *   it is the mechanical consequence (see `notify.ts`).
 * - `goal_evidence` — 验收材料，只读. Two hops of derived query, no judgement.
 * - `goal_report` — 差距简报. The judgement, written down as a card whose exits
 *   are the operator's.
 *
 * None of them takes a viewer: the read domain comes from the turn's own origin
 * (§3.3), so a group turn cannot assemble a report out of another place's work
 * and then read it aloud.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { asRecord, asString, type GraphViewer } from '@yzj-next/graph'
import type { TurnBinding } from '../turns.ts'
import { goalEvidence, visibleGoals } from './evidence.ts'
import {
  assessmentIdFor, goalCommitmentIdFor, proposalIdFor, proposalSettled, type ProposalState,
} from './family.ts'
import { checkGoalTruth, truthLine } from './truth.ts'

const output = {
  schema: {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: {
      content: { type: 'string' as const, required: true as const },
      proposalId: { type: 'string' as const },
      assessmentId: { type: 'string' as const },
    },
  },
  render: (_args: unknown, value: { content: string }) => [
    { type: 'text' as const, text: value.content },
  ],
}

function bindingOf(ctx: Context, agent: Agent | undefined): TurnBinding | undefined {
  if (agent === undefined) return undefined
  const turns = ctx.get('yzjTurns')
  return turns?.bindingFor(agent) ?? turns?.defaultBinding()
}

function anchorOf(binding: TurnBinding | undefined, agent: Agent | undefined): string {
  if (binding?.messageId !== undefined) return `yzj:${binding.messageId}`
  return `session:${String(agent?.session.id ?? 'unknown')}`
}

function viewerOf(binding: TurnBinding | undefined): GraphViewer {
  return binding?.viewer ?? { kind: 'place', placeKey: '__unbound__' }
}

/**
 * Deliver a freshly written proposal to where it was asked for.
 *
 * A proposal read in a group is a proposal the whole group can correct, and one
 * read in a DM stays between two people — which is the right default depends
 * entirely on where the conversation was, so it follows the conversation rather
 * than picking.
 */
async function show(ctx: Context, kind: string, id: string, placeKey: string | undefined): Promise<boolean> {
  const channel = ctx.get('yzjCardChannel')
  if (channel === undefined) return false
  try {
    const delivered = placeKey === undefined
      ? await channel.deliverToOperator({ kind, id })
      : await channel.deliverToPlace({ kind, id }, placeKey)
    return delivered !== undefined
  } catch {
    return false
  }
}

/**
 * A proposal id that is idempotent within a turn but not across a session.
 *
 * 幂等锚 is computed from the SOURCE, and on the desktop the source anchor is
 * the whole session — so re-asking for a decomposition after rejecting the
 * first one used to hand back the settled card and refuse to write a new one.
 * A settled proposal is finished business; the next ask deserves its own
 * object. One still open is a genuine duplicate and is reported as such.
 */
function freshProposalId(
  ctx: Context, anchor: string, subject: string,
): { readonly id: string; readonly busy: boolean } {
  const base = proposalIdFor(anchor, subject)
  let id = base
  for (let round = 1; round < 50; round += 1) {
    const existing = ctx.yzjGraph.rawObject('proposal', id)
    if (existing === undefined) return { id, busy: false }
    // The same predicate the card answers by: still answerable = still busy.
    // A partially decided proposal is very much still in play.
    if (!proposalSettled(existing.state as unknown as ProposalState)) return { id, busy: true }
    id = `${base}-${String(round)}`
  }
  return { id, busy: true }
}

export function applyGoalTools(ctx: Context): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'goal_propose',
    description: 'Propose a GOAL for a person to sign off, after you have helped them think one through. You cannot create a goal — only propose one. Use this at the end of a goal-drafting conversation ("帮我想想这个季度的目标"), never on your own initiative. Always include successCriteria: a goal nobody can say "done" about cannot be accepted later. The goal\'s real body is a Yunzhijia document — pass its link if you were given one; if not, say so and let them paste it with their confirmation.',
    presentCall: args => ({ card: 'generic', title: `提案立目标：${String(args.what)}`, kind: 'edit' }),
    parameters: {
      what: { type: 'string', required: true, description: 'The goal, in the owner\'s own words.' },
      successCriteria: { type: 'string', required: true, description: 'How anyone would know it is done — the thing you ground the conversation toward.' },
      goalRef: { type: 'string', description: 'Link of the Yunzhijia goal document/table, when you were given one.' },
      ownerOpenId: { type: 'string', description: 'openId of the person who owns it; omit for the operator.' },
      ownerName: { type: 'string', description: 'Display name of the owner.' },
      due: { type: 'string', description: 'When it is to be accepted ("季度末"), when stated.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const anchor = anchorOf(binding, exec.agent)
      const first = freshProposalId(ctx, anchor, args.what)
      if (first.busy) return { content: `这条目标提案已经递过了，还等着裁决。`, proposalId: first.id }
      const proposalId = first.id
      if (args.goalRef !== undefined) {
        /*
          Existence is checked RAW on purpose — a goal this turn cannot see
          still owns that URI, and proposing a second one would be a proposal
          that can never be confirmed. But the NAME comes from the scoped read:
          「已经立过了」 is a fact the caller needs; what it is called is not.
        */
        const owned = ctx.yzjGraph.rawObject('commitment', goalCommitmentIdFor(args.goalRef))
        if (owned !== undefined) {
          const visible = ctx.yzjGraph.object(
            viewerOf(binding), 'commitment', goalCommitmentIdFor(args.goalRef),
          )
          const named = asString(asRecord(visible?.state)?.what)
          return {
            content: named === undefined
              ? '这个真身上已经有一个目标了（这里看不到它的内容）。不要重立。'
              : `这个真身已经立过目标了：「${named}」。改内容请在那条目标上改，不要重立。`,
          }
        }
      }
      await ctx.yzjGraph.append({
        type: 'proposal/opened',
        data: {
          proposalId,
          kind: 'goal',
          title: args.what,
          criteria: args.successCriteria,
          items: [{
            what: args.what,
            ...(args.ownerOpenId === undefined ? {} : { executorOpenId: args.ownerOpenId }),
            ...(args.ownerName === undefined ? {} : { executorName: args.ownerName }),
            ...(args.due === undefined ? {} : { due: args.due }),
          }],
          sourceAnchor: anchor,
          ...(args.goalRef === undefined ? {} : { goalRef: args.goalRef }),
          ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
          ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
          ...(binding?.audience === undefined ? {} : { audience: [...binding.audience] }),
          // 递给谁就是谁签：a proposal read in a group is not signable by the group.
          ...(binding?.decider === undefined ? {} : { decider: binding.decider }),
        },
        actor: { kind: 'agent' },
      })
      const shown = await show(ctx, 'proposal', proposalId, binding?.placeKey)
      return {
        content: [
          `已把目标提案递上去：「${args.what}」。`,
          args.goalRef === undefined
            ? '还没有真身链接——请对方在云之家建好目标文档，把链接跟「确认」一起发过来。'
            : '',
          shown ? '' : '（卡没能投出去，请在回复里把提案内容原样说一遍，让对方能裁决。）',
          '这只是提案。没有人按下确认之前，图上不会有这个目标。',
        ].filter(line => line !== '').join('\n'),
        proposalId,
      }
    },
  }))

  register(defineTool({
    name: 'goal_breakdown',
    description: 'Propose how to break a goal into commitments, when somebody asks you to ("帮我把这个目标拆一下"). Each item names WHAT, WHO owes it, and by WHEN. You must also say WHERE each registration should be announced (placeKey of a conversation that person is in) — pick it only when you were told; leave it out and it goes to this conversation. Every item is decided one by one by a person; confirming one posts the registration into that place under their name. Never call this to assign work on your own initiative.',
    presentCall: args => ({
      card: 'generic',
      title: `拆解提案 · ${String((args.items as unknown[] | undefined)?.length ?? 0)} 条`,
      kind: 'edit',
    }),
    parameters: {
      goalRef: { type: 'string', required: true, description: 'Link/URI of the goal being decomposed (from graph_query or the goal chip).' },
      items: {
        type: 'array',
        required: true,
        description: 'The proposed children, in the order they should be decided.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            what: { type: 'string', required: true, description: 'What is being asked of them, concretely.' },
            executorOpenId: { type: 'string', description: 'openId of the person who would owe it (resolve via the contact directory).' },
            executorName: { type: 'string', description: 'Their display name.' },
            due: { type: 'string', description: 'Deadline, when there is a real one.' },
            placeKey: { type: 'string', description: 'Conversation the registration should be announced in. Only when you were told which; do not guess between a group and a DM.' },
            placeName: { type: 'string', description: 'Readable name of that place, for the card.' },
          },
        },
      },
    },
    output,
    timeoutMs: 20_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const anchor = anchorOf(binding, exec.agent)
      const goalId = goalCommitmentIdFor(args.goalRef)
      const goal = ctx.yzjGraph.rawObject('commitment', goalId)
      if (goal === undefined) {
        return { content: `图上没有这个目标（${args.goalRef}）。先用 graph_query 找到目标，或让对方在承诺板上「立目标」。` }
      }
      /*
        名字只从看得见的那次读里来。The proposal card is posted where this
        conversation is, so a goal declared privately must not have its title
        printed into a group by way of 「拆解：<名字>」.
      */
      const goalName = asString(
        asRecord(ctx.yzjGraph.object(viewerOf(binding), 'commitment', goalId)?.state)?.what,
      ) ?? args.goalRef
      if (asString(asRecord(goal.state)?.status) !== 'open') {
        return { content: `目标「${goalName}」已经结束了，不能再往下拆。` }
      }
      const items = args.items.filter(item => item.what.trim() !== '')
      if (items.length === 0) return { content: '没有可提案的条目。' }
      const fresh = freshProposalId(ctx, anchor, `拆解:${args.goalRef}`)
      if (fresh.busy) {
        return { content: '这个目标的拆解提案已经递过了，还等着逐条裁决。', proposalId: fresh.id }
      }
      const proposalId = fresh.id
      await ctx.yzjGraph.append({
        type: 'proposal/opened',
        data: {
          proposalId,
          kind: 'breakdown',
          title: `拆解：${goalName}`,
          goalRef: args.goalRef,
          goalName,
          items: items.map(item => ({
            what: item.what,
            ...(item.executorOpenId === undefined ? {} : { executorOpenId: item.executorOpenId }),
            ...(item.executorName === undefined ? {} : { executorName: item.executorName }),
            ...(item.due === undefined ? {} : { due: item.due }),
            ...(item.placeKey === undefined ? {} : { placeKey: item.placeKey }),
            ...(item.placeName === undefined ? {} : { placeName: item.placeName }),
          })),
          sourceAnchor: anchor,
          ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
          ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
          ...(binding?.audience === undefined ? {} : { audience: [...binding.audience] }),
          ...(binding?.decider === undefined ? {} : { decider: binding.decider }),
        },
        actor: { kind: 'agent' },
      })
      const shown = await show(ctx, 'proposal', proposalId, binding?.placeKey)
      return {
        content: [
          `已递上 ${String(items.length)} 条拆解提案，等人逐条裁决。`,
          /*
            A goal whose wording this conversation cannot see is shown by its
            URI — say why, or it reads as a bug. This happens when a goal was
            declared privately (on the board, in no place) and is being
            decomposed from inside a group topic, where the read domain is that
            place. The work-around is a real one: do it from a local session,
            where the reader is the operator.
          */
          goalName === args.goalRef
            ? '（这个会话看不到目标的正文，卡上只能显示它的链接——它是在私语域立的。想看到名字，去本地会话里拆。）'
            : '',
          shown ? '' : '（卡没能投出去，请在回复里把这几条原样列出来，让对方能逐条答复。）',
          '确认一条就等于签发一条：那条承诺会以裁决人的名义发到执行者所在的会话里，不会静默落库。',
        ].filter(line => line !== '').join('\n'),
        proposalId,
      }
    },
  }))

  register(defineTool({
    name: 'goal_evidence',
    description: 'Read what has actually happened under a goal: its success criteria, every commitment hanging off it with its terminal state, and the artifacts those produced. Read-only, all derived from the graph. Use it before answering "这个目标做到什么程度了" and always before goal_report — the point of this design is that an assessment cites real objects instead of asking somebody for a number. Omit goalRef to list the goals you can see here.',
    presentCall: args => ({
      card: 'generic',
      title: args.goalRef === undefined ? '查目标' : '取目标证据',
      kind: 'read',
    }),
    parameters: {
      goalRef: { type: 'string', description: 'Link/URI of the goal; omit to list visible goals.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const viewer = viewerOf(bindingOf(ctx, exec.agent))
      if (args.goalRef === undefined) {
        const goals = visibleGoals(ctx, viewer)
        return {
          content: goals.length === 0
            ? '这里看不到任何目标。'
            : goals.map(goal => `${goal.what} [${goal.status}] ${goal.goalRef}`).join('\n'),
        }
      }
      const evidence = goalEvidence(ctx, viewer, args.goalRef)
      if (evidence.status === 'unknown' && evidence.children.length === 0) {
        return { content: `这里看不到目标 ${args.goalRef} 下的任何东西。` }
      }
      /*
        消费时刻顺手看一眼真身 (§1.9-4).

        这是 `truth/changed` 唯一的生产者被点着的地方。放在这里而不是养一个
        定时器,是因为「随时可对账,不是持续对账」:没人问的时候,系统不该替谁
        盯着一份文档;而**有人问的这一刻,恰恰是那份副本会被当真的一刻**。
        下面那句成功标准是抄下来的,它要么此刻还成立,要么必须当场说自己可能
        已经过时——把这句话留到人自己去发现,就是让一个过期的结论继续看起来
        成立。
      */
      const verdict = await checkGoalTruth(ctx, args.goalRef)
      const lines = [
        truthLine(verdict),
        `目标：${evidence.goalName ?? evidence.goalRef} [${evidence.status}]`,
        `owner：${evidence.owner ?? '未记录'}`,
        evidence.criteria === undefined
          ? '成功标准：未记录（立目标时没有写「怎么算完成」——评估只能凭子承诺与产出说话）'
          : `成功标准：${evidence.criteria}`,
        `子承诺：在跟 ${String(evidence.counts.open)} · 逾期 ${String(evidence.counts.overdue)} · 已了 ${String(evidence.counts.settled)}`,
        ...evidence.children.map(child => (
          `- [${child.status}${child.overdue ? '·逾期' : ''}] ${child.what} — ${child.who}`
          + `${child.due === undefined ? '' : ` · ${child.due}`}`
          + `${child.progress === undefined ? '' : ` · 最近：${child.progress}`}`
          + `${child.notified === 'failed' ? ' · 未通知本人' : ''}`
        )),
        evidence.artifacts.length === 0
          ? '产出：无'
          : `产出（${String(evidence.artifacts.length)}）：`,
        ...evidence.artifacts.map(artifact => `- ${artifact.title} (${artifact.action}) ${artifact.uri}`),
      ]
      return { content: lines.join('\n') }
    },
  }))

  register(defineTool({
    name: 'goal_report',
    description: 'Write the gap report for a goal, after goal_evidence. One line per success criterion, each with the evidence you are basing it on — name the commitment or artifact, never a feeling. This produces a card whose only exits are the operator\'s: 验收 or 继续. You are not accepting anything; you are handing somebody the material to accept with.',
    presentCall: args => ({ card: 'generic', title: `差距简报 · ${String(args.goalRef)}`, kind: 'edit' }),
    parameters: {
      goalRef: { type: 'string', required: true, description: 'Link/URI of the goal.' },
      summary: { type: 'string', required: true, description: 'One or two sentences: where it stands overall.' },
      lines: {
        type: 'array',
        required: true,
        description: 'One entry per success criterion.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            criterion: { type: 'string', required: true, description: 'The criterion, quoted from the goal.' },
            verdict: { type: 'string', required: true, enum: ['met', 'partial', 'missing'], description: 'met / partial / missing.' },
            evidence: { type: 'string', required: true, description: 'What you are reading it off — a commitment, an artifact, or plainly "没有任何承诺覆盖这一条".' },
          },
        },
      },
    },
    output,
    timeoutMs: 20_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const anchor = anchorOf(binding, exec.agent)
      /*
        The goal must exist before a report about it does.

        `append` on an unknown id CREATES an object, so a report about a
        mistyped URI would mint a phantom goal that the acceptance button then
        "closes" — and nothing in any surface could remove it.
      */
      const goalId = goalCommitmentIdFor(args.goalRef)
      const goal = ctx.yzjGraph.rawObject('commitment', goalId)
      if (goal === undefined) {
        return { content: `图上没有这个目标（${args.goalRef}），不能给它写简报。先用 goal_evidence 确认目标引用。` }
      }
      // 名字只从看得见的那次读里来，结构（存在与状态）不算措辞。
      const goalName = asString(
        asRecord(ctx.yzjGraph.object(viewerOf(binding), 'commitment', goalId)?.state)?.what,
      ) ?? args.goalRef
      if (asString(asRecord(goal.state)?.status) !== 'open') {
        return { content: `这个目标已经结束了，不用再写简报。` }
      }
      /*
        新的一次评估是新的一份简报.

        The id is derived from the turn anchor, and on the desktop that anchor
        is the whole SESSION — so a second reading folded onto the first, and
        an assessment somebody had already accepted was rewritten back to open
        with the old `decidedBy` still on it. Suffixing past settled reports
        keeps re-running the same turn idempotent while letting a genuinely new
        reading be its own object.
      */
      /*
        下结论之前先看一眼真身。

        评估是**最应该对着当前正文**下判断的那一刻——照着一份可能已经过时的
        副本判出「达成」,是这套设计最不愿意犯的错。看一眼的副作用正好是我们
        要的:变了就写下 `truth/changed`,并且把这次看到的版本记进简报里。
      */
      const verdict = await checkGoalTruth(ctx, args.goalRef)
      const truthMark = verdict.kind === 'unknown' ? undefined : verdict.note

      let assessmentId = assessmentIdFor(anchor, args.goalRef)
      for (let round = 1; round < 50; round += 1) {
        const existing = ctx.yzjGraph.rawObject('assessment', assessmentId)
        if (existing === undefined) break
        if (asString(asRecord(existing.state)?.status) === 'open') break
        assessmentId = `${assessmentIdFor(anchor, args.goalRef)}-${String(round)}`
      }
      await ctx.yzjGraph.append({
        type: 'assessment/reported',
        data: {
          assessmentId,
          goalRef: args.goalRef,
          goalName,
          summary: args.summary,
          lines: args.lines.map(line => ({
            criterion: line.criterion,
            verdict: line.verdict,
            evidence: line.evidence,
          })),
          sourceAnchor: anchor,
          // 依据的那一版标准跟着简报一起落库——见 family 里的 `criteriaBasis`。
          ...(asString(asRecord(goal.state)?.criteria) === undefined
            ? {}
            : { criteriaBasis: asString(asRecord(goal.state)?.criteria) as string }),
          /*
            连真身的版本号一起记 (环境快照律 §1.9-5).

            `criteriaBasis` 记的是我们那份**副本**当时长什么样,而这一条记的是
            **真身**当时是第几版。少了后者,一份三周前的结论在真身被改过之后
            仍然看起来成立——而它是照着另一份正文判出来的。
          */
          ...(truthMark === undefined ? {} : { truthFingerprint: truthMark }),
          ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
          // 验收是主权时刻,和签发同理:递给谁,就只有谁能按。
          ...(binding?.decider === undefined ? {} : { decider: binding.decider }),
        },
        actor: { kind: 'agent' },
      })
      /*
        简报的听众域：默认私语域 (v4.10).

        Child commitments live across places, so a report assembled for the
        operator carries evidence from more than one of them. Posting that into
        a group would either leak the parts that group cannot see, or — because
        the read domain silently narrows — quietly drop half the evidence and
        present the remainder as the whole picture. Neither is acceptable, so it
        goes to the operator and reaches a group only through the existing
        artifact/summary route.
      */
      const shown = await show(ctx, 'assessment', assessmentId, undefined)
      const missing = args.lines.filter(line => line.verdict !== 'met').length
      return {
        content: [
          `已写好「${goalName}」的差距简报：${String(args.lines.length)} 条标准，其中 ${String(missing)} 条未完全达成。`,
          shown ? '简报已发到操作者本人的会话里（跨场所证据只在私语域完整）。' : '（简报卡没能投出去，请把结论在回复里说明。）',
          '验收是人的动作——我只给材料。',
        ].join('\n'),
        assessmentId,
      }
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
