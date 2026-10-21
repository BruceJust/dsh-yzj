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
  return { text: text.length > 80 ? `${text.slice(0, 80)}…` : text, retrying: false }
}
