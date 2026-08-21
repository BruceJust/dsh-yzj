/**
 * `obj-minutes` —— 纪要双桥 (§5.6，设计 v4.16).
 *
 * 摄取的**传输**卡在一把用户会话钥匙上（实测：网关答「当前会话超时」而不是 404），
 * 而摄取的**规则**——双桥、三级可信度、内容级去重、只读铁律——今天就能跑。所以这个
 * 插件今天挂上去是有用的：人把一份纪要贴进来，两座桥照样走。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@yzj-next/graph'
import type { TurnBinding } from '../turns.ts'
import { readMinutes } from './bridge.ts'
import { ingestMinutes, pullAndIngest } from './ingest.ts'

export const name = 'yzj-next-obj-minutes'
export const inject = ['yzjGraph', 'tools']

const output = {
  schema: {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: { content: { type: 'string' as const, required: true as const } },
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

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'minutes_ingest',
    description: 'Turn a meeting\'s minutes into PROPOSALS — decisions become goal proposals (carrying the basis the minutes recorded), action items become commitment proposals (carrying the executor\'s openId when the minutes bound one). Nothing becomes a fact: a human decides every item. Pass stenoId to pull from AI 速记, or paste the minutes JSON directly when the channel is not connected.',
    presentCall: () => ({ card: 'generic', title: '把会议纪要变成提案', kind: 'edit' }),
    parameters: {
      stenoId: { type: 'string', description: 'AI 速记 id, when the channel can reach it.' },
      minutesJson: { type: 'string', description: 'The minutes payload as JSON, when pasted by hand.' },
    },
    output,
    timeoutMs: 30_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const scope = {
        ...(binding?.topicKey === undefined ? {} : { topicKey: binding.topicKey }),
        ...(binding?.placeKey === undefined ? {} : { placeKey: binding.placeKey }),
        ...(binding?.decider === undefined ? {} : { decider: binding.decider }),
      }
      if (args.minutesJson !== undefined && args.minutesJson.trim() !== '') {
        let payload: JsonValue
        try {
          payload = JSON.parse(args.minutesJson) as JsonValue
        } catch {
          return { content: '这段纪要不是合法的 JSON，解析不了。' }
        }
        const id = args.stenoId ?? `pasted:${String(Date.now())}`
        const outcome = await ingestMinutes(ctx, readMinutes(id, payload), scope)
        return { content: outcome.note }
      }
      if (args.stenoId === undefined) {
        return { content: '给一个 stenoId，或者把纪要 JSON 贴进 minutesJson。' }
      }
      return { content: (await pullAndIngest(ctx, args.stenoId, scope)).note }
    },
  })))
}
