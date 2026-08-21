/**
 * Conflict visibility — waiting-visibility's estranged twin.
 *
 * A serial queue that silently applies a later instruction contradicting the
 * one in flight produces the old world's worst day: a document reversed three
 * times in an afternoon, with nobody able to say who won or why. Both halves
 * of the machinery already exist (the queue knows what is running; the graph
 * can hold an answerable object); the whole cost is one message.
 *
 * **P1's detection is the model's own judgement** (prompt + this tool), which
 * is a declared degraded form: a miss lands back on old-world behaviour rather
 * than adding a new failure. The end state is an orchestrator-level comparison;
 * the miss rate is what decides when that becomes worth building (H18).
 */

import { asRecord, asString } from '@yzj-next/graph'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CardDefinition } from '@yzj-next/cards'
import { createHash } from 'node:crypto'

export interface ConflictState {
  readonly conflictId: string
  readonly status: 'flagged' | 'resolved'
  readonly topicKey: string
  readonly inflightAnchor: string
  readonly incomingAnchor: string
  readonly note: string
  readonly resolution?: 'continue' | 'cancel'
}

/** The conflict family lives in the kernel's vocabulary; this is its card. */
export const conflictCard: CardDefinition<ConflictState> = {
  type: 'conflict',
  updateStrategy: 'append-echo',

  actions: [
    {
      id: 'continue',
      label: '继续',
      style: 'primary',
      keywords: ['继续', '按原来的', '不变'],
      allowedActors: actor => actor.openId !== undefined,
      available: state => state.status === 'flagged',
    },
    {
      id: 'cancel',
      label: '按新指令',
      style: 'danger',
      keywords: ['按新的', '改', '取消原来的'],
      allowedActors: actor => actor.openId !== undefined,
      available: state => state.status === 'flagged',
    },
  ],

  isResolved: state => state.status === 'resolved',

  /**
   * ①单答确认——分类学把冲突确认归在这里。
   *
   * 徽标另说一句「冲突待裁」：模式和普通确认相同，可**已经有一件事停在半路**，
   * 这个区别在一屏上必须一眼看得出来。
   */
  demand: state => (
    state.status === 'flagged'
      ? {
        layer: 'blocking',
        mode: 'single-confirm',
        label: state.note,
        badge: '冲突待裁',
      }
      : undefined
  ),

  renderText: state => ({
    body: [
      `⚠️ 与进行中的指令冲突，已暂停等确认`,
      state.note,
      `[card#conflict:${state.conflictId}]`,
    ].join('\n'),
    replyHints: ['继续', '按新的'],
  }),

  onResolved: state => ({
    echoText: `冲突已裁定：${state.resolution === 'continue' ? '维持原指令' : '改按新指令'}`,
  }),

  apply: (state, action, actor) => ({
    events: [{
      type: 'conflict/resolved',
      data: {
        conflictId: state.conflictId,
        resolution: action.id === 'continue' ? 'continue' : 'cancel',
        by: actor.openId ?? actor.kind,
      },
      actor,
    }],
  }),
}

/** Deterministic id so the same collision flagged twice is one object. */
function conflictIdFor(topicKey: string, incomingAnchor: string): string {
  const hash = createHash('sha256')
    .update('yzj-next-conflict-v1').update('\0')
    .update(topicKey).update('\0')
    .update(incomingAnchor)
    .digest('hex')
    .slice(0, 20)
  return `cfl-${hash}`
}

export function applyConflictTools(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'conflict_flag',
    description: 'Flag that a newly queued instruction CONTRADICTS the work already in flight in this topic — "改回原来的价格" arriving while you are mid-way through changing it. Use it before acting on the new instruction, not after. Do not use it for instructions that merely add to or refine the current work.',
    parameters: {
      note: { type: 'string', required: true, description: 'One sentence naming both sides of the contradiction, in the operator\'s terms.' },
      inflight: { type: 'string', required: true, description: 'What you are currently doing.' },
      incoming: { type: 'string', required: true, description: 'What the new instruction asks for.' },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          content: { type: 'string' as const, required: true as const },
          conflictId: { type: 'string' as const },
        },
      },
      render: (_args: unknown, value: { content: string }) => [
        { type: 'text' as const, text: value.content },
      ],
    },
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const turns = ctx.get('yzjTurns')
      const binding = exec.agent === undefined
        ? undefined
        : turns?.bindingFor(exec.agent) ?? turns?.defaultBinding()
      const topicKey = binding?.topicKey ?? 'desktop'
      const incomingAnchor = binding?.messageId ?? `session:${String(exec.agent?.session.id ?? '')}`
      const conflictId = conflictIdFor(topicKey, incomingAnchor)
      const existing = ctx.yzjGraph.rawObject('conflict', conflictId)
      if (existing !== undefined) {
        return { content: '这次冲突已经亮出过了，等操作者裁定。', conflictId }
      }
      await ctx.yzjGraph.append({
        type: 'conflict/flagged',
        data: {
          conflictId,
          topicKey,
          inflightAnchor: args.inflight,
          incomingAnchor,
          note: `${args.note}（进行中：${args.inflight}；新指令：${args.incoming}）`,
        },
        actor: { kind: 'agent' },
      })
      // The card goes to the task's OWN place, not the operator's chat: a
      // conflict is visible to the people who caused it, and answering it is
      // how the pause ends. Without this projection the keywords resolve
      // nowhere and the pause has no exit.
      const delivered = await ctx.get('yzjCardChannel')?.deliverToPlace(
        { kind: 'conflict', id: conflictId },
        binding?.placeKey ?? '',
      )
      return {
        content: delivered === undefined
          ? '已亮出冲突并暂停。请在回复里把两边说清楚，等操作者选「继续」或「按新的」再动手。'
          : '已亮出冲突并暂停，等操作者选「继续」或「按新的」。请在回复里把两边说清楚。',
        conflictId,
      }
    },
  }))
}

/** Read a conflict's state off the graph. */
export function conflictStateOf(ctx: Context, conflictId: string): ConflictState | undefined {
  const object = ctx.yzjGraph.rawObject('conflict', conflictId)
  if (object === undefined) return undefined
  return asString(asRecord(object.state)?.conflictId) === undefined
    ? undefined
    : object.state as unknown as ConflictState
}
