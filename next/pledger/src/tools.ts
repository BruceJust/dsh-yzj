/** 工具面只剩 `pledger_query`（只读，viewer=operator 的回合才进）。模型没有写私账的通道（PTD-30）。 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { judgView } from './judg.ts'
import { DEFAULT_WINDOW } from './types.ts'

export const PLEDGER_TOOLS = ['pledger_query'] as const

export function isOperatorTurn(ctx: Context, agent: Agent | undefined): boolean {
  if (agent === undefined) return true
  const turns = ctx.get('yzjTurns')
  const binding = turns?.bindingFor(agent) ?? turns?.defaultBinding()
  return binding?.viewer.kind === 'operator'
}

export function pledgerDenial(ctx: Context, exec: { readonly name: string; readonly agent?: Agent }): string | undefined {
  if (!(PLEDGER_TOOLS as readonly string[]).includes(exec.name)) return undefined
  return isOperatorTurn(ctx, exec.agent) ? undefined : '这是操作者本人的私账，云之家场所触发的回合读不到它，也写不进去。'
}

export function applyPledgerTools(ctx: Context): () => void {
  const disposeGuard = ctx.tools.guard(exec => pledgerDenial(ctx, exec))
  const disposeQuery = ctx.tools.register(defineTool({
    name: 'pledger_query',
    description: 'Read the operator\'s OWN private judgement record (押 / 回执 / 我的判断). Only when the operator '
      + 'just asked to look at their own record; never to decide how to behave, never in a group. No score is computed here.',
    presentCall: () => ({ card: 'generic', title: '查你的判断', kind: 'read' }),
    parameters: {
      windowDays: { type: 'number', description: 'Rolling window in days (default 90). There is no all-time option.' },
    },
    output: {
      schema: { type: 'object' as const, additionalProperties: false as const, properties: { content: { type: 'string' as const, required: true as const } } },
      render: (_args: unknown, value: { content: string }) => [{ type: 'text' as const, text: value.content }],
    },
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!isOperatorTurn(ctx, exec?.agent)) throw new Error('私账只对本人的回合开放')
      await Promise.resolve()
      const view = judgView(ctx, { days: args.windowDays ?? DEFAULT_WINDOW.days })
      if (view.groups.length === 0) return { content: '（还没有内容——押和结果都从本人的裁决长出来。）' }
      return {
        content: view.groups.map(group => {
          const head = group.head
          return `${head.label}：同意 ${String(head.agree)}（没被推翻 ${String(head.notReversed)} · 被推翻 ${String(head.reversed)}）`
            + `｜没同意 ${String(head.diverged)}（证明对 ${String(head.vindicated)} · 待定 ${String(head.pending)}）`
            + `｜${String(group.rows.length)} 行`
        }).join('\n') + '\n（这里只有原料，没有分数——结论由本人自己下。）',
      }
    },
  }))
  return () => { disposeQuery(); disposeGuard() }
}
