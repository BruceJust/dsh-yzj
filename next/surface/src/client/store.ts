/**
 * The one piece of shared client state: which frame the center column is
 * showing.
 *
 * The sidebar and the center column are separate slot entries with no common
 * ancestor, but "click the board, the center shows the board" is one gesture.
 * A module-level store inside our own bundle is the smallest thing that can
 * carry it — and it holds a VIEW SELECTION, never data. Anything that could
 * disagree with the graph still comes from the graph.
 */

/**
 * The two zoom levels of §7.3 plus the board.
 *
 * `place` is the group seen whole — its main thread with the topics that were
 * born in it rendered inline where they were born. It is a FRAME rather than a
 * session because a place is not a conversation with an agent: nothing runs
 * there, there is nothing to steer, and giving it a session would have meant
 * inventing one.
 */
import { closePreview } from './preview.ts'

export type Frame =
  | { readonly kind: 'session' }
  | { readonly kind: 'board' }
  | { readonly kind: 'place'; readonly placeKey: string; readonly groupName: string }
  /**
   * 目标放大态 —— 承诺板的第二缩放级别 (v4.12 §7.6).
   *
   * 缩放语法的第四次复用(群→话题、卡→展开、工件→并排→沉浸、板→目标)。它是
   * 一个 FRAME 而不是一个 session,和 `place` 同理:目标不是一段和 agent 的对话,
   * 那里没有东西在跑、没有东西可 steer。
   *
   * 「分活去哪、看进度看哪」的割裂之所以从根上不存在,是因为进出即缩放、Back
   * 恢复板位、**读的是同一个查询**——一旦它变成一个要单独打开的地方,就变成了
   * 竞品那种「另一个要打开的 app」。
   */
  | { readonly kind: 'goal'; readonly goalRef: string; readonly goalName: string }

let frame: Frame = { kind: 'session' }
const listeners = new Set<() => void>()

/**
 * Where 「‹ 返回」 goes, and what the reader was looking at when they left.
 *
 * Back and Up are different questions (D13②, the Android model): Up is a place
 * in the hierarchy — the breadcrumb group name — while Back is the frame you
 * personally came from, at the pixel you left it. Conflating them is the bug
 * this stack exists to fix: somebody scrolls a long group thread, opens a
 * topic, comes back, and is at the top again with no idea where they were.
 */
const stack: { frame: Frame; scrollTop: number }[] = []

/** Push the current frame before navigating away from it. */
export function pushFrame(next: Frame, scrollTop: number): void {
  stack.push({ frame, scrollTop })
  setFrame(next)
}

/** The frame 「‹ 返回」 would return to, if any. */
export function backTarget(): Frame | undefined {
  return stack.at(-1)?.frame
}

/**
 * Pop one level. The scroll position travels with the pop rather than being
 * recomputed, because the only correct answer is the one the reader left.
 */
export function popFrame(): number {
  const previous = stack.pop()
  if (previous === undefined) {
    setFrame({ kind: 'session' })
    return 0
  }
  setFrame(previous.frame)
  return previous.scrollTop
}

/**
 * 传送门带过去的那件事 (v4.9 入口 A①).
 *
 * The board's 「委派」 is a PORTAL, not a form: assigning work on a board would
 * be re-inventing a project-management tool and rebuilding the split entrance
 * this whole product exists to close. So the board chooses only what a person
 * must choose — which goal, and which room — and everything else happens where
 * work actually happens: in the conversation, in the operator's own words.
 *
 * This carries the goal across the frame switch. It is a HAND-OFF: read once by
 * the column that receives it, then cleared, because a second conversation
 * opened later has nothing to do with an errand that has already landed.
 */
export interface Errand {
  /**
   * 带过去的是**什么**。
   *
   * 「目标」与「会」都走同一个传送门，可它们落地之后的后果完全不同：目标要装载
   * 语境（在那个话题里登记的承诺从此继承它），**一场会不装载任何东西**。不分开
   * 的后果不是标签错了——是会的 id 会被当成 goalRef 写进 `goal-context`，然后那
   * 个话题里每一条新承诺都挂上一个根本不是目标的 URI，把目标图污染掉。
   *
   * `nudge` 是催办（v4.21 第一档①「催办统一」）：**只带一句拟好的稿**，不装载
   * 任何语境。催不是委派，它不该让那个话题从此继承什么——它只是把人送到该说话的
   * 地方，并且把话先起个头。
   */
  readonly subject: 'goal' | 'event' | 'nudge'
  readonly goalRef: string
  readonly goalName: string
  /**
   * Where the words should go: 公 for delegation, 私 for an ordinary turn,
   * **轻问** for a read-only projection.
   *
   * 第三格不是多余的。「问这个目标」这颗按钮此前带的是 `private`——一次**完整的
   * agent turn，写工具全部可用**——而它的名字和它自己的注释都写着轻问（一次性
   * 只读投影：不开任务、不写任何东西）。一颗写着「问一下」的按钮按下去可能动手
   * 写东西，是最不该错的那个方向。
   */
  readonly voice: 'place' | 'private' | 'ask'
  /** Text to seed the composer with. The operator edits it; nothing auto-sends. */
  readonly seed?: string
}

let errand: Errand | undefined

export function sendErrand(next: Errand): void {
  errand = next
}

/** Take the pending errand, if any. Reading it consumes it. */
export function takeErrand(): Errand | undefined {
  const value = errand
  errand = undefined
  return value
}

/**
 * 板上正看着哪一档:全部,还是按目标 (v4.8 两级缩放).
 *
 * 放在这里而不是留在板的组件里,因为**进目标页会把板整个卸载掉**——回来时它是
 * 一次全新的挂载,组件状态一个不剩。于是从「按目标」放大进一个目标、再返回,
 * 落回的是「全部」:目标行连同你刚才停在的那一行一起消失了,恢复滚动位置也就
 * 无从谈起。
 *
 * 「Back 恢复板位」要恢复的是**离开时看见的那一屏**,而那一屏是「哪一档 + 哪个
 * 像素」两件事合起来定义的。
 */
let boardLens: 'all' | 'goals' = 'all'

export function currentBoardLens(): 'all' | 'goals' {
  return boardLens
}

export function setBoardLens(next: 'all' | 'goals'): void {
  boardLens = next
}

export function currentFrame(): Frame {
  return frame
}

export function setFrame(next: Frame): void {
  frame = next
  /*
    切场景即收预览 (v4.11「切会话即收」).

    和「锚不跨会话残留」是同一条纪律:上一个话题里打开的那份文档,在新的场景
    里是一句没有出处的话——看着它的人会以为它属于眼前这段对话。会话之间的
    切换由中栏自己关(它才知道 sessionId 变了),框架之间的切换在这里。
  */
  closePreview()
  for (const listener of listeners) listener()
}

export function subscribeFrame(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
