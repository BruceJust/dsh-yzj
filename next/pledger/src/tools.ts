/**
 * 工具面 —— **新增模型工具仅两个** (§8).
 *
 * `pledger_query` 只读，`pledger_register` 落账。组织侧 41 个工具零变更。
 *
 * Two properties are enforced by the SIGNATURES rather than by prompts:
 *
 * - **`pledger_register` 上没有 `text` 参数** (断言⑬ / PTD-12). 原话直存律的参数面
 *   保证：模型连转写你的赌注的通道都没有。于是立约与补登事实**只有人手路径**
 *   （桌面私语面 / 金库行内动词），这不是纪律，是这张 schema 的形状。
 * - **没有 viewer 参数**. 私账的读取面上就没有「以谁的身份看」这个问题——账本随
 *   目录归属一个人，而目录在进程启动前就已经回答了这件事 (断言⑨).
 *
 * viewer 条款（§8「place turn 中此工具不存在而非被拒绝」）在 P1 落成一道**单调
 * 拒绝门**：工具运行时只对 agent 作用域开放 `restrict()`，而这个插件不在任何 agent
 * 作用域里，所以「不注册进那一面」这一形态暂时够不到。拒绝是单调的——别的插件的
 * allow 翻不回来——而且它和组织侧对 shell / 委派执行类工具用的是同一条既有机制。
 * 这是一处**明标的降级**：形态不同，效果（云之家触发的回合碰不到这本账）相同。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { asRecord, asString } from '@yzj-next/graph'
import { PROPOSAL_FAMILIES } from './families.ts'
import { patternsIn } from './patterns.ts'
import { vaultView } from './vault.ts'
import { reattribute, reopenInvites, shiftGear, toggleMirror } from './verbs.ts'
import { ATTRIBUTION_LABEL, DEFAULT_PATTERN_WINDOW, type Attribution, type Gear } from './types.ts'

/** The two tool names. Listed once so the guard and the registry cannot drift. */
export const PLEDGER_TOOLS = ['pledger_query', 'pledger_register'] as const

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

/** True when this turn reads as the operator — the only identity this ledger has. */
export function isOperatorTurn(ctx: Context, agent: Agent | undefined): boolean {
  if (agent === undefined) return true
  const turns = ctx.get('yzjTurns')
  const binding = turns?.bindingFor(agent) ?? turns?.defaultBinding()
  // 不知道是哪一种就当**不是**：宁可这一回合读不到自己的账，不可在群里读出来。
  return binding?.viewer.kind === 'operator'
}

/**
 * The monotonic denial. Registered by the pledger itself, so a deployment that
 * mounts the ledger cannot end up with an ungated private read.
 */
export function pledgerDenial(
  ctx: Context, exec: { readonly name: string; readonly agent?: Agent },
): string | undefined {
  if (!(PLEDGER_TOOLS as readonly string[]).includes(exec.name)) return undefined
  return isOperatorTurn(ctx, exec.agent)
    ? undefined
    : '这是操作者本人的私账，云之家场所触发的回合读不到它，也写不进去。'
}

export function applyPledgerTools(ctx: Context): () => void {
  const disposeGuard = ctx.tools.guard(exec => pledgerDenial(ctx, exec))

  const disposeQuery = ctx.tools.register(defineTool({
    name: 'pledger_query',
    description:
      'Read the operator\'s OWN private judgement ledger (the vault): expectations under test, '
      + 'calibrated cases, and rolling patterns. Only ever call this when the operator has just '
      + 'asked you to look at their own record — never to decide how to behave, never to adjust a '
      + 'proposal, and never in a group conversation. This ledger belongs to one person and is '
      + 'invisible to the organization.',
    presentCall: () => ({ card: 'generic', title: '查你的判断（金库）', kind: 'read' }),
    parameters: {
      zone: {
        type: 'string',
        enum: ['testing', 'settled', 'patterns', 'gears'],
        description: 'Which part of the vault to read; omit for a summary of all of them.',
      },
      /**
       * 窗口是**必填的语义**，不是可选的方便 (PTD-5).
       *
       * 参数上给了默认值（90 天），可它没有「不限」这个取值：一次全史聚合在这个
       * schema 上不可构造。「判断力得分」因此不是一个被拒绝的请求，是一个说不出口
       * 的请求。
       */
      windowDays: {
        type: 'number',
        description: 'Rolling window in days for patterns (default 90). There is no all-time option.',
      },
    },
    output,
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!isOperatorTurn(ctx, exec.agent)) throw new Error('私账只对本人的回合开放')
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) {
        return { content: '（这个部署没有启用私账层）', count: 0 }
      }
      const window = { days: args.windowDays ?? DEFAULT_PATTERN_WINDOW.days }
      const view = vaultView(pledger, { window })
      await Promise.resolve()
      if (args.zone === 'testing') {
        return {
          content: view.testing.length === 0
            ? '（没有检验中的预期。预期不可回填——只在裁决时刻出生。）'
            : view.testing.map(row => (
              `「${row.text}」 · 检验点：${row.checkpointText}${row.due ? '（已过，待对表）' : ''}`
            )).join('\n'),
          count: view.testing.length,
        }
      }
      if (args.zone === 'settled') {
        return {
          content: view.settled.length === 0
            ? '（还没有已对表的判例。）'
            : view.settled.map(row => (
              `[${row.attributionLabel}] ${row.thenText} → ${row.factText}`
            )).join('\n'),
          count: view.settled.length,
        }
      }
      if (args.zone === 'patterns') {
        const patterns = patternsIn(pledger, window)
        return {
          content: patterns.length === 0
            ? `（近 ${String(window.days)} 天没有重复出现的判例。模式是滚动派生的，不是档案。）`
            : patterns.map(one => `${one.label}：${String(one.count)} 次`).join('\n'),
          count: patterns.length,
        }
      }
      if (args.zone === 'gears') {
        return {
          content: view.gears.map(row => `${row.label}：${row.gear} 档`).join('\n'),
          count: view.gears.length,
        }
      }
      return {
        content: [
          `检验中 ${String(view.testing.length)} · 已对表 ${String(view.settled.length)} · 已撤回 ${String(view.withdrawn.length)}`,
          `模式（近 ${String(window.days)} 天，滚动派生）：${view.patterns.length === 0 ? '无' : view.patterns.map(one => `${one.label} ${String(one.count)} 次`).join('；')}`,
          `档位：${view.gears.map(row => `${row.label}=${row.gear}`).join('，')}`,
          '这本账无分数、无排名、无画像、无建议倾向、无团队视图——结论由本人自己下。',
        ].join('\n'),
        count: view.testing.length + view.settled.length,
      }
    },
  }))

  const disposeRegister = ctx.tools.register(defineTool({
    name: 'pledger_register',
    description:
      'Record the operator\'s OWN decision about their private ledger, when they say it in words: '
      + 'an attribution on a calibration receipt, a gear shift on a proposal family, a rear-view '
      + 'mirror toggle, or reopening a silenced invite family. '
      + 'You may NEVER choose an attribution for them and you may NEVER write their words: there is '
      + 'no text parameter here on purpose. Opening an expectation and noting an outside fact are '
      + 'not available through this tool at all — those are the person\'s own sentences and they '
      + 'are typed by the person.',
    presentCall: args => ({
      card: 'generic',
      title: `记进你的金库：${String((args as { action?: unknown }).action ?? '')}`,
      kind: 'edit',
    }),
    parameters: {
      action: {
        type: 'string',
        enum: ['attribute', 'dismiss', 'reopen', 'shift-gear', 'mirror', 'reopen-invites'],
        description: 'What the operator just told you to record.',
        required: true,
      },
      calibrationId: { type: 'string', description: 'Target receipt for attribute / dismiss / reopen.' },
      attribution: {
        type: 'string',
        enum: ['q1', 'q2', 'q3', 'q4'],
        description:
          'The cell THE OPERATOR named: q1 right-by-judgement, q2 right-by-luck, '
          + 'q3 wrong-by-judgement, q4 wrong-by-world. Never infer this.',
      },
      family: {
        type: 'string',
        enum: PROPOSAL_FAMILIES.map(spec => spec.family),
        description: 'Proposal family for shift-gear / mirror / reopen-invites.',
      },
      gear: {
        type: 'string',
        enum: ['default', 'weight'],
        description:
          'Gear to move to. `lease` is absent on purpose: an authorization lease is an '
          + 'ORGANIZATION-side object created through its own strong-confirmation flow.',
      },
      patternKey: { type: 'string', description: 'Which pattern the mirror is for.' },
      on: { type: 'boolean', description: 'Mirror on or off.' },
    },
    output,
    timeoutMs: 10_000,
    async execute(args, exec) {
      if (!isOperatorTurn(ctx, exec.agent)) throw new Error('私账只对本人的回合开放')
      const pledger = ctx.get('yzjPledger')
      if (pledger === undefined || !pledger.ready) throw new Error('这个部署没有启用私账层')
      switch (args.action) {
        case 'attribute': {
          if (args.calibrationId === undefined || args.attribution === undefined) {
            throw new Error('归因要说清是哪一条回执、哪一格——而那一格必须是操作者自己说的。')
          }
          await reattribute(ctx, args.calibrationId, args.attribution as Attribution)
          return {
            content: `已记：${ATTRIBUTION_LABEL[args.attribution as Attribution]}（归因可纠，更正即追加）`,
          }
        }
        case 'dismiss':
        case 'reopen': {
          if (args.calibrationId === undefined) throw new Error('要说清是哪一条回执')
          const current = pledger.object('calibration', args.calibrationId)
          if (current === undefined) throw new Error(`找不到校准回执 ${args.calibrationId}`)
          const status = asString(asRecord(current.state)?.status)
          if (args.action === 'dismiss' && status !== 'open') throw new Error('这条回执不在待答态')
          if (args.action === 'reopen' && status !== 'dismissed') throw new Error('这条回执没有被标注「配对错了」')
          await pledger.append({
            type: args.action === 'dismiss' ? 'calibration/dismissed' : 'calibration/reopened',
            data: { calibrationId: args.calibrationId },
            actor: { kind: 'operator', ...(pledger.owner === undefined ? {} : { openId: pledger.owner }) },
          })
          return { content: args.action === 'dismiss' ? '已标注「配对错了」，判例未入账。' : '已纠回，四格重新可答。' }
        }
        case 'shift-gear': {
          if (args.family === undefined || args.gear === undefined) throw new Error('换挡要说清哪一族、哪一档')
          await shiftGear(ctx, { family: args.family, gear: args.gear as Gear, entry: 'vault' })
          return { content: `已换挡：${args.family} → ${args.gear}（档位私有，组织侧无人知晓）` }
        }
        case 'mirror': {
          if (args.family === undefined || args.patternKey === undefined || args.on === undefined) {
            throw new Error('后视镜要说清哪一族、哪个模式、开还是关')
          }
          await toggleMirror(ctx, args.family, args.patternKey, args.on)
          return { content: `后视镜已${args.on ? '开' : '关'}——你签发的私账规则，我只执行显示。` }
        }
        case 'reopen-invites': {
          if (args.family === undefined) throw new Error('要说清哪一族')
          await reopenInvites(ctx, args.family)
          return { content: `${args.family} 的立约邀约已重新打开。` }
        }
        default:
          throw new Error(`未知动作 ${String(args.action)}`)
      }
    },
  }))

  return () => {
    disposeRegister()
    disposeQuery()
    disposeGuard()
  }
}
