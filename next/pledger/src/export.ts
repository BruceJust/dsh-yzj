/**
 * 取走 —— **拷得走 ≠ 取得走** (v2.0 / #62-A2 / 断言⑰).
 *
 * 硬合同第三条写着「本人可整体取走」。上一版兑现到「目录自包含、拷贝独立可读」就
 * 停了——可拷走的是一份 `pledger.jsonl`：一串带 id 的 JSON 行。**逐级兑付定律对
 * 取走律同样适用**：给不出人能读的东西的「可取走」，是明拒条款上的幽灵信号。
 *
 * 所以目录是**三件套**：
 * ① `pledger.jsonl` —— 原件，机器可重放；
 * ② `判例册.md` —— **人可读全史**，每条含「当时 / 事实 / 证据」三段文本；
 * ③ `README.md` —— 硬合同五条 + 格式说明 + 「本目录不依赖任何外部系统」。
 *
 * 两件事这份导出**刻意不做**：
 * - **不解析任何锚**。正文全部来自写入时定格的照片（立此存照律）。导出时组织图
 *   可能已经墓碑，那时再去解析就晚了——自包含的门槛在**写入面**，不在导出面。
 * - **不写任何事件**。读自己的账是自由：导出前后事件流一行不增（断言⑰）。
 */

import { asRecord, asString } from '@yzj-next/graph'
import type { YzjPledger } from './service.ts'
import { anchoredOf } from './patterns.ts'
import { ATTRIBUTION_LABEL, DEFAULT_PATTERN_WINDOW, type Attribution } from './types.ts'
import { CONTRACT_CHIPS, VAULT_REFUSALS } from './vault.ts'

/** 导出的两份人可读文件。写盘由调用方做——这一层只负责把话说清楚。 */
export interface VaultExport {
  readonly casebook: string
  readonly readme: string
}

const when = (iso: string): string => {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString('zh-CN', { hour12: false })
    : iso
}

/**
 * 判例册 —— 一份**纯 markdown**，在没有组织图、没有本系统的环境里也读得完。
 *
 * 每条判例三段：**当时** × **事实** × **证据**，全部是文本。锚只作为括注附在后面，
 * 而且明说它是「回真身用的坐标」——不是内容的来源。全文没有一处 id-only 的悬挂引用
 * （断言⑰ grep 这一条）。
 */
export function casebookOf(pledger: YzjPledger, now = Date.now()): string {
  const lines: string[] = [
    '# 我的判断 · 判例册',
    '',
    `> 导出于 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}。`,
    '> **这份文件不依赖任何外部系统**：下面每一段文字都是写下它的那一刻定格的快照，',
    '> 不是从别处解析出来的。组织侧的对象后来变了、没了，这里一个字都不会少。',
    '',
    '---',
    '',
  ]

  const cases = [...pledger.query('calibration')]
    .filter(object => asString(asRecord(object.state)?.status) === 'answered')
    .sort((left, right) => left.updatedAt - right.updatedAt)
  lines.push(`## 已对表的判例（${String(cases.length)} 条）`, '')
  if (cases.length === 0) {
    lines.push('（还没有。判例是「当时的裁决 × 后来的事实」被你亲手配上那一格之后才有的东西。）', '')
  }
  for (const object of cases) {
    const state = asRecord(object.state)
    const attribution = asString(state?.attribution) as Attribution | undefined
    const verdict = anchoredOf(state?.verdict)
    const fact = anchoredOf(state?.fact)
    const evidence = Array.isArray(state?.evidence) ? state.evidence.map(anchoredOf) : []
    lines.push(
      `### ${attribution === undefined ? '（未归因）' : ATTRIBUTION_LABEL[attribution]} · ${when(verdict.at)}`,
      '',
      `- **当时**：${asString(state?.thenText) ?? verdict.text}`,
      `- **事实**：${fact.text}`,
      ...(evidence.length === 0
        ? []
        : ['- **证据**：', ...evidence.map(one => `    - ${one.text}`)]),
      ...(verdict.anchor === undefined
        ? []
        : [`- 回真身的坐标（仅供跳转，内容不来自它）：\`${verdict.anchor.kind}:${verdict.anchor.id}\``]),
      '',
    )
  }

  const expectations = [...pledger.query('expectation')]
    .sort((left, right) => left.createdAt - right.createdAt)
  lines.push('---', '', `## 预期（${String(expectations.length)} 条）`, '')
  if (expectations.length === 0) {
    lines.push('（还没有。预期在裁决时刻出生，不可回填——所以这里永远不会有事后补写的行。）', '')
  }
  for (const object of expectations) {
    const state = asRecord(object.state)
    const status = asString(state?.status) ?? 'testing'
    const checkpoint = asRecord(state?.checkpoint)
    const verdict = anchoredOf(state?.verdict)
    const label = status === 'withdrawn' ? '已撤回' : status === 'settled' ? '已对表' : '检验中'
    lines.push(
      `### 「${asString(state?.text) ?? ''}」 · ${label}`,
      '',
      `- 检验点：${asString(checkpoint?.text) ?? '（未定）'}`,
      `- 当时裁决的是：${verdict.text}`,
      `- 立于：${when(new Date(object.createdAt).toISOString())}`,
      ...(status === 'withdrawn'
        ? [`- 撤回理由：${asString(state?.reason) ?? '（未写）'}`,
          '- 撤回是终态：前提消失时撤回是诚实，不是失败。']
        : []),
      '',
    )
  }

  const distribution = pledger.query('calibration')
    .filter(object => asString(asRecord(object.state)?.status) === 'answered')
    .reduce<Record<string, number>>((count, object) => {
      const key = asString(asRecord(object.state)?.attribution) ?? '?'
      return { ...count, [key]: (count[key] ?? 0) + 1 }
    }, {})
  lines.push(
    '---', '',
    `## 归因分布（近 ${String(DEFAULT_PATTERN_WINDOW.days)} 天之外的也在这里——这一份是全史）`, '',
    ...(['q1', 'q2', 'q3', 'q4'] as Attribution[])
      .map(cell => `- ${ATTRIBUTION_LABEL[cell]}：${String(distribution[cell] ?? 0)} 条`),
    '',
    '> **这里只陈列，不解读。** 单次归因防不住「永远选一格」，分布能；而一旦有谁',
    '> 替你解读分布，它就从镜子变回了教练。结论你自己下。',
    '',
  )
  return lines.join('\n')
}

/** 目录说明 —— 硬合同、格式、以及那句最要紧的话。 */
export function readmeOf(owner: string | undefined, now = Date.now()): string {
  return [
    '# 我的判断（金库）· 私账目录',
    '',
    `> 归属：${owner ?? '（未知）'}　导出于 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '## 这个目录是什么',
    '',
    '组织的图记承诺的一生，这本账记**你的判断**的一生——两本账，两种可见性，永不合流。',
    '',
    '**本目录不依赖任何外部系统。** 拷到任何一台机器上，`判例册.md` 都读得完整：',
    '每一段文字都是写下它的那一刻定格的快照，不是从别处解析出来的链接。',
    '',
    '## 三件套',
    '',
    '| 文件 | 是什么 |',
    '|---|---|',
    '| `pledger.jsonl` | 原件。一行一个事件，append-only，机器可重放 |',
    '| `判例册.md` | 人可读全史。每条判例含「当时 / 事实 / 证据」三段文本 |',
    '| `README.md` | 你正在读的这份 |',
    '| `snapshot.json` | 物化缓存，可以删——删了下次从原件重放 |',
    '',
    '## 硬合同',
    '',
    ...CONTRACT_CHIPS.map(chip => `- **${chip.label}** —— ${chip.how}`),
    '',
    '## 这本账故意没有的东西',
    '',
    VAULT_REFUSALS.map(one => `**${one}**`).join(' · ') + '。',
    '',
    '故意没有的东西不说出来，看起来就只是还没做。这几样不是还没做——是**不做**：',
    '金库只陈列判例与对表，结论你自己下。',
    '',
    '## 删掉它',
    '',
    '直接删掉这个目录就是销毁，没有任何别的地方留着副本；系统里的入口是金库里的',
    '两段式确认。更正一律走追加，**销毁是这本账唯一的删除路径**。',
    '',
  ].join('\n')
}

/** 两份文件一起产出。**读操作**：不写任何事件。 */
export function vaultExport(pledger: YzjPledger, now = Date.now()): VaultExport {
  return { casebook: casebookOf(pledger, now), readme: readmeOf(pledger.owner, now) }
}
