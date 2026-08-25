/**
 * 一个物,三种看法 (v4.11 D13⑥).
 *
 * 「看一个文件」不是一件事,是三件:**扫一眼**它是什么(流里的卡)、**边看边回**
 * 地验收它(并排)、**深读**它(沉浸)。这三件事的区别不在文件上,在人当下想干
 * 什么——所以缩放是用户的手势,不是文件类型的属性。
 *
 * 默认落在**并排**,而不是弹窗。弹窗挡住对话,验收就变成「看完凭记忆回复」——
 * 而验收恰恰是**一边看一边说**的:「第三节这段改一下」。这条 UI 决策是产品
 * 决策的直接后果,不是审美偏好。
 *
 * 这里只存**看法**,不存内容。谁被看着、看多近,是视图选择;文件的字节是宿主
 * 取来的,按 fileId 缓存在下面那张表里,并排与沉浸共用同一份——切换姿势不该
 * 重新下载一遍。
 *
 * **工件统一**:同事拖进群的 PDF 与 agent 交付的 md 是同一种图居民,所以这里
 * 只有一个 `ArtifactRef`,两种血缘。谁生的决定卡上那行小字,不决定它怎么被看。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { AttachmentBodyWire, SurfaceInject } from './rpc.ts'

/**
 * 一件工件,不管它是怎么来的。
 *
 * 能力按**真的够得着什么**亮灭,而不是按血缘:云之家的在线文档没有字节可取
 * (otl 节点连下载口都没有),它能给的最诚实的东西是一扇门;IM 附件有字节,
 * 它能给预览和下载。同一张卡,亮的按钮不同——这不是两套 UI。
 */
export interface ArtifactRef {
  /** 稳定身份:同一个物在流里、右栏里、板上点开的是同一份预览。 */
  readonly key: string
  readonly title: string
  /** 卡上那行小字:大小、谁发的、血缘。 */
  readonly meta?: string
  /**
   * 需要被看见的提醒,不是小字。
   *
   * 「写到了别的场所」是越境信号,「共用会话」是一句关于数据本身的坦白——它们
   * 和「2.0 KB · 云之家文件」不是一类东西。把它们并进那行灰字,等于把警告降级
   * 成装饰;而它们各自都带着一个**为什么**,那句为什么才是它们存在的理由。
   */
  readonly marks?: readonly { readonly label: string; readonly why?: string }[]
  /** 决定怎么投影。取不到就从标题的后缀猜。 */
  readonly ext?: string
  readonly size?: number
  /** 字节路。有它才谈得上预览与下载。 */
  readonly fileId?: string
  /** 真身的门。有它才谈得上「在云之家打开」。 */
  readonly href?: string
  /** 出生血缘:人在 IM 里发的,还是 agent 劳动产出的。 */
  readonly origin: 'im' | 'agent'
}

/**
 * 能被打开来看的那一类工件:**有字节可取**。
 *
 * 云之家的在线文档没有这条路(otl 节点连下载口都不开),它能给的是一扇门——
 * 而且门比投影更对:那是一个活的东西,此刻可能已经被别人改了,一份复制品会
 * 骗人(数据律 1)。所以「预览」这个动词只对得起有字节的东西,由类型说出来,
 * 而不是靠每个调用点自己记得判断。
 */
export type PreviewTarget = ArtifactRef & { readonly fileId: string }

/** 并排(默认)与沉浸。流内卡不是一个「态」——它一直在那儿。 */
export type PreviewStage = 'aside' | 'immersive'

export interface PreviewState {
  readonly target?: PreviewTarget
  readonly stage: PreviewStage
}

const CLOSED: PreviewState = { stage: 'aside' }

let state: PreviewState = CLOSED
const listeners = new Set<() => void>()

/**
 * 让右栏出现的那只手。
 *
 * 右栏的开合是宿主的权,`ctx.layout` 只给了 open/close 两个动词,而按下「预览」
 * 的地方(中栏的一条消息)离那只手隔着五层 props。装配处注册一次,比一路往下
 * 传一个跟消息无关的回调干净。
 */
let opener: (() => void) | undefined

export function setPreviewOpener(open: () => void): void {
  opener = open
}

function notify(): void {
  for (const listener of listeners) listener()
}

/*
  并排有没有地方落,不能靠推断。

  「右栏挂载了没有」回答不了它,实测过:槽照样渲染,列宽却是 0——宿主的抽屉
  在**当前会话是空会话**时打不开(它要求有一个非空会话可渲染),而从群主楼或
  承诺板点开一份文件恰恰常常处在这个状态。那时按下「预览」,人看到的是**什么
  都没发生**,所有 bug 里最难被报告的一种。
*/

/** 右栏的根节点,在场期间由右栏自己交出来。 */
export interface AsideHost {
  getBoundingClientRect(): { width: number }
  closest(selector: string): unknown
}

let asideHost: AsideHost | null = null

/** 窄于这个数就不算「有地方落」:抽屉开着最窄也有 300。 */
const ASIDE_MIN = 120

/**
 * 宿主自己写在框上的那个判断:右栏此刻是收起的。
 *
 * 它和 `cols.details === 0` 在同一次提交里落下,**同步、不受动画影响**——而
 * 列宽是一路动画过来的。这条耦合是有意的,而且带着代价意识:属性名要是上游
 * 改了,下面那条宽度判断仍然兜得住真的关着的情形。
 */
function collapsed(node: AsideHost): boolean {
  return node.closest('[data-details-collapsed]') !== null
}

/**
 * 并排此刻有没有地方落。
 *
 * 两条判断,分别兜住两种失真:
 *
 * - **属性**:抽屉正在动画里张开时,量到的宽度还是 0——只看像素会把一次正常的
 *   打开误判成「开不出来」(实测栽在这里:样式写着 360,计算值还是 0px);
 * - **宽度**:属性哪天被上游改名,`collapsed` 会一律答「开着」,那时真的关着
 *   的抽屉只有像素说得出真话。
 *
 * 两条都不成立才算没地方落。宁可多给一次并排,不能静悄悄地什么都不发生。
 */
function asideAvailable(): boolean {
  if (asideHost === null) return false
  return !collapsed(asideHost) || asideHost.getBoundingClientRect().width >= ASIDE_MIN
}

export function setAsidePreviewHost(node: AsideHost | null): void {
  asideHost = node
}

/**
 * 把右栏叫开，**开不出来时喊一声**。
 *
 * 事件枢纽和工件预览是同一件事的两个实例：中栏点一下，右栏接管。所以它们共用这只手
 * （`opener` 是装配处注册的宿主动词）与同一条实测教训——**抽屉在当前会话为空时打不
 * 开**，而从承诺板点一场会恰恰常常处在这个状态。工件那条路的兜底是降级到沉浸，枢纽
 * 没有沉浸态，所以它要的是一个**能被说出口的失败**。
 *
 * 但**不能当场下结论**（这一版的第一稿就错在这儿）：`opener()` 触发的是宿主的一次
 * 状态更新，而那是异步的——紧接着量，属性还没翻、宽度还是 0，于是一次**正常的打开**
 * 会被报成「右栏没能打开」。一句看着可信的假错误，比没有提示更坏。
 *
 * 所以和 `openPreview` 同一个节拍：先量一次，不行就等它一拍再量。500ms 的理由写在
 * 那边——宿主的慢过渡实测 0.3s，而宽度越过 120 就算数。
 */
export function revealAside(unavailable: () => void): void {
  opener?.()
  if (asideAvailable()) return
  setTimeout(() => { if (!asideAvailable()) unavailable() }, 500)
}

let settling: ReturnType<typeof setTimeout> | undefined

export function openPreview(target: PreviewTarget): void {
  state = { target, stage: 'aside' }
  opener?.()
  notify()
  if (asideAvailable()) return
  /*
    抽屉此刻是关着的。它可能正在开(宿主的列宽有一个过渡动画,这一刻量到的
    是动画的起点),也可能**根本开不出来**。等它一拍再量一次,还是没有就走
    沉浸——三态的阶梯可以跳级,但不能断在半空。

    500ms 不是拍脑袋:宿主的 `--ds-transition-duration-slow` 实测 0.3s,而
    宽度只要越过 120 就算数(360 的三分之一,动画早期就到了)。等到动画结束
    还有富余,而在真的开不出来的那一路,人多等的也就是这半秒。
  */
  clearTimeout(settling)
  settling = setTimeout(() => {
    if (state.target?.key !== target.key || state.stage !== 'aside') return
    if (!asideAvailable()) setPreviewStage('immersive')
  }, 500)
}

/** 右栏把自己的根节点交出来,在场期间有效。 */
export function useAsidePreviewHost(node: HTMLElement | null): void {
  useEffect(() => {
    if (node === null) return undefined
    setAsidePreviewHost(node)
    return () => { setAsidePreviewHost(null) }
  }, [node])
}

export function setPreviewStage(stage: PreviewStage): void {
  if (state.target === undefined || state.stage === stage) return
  state = { ...state, stage }
  notify()
}

/**
 * 从沉浸退出来。
 *
 * 通常回并排,不是关掉——退出深读的人想回到对话,而那份文档本来就还在旁边
 * 开着。但并排不一定有地方落(右栏开不出来的那种情况),那时退出**就是**关掉:
 * 把一份文档「退」进一个看不见的格子,和把它弄丢没有区别。
 */
export function leaveImmersive(): void {
  if (asideAvailable()) setPreviewStage('aside')
  else closePreview()
}

/**
 * 收起。
 *
 * **切会话即收**——预览随语境走,和「锚不跨会话残留」是同一条纪律:上一个话题
 * 里打开的那份文档,在新话题里是一句没有出处的话。
 */
export function closePreview(): void {
  clearTimeout(settling)
  if (state.target === undefined) return
  state = CLOSED
  notify()
}

export function previewSnapshot(): PreviewState {
  return state
}

export function subscribePreview(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function usePreview(): PreviewState {
  return useSyncExternalStore(subscribePreview, previewSnapshot, previewSnapshot)
}

/**
 * 取回来的字节,按 fileId 记着。
 *
 * fileId 是不变的,所以**取到的东西**永远不会过期成谎话(数据律:缓存不是真身,
 * 但不可变的东西可以放心地记)。它值得存在的原因有三个:并排切沉浸不重下、
 * 缩略图点开大图是瞬间的、同一个文件在流里和右栏里只取一次。
 *
 * **失败不在此列,所以它另存一处。** 「这个文件是什么」是不变的,「这一次没取到」
 * 不是——通道没就绪、token 刚过期、CLI 抖了一下,都会让一次取失败,而它们都会
 * 自己好。把失败和字节记在同一张表里,等于把一次偶然说成了一个事实:那条
 * 「取不到这个文件」会挂到刷新页面为止,而且没有任何再试的门。
 */
const bodies = new Map<string, AttachmentBodyWire>()
const misses = new Set<string>()
const inflight = new Map<string, Promise<unknown>>()

export interface AttachmentRead {
  readonly body?: AttachmentBodyWire
  /** 这一次没取到——和「还没取」是两回事,也和「这个文件不存在」是两回事。 */
  readonly missing: boolean
  readonly busy: boolean
  /** 再试一次。失败是可以重来的,所以门要给出来。 */
  retry(): void
}

/** 这个 id 此刻读到了什么。缓存的规则写在一处,才考得住。 */
export function attachmentState(fileId: string): Omit<AttachmentRead, 'retry'> {
  const cached = bodies.get(fileId)
  if (cached !== undefined) return { body: cached, missing: false, busy: false }
  if (misses.has(fileId)) return { missing: true, busy: false }
  return { missing: false, busy: true }
}

/** 一次取的结果落库。`undefined` = 这次没取到,记成一次失败而不是一个事实。 */
export function rememberAttachment(fileId: string, body: AttachmentBodyWire | undefined): void {
  if (body === undefined) misses.add(fileId)
  else bodies.set(fileId, body)
}

/** 忘掉那次失败,让下一次读重新走一趟宿主。取到的字节不受影响。 */
export function retryAttachment(fileId: string): void {
  misses.delete(fileId)
}

/**
 * 一个附件的字节。传 `undefined` 表示**先别取**。
 *
 * 「先别取」是个必需的参数而不是调用方的判断:一屋子截图,急切加载等于每渲染
 * 一次就派出几十个 CLI 进程。缩略图等它滚进视野才把 id 递进来。
 */
export function useAttachmentBody(
  fileId: string | undefined,
  name: string | undefined,
  inject: SurfaceInject,
): AttachmentRead {
  /*
    `attempt` 既是重试的开关,也是「这一次读」的身份。

    它进 effect 的依赖里:重试要能真的再跑一遍,而 fileId 和 name 都没变。
  */
  const [attempt, setAttempt] = useState(0)
  const [, bump] = useState(0)

  useEffect(() => {
    if (fileId === undefined || bodies.has(fileId)) return undefined
    let alive = true
    let pending = inflight.get(fileId)
    if (pending === undefined) {
      pending = inject.attachment(fileId, name).then(
        (body) => { rememberAttachment(fileId, body) },
        () => { rememberAttachment(fileId, undefined) },
      ).finally(() => { inflight.delete(fileId) })
      inflight.set(fileId, pending)
    }
    void pending.then(() => { if (alive) bump(tick => tick + 1) })
    return () => { alive = false }
  }, [fileId, name, inject, attempt])

  const retry = useCallback((): void => {
    if (fileId === undefined) return
    retryAttachment(fileId)
    setAttempt(tick => tick + 1)
  }, [fileId])

  if (fileId === undefined) return { missing: false, busy: false, retry }
  return { ...attachmentState(fileId), retry }
}

/**
 * `yzj://file/<id>` —— agent 上传的文件,它的 id 就是附件的 fileId。
 *
 * 这一行是「工件统一」真正成立的地方:agent 交付的文件和同事拖进群的文件走
 * 同一条取字节的路,于是同一张卡、同一套预览语法不是说法而是事实。文档类
 * (`yzj://doc/…`)没有这条路,它只有门。
 */
export function fileIdOfUri(uri: string): string | undefined {
  const match = /^yzj:\/\/file\/([^/?#]+)$/u.exec(uri)
  return match?.[1]
}

/**
 * Only a scheme a browser may safely follow.
 *
 * `parentGoalRef` is writable from a GROUP: `/link <anything>` takes the raw
 * message text, and any member of a served group can send it. Rendering that
 * string as an `href` turns stored text into a live navigation in the page
 * that holds the loopback RPC channel — `javascript:` runs in the current
 * document. So a goal reference is a link only when it is provably one, and
 * otherwise it is shown as the text it is.
 *
 * 工件的 URI 走同一道闸:`yzj://file/…` 是我们自己的记号,不是一扇门。
 */
export function safeHref(ref: string): string | undefined {
  try {
    const url = new URL(ref)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** 文件名末尾那一小截,决定怎么投影。 */
export function extensionOf(name: string | undefined): string | undefined {
  if (name === undefined) return undefined
  const base = name.split(/[/\\]/u).pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return undefined
  return base.slice(dot + 1).toLowerCase()
}

/** 字节,写成人会说出口的那个单位。 */
export function sizeLabel(size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size) || size <= 0) return ''
  if (size < 1_024) return `${String(size)} B`
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`
  return `${(size / 1_024 / 1_024).toFixed(1)} MB`
}
