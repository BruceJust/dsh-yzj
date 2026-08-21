/**
 * `graph_query` — the model's read window onto the graph, and the engine
 * behind `/status` and the morning digest.
 *
 * **It takes no viewer.** The read domain is bound by the orchestrator from the
 * turn's own origin (§3.3): a group turn reads that place, a private turn
 * reads as the operator. Exposing the parameter would make the signature look
 * safe while letting the model pass `operator` and then speak the result into
 * a group — the exact leak the rule exists to close.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { asRecord, asString, type GraphObject, type GraphViewer } from '@yzj-next/graph'
import type { TurnBinding } from './turns.ts'

const output = {
  schema: {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: {
      content: { type: 'string' as const, required: true as const },
      count: { type: 'number' as const },
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

/** One object rendered as a line the model can read and quote. */
export function describeObject(object: GraphObject): string {
  const state = asRecord(object.state) ?? {}
  const status = asString(state.status) ?? '?'
  const head = `${object.kind}:${object.id} [${status}]`
  const what = asString(state.what) ?? asString(state.reason) ?? asString(state.label)
  const due = asString(state.due)
  const executor = asRecord(state.executor)
  const who = executor === undefined
    ? undefined
    : asString(executor.name) ?? asString(executor.openId) ?? asString(executor.kind)
  const parts = [head]
  if (what !== undefined) parts.push(what)
  if (who !== undefined) parts.push(`执行者 ${who}`)
  if (due !== undefined) parts.push(`期限 ${due}`)
  const goal = asString(state.parentGoalRef)
  if (goal !== undefined) parts.push(`承 ${goal}`)
  return parts.join(' · ')
}

/** 工作块里说人话用的对象名。 */
const KIND_WORD: Record<string, string> = {
  commitment: '承诺', waiting: '在等的事', approval: '待确认',
  task: '任务', conflict: '冲突',
}

export function applyGraphTools(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'graph_query',
    description: 'Query the conversation graph for objects you are allowed to see here: commitments, waits, approvals, conflicts, tasks. Use it before answering "what is outstanding", "who owes what", "what am I waiting on", and before recording a receipt (to find the commitment id). Results are already scoped to this conversation\'s read domain — you cannot widen them, and you should not try.',
    // 工作块只显示这一行；参数和结果在完整轨迹里。
    presentCall: args => ({
      card: 'generic',
      title: `查${args.kind === undefined ? '会话图' : KIND_WORD[args.kind] ?? args.kind}`,
      kind: 'read',
    }),
    parameters: {
      kind: {
        type: 'string',
        enum: ['commitment', 'waiting', 'approval', 'task', 'conflict'],
        description: 'Object kind to list; omit for everything visible here.',
      },
      status: {
        type: 'array',
        items: { type: 'string' },
        description: 'Statuses to keep, e.g. ["open"] for outstanding commitments.',
      },
      sinceDays: { type: 'number', description: 'Only objects touched within this many days.' },
      limit: { type: 'number', description: 'Newest-first cap; default 20, max 100.' },
    },
    output,
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const viewer: GraphViewer = binding?.viewer ?? { kind: 'place', placeKey: '__unbound__' }
      const limit = args.limit === undefined ? 20 : Math.min(Math.max(1, args.limit), 100)
      const objects = ctx.yzjGraph.query(viewer, {
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.sinceDays === undefined
          ? {}
          : { since: Date.now() - args.sinceDays * 24 * 60 * 60 * 1_000 }),
        limit,
      })
      await Promise.resolve()
      return {
        content: objects.length === 0
          ? '（这个范围内没有可见对象）'
          : objects.map(describeObject).join('\n'),
        count: objects.length,
      }
    },
  }))
}
