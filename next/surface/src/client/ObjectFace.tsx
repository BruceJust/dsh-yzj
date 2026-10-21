/**
 * The right column — 对象面: what the flow has deposited as things.
 *
 * A conversation is where work happens; artifacts and conventions are what is
 * left when it stops. This column is the second half of that sentence, and it
 * is a pure read of edges the tools already record — no separate index, no
 * bookkeeping that could drift from what actually happened.
 *
 * The 记忆 tab shows its sources and offers to forget. Both are the same rule:
 * a memory that cannot be traced or retired is one people stop trusting the
 * first time it repeats something that stopped being true.
 *
 * The three tabs are three RADII around one point — this conversation, its
 * place, and what holds in that place — so each one names its own radius. A
 * panel whose contents depend on where you stand and never says where it
 * thinks you are standing is one where two identical lists cannot be told
 * apart from a bug; that is exactly how this column read before.
 */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import type { ObjectFaceWire, SurfaceInject } from './rpc.ts'
import { ArtifactPreview } from './PreviewPanel.tsx'
import { ResourceTab } from './ResourceTab.tsx'
import { YzjEventHub } from './EventHub.tsx'
import { CommitmentStoryPanel } from './Story.tsx'
import { currentFrame, currentSpotlight, focusOf, setSpotlight, subscribeFrame, subscribeSpotlight } from './store.ts'
import { closeAside, useAsidePreviewHost, usePreview } from './preview.ts'
import { usePoll } from './poll.ts'
import { Skeleton, UnreadLine } from './Unread.tsx'
import { AGENT } from './words.ts'
import tokens from './tokens.module.css'
import css from './objects.module.css'

type Tab = 'current' | 'memory' | 'resources'

const AXIS_LABEL: Record<string, string> = { place: '这个群', entity: '人和事', org: '全公司' }

export interface ObjectFaceProps {
  sessionId?: string
  inject: SurfaceInject
  /**
   * 一跳可达 —— 事件枢纽从这里通向挂在会上的那件活。
   *
   * 右栏是物的那一面，而物是有出处的：一份材料出自某件活，那件活正在某个话题里干。
   * 没有这条边，枢纽只能报出一个数而指不了路。
   */
  openSession?(sessionId: string): void
}

const EMPTY: ObjectFaceWire = { current: [], memory: [], resources: [], memoryElsewhere: 0 }

export function YzjObjectFace(props: ObjectFaceProps): ReactNode {
  const { sessionId, inject, openSession } = props
  const [face, setFace] = useState<ObjectFaceWire>(EMPTY)
  const [tab, setTab] = useState<Tab>('current')
  const preview = usePreview()
  /** 中栏点了一场会：这一栏被它接管，和工件预览同一条纪律、同一种形状。 */
  const spotlight = useSyncExternalStore(subscribeSpotlight, currentSpotlight)
  const frame = useSyncExternalStore(subscribeFrame, currentFrame)
  /** 这一栏此刻摆什么，只问这一处（律六）。 */
  const focus = focusOf(frame, preview.target !== undefined, spotlight)
  /*
    这一栏把自己的实际宽度报出去,「并排有没有地方落」由此回答。

    回调 ref 存进 state 而不是 `useRef`:根节点在两个 return 分支里各画一次,
    ref 对象的 `.current` 变了不会触发 effect 重跑,而这里恰恰需要它重跑。
  */
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  useAsidePreviewHost(host)

  /*
    站在哪儿看：群视图里是这个群，不是上一个打开过的话题——那一栏标题写着这个群、内容却是
    另一个群的，比空着更糟。还没出生的私聊没有可看的东西。
  */
  const placeKey = frame.kind === 'place' && frame.newDm === undefined ? frame.placeKey : undefined
  const where_ = placeKey ?? sessionId ?? ''
  /** 读到过一次没有；上一次读成了没有。读不到 ≠ 这里什么都没有。 */
  const [loaded, setLoaded] = useState(false)
  const [unread, setUnread] = useState(false)
  /** 只有最新那一次读可以画：换了地方，上一处慢回来的结果不许盖上来。 */
  const readSeq = useRef(0)
  // 换了地方：先清掉上一处的东西，别让它顶着新地方的标题停留一拍。
  useEffect(() => {
    readSeq.current += 1
    setFace(EMPTY)
    setLoaded(false)
    setUnread(false)
  }, [where_])

  const refresh = useCallback(async (): Promise<void> => {
    readSeq.current += 1
    const ticket = readSeq.current
    const next = await inject.objects(placeKey === undefined ? sessionId : undefined, placeKey)
    if (ticket !== readSeq.current) return
    setUnread(next === undefined)
    if (next === undefined) return
    setLoaded(true)
    setFace(next)
  }, [inject, sessionId, placeKey])

  usePoll(refresh, { active: focus.kind === 'things' })

  // 账的几屏上什么都没选：这一栏收起，不摆上一屏留下的东西。
  useEffect(() => {
    if (focus.kind === 'none') closeAside()
  }, [focus.kind])

  /*
    并排 = 默认预览态 (v4.11):打开一份工件,这一栏被它**接管**。

    不违反「中栏是流、右栏是物」,恰恰是兑现它——预览就是「物」的放大态。而
    放在这里而不是弹窗上,是因为**边看边回是验收的原生姿势**:弹窗挡住对话,
    验收就变成「看完凭记忆回复」。宽度是宿主的抽屉,拖拽把手和两端护栏
    (中栏 ≥640 拖不破、这一栏 300–520)都由它保证。

    沉浸时这里让位:整屏的那一份才是正在被读的,两个 iframe 同时渲染同一份
    PDF 只是白烧一遍。留一行字说明它去了哪儿,而不是悄悄换回列表。
  */
  /*
    工件预览排在前面：它是**刚刚按下的那一下**。

    两者都是「这一栏被一个物接管」，撞在一起时该赢的是更近的那次手势。工件预览
    自带 Esc 与关闭，收起来就露出下面的枢纽——不是二选一，是叠着。
  */
  if (focus.kind === 'none') return <div className={`${tokens.tokens} ${css.panel}`} ref={setHost} />

  if (focus.kind === 'commitment') {
    return (
      <div className={`${tokens.tokens} ${css.panel}`} ref={setHost}>
        <CommitmentStoryPanel
          key={focus.id}
          id={focus.id}
          title={focus.title}
          {...(focus.intent === undefined ? {} : { intent: focus.intent })}
          inject={inject}
          {...(openSession === undefined ? {} : { openSession })}
          close={() => { setSpotlight(undefined) }}
        />
      </div>
    )
  }

  if (focus.kind === 'event') {
    return (
      <div className={`${tokens.tokens} ${css.panel}`} ref={setHost}>
        <YzjEventHub
          key={focus.eventId}
          eventId={focus.eventId}
          title={focus.title}
          inject={inject}
          openSession={(id) => {
            // 跳去看那件活 = 换语境，枢纽跟着退场（切会话即收，同一条纪律）。
            setSpotlight(undefined)
            openSession?.(id)
          }}
          close={() => { setSpotlight(undefined) }}
        />
      </div>
    )
  }

  if (preview.target !== undefined) {
    return (
      <div className={`${tokens.tokens} ${css.panel}`} ref={setHost}>
        {preview.stage === 'aside'
          ? <ArtifactPreview target={preview.target} stage="aside" inject={inject} />
          : (
            <div className={css.calm}>正在全屏看《{preview.target.title}》，按 <b>Esc</b> 回到这里。</div>
          )}
      </div>
    )
  }

  /** 群视图里没有「这个话题」：产出那一格不摆，默认看这个群的资料。 */
  const tabs = placeKey === undefined
    ? [['current', '产出'], ['memory', '记忆'], ['resources', '资料']] as const
    : [['resources', '资料'], ['memory', '记忆']] as const
  const shown: Tab = placeKey !== undefined && tab === 'current' ? 'resources' : tab
  const rows = shown === 'current' ? face.current : shown === 'resources' ? face.resources : []
  const counts: Record<Tab, number> = {
    current: face.current.length,
    memory: face.memory.length,
    resources: face.resources.length,
  }

  // Where the radii are centred. 「本群」 names the room; a desk session has no
  // room, and saying so is more useful than naming nothing.
  const where = face.scope?.kind === 'place'
    ? face.scope.placeName ?? '本群'
    : '本机'
  /*
    **记忆这一格是两种东西，标题此前只说了一种。**

    「在「X」里成立的惯例」对场所轴是真的，对本人/全组织轴是假的——后两轴的坐标是账号
    本身，它们**在每一个会话里都成立**，也因此在每一个会话里都出现。于是切到另一个群，
    同一条「关于某人」的惯例又跟过来了，头上还顶着「在这个群里成立」——报告过来的
    「切群时对象面对不上」，看到的就是这个。

    修法不是把它们藏起来（它们确实在这里生效，藏了就成了幽灵注入），是**分节**：这里
    成立的一节、到哪儿都成立的一节，各自说各自的话。
  */
  const hereMemories = face.memory.filter(item => item.axis === 'place')
  const anywhereMemories = face.memory.filter(item => item.axis !== 'place')
  const RADIUS: Record<Tab, string> = {
    current: face.scope?.kind === 'place' ? '这个话题产出的' : '这个会话产出的',
    memory: face.scope?.kind === 'place'
      ? `在「${where}」学到的 ${String(hereMemories.length)} 条${anywhereMemories.length === 0 ? '' : ` · 另有 ${String(anywhereMemories.length)} 条到哪儿都成立`}`
      : '到哪儿都成立的做法',
    resources: face.scope?.kind === 'place' ? `「${where}」里所有话题的产出` : '本机会话的产出',
  }

  /** 一条惯例的卡片。两节共用一张脸——分节分的是「在哪儿成立」，不是它长什么样。 */
  const memoryCard = (item: ObjectFaceWire['memory'][number]): ReactNode => (
    <div className={css.memCard} key={item.id}>
      <button
        type="button"
        className={css.memDel}
        title="忘掉这条"
        onClick={() => { void inject.forgetMemory(item.id).then(() => refresh()) }}
      >
        ×
      </button>
      <span
        className={`${css.memAxis} ${item.axis === 'org' ? css.memOrg : item.axis === 'entity' ? css.memEntity : css.memPlace}`}
      >
        {AXIS_LABEL[item.axis] ?? item.axis}
      </span>
      <div className={css.memText}>{item.summary}</div>
      <div className={css.memMeta}>
        {/* 出处是消息 id（yzj:msg-…），不上屏；说它从几句话里学来的。 */}
        {item.sourceAnchors.length === 0 ? '没记出处' : `从 ${String(item.sourceAnchors.length)} 句话里学到的`}
      </div>
    </div>
  )

  return (
    <div className={`${tokens.tokens} ${css.panel}`} ref={setHost}>
      <div className={css.tabs}>
        {tabs.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={`${css.tab} ${shown === id ? css.tabOn : ''}`}
            onClick={() => { setTab(id) }}
          >
            {label}
            {counts[id] > 0 && <span className={css.tabCount}>{counts[id]}</span>}
          </button>
        ))}
      </div>

      {/* 半径常显：三个 tab 是同一个点上的三个半径,不说清楚就分不出哪个是哪个。 */}
      <div className={css.radius}>{RADIUS[shown]}</div>
      {unread && <UnreadLine had={loaded} />}

      <div className={css.body}>
        {!loaded ? !unread && <Skeleton rows={3} /> : shown === 'memory' && (
          face.memory.length === 0
            ? (
              <div className={css.calm}>
                {face.scope?.kind === 'place' ? <>还没记下「{where}」的做法。</> : <>还没记下什么做法。</>}
                {AGENT}学到这里长期成立的做法，会记在这儿，下次不用你再说；每条都能让它忘掉。
                {(face.memoryElsewhere ?? 0) > 0 && <> 另有 {face.memoryElsewhere} 条是在别的群里学的，在那个群里看得到。</>}
              </div>
            )
            : [
              ...(hereMemories.length === 0 || anywhereMemories.length === 0
                ? []
                : [<div className={css.memSection} key="sec-here">在「{where}」里学到的</div>]),
              ...hereMemories.map(item => memoryCard(item)),
              ...(anywhereMemories.length === 0
                ? []
                : [
                  <div className={css.memSection} key="sec-any">到哪儿都成立的</div>,
                ]),
              ...anywhereMemories.map(item => memoryCard(item)),
            ]
        )}

        {/*
          当前与资源画的是同一种行，所以走同一个组件 —— 而**资源那一格是跨账本恒定
          格**（v2.2 账本律③）：金库右栏的资源 tab 复用的就是这一个，不是另写一份
          长得像的。恒定如果靠两份代码各自保持一致，它就只是暂时一致。
        */}
        {loaded && shown !== 'memory' && (
          <ResourceTab
            rows={rows}
            empty={shown === 'current'
              ? `这里还没有产出。${AGENT}写的文档、建的表会出现在这儿。`
              : face.scope?.kind === 'place'
                ? `「${where}」里还没有产出。`
                : '本机的会话还没有产出。群里的产出在各自的群里。'}
          />
        )}
      </div>
    </div>
  )
}
