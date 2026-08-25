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
  useCallback, useEffect, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import type { ObjectFaceWire, SurfaceInject } from './rpc.ts'
import { ArtifactPreview } from './PreviewPanel.tsx'
import { ArtifactCard } from './ArtifactCard.tsx'
import { YzjEventHub } from './EventHub.tsx'
import { artifactRefOf } from './artifacts.ts'
import { currentSpotlight, setSpotlight, subscribeSpotlight } from './store.ts'
import { useAsidePreviewHost, usePreview } from './preview.ts'
import tokens from './tokens.module.css'
import css from './objects.module.css'

type Tab = 'current' | 'memory' | 'resources'

const AXIS_LABEL: Record<string, string> = { place: '场所', entity: '实体', org: '组织' }

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
  /*
    这一栏把自己的实际宽度报出去,「并排有没有地方落」由此回答。

    回调 ref 存进 state 而不是 `useRef`:根节点在两个 return 分支里各画一次,
    ref 对象的 `.current` 变了不会触发 effect 重跑,而这里恰恰需要它重跑。
  */
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  useAsidePreviewHost(host)

  const refresh = useCallback(async (): Promise<void> => {
    setFace(await inject.objects(sessionId))
  }, [inject, sessionId])

  useEffect(() => {
    let alive = true
    void refresh()
    const timer = setInterval(() => { if (alive) void refresh() }, 6_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

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
  if (preview.target === undefined && spotlight !== undefined) {
    return (
      <div className={`${tokens.tokens} ${css.panel}`} ref={setHost}>
        <YzjEventHub
          key={spotlight.eventId}
          eventId={spotlight.eventId}
          title={spotlight.title}
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
            <div className={css.calm}>
              正在沉浸阅读《{preview.target.title}》——按 <b>Esc</b> 回到并排，
              这一栏会把它接回来。
            </div>
          )}
      </div>
    )
  }

  const rows = tab === 'current' ? face.current : tab === 'resources' ? face.resources : []
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
      ? `在「${where}」里成立的 ${String(hereMemories.length)} 条${anywhereMemories.length === 0 ? '' : ` · 另有 ${String(anywhereMemories.length)} 条到哪儿都成立`}`
      : '不限场所的惯例（本机会话没有场所）',
    resources: face.scope?.kind === 'place' ? `「${where}」里所有话题产出的` : '本机会话产出的（不属于任何群）',
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
        出处：{item.sourceAnchors.join('、') || '未记录'}
      </div>
    </div>
  )

  return (
    <div className={`${tokens.tokens} ${css.panel}`} ref={setHost}>
      <div className={css.head}>
        <span className={css.title}>对象面</span>
        <span className={css.sub}>流沉淀为物 · 跟会话走</span>
      </div>
      <div className={css.tabs}>
        {([['current', '当前'], ['memory', '记忆'], ['resources', '资源']] as const).map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={`${css.tab} ${tab === id ? css.tabOn : ''}`}
            onClick={() => { setTab(id) }}
          >
            {label}
            {counts[id] > 0 && <span className={css.tabCount}>{counts[id]}</span>}
          </button>
        ))}
      </div>

      {/* 半径常显：三个 tab 是同一个点上的三个半径,不说清楚就分不出哪个是哪个。 */}
      <div className={css.radius}>{RADIUS[tab]}</div>

      <div className={css.body}>
        {tab === 'memory' && (
          face.memory.length === 0
            ? (
              <div className={css.calm}>
                {face.scope?.kind === 'place'
                  ? <>在「{where}」还没有记下任何惯例。</>
                  : <>还没有不限场所的惯例。</>}
                <br />
                agent 学到这里长期成立的做法时会用 <code>memory_note</code> 记一条，
                下次不必再被告知；每条都带着它的出处，你随时可以让它忘掉。
                <br />
                <b>群里学到的惯例只在那个群里读得出来</b>——它是在那儿说的。
                {(face.memoryElsewhere ?? 0) > 0 && (
                  <>
                    <br />
                    <b>另有 {face.memoryElsewhere} 条记在别的场所</b>，
                    在那个群的任意话题里打开这一栏就能看到。
                  </>
                )}
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
                  <div className={css.memSection} key="sec-any">
                    到哪儿都成立的（本人 / 全组织）——不属于这个群，切到别的会话同样会出现
                  </div>,
                ]),
              ...anywhereMemories.map(item => memoryCard(item)),
            ]
        )}

        {tab !== 'memory' && rows.length === 0 && (
          <div className={css.calm}>
            {tab === 'current'
              ? '这个会话还没有产出工件。写文档、建表格之后会出现在这里，并同时出现在中间那一列它被写出来的位置。'
              : face.scope?.kind === 'place'
                ? `「${where}」里还没有任何话题产出过工件。`
                : '本机会话还没有产出工件。群里产出的在各自的群里。'}
          </div>
        )}

        {/*
          和中栏那条产出行、承诺板那个抽屉画的是同一张卡——一个物不配两套 UI。
          能取到字节的(agent 上传的文件)点开就在这一栏并排看,取不到的
          (云之家在线文档)给一扇门。
        */}
        {tab !== 'memory' && rows.map(row => (
          <ArtifactCard
            key={`${row.uri}:${String(row.time)}`}
            artifact={artifactRefOf({
              uri: row.uri, title: row.title, action: row.action, notes: [row.placeKey],
            })}
          />
        ))}
      </div>
    </div>
  )
}
