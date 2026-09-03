/**
 * `ctx.yzjTopics` — the seam the desktop surface reads a topic through.
 *
 * The surface never touches the transport. It asks three questions — what
 * conversation is this session a window onto, what was said in it, and put
 * this sentence in it — and everything else (cursors, dedupe, the echo
 * protocol) stays where it belongs. That boundary is what lets the transport
 * grow a second adapter without the view knowing.
 *
 * **The messages this returns are a projection, not a store.** They are read
 * from Yunzhijia at request time and cached only long enough to be rendered;
 * the conversation itself is the body of truth (数据律 1: a browser cache is
 * never the body). A stale read is allowed to be stale — it is not allowed to
 * be out of order, and it is not allowed to look fresh.
 */

import { copyFile, mkdir, open, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  compactTopicSummary, conversationKindForGroup, groupIdFromPlaceKey, outboundFingerprint, placeKeyFor,
  resolveTopicRootId, topicRouteFor, type YzjGroup, type YzjMessage, type YzjTopicRoute,
} from './protocol.ts'
import type { YzjChannelClient } from './client.ts'
import { READ_EMPTY, type ChannelState } from './state.ts'
import { triageOutbound } from './triage.ts'

/** One conversation the desktop can open as a window. */
export interface TopicDescriptor {
  readonly topicKey: string
  readonly sessionId: string
  readonly placeKey: string
  readonly groupId: string
  readonly groupName: string
  readonly topicRootId: string
  readonly label: string
  readonly generation: number
  readonly conversationKind: 'group' | 'direct'
}

/** One Yunzhijia message as the surface renders it. */
export interface TopicMessage {
  readonly msgId: string
  readonly fromOpenId: string
  /** Resolved display name; falls back to the openId when the directory is silent. */
  readonly fromName: string
  readonly content: string
  readonly msgType: string
  /** Epoch milliseconds — the axis the fused timeline sorts on. */
  readonly time: number
  /**
   * True when the AGENT sent this, speaking under the operator's account.
   *
   * Not "the operator's openId sent it": the agent posts through that same
   * account, so that test cannot tell the agent's reply from the operator
   * typing in the group — and since the column drops our own outbound to avoid
   * showing one utterance twice, it silently swallowed everything the operator
   * ever said in a place. The echo registry knows the difference because it
   * recorded each send; that is the signal, and it is the same one the inbound
   * triage uses to avoid answering itself.
   */
  readonly own: boolean
  readonly replyToSummary?: string
  /**
   * The root of the reply chain this message hangs on (itself when it starts
   * one). 挂链是数据事实 (v4.7) — Yunzhijia records it, we only read it — and
   * whether that chain gets drawn as a topic is a separate, projection-side
   * decision.
   */
  readonly chainRootId?: string
  /**
   * The message this one replies to, so the quote line can jump to it.
   *
   * The summary alone made the quote a dead label: you can read who said what
   * and have no way to go look at it, which is the one thing a quote is for.
   */
  readonly replyToId?: string
  /**
   * What was attached, resolved to something a browser can actually render.
   *
   * The URL is built HERE because it needs the conversation id, which the view
   * has no business knowing — and because a CDN path shape is a transport
   * fact. Measured: `https://static.yunzhijia.com/image/<groupId>/<id>` serves
   * both image segments and file bodies, unauthenticated.
   */
  readonly images?: readonly {
    fileId: string
    w?: number
    h?: number
    /**
     * 图片自己的名字,当它是作为文件发来的。
     *
     * 一张截图叫 `Xnip2026-08-20-15-03.png` 而不是「图片」,而放大之后头上那行
     * 写什么、下载下来叫什么、按什么后缀投影,全靠它。富文本内嵌的那一类没有
     * 名字,这几个字段就跟着缺席。
     */
    name?: string
    ext?: string
    size?: number
    /**
     * Embedded in a richText body rather than sent as a file.
     *
     * These carry a DIFFERENT id space, and there is no route to their bytes:
     * the CDN address serves the placeholder icon, and `file download` answers
     * `code=2005, Get download info failed`. Marked so the surface can say
     * which limit it hit instead of a generic failure — 「取不到」 with no reason
     * is the thing this product keeps refusing to ship.
     */
  }[]
  readonly file?: { fileId: string; name: string; ext?: string; size?: number }
}

/** Extensions that are pictures whatever the platform labelled them. */
const PICTURE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'svg'])

/**
 * What the FIRST BYTES say a file is.
 *
 * 扩展名是一句主张,字节是事实——而这里的主张常常不成立:云之家把粘贴的
 * 截图叫 `.png` 而里面是 jpeg,把没有后缀的东西照发。一个错的 mime 不会
 * 报错,它画出一张坏图,看起来像网络问题。
 *
 * 认不出来就返回 undefined,交给扩展名兜底——文本没有魔数,而 `.md` 是不是
 * markdown 只有写它的人知道。
 */
export function sniffMime(head: Uint8Array): string | undefined {
  const hex = Buffer.from(head.subarray(0, 12)).toString('hex')
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png'
  if (hex.startsWith('47494638')) return 'image/gif'
  if (hex.startsWith('424d')) return 'image/bmp'
  if (hex.startsWith('25504446')) return 'application/pdf'
  // RIFF....WEBP —— 前四字节与 wav/avi 同,判定必须读到第 8 字节的 brand。
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp'
  return undefined
}

/**
 * Whether a file attachment is actually a PICTURE.
 *
 * An image pasted into a chat does not arrive as a `richText` image segment —
 * it arrives as `msgType: 'file'` with `ftype: 1`, an image extension and
 * `picWidth/picHeight`. Reading only `desc[]` therefore drew every pasted
 * screenshot as a grey file card. Three independent markers because any one of
 * them alone would miss a shape somebody's client produces.
 */
export function isPictureAttachment(
  param: { ftype?: number; ext?: string; picWidth?: number },
): boolean {
  if (param.ftype === 1) return true
  if (param.picWidth !== undefined) return true
  return param.ext !== undefined && PICTURE.has(param.ext.toLowerCase())
}

/**
 * One row of the operator's conversation list — the IM surface, not the
 * agent's work queue.
 *
 * 「谁在找我」和「什么需要我」是两个正交问题 (v4.8): this answers the first.
 * A conversation appears here whether or not the agent is on duty in it,
 * because a left column that only lists agent topics sends the operator back
 * to the native client for everything else, and that is the entrance
 * fragmentation this product exists to end.
 */
export interface ConversationRow {
  readonly groupId: string
  readonly placeKey: string
  readonly name: string
  /** 1 = direct, 2 = group, 3 = assistant/app, 8 = system notice. */
  readonly type: number
  readonly kind: 'group' | 'direct' | 'assistant'
  /** Epoch ms of the last message; 0 when there has never been one. */
  readonly lastMsgTime: number
  readonly preview: string
  /** `min(server, local)` — see `ChannelState.conversations`. */
  readonly unread: number
  readonly avatarUrl?: string
  /** The agent answers here. Off = a light row; on = a place row with topics. */
  readonly onDuty: boolean
  /** The operator's own DM with themselves: the approval / private channel. */
  readonly selfChat: boolean
}

/**
 * 桌面说出去的一句话，回来是什么 —— **一份形状，三条出站路**。
 *
 * `sessionId` 只在**点着了**的时候有：那是这句话刚刚生出来的那个话题。它不是给导航
 * 用的方便字段，是「委派带着目标语境」这条规则在主楼那条路上的落点——主楼委派长出的
 * 新话题得继承那个目标，而在此之前，桌面这一侧根本没有办法知道它叫什么。
 */
export interface DeskSend {
  readonly msgId?: string
  readonly ignited: boolean
  readonly refused?: 'not-on-duty' | 'feed'
  readonly sessionId?: string
  /**
   * **桌面出站对称** (决策 #63, v3.15③ 同律)：本实例在这个场所不在岗，但有同侪实例
   * 对群在岗——话发出去了、**不就地点火**，将由它接单。锚定条在按下之前就要说这句。
   */
  readonly deferredTo?: { readonly openId: string; readonly name: string }
}

/** 一个场所此刻的在岗图景 —— 本实例的范围与观察到的同侪 (决策 #63)。 */
export interface PresenceView {
  /** 本实例：对群在岗 / 仅本人 / 不接单。 */
  readonly self: 'all' | 'self' | 'off'
  /** 对群在岗时，那条向群发出的声明帖；没发出去是 `undefined`（面板要说）。 */
  readonly selfAnchor?: string
  readonly selfSince?: number
  /** 观察到的对群在岗的同侪实例。 */
  readonly peers: readonly { readonly openId: string; readonly name: string; readonly since: number }[]
}

/** 接单开关按下去之后的实话。 */
export interface ServeOutcome {
  readonly served: boolean
  readonly scope?: 'all' | 'self'
  readonly groupName?: string
  /** 对群在岗声明帖发出去了没有——记了岗但群里不知道，是要说出来的状态。 */
  readonly announced?: boolean
  /**
   * 第二在岗押门 (P1)：已有同侪对群在岗，这一次**没有接**。两条出口——请对方退岗
   * （`draft`，拟稿亲发）、或改为仅本人。
   */
  readonly conflict?: { readonly openId: string; readonly name: string; readonly since: number }
  readonly draft?: string
  /**
   * 退岗时，本群的**场所记忆**拟成一段背景包 (决策 #63 在岗移交)。越境律：场所记忆随包
   * 须人签发的脱密——所以它只是拟稿，由你决定发不发、发给谁；私语不迁移，这里也没有。
   */
  readonly memoryDraft?: string
}

export interface YzjTopics {
  /** The conversation one session is a window onto. */
  topicOf(sessionId: string): TopicDescriptor | undefined
  /**
   * Every conversation this account has, newest activity first.
   *
   * Accumulated by the poll rather than fetched on demand: the poll already
   * reads the conversation list to find work in it, so the roster is free —
   * and it is the only thing that survives a restart, which is what makes
   * local name filtering possible at all (the platform has no group search).
   */
  conversations(): readonly ConversationRow[]
  /** The operator has read this conversation up to its newest message. */
  markRead(placeKey: string): void
  /**
   * The words that address the agent, from the deployment's own config.
   *
   * The desktop prefills one and warns about them; hard-coding `@next` there
   * meant that the day this reverts to `@agent` (平价切换, planned in the
   * bundle patch) the ⚡ verb would post a dead `@next` into a real group —
   * precisely the "public @ nothing will answer" this release exists to stop.
   */
  aliases(): readonly string[]
  /** Every topic this channel knows, newest first, grouped by place. */
  tree(): readonly { place: { placeKey: string; groupName: string }; topics: readonly TopicDescriptor[] }[]
  /** What was said in this topic, oldest first. */
  messagesFor(sessionId: string, limit?: number): Promise<readonly TopicMessage[]>
  /** What was said in the PLACE, oldest first — every topic's messages together. */
  messagesInPlace(placeKey: string, limit?: number): Promise<readonly TopicMessage[]>
  /**
   * Say one thing INTO the place.
   *
   * `replyTo` is the landing point: absent anchors to the topic's own root,
   * present attaches to that message's chain (回复 = 挂链, v4.7).
   */
  sendToPlace(sessionId: string, text: string, replyTo?: string): Promise<{ msgId?: string }>
  /**
   * 轻问: one read-only turn in this topic. Nothing is written, nothing is
   * posted into the place, and no task is opened — the answer comes straight
   * back to the asker.
   */
  lightAsk(sessionId: string, text: string): Promise<string>
  /**
   * Say something into a PLACE — the main thread, or onto a message's chain.
   *
   * `ignited` reports whether the agent was among the addressees and a topic
   * therefore caught fire. 委派是对话的特例：most sends here are just people
   * talking, and those return `ignited: false` without anything else happening.
   *
   * `refused: 'not-on-duty'` means the agent was addressed somewhere it does
   * not answer, and NOTHING was sent — a public @ that will never be answered
   * is worse than being told here.
   */
  sendInPlace(
    placeKey: string, text: string, replyTo?: string,
  ): Promise<DeskSend>
  /**
   * 给一个**还没聊过**的人发第一句 —— 私聊的出生 (v4.24 场所选项集).
   *
   * 云之家没有「创建私聊」这个动作：`--to-open-id` 发一句，平台在回包里给出 groupId,
   * 那一刻这间屋子才存在。所以这一条不认 placeKey——它此刻还不存在,正是这次发送把它
   * 造出来的,回包里的 `placeKey` 就是它。
   */
  sendToPerson(openId: string, text: string): Promise<DeskSend & { placeKey?: string }>
  /**
   * 接单开关 — put a conversation into service, or take it out.
   *
   * This is the deployment's blast radius, so it is deliberately NOT a control
   * in the conversation list: it lives behind the place contract, where the
   * consequences are written down next to it. What it changes is real and
   * immediate — polling starts reading this conversation's history, topics
   * start being born in it, `@` starts being answered, and registration cards
   * start landing there.
   *
   * Takes effect without a restart (the allow-list is one live set), and is
   * durable (the decision outlives the process).
   */
  setServed(placeKey: string, on: boolean, scope?: 'all' | 'self'): Promise<ServeOutcome>
  /** 这个场所的在岗图景：本实例的范围、同侪的在岗声明 (决策 #63)。 */
  presenceIn(placeKey: string): PresenceView
  /** 观察到的同侪实例——板上「本实例登记集」明标降级要它 (决策 #63 §7.4 P1)。 */
  peers(): readonly { readonly openId: string; readonly name: string; readonly lastSeen: number }[]
  /**
   * An attachment's real content, fetched through the CLI and cached on disk.
   *
   * Everything about this goes through the host because the bytes have no
   * public URL — the address that looks like one serves a placeholder icon.
   * Capped, because a chat can hold a 40 MB video and the RPC channel carries
   * JSON: over the cap the caller is told the size and where it was saved
   * rather than handed something the browser should not be holding.
   */
  readAttachment(fileId: string, name?: string): Promise<AttachmentBody>
  /**
   * Put the attachment where a person can find it — 预览不等于拿到手。
   *
   * The host copies rather than the browser downloading: attachments have no
   * public URL, and routing 40 MB through a JSON RPC as base64 to trigger a
   * browser save would be an expensive way to reach a folder the host can
   * already write to. Returns the real path, because "下载好了" without saying
   * where is the kind of receipt nobody can act on.
   */
  saveAttachment(fileId: string, name?: string): Promise<{ savedTo: string; size: number }>
}

/**
 * What the host can say about one attachment's content.
 *
 * 四种形态对应四种投影 (v4.11「能投影则投影」):图片直接看、PDF 交给浏览器
 * 自带的阅读器、文本按后缀富渲染或照原样、剩下的**不硬造 viewer**——说清楚
 * 它是什么、放在哪儿了,比画一个假的阅读框诚实。
 */
export type AttachmentBody =
  | { readonly kind: 'image'; readonly mime: string; readonly base64: string; readonly size: number }
  | { readonly kind: 'pdf'; readonly base64: string; readonly size: number }
  | { readonly kind: 'text'; readonly text: string; readonly size: number; readonly clipped: boolean }
  | { readonly kind: 'binary'; readonly size: number; readonly savedTo: string; readonly why: string }

declare module '@deepseek-ai/cordis' {
  interface Context {
    yzjTopics?: YzjTopics
  }
}

/**
 * `session-yzj-next-<hash>` ⇄ `yzj-topic-<hash>`.
 *
 * The two prefixes differ because the SESSION id carries the deployment's own
 * hash domain (so a topic never resumes into the old system's session) while
 * the topic key names the conversation. They are derived from the same hash,
 * so the transform is pure — but it has to be written from the router's actual
 * output, not from what the names suggest.
 */
const SESSION_PREFIX = 'session-yzj-next-'
const TOPIC_PREFIX = 'yzj-topic-'

export function topicKeyOfSession(sessionId: string): string | undefined {
  return sessionId.startsWith(SESSION_PREFIX)
    ? `${TOPIC_PREFIX}${sessionId.slice(SESSION_PREFIX.length)}`
    : undefined
}

export function sessionIdOfTopic(topicKey: string): string {
  return topicKey.startsWith(TOPIC_PREFIX)
    ? `${SESSION_PREFIX}${topicKey.slice(TOPIC_PREFIX.length)}`
    : `${SESSION_PREFIX}${topicKey}`
}

/** Parse the CLI's local-time stamp ("2026-08-18 15:03:35.027"). */
export function parseSendTime(sendTime: string): number {
  const parsed = Date.parse(sendTime.replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : 0
}

export class YzjTopicReader implements YzjTopics {
  /** openId → display name. The directory is stable; one lookup is enough. */
  private readonly names = new Map<string, string>()

  constructor(
    private readonly ctx: Context,
    private readonly client: YzjChannelClient,
    private readonly state: ChannelState,
    private readonly operatorOpenId: string,
    private readonly operatorOrgId: string,
    /** Runs one read-only turn on the topic's own queue. */
    private readonly ask: (route: YzjTopicRoute, text: string) => Promise<string>,
    /** Posts into a place and ignites a turn when the agent is addressed. */
    private readonly post: (
      placeKey: string, text: string, replyTo?: string,
    ) => Promise<DeskSend>,
    /** Posts the FIRST message to somebody, creating the DM in the process. */
    private readonly postToPerson: (
      openId: string, text: string,
    ) => Promise<DeskSend & { placeKey?: string }>,
    /**
     * 这个群 agent 在不在岗 —— 和轮询那一侧**同一个谓词**（`onDutyIn`）。
     *
     * 此前这里自己算了一遍（空集 = 到处在岗），而门那一侧早已改成空集 = 全关：
     * 左栏许诺一个永远不会应答的 agent。一个事实源，一个谓词。
     */
    private readonly onDutyOf: (groupId: string) => boolean,
    /** The trigger words, from config — one source for the gate and the UI. */
    private readonly triggerAliases: readonly string[],
    /**
     * Put a conversation in or out of service.
     *
     * A callback rather than a mutable set handed around: the live allow-list
     * and the durable record of the decision have to move together, and they
     * both live where the channel is assembled. One writer, one place.
     */
    private readonly serve: (groupId: string, on: boolean, scope?: 'all' | 'self') => Promise<ServeOutcome>,
    /** Where fetched attachments are cached — the deployment's own workspace. */
    private readonly cacheDir: string,
    /** 在岗图景与同侪观测都住在轮询那一侧；这里只是把它们交给桌面。 */
    private readonly presence: {
      readonly of: (groupId: string) => PresenceView
      readonly peers: () => readonly { openId: string; name: string; lastSeen: number }[]
      /** 桌面读到的消息交给轮询那一侧当观测：不在岗的群里谁在岗，只有这条路能知道。 */
      readonly observe?: (groupId: string, messages: readonly YzjMessage[]) => void
    },
  ) {}

  /** Text-ish extensions worth showing as words rather than offering as a download. */
  private static readonly READABLE = new Set([
    'md', 'txt', 'log', 'json', 'csv', 'tsv', 'yml', 'yaml', 'xml', 'html', 'htm',
    'ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'sql', 'ini', 'conf', 'toml', 'diff', 'patch',
  ])

  /** Above this the browser should not be holding it as base64. */
  private static readonly INLINE_MAX = 6 * 1024 * 1024
  /** A preview is for reading, not for loading a whole log into the DOM. */
  private static readonly TEXT_MAX = 200 * 1024

  /** Fetch once, keep by id. Attachment ids are immutable, so this never staless. */
  private async cacheAttachment(
    fileId: string, name?: string,
  ): Promise<{ path: string; size: number; ext: string }> {
    const dir = join(this.cacheDir, 'attachments')
    await mkdir(dir, { recursive: true })
    const ext = (name?.includes('.') === true ? name.split('.').pop() ?? '' : '').toLowerCase()
    const path = join(dir, ext === '' ? fileId : `${fileId}.${ext}`)
    let size = await stat(path).then(info => info.size).catch(() => -1)
    if (size < 0) {
      await this.client.downloadFile(fileId, path)
      size = await stat(path).then(info => info.size).catch(() => 0)
    }
    return { path, size, ext }
  }

  /**
   * The first bytes, and only those.
   *
   * 一个 40MB 的视频不该为了「它是什么」被整个读进内存——嗅探只需要 12 字节。
   */
  private async headOf(path: string): Promise<Uint8Array> {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(12)
      const { bytesRead } = await handle.read(buffer, 0, 12, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async readAttachment(fileId: string, name?: string): Promise<AttachmentBody> {
    /*
      Cached by file id under the workspace.

      Attachment ids are immutable, so a file fetched once never needs fetching
      again — which matters because every fetch is a CLI process, and a room
      full of screenshots would otherwise spawn one per thumbnail per render.
    */
    const { path, size, ext } = await this.cacheAttachment(fileId, name)
    const mime = sniffMime(await this.headOf(path))

    if (mime === 'application/pdf') {
      if (size > YzjTopicReader.INLINE_MAX) {
        return { kind: 'binary', size, savedTo: path, why: 'PDF 太大，没有内联' }
      }
      return { kind: 'pdf', base64: (await readFile(path)).toString('base64'), size }
    }
    if (mime?.startsWith('image/') === true) {
      if (size > YzjTopicReader.INLINE_MAX) {
        return { kind: 'binary', size, savedTo: path, why: '图片太大，没有内联' }
      }
      return { kind: 'image', mime, base64: (await readFile(path)).toString('base64'), size }
    }
    /*
      SVG 是唯一靠扩展名进图片这一路的:它是文本,没有魔数。
      它走 `<img>`,里面的脚本不执行——和其余图片同一个安全形状。
    */
    if (ext === 'svg') {
      return {
        kind: 'image',
        mime: 'image/svg+xml',
        base64: (await readFile(path)).toString('base64'),
        size,
      }
    }
    /*
      名字说是图片,字节不认识——最典型的是 iPhone 的 HEIC。

      过去这里会当作 png 发出去,浏览器画出一张破图,看起来像网络抖了一下。
      说「打不开」并给出它在哪儿,比一个假的图片框诚实。
    */
    if (PICTURE.has(ext)) {
      return { kind: 'binary', size, savedTo: path, why: `这个图片格式浏览器打不开（${ext.toUpperCase()}）` }
    }
    if (YzjTopicReader.READABLE.has(ext)) {
      const bytes = await readFile(path)
      const clipped = bytes.length > YzjTopicReader.TEXT_MAX
      return {
        kind: 'text',
        text: bytes.subarray(0, YzjTopicReader.TEXT_MAX).toString('utf8'),
        size,
        clipped,
      }
    }
    return { kind: 'binary', size, savedTo: path, why: '这个类型没法在这里预览' }
  }

  async saveAttachment(fileId: string, name?: string): Promise<{ savedTo: string; size: number }> {
    const cached = await this.cacheAttachment(fileId, name)
    const target = join(homedir(), 'Downloads')
    await mkdir(target, { recursive: true })
    const base = name === undefined || name.trim() === '' ? fileId : name.trim()
    // Never clobber. Somebody who downloads two versions of 「方案.docx」 wants
    // two files, not a silent replacement of the one they already annotated.
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const tail = dot > 0 ? base.slice(dot) : ''
    let savedTo = join(target, base)
    for (let n = 2; n < 200; n += 1) {
      const taken = await stat(savedTo).then(() => true).catch(() => false)
      if (!taken) break
      savedTo = join(target, `${stem} (${String(n)})${tail}`)
    }
    await copyFile(cached.path, savedTo)
    return { savedTo, size: cached.size }
  }

  async setServed(placeKey: string, on: boolean, scope?: 'all' | 'self'): Promise<ServeOutcome> {
    const groupId = groupIdFromPlaceKey(placeKey)
    if (groupId === undefined) throw new Error('这不是一个可接入的会话')
    const outcome = await this.serve(groupId, on, scope)
    const name = this.state.conversation(groupId)?.name
    return { ...outcome, ...(name === undefined ? {} : { groupName: name }) }
  }

  presenceIn(placeKey: string): PresenceView {
    const groupId = groupIdFromPlaceKey(placeKey)
    if (groupId === undefined) return { self: 'off', peers: [] }
    return this.presence.of(groupId)
  }

  peers(): readonly { readonly openId: string; readonly name: string; readonly lastSeen: number }[] {
    return this.presence.peers()
  }

  aliases(): readonly string[] {
    return this.triggerAliases
  }

  async sendInPlace(
    placeKey: string, text: string, replyTo?: string,
  ): Promise<DeskSend> {
    const body = text.trim()
    if (body === '') throw new Error('Refusing to post an empty message')
    return this.post(placeKey, body, replyTo)
  }

  async sendToPerson(openId: string, text: string): Promise<DeskSend & { placeKey?: string }> {
    const body = text.trim()
    if (body === '') throw new Error('Refusing to post an empty message')
    return this.postToPerson(openId, body)
  }

  /**
   * The conversation list, newest activity first.
   *
   * Sorted HERE rather than trusted from the server: `im group recent` orders
   * by a per-conversation update stamp it does not expose, and measured
   * against `lastMsgSendTime` that order breaks 91 times in 499 rows — a list
   * that claims "most recent first" and is not would be a lie in the one
   * column the operator scans fastest.
   */
  conversations(): readonly ConversationRow[] {
    const onDuty = this.onDutyOf
    return this.state.conversations()
      .map((record) => {
        const kind = record.type === 1 ? 'direct' : record.type === 2 ? 'group' : 'assistant'
        const parts = record.groupId.split('-')
        return {
          groupId: record.groupId,
          placeKey: placeKeyFor(kind === 'direct' ? 'direct' : 'group', record.groupId),
          name: record.name,
          type: record.type,
          kind,
          lastMsgTime: record.lastMsgTime,
          preview: record.preview,
          unread: record.unreadEffective,
          ...(record.avatarUrl === undefined ? {} : { avatarUrl: record.avatarUrl }),
          // An assistant or system feed is never on duty: triage refuses those
          // conversation types outright, so a place row there would promise
          // an agent that cannot answer.
          onDuty: kind !== 'assistant' && onDuty(record.groupId),
          // 自聊 is the operator's DM with themselves — both halves of the id
          // are the same person. (The openId does NOT appear in DM ids on this
          // platform, so identity matching is not an alternative test.)
          selfChat: kind === 'direct' && parts.length === 2 && parts[0] === parts[1],
        } satisfies ConversationRow
      })
      .sort((left, right) => right.lastMsgTime - left.lastMsgTime)
  }

  markRead(placeKey: string): void {
    const groupId = groupIdFromPlaceKey(placeKey)
    if (groupId === undefined) return
    const record = this.state.conversation(groupId)
    if (record === undefined) return
    // A conversation with no message still has an unread count, and there is
    // no message id to mark. Without a stand-in its badge could never be
    // cleared by any gesture the UI has.
    this.state.markRead(groupId, record.lastMsgId === '' ? READ_EMPTY : record.lastMsgId)
    // The only fire-and-forget save in the channel: an unhandled rejection
    // here (ENOSPC, a rename race) would take the process down on a 6-second
    // timer, which is a worse outcome than a lost read mark.
    this.state.save().catch((error: unknown) => {
      console.error('[yzj-next-channel] failed to record the read mark', error)
    })
  }

  topicOf(sessionId: string): TopicDescriptor | undefined {
    const topicKey = topicKeyOfSession(sessionId)
    if (topicKey === undefined) return undefined
    const handle = this.ctx.yzjGraph.topicHandle(topicKey)
    if (handle === undefined) return undefined
    const groupId = handle.groupId ?? groupIdFromPlaceKey(handle.placeKey)
    if (groupId === undefined) return undefined
    return {
      topicKey,
      sessionId,
      placeKey: handle.placeKey,
      groupId,
      groupName: handle.groupName ?? groupId,
      topicRootId: handle.topicRootId ?? 'direct',
      // Cleaned on READ as well as on write. Topics registered before the
      // alias was stripped still carry it, and a rule that only applies to
      // rows created after the fix leaves the sidebar looking exactly as
      // broken as it did before for everything already in it.
      label: compactTopicSummary(handle.label),
      generation: handle.generation,
      conversationKind: handle.placeKey.startsWith('yzj-dm-') ? 'direct' : 'group',
    }
  }

  tree(): readonly { place: { placeKey: string; groupName: string }; topics: readonly TopicDescriptor[] }[] {
    const byPlace = new Map<string, { groupName: string; topics: TopicDescriptor[] }>()
    // Newest first inside each place: the graph's own append order IS the
    // recency order, so no separate index is needed.
    const objects = this.ctx.yzjGraph.query(
      { kind: 'operator', openId: this.operatorOpenId }, { kind: 'topic', limit: 200 },
    )
    for (const object of objects) {
      const descriptor = this.topicOf(sessionIdOfTopic(object.id))
      if (descriptor === undefined) continue
      const entry = byPlace.get(descriptor.placeKey)
        ?? { groupName: descriptor.groupName, topics: [] }
      entry.topics.push(descriptor)
      byPlace.set(descriptor.placeKey, entry)
    }
    return [...byPlace.entries()].map(([placeKey, entry]) => ({
      place: { placeKey, groupName: entry.groupName },
      topics: entry.topics,
    }))
  }

  async messagesFor(sessionId: string, limit = 40): Promise<readonly TopicMessage[]> {
    const topic = this.topicOf(sessionId)
    if (topic === undefined) return []
    const group: YzjGroup = {
      groupId: topic.groupId,
      groupName: topic.groupName,
      groupType: topic.conversationKind === 'direct' ? 1 : 2,
      lastMsgId: '',
      lastMsgSendTime: '',
    }
    const lookup = (groupId: string, msgId: string): string | undefined => (
      this.state.topicForMessage(groupId, msgId)
    )
    const direct = conversationKindForGroup(group) === 'direct'
    /**
     * Walk back until this TOPIC has enough, not until the GROUP does.
     *
     * A busy place interleaves several topics, so the newest 20 messages of a
     * group can easily contain none of the one being read — and a window that
     * silently renders zero messages for a live conversation is the failure
     * this whole column exists to avoid. Bounded at four pages: a projection
     * is allowed to be partial, it is not allowed to be unbounded.
     */
    let scanned = await this.client.messages(topic.groupId, 20)
    let mine = direct ? scanned : scanned.filter(message => (
      resolveTopicRootId(group, message, scanned, lookup) === topic.topicRootId
    ))
    for (let page = 1; page < 4 && mine.length < limit; page += 1) {
      const earliest = scanned[0]
      if (earliest === undefined) break
      const older = await this.client.olderPage(topic.groupId, earliest.msgId)
      if (older.messages.length === 0) break
      scanned = [...older.messages, ...scanned]
      mine = direct ? scanned : scanned.filter(message => (
        resolveTopicRootId(group, message, scanned, lookup) === topic.topicRootId
      ))
      if (!older.more) break
    }
    await this.resolveNames(mine)
    this.presence.observe?.(topic.groupId, scanned)
    return mine
      .map(message => this.render(message, topic.groupId))
      .sort((left, right) => left.time - right.time)
      .slice(-limit)
  }

  async sendToPlace(sessionId: string, text: string, replyTo?: string): Promise<{ msgId?: string }> {
    const topic = this.topicOf(sessionId)
    if (topic === undefined) throw new Error('This session is not a Yunzhijia topic')
    const body = text.trim()
    if (body === '') throw new Error('Refusing to post an empty message')
    // Anchored to the topic root, so what the operator says from the desktop
    // lands in the SAME topic they are looking at — otherwise the fused window
    // would produce messages it cannot then show.
    const anchor = replyTo ?? (topic.topicRootId === 'direct' ? undefined : topic.topicRootId)
    /*
      **出站分诊，与入站③ 对称** (v3.15 裁决③).

      这一句要是在答一张卡（回复锚命中已投影的卡 + 文本命中它的动词），它就是一次
      **应答**，不是一次普通发言——而且必须在**这一侧**判定：回程那条路会把它当成回声
      抑制掉（每次 `client.send` 都登记出站指纹，agent 与桌面一视同仁），于是那句
      「确认」发出去之后一声不响地消失，卡永远等下去。

      判定用的是 `replyTo`，不是 `anchor`：话题根不是一张卡，把它当锚会让**这个话题里
      的任何一句话**都去撞一遍卡的关键词。
    */
    const answer = triageOutbound({
      text: body,
      ...(replyTo === undefined ? {} : { replyTo }),
      aliases: this.triggerAliases,
      cardForAnchor: candidate => this.ctx.yzjCards.cardForAnchor(candidate),
      resolveKeyword: (cardRef, value) => this.ctx.yzjCards.resolveKeyword(cardRef, value),
    })
    // 会话列里打的是人自己的话：`desk` 出站——不签实例署名，回复它也不算受话 agent。
    const sent = await this.client.send({ groupId: topic.groupId }, body, anchor, 'desk')
    if (answer !== undefined) {
      const result = await this.ctx.yzjCards.act(
        answer.projection.cardRef,
        answer.actionId,
        { kind: 'operator', openId: this.operatorOpenId },
        'yzj-text',
        answer.input,
      )
      // 回执贴回那句话下面——和入站一路一字不差：群里看得见「确认」，也得看得见它生效了。
      await this.client.send({ groupId: topic.groupId }, result.receipt, sent.msgId ?? anchor)
    }
    if (sent.msgId !== undefined) {
      // The topic index follows the CHAIN, not the anchor we happened to use:
      // a reply to a message inside this topic still belongs to this topic.
      this.state.recordMessageTopic(topic.groupId, sent.msgId, topic.topicRootId)
      await this.state.save()
    }
    return sent.msgId === undefined ? {} : { msgId: sent.msgId }
  }

  /**
   * The place's own thread — unfiltered by topic.
   *
   * The group view's job is to show what the room looks like, so it does the
   * opposite of `messagesFor`: no topic filter, one page, newest window. The
   * topic cards are laid over it by the view at the message each topic grew
   * from, which is why the raw thread has to stay raw here.
   */
  async messagesInPlace(placeKey: string, limit = 40): Promise<readonly TopicMessage[]> {
    const groupId = groupIdFromPlaceKey(placeKey)
    if (groupId === undefined) return []
    // One CLI page is 20 (its hard ceiling), and a place that hosts a dozen
    // topics burns through that in an afternoon — so page back until the
    // requested window is filled. Bounded at four pages: a projection may be
    // partial, it may not be unbounded.
    let scanned = await this.client.messages(groupId, limit)
    for (let page = 1; page < 4 && scanned.length < limit; page += 1) {
      const earliest = scanned[0]
      if (earliest === undefined) break
      const older = await this.client.olderPage(groupId, earliest.msgId)
      if (older.messages.length === 0) break
      scanned = [...older.messages, ...scanned]
      if (!older.more) break
    }
    await this.resolveNames(scanned)
    this.presence.observe?.(groupId, scanned)
    const group: YzjGroup = {
      groupId, groupName: '', groupType: 2, lastMsgId: '', lastMsgSendTime: '',
    }
    const lookup = (id: string, msgId: string): string | undefined => (
      this.state.topicForMessage(id, msgId)
    )
    return scanned
      .map(message => this.render(
        message, groupId, resolveTopicRootId(group, message, scanned, lookup),
      ))
      .sort((left, right) => left.time - right.time)
      .slice(-limit)
  }

  async lightAsk(sessionId: string, text: string): Promise<string> {
    const topic = this.topicOf(sessionId)
    if (topic === undefined) throw new Error('This session is not a Yunzhijia topic')
    const body = text.trim()
    if (body === '') throw new Error('Refusing to ask nothing')
    return this.ask(this.routeOf(topic), body)
  }

  /**
   * Rebuild the durable route for a topic we already know.
   *
   * `topicRouteFor` is pure over (identity, group, rootId, generation), and all
   * four are on the handle — so the route the desktop reaches is byte-identical
   * to the one the poller mints, including its sessionId. Deriving it beats
   * storing it: a stored route is a second copy that can disagree.
   */
  private routeOf(topic: TopicDescriptor): YzjTopicRoute {
    const group: YzjGroup = {
      groupId: topic.groupId,
      groupName: topic.groupName,
      groupType: topic.conversationKind === 'direct' ? 1 : 2,
      lastMsgId: '',
      lastMsgSendTime: '',
    }
    const synthetic: YzjMessage = {
      msgId: topic.topicRootId, content: '', fromOpenId: this.operatorOpenId,
      msgType: 'text', sendTime: '', param: {},
    }
    return topicRouteFor(
      { orgId: this.operatorOrgId, openId: this.operatorOpenId },
      group, synthetic, [], topic.topicRootId, topic.generation,
    )
  }

  /** Fill the display-name cache for any sender we have not seen before. */
  private async resolveNames(messages: readonly YzjMessage[]): Promise<void> {
    const unknown = [...new Set(messages.map(message => message.fromOpenId))]
      .filter(openId => openId !== '' && !this.names.has(openId))
    if (unknown.length === 0) return
    try {
      const users = await this.client.usersByOpenId(unknown)
      for (const user of users) this.names.set(user.openId, user.name)
    } catch (error) {
      console.error('[yzj-next-channel] failed to resolve display names', error)
    }
    // Negative results are cached too: a directory that does not know somebody
    // will not learn them by being asked once per render.
    for (const openId of unknown) if (!this.names.has(openId)) this.names.set(openId, openId)
  }

  private render(message: YzjMessage, groupId: string, chainRootId?: string): TopicMessage {
    /*
      Attachments carry an ID, never a URL.

      The bytes are not publicly addressable — the URL this used to build is a
      generic icon endpoint (see `downloadFile`). So the wire carries the file
      id and the surface asks the host for the content, which is also the only
      way to put a size cap and a cache in front of it.
    */
    const images: {
      fileId: string; w?: number; h?: number
      name?: string; ext?: string; size?: number
    }[] = (message.param.desc ?? []).map(segment => ({
      fileId: segment.data,
      ...(segment.w === undefined ? {} : { w: segment.w }),
      ...(segment.h === undefined ? {} : { h: segment.h }),
    }))
    const fileId = message.param.fileId
    const picture = fileId !== undefined && isPictureAttachment(message.param)
    if (picture && fileId !== undefined) {
      images.push({
        fileId,
        ...(message.param.picWidth === undefined ? {} : { w: message.param.picWidth }),
        ...(message.param.picHeight === undefined ? {} : { h: message.param.picHeight }),
        // 图片也是文件——它有名字、有后缀、有大小,放大和下载都要用到。
        ...(message.param.name === undefined ? {} : { name: message.param.name }),
        ...(message.param.ext === undefined ? {} : { ext: message.param.ext }),
        ...(message.param.size === undefined ? {} : { size: message.param.size }),
      })
    }
    const file = fileId === undefined || picture
      ? undefined
      : {
        fileId,
        name: message.param.name ?? fileId,
        ...(message.param.ext === undefined ? {} : { ext: message.param.ext }),
        ...(message.param.size === undefined ? {} : { size: message.param.size }),
      }
    return {
      ...(chainRootId === undefined ? {} : { chainRootId }),
      msgId: message.msgId,
      fromOpenId: message.fromOpenId,
      fromName: this.names.get(message.fromOpenId)
        ?? (message.fromOpenId === this.operatorOpenId ? '你' : message.fromOpenId),
      content: message.content,
      msgType: message.msgType,
      time: parseSendTime(message.sendTime),
      own: this.state.isOwnOutbound(
        message.msgId, groupId, outboundFingerprint(groupId, message.content),
      ),
      ...(message.param.replySummary === undefined
        ? {}
        : { replyToSummary: message.param.replySummary }),
      ...(message.param.replyMsgId === undefined
        ? {}
        : { replyToId: message.param.replyMsgId }),
      ...(images.length === 0 ? {} : { images }),
      ...(file === undefined ? {} : { file }),
    }
  }
}
