/**
 * 建一条目标真身 —— **人选落点，系统建文档**（v4.8 立目标；技术方案「真身行经既有
 * sheet/doc 工具 + 确认流创建」）。
 *
 * 立目标有三个入口，此前两个入口都在同一件事上让人当集成层：看板那张表只有一个「真身
 * 链接」输入框，提案那条路则回一句「请对方在云之家建好目标文档，把链接跟确认一起发过
 * 来」。两句话背后是同一个已经被推翻的前提——「agent 建不了云之家文档」。`doc create`
 * 一直都在。
 *
 * 所以这段逻辑住在这里，而不是在两个消费者各写一份：**两份一样的判断，迟早在「正文要
 * 不要写进去」这种事上分道扬镳**，而那时两个入口立出来的目标就不是同一种东西了。
 *
 * 三件事分得很清楚：
 *
 * - **建在哪个知识库是人的决定**：谁打得开这个目标就取决于它。这个函数不挑、不缺省、
 *   不「沿用上次那个」——调用方必须带着一个 workspace 进来，问那一句是调用方的事。
 * - **建文档 + 写正文是纯损耗**，归系统。
 * - **正文写不进去不等于文档没建出来**：那时返回链接**并且说明正文是空的**——把一次
 *   半成功报成失败，人会再建一份，于是同一个目标有了两个真身。
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type JsonValue } from '@yzj-next/graph'

/** 云之家文档的可打开地址。与工具层同一份推导。 */
export function goalBodyLink(docId: string): string {
  return `https://www.yunzhijia.com/knowledge/lingee/#/store/doc/${docId}`
}

export interface GoalBodyMade {
  readonly url: string
  readonly id: string
  /** 建出来了，但正文没写进去时的实话。 */
  readonly note?: string
}

function failureText(result: { readonly stderr?: string; readonly json?: unknown }, fallback: string): string {
  const said = (result.stderr ?? '').trim()
  return said === '' ? fallback : said
}

/**
 * @param input.workspace - 知识库 id。**由人选**，调用方问出来的。
 * @param input.title - 文档标题 = 目标名。
 * @param input.criteria - 「怎么算完成」。写进正文，因为**评估是回真身里读它的**——
 *   只活在图里的标准，是没有人能拿去对账的标准（真身唯一律）。
 */
export async function createGoalBody(
  ctx: Context,
  input: { readonly workspace: string; readonly title: string; readonly criteria?: string },
): Promise<GoalBodyMade | { readonly error: string }> {
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { error: '云之家通道未就绪' }

  const made = await bridge.run(
    ['doc', 'create', '--workspace', input.workspace, '--title', input.title],
    { timeoutMs: 30_000 },
  )
  if (!made.ok) return { error: failureText(made, '真身没能建出来') }
  const id = asString(asRecord(made.json as JsonValue)?.id)
  /*
    **没拿到 id 就算失败。**

    建了一个找不回来的文档，比没建更坏：目标会挂在一个空链接上，而板上那一行看起来
    一切正常——真身之变律里最难查的那一种，引用还在、指向的东西打不开。
  */
  if (id === undefined) return { error: '云之家没有回传文档 id，真身链接取不到' }

  const criteria = (input.criteria ?? '').trim()
  if (criteria === '') return { url: goalBodyLink(id), id }

  /*
    正文里先立一行「怎么算完成」，再把原话放进去。

    用 `block insert` 而不是整篇 overwrite：这是一份刚建出来的空文档，append 语义在这里
    与 overwrite 等价，而**默认宁 append 勿 overwrite** 是这一族工具的既定纪律（overwrite
    没有版本参数，并发下会盖掉别人刚写的东西）。
  */
  const element = JSON.stringify([
    { type: 'heading2', content: [{ type: 'text', content: '怎么算完成' }] },
    ...criteria.split('\n').map(line => ({
      type: 'paragraph',
      content: [{ type: 'text', content: line.trim() }],
    })).filter(block => block.content[0]?.content !== ''),
  ])
  const wrote = await bridge.run(
    ['doc', 'block', 'insert', '--id', id, '--element', element],
    { timeoutMs: 30_000 },
  )
  if (wrote.ok) return { url: goalBodyLink(id), id }
  return {
    url: goalBodyLink(id),
    id,
    // 半成功要说成半成功：文档在，正文空着，评估到时候读不到标准。
    note: `真身建好了，但「怎么算完成」没能写进正文（${failureText(wrote, '写入失败')}）——请自己补一句，否则日后评估读不到标准。`,
  }
}
