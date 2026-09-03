/** 判断力档案与判例册 —— 托管律的两个可读面。判例册页眉写 dogfood 四数；不解析锚、不写事件。 */
import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString } from '@yzj-next/graph'
import { judgView } from './judg.ts'
import { activeClauses } from './pledge.ts'
import { ATTRIBUTION_LABEL, DEFAULT_WINDOW, RECEIPT_TYPE_LABEL, type ClauseKey } from './types.ts'

export const DESTROY_PHRASE = '销毁我的判断账本'

/** 硬合同五条：系统保证，只读。 */
export const HARD_TERMS: readonly { readonly label: string; readonly value: string; readonly how: string }[] = [
  { label: '谁能看', value: '只有你', how: 'viewer 单态：这个账本的读取面上没有「别人」这个参数' },
  { label: '存在哪', value: '你自己的记录，不进公司系统', how: '组织图的事件 schema 里没有任何私账字段；组织侧包 import 私账即 CI 红' },
  { label: '带走', value: '可以整本导出或销毁；公司和别人不能导出', how: '目录自包含 + 判例册；审计导出的重放不挂这个源' },
  { label: '考核', value: '永远不进任何考核或汇总', how: '组头查询强制滚动窗，返回类型里没有判词的位置' },
  { label: '拿来做什么', value: '我只在你要看的时候拿出来，不拿它去改别的事', how: '模型没有写私账的工具；显示规则只由你的软合同句签发' },
]

export interface JudgContract {
  readonly hard: typeof HARD_TERMS
  readonly soft: readonly { readonly clauseId: string; readonly key: ClauseKey; readonly family?: string; readonly text: string; readonly at: number }[]
  readonly signedBy: '你自己'
  readonly agentMayPropose: false
}

export function judgContract(ctx: Context): JudgContract {
  return { hard: HARD_TERMS, soft: activeClauses(ctx), signedBy: '你自己', agentMayPropose: false }
}

/** dogfood 三指标 + 30 天末生效（分册 §9）。全部是 pgraph 计数。 */
export function indicators(ctx: Context): { pledges: number; answered: number; seen: number; feedback: number; activeClauses: number; activeLeases: number } {
  const pledger = ctx.get('yzjPledger')
  if (pledger === undefined || !pledger.ready) return { pledges: 0, answered: 0, seen: 0, feedback: 0, activeClauses: 0, activeLeases: 0 }
  const answered = new Set(pledger.events(['calibration/answered']).map(event => asString(asRecord(event.data)?.calibrationId)))
  const seen = new Set(pledger.events(['calibration/seen']).map(event => asString(asRecord(event.data)?.calibrationId)))
  const clauses = activeClauses(ctx)
  return {
    pledges: pledger.events(['expectation/opened']).length,
    answered: answered.size,
    seen: seen.size,
    feedback: pledger.events(['clause/set']).length + pledger.events(['clause/cleared']).length,
    activeClauses: clauses.filter(one => one.key !== 'lease').length,
    activeLeases: clauses.filter(one => one.key === 'lease').length,
  }
}

const when = (iso: string | number): string => {
  const parsed = typeof iso === 'number' ? iso : Date.parse(iso)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('zh-CN', { hour12: false }) : String(iso)
}

/** 判例册：纯 markdown，没有本系统的环境里也读得完。 */
export function casebookOf(ctx: Context, now = Date.now()): string {
  const view = judgView(ctx, DEFAULT_WINDOW, now)
  const numbers = indicators(ctx)
  const lines: string[] = [
    '# 我的判断 · 判例册',
    '',
    `> 导出于 ${when(now)}。这份文件不依赖任何外部系统：每一段都是写下它那一刻定格的快照。`,
    `> 自发押注 ${String(numbers.pledges)} · 回执归因 ${String(numbers.answered)} / 已在屏 ${String(numbers.seen)}`
      + ` · 回喂事件 ${String(numbers.feedback)} · 生效中：${String(numbers.activeClauses)} 句 + ${String(numbers.activeLeases)} 份租约`,
    '',
  ]
  if (view.groups.length === 0) lines.push('（还没有内容——押和结果都从你自己的裁决长出来。）', '')
  for (const group of view.groups) {
    const head = group.head
    lines.push(
      `## ${head.label}`,
      '',
      `同意 ${String(head.agree)}（没被推翻 ${String(head.notReversed)} · 被推翻 ${String(head.reversed)}）`
        + `｜没同意 ${String(head.diverged)}（证明对 ${String(head.vindicated)} · 待定 ${String(head.pending)}）`
        + `｜每次约 ${String(Math.round(head.dwellMs / 1000))} 秒 · 等你约 ${String(Math.round(head.waitMs / 60_000))} 分钟`,
      '',
    )
    for (const row of group.rows) {
      if (row.kind === 'pledge') {
        lines.push(`- 押「${row.text}」 · ${row.status === 'withdrawn' ? `已撤回${row.reason === undefined || row.reason === '' ? '' : `（${row.reason}）`}` : row.checkpointText} · 押在：${row.verdict.text}`)
        continue
      }
      lines.push(
        `- ${row.dismissed ? '（这不是那件事的结果，没记入）' : row.attributionLabel ?? '（还没定）'} · ${RECEIPT_TYPE_LABEL[row.type]} · ${when(row.at)}`,
        ...row.then.map(one => `    - 当时：${one.text}`),
        ...row.later.map(one => `    - 后来：${one.text}`),
      )
    }
    lines.push('')
  }
  lines.push('---', '', '这里没有分数、没有排名、没有别人的账。结论你自己下。', '')
  return lines.join('\n')
}

export function readmeOf(owner: string | undefined, now = Date.now()): string {
  return [
    '# 我的判断 · 私账目录',
    '',
    `> 归属：${owner ?? '（未知）'}　导出于 ${when(now)}`,
    '',
    '`pledger.jsonl` 是原件（一行一个事件，机器可重放）；`判例册.md` 是人可读全史；`snapshot.json` 可删。',
    '**本目录不依赖任何外部系统。** 直接删掉这个目录就是销毁——系统里没有别的副本。',
    '',
    ...HARD_TERMS.map(term => `- **${term.label}**：${term.value}`),
    '',
  ].join('\n')
}

export const ATTRIBUTION_CELLS = ATTRIBUTION_LABEL
