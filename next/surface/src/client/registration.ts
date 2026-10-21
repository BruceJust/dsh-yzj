/**
 * 登记路径的**结构化先验** —— 委派五步④ (v3.15 裁决④).
 *
 * 我上一轮判过这条「要 session 才有 turn，是通道层动刀」——**那是错的**。裁决说得很
 * 清楚：判定根本不在群 session 里跑。传送门第②步里操作者**已经选过执行者**了，那次
 * 选择本身就是先验：选了人 → 登记路径，选了 agent → 委派路径。剩下的只是把他填进
 * 骨架的两个空读出来，而那个骨架**是我们自己给的**。
 *
 * 所以这不是「用正则做语义判定」（那是被明确否掉的）：**分类**来自先验，这里只做
 * **抽取**。句子改到认不出骨架时就**认不出**——返回 undefined，那句话照常发出去，由
 * agent 像观察任何一句话那样去观察它。宁可退回旧路，也不拿一个猜出来的事由去登记
 * 一条挂在别人名下的承诺。
 */
export function registrationFrom(
  text: string, name: string,
): { readonly what: string; readonly due?: string } | undefined {
  // 受话是 composer 补上的那一截，不是句子的一部分。
  const body = text.replace(/^\s*@\S+\s*/u, '').trim()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const matched = new RegExp(
    `^登记承诺[：:]\\s*(.+?)[，,]\\s*${escaped}\\s*负责[，,]?\\s*(.*?)[。.]?\\s*$`, 'u',
  ).exec(body)
  if (matched === null) return undefined
  const what = (matched[1] ?? '').trim()
  const due = (matched[2] ?? '').trim()
  /*
    空还空着就不算填过。

    骨架里那两个〔…〕是**故意留白**的；原样发出去说明人还没写，而拿「〔要做什么〕」
    去登记一条承诺，比不登记坏得多——板上会长出一行没有人看得懂的活，挂在同事名下。
  */
  if (what === '' || what.includes('〔')) return undefined
  return due === '' || due.includes('〔') ? { what } : { what, due }
}
