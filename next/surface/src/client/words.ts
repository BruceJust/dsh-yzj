/**
 * 屏上的几句公共的话 —— 界面重设计 律一「界面不解释自己」、§7「说人话」.
 *
 * 放在一处，是因为它们此前各写各的：agent 有五种叫法（云小助 / Agent / agent / AI /
 * 智能体），「多久以前」有三种算法，宿主的原始报错（一整段 JSON）直接贴上屏。说法
 * 一旦散开，就没有人能保证它们说的是同一件事。
 */

/**
 * agent 在屏上的名字。
 *
 * 和出站落款「—— 云小助（操作者）」是**同一个名字**（`objects/signature.ts` 的
 * `SIGNATURE_AGENT`，测试里对过）。浏览器这一半不能 import 节点侧的包，所以抄一份，
 * 由测试保证两处不分家。
 */
export const AGENT = '云小助'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 一段时长，按人说话的粒度：分钟、小时、天。不到一分钟不报数。 */
export function span(ms: number): string {
  const d = Math.max(0, ms)
  if (d < MIN) return '不到 1 分钟'
  if (d < HOUR) return `${String(Math.floor(d / MIN))} 分钟`
  if (d < DAY) return `${String(Math.floor(d / HOUR))} 小时`
  return `${String(Math.floor(d / DAY))} 天`
}

/**
 * 「谁在等你、等了多久」—— 「要你」每一条的第二行 (律二).
 *
 * 一条「要你」就是一个被你卡住的人，所以这一行先说人：「李婷等你 13 小时」。刚开口的
 * 不报「0 分钟」，说「在等你」。
 */
export function waitLine(who: string, since: number, now: number): string {
  const waited = now - since
  return waited < MIN ? `${who}在等你` : `${who}等你 ${span(waited)}`
}

/** 宿主报错的人话版本，和「它会不会自己好」。 */
export interface PlainError {
  readonly text: string
  /** 轮询会自己再试——界面要说「稍后自动重试」，而不是让人去按什么。 */
  readonly retrying: boolean
}

/**
 * 把宿主的原话翻成人话 —— **不贴 JSON** (§5.8 错误说人话、自动恢复).
 *
 * 实测贴上屏的是这样一段：`yzj channel messages for 6a60… failed: {"error":{"code":
 * 10000429,"message":"API error: code=10000429, 请求过于频繁",…}}`。人从里面读得出的
 * 只有一件事：「云之家暂时限流」——其余是给开发者看的，放进 `title` 里留给需要的人。
 *
 * 认不出来的就取 JSON 里那句 message，再认不出来就原样给出：**宁可说一句半懂的实话，
 * 不编一句好懂的假话**。已经是人话的（宿主的拒绝理由多半是中文整句）原样放行。
 */
export function plainError(raw: string): PlainError {
  const text = raw.trim()
  if (/10000429|请求过于频繁|too many requests|\b429\b/iu.test(text)) {
    return { text: '云之家暂时限流', retrying: true }
  }
  if (/token|401|未登录|登录已?过期|unauthori[sz]ed/iu.test(text)) {
    return { text: '云之家的登录过期了，需要重新登录', retrying: false }
  }
  if (/\b403\b|无权限|没有权限|forbidden/iu.test(text)) {
    return { text: '没有权限读这里', retrying: false }
  }
  if (/transport|network|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|timeout|超时|decoding response/iu.test(text)) {
    return { text: '暂时连不上云之家', retrying: true }
  }
  const message = /"message"\s*:\s*"([^"]+)"/u.exec(text)?.[1]
  if (message !== undefined) {
    return { text: message.replace(/^API error:\s*code=\d+,\s*/u, '').slice(0, 60), retrying: false }
  }
  // 整句中文、没夹着结构的，是写给人看的：一个字不剪。
  if (/[\u4e00-\u9fff]/u.test(text) && !/[{}[\]]/u.test(text)) return { text, retrying: false }
  return { text: text.length > 80 ? `${text.slice(0, 80)}…` : text, retrying: false }
}

/**
 * 原话期限解析出的那一天，按人数日子的方式说：今天 / 明天 / 周五 / 11/3 周二，过了零点
 * 之外的时刻带上几点。「原话「明天」→ 周四 18:00」——先原话，再结果（律五）。
 */
export function dueDayText(at: number, now: number): string {
  const day = new Date(at)
  const today = new Date(now)
  const start = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(day) - start(today)) / 86_400_000)
  const weekday = `周${'日一二三四五六'[day.getDay()] ?? ''}`
  const name = days === 0 ? '今天' : days === 1 ? '明天' : days === 2 ? '后天'
    : days > 0 && days < 7 ? weekday
      : `${String(day.getMonth() + 1)}/${String(day.getDate())} ${weekday}`
  const endOfDay = day.getHours() === 23 && day.getMinutes() === 59
  return endOfDay ? name : `${name} ${String(day.getHours()).padStart(2, '0')}:${String(day.getMinutes()).padStart(2, '0')}`
}

/**
 * 一次回答没生效，用人话说为什么 (§5.8)。
 *
 * 卡服务的回执是写给云之家那一头的（「本次应答已记录但未生效」「由 op-1a2b 选择「approve」
 * 并执行」）——账号 id 和动作 id 原样上屏，人读不懂。这里按结果说：谁答的、在哪答的，卡上
 * 那一行吸收行已经写着，不用再贴一遍原文。
 */
export function receiptLine(result: { readonly outcome: string; readonly receipt: string } | undefined, fallback: string): string {
  if (result === undefined) return fallback
  switch (result.outcome) {
    case 'unauthorized': return '这件不归你定，这次没生效。'
    case 'duplicate': return '已经按你的选择办过了。'
    case 'superseded':
      return /已于|处理完毕/u.test(result.receipt)
        ? '别处已经先答了，这次没生效——卡上写着是谁、在哪答的。'
        : '这张卡现在不接受这个回答了，这次没生效。'
    case 'applied': return ''
    default: {
      const text = result.receipt.replace(/^⚠️?\s*/u, '').trim()
      return text === '' ? fallback : plainError(text).text
    }
  }
}

/**
 * 一轮没答完，用人话说为什么、下一步是什么 (§5.8)。
 *
 * 模型那一头的错和云之家那一头的错是两件事：连不上模型不该说成「连不上云之家」，所以
 * 不走 {@link plainError}。每一句都带下一步——再说一句它会接着做，或者该去哪儿改。
 * 认不出来的照实带上一小段原话，不编。
 */
export function turnErrorLine(raw: string): string {
  const text = raw.trim()
  if (/abort|cancel|已停止|已中止/iu.test(text)) return '这一轮停下了。'
  if (/\b429\b|rate.?limit|too many requests|overload|\b529\b|繁忙/iu.test(text)) {
    return `模型那边正忙，${AGENT}这一轮没答完——过一会儿再说一句，它会接着做。`
  }
  if (/no credential|is not set|missing.{0,20}key|未配置/iu.test(text)) {
    return `还没填模型的钥匙，${AGENT}这一轮没答完——到设置里填一下。`
  }
  if (/\b401\b|\b403\b|api.?key|unauthori[sz]ed|forbidden|invalid.{0,12}key/iu.test(text)) {
    return `模型的钥匙不对，${AGENT}这一轮没答完——要到设置里重新填一下。`
  }
  if (/context.{0,20}(length|window)|too long|max.?tokens|token limit|上下文/iu.test(text)) {
    return `这个话题太长了，${AGENT}这一轮没答完——开一个新话题接着说会好。`
  }
  if (/timeout|timed out|ETIMEDOUT|ECONN|ENOTFOUND|fetch failed|network|socket|超时/iu.test(text)) {
    return `${AGENT}这一轮没连上模型，没答完——再说一句会重试。`
  }
  const said = text.replace(/^(?:[\w-]+:\s*)+/u, '').replace(/^error:\s*/iu, '')
  return `${AGENT}这一轮没答完${said === '' ? '' : `（${said.length > 40 ? `${said.slice(0, 40)}…` : said}）`}——再说一句会重试。`
}

/**
 * 一件事发生在什么时候，按人回想的方式：刚刚、几分钟前、今天几点、昨天几点、几月几号。
 *
 * 吸收行「你在云之家里回了确认 · 昨天 16:52」读的就是它——回想「这是我什么时候答的」
 * 时，人用的是这套粒度，不是一个绝对时间戳。
 */
export function whenOf(at: number, now: number): string {
  const ago = now - at
  if (ago < MIN) return '刚刚'
  if (ago < HOUR) return `${String(Math.floor(ago / MIN))} 分钟前`
  const when = new Date(at)
  const today = new Date(now)
  const clock = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  const dayOf = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((dayOf(today) - dayOf(when)) / DAY)
  if (days === 0) return clock
  if (days === 1) return `昨天 ${clock}`
  return `${String(when.getMonth() + 1)} 月 ${String(when.getDate())} 日 ${clock}`
}

/** 回答发生在哪儿，用人的话。桌面上答的不必说「在这里」——人就站在这里。 */
export function whereOf(via: string): string {
  if (via === 'yzj-text') return '在云之家里'
  return ''
}
