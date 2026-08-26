/**
 * 事件枢纽 —— 一场会**看进去**是什么样 (§5.6, v4.19).
 *
 * 板上一场会只占一行，一行装得下的只有三样：几点、叫什么、准备好没有。这一屏是那一行
 * 的放大态，回答会前真正要决定的那一件事：**还差什么，要不要现在补一刀。**
 *
 * 三条纪律，写在这里是为了让后来改这个文件的人先读到：
 *
 * ① **就绪度是推导，不是字段**。挂着的活办完了它就绿，没人需要来点一下——一个叫
 *    `readiness` 的字段第一天就会开始撒谎（有人干完了忘了来更新，会前那一眼看到的
 *    还是「没准备好」）。所以这一屏只读，不写。
 * ② **无关联 ≠ 缺材料**（v4.19 就绪度三态）。一场没挂任何东西的会是**合法状态**，
 *    不是一个待办：没有期待就没有「缺」。空状态因此得说清自己是哪一种空——语义空缺
 *    渲染成负面状态，是这套设计点名要避免的那种谎。
 * ③ **一跳指路，不搬运**。挂着的每件活都通向它自己在干的那个话题；这一屏不复述过程，
 *    也不做第二条时间线。
 *
 * 「为此会准备」是**传送门**，不是表单：它不替人派活。会前那一刀说给谁听、在哪说，
 * 是社交决策——机器代做的那一刻就错了。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { BoardEventWire, SurfaceInject } from './rpc.ts'
import { RoomPicker, handoffPortal, landPortal, type Portal } from './RoomPicker.tsx'
import { RepairVerbs, type Repair, type RepairTarget } from './RepairVerbs.tsx'
import { eventPrepSeed } from './commission.ts'
import { safeHref } from './preview.ts'
import css from './objects.module.css'

export interface EventHubProps {
  eventId: string
  /** 读不回来时还说得出它是谁——「那场会不在了」比一片空白像话。 */
  title: string
  inject: SurfaceInject
  openSession(sessionId: string): void
  close(): void
}

/** 一场会的钟点。跨天的会不画成「25:00」，两端都写出来。 */
function clockOf(event: BoardEventWire): string {
  const at = (stamp: number): string => {
    const time = new Date(stamp)
    return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  }
  if (event.startAt === 0) return '时间未定'
  return event.endAt === undefined ? at(event.startAt) : `${at(event.startAt)}–${at(event.endAt)}`
}

const STATUS_LABEL: Record<string, string> = {
  // 移交不是死法：事还在，只是换了一条边（决策 #59）。和作废挤成同一句就再也分不出来。
  open: '在跟', closed: '已完成', voided: '已作废', merged: '已合并', transferred: '已移交',
}

/**
 * 会上要用的东西，**按 URI 去重**。
 *
 * 归属那一层是故意重复的：一份产在共用会话里的材料会挂在共用它的每一件活下面——
 * 「丢掉是丢真数据，独占是说假话」。可**清单是给人看的**，同一个链接印两遍只会让人
 * 以为有两份东西；`materialsFor`（写进日程描述的那一份）早就是这么做的，它的注释里
 * 写着「清单那一层按 URI 去重」——那句话说的正是这里，而这里第一版没做。
 *
 * 两个后果，一个看得见一个看不见：屏幕上多出一行不存在的材料；React 拿到两个一样的
 * key。
 */
export function materialsOf(event: BoardEventWire): { uri: string; title: string }[] {
  const seen = new Set<string>()
  const out: { uri: string; title: string }[] = []
  for (const prep of event.prepares) {
    for (const artifact of prep.artifacts) {
      if (seen.has(artifact.uri)) continue
      seen.add(artifact.uri)
      out.push(artifact)
    }
  }
  return out
}

/**
 * 一条 hub 行看在修理动词眼里是什么 —— 只有它真正需要的那几样。
 *
 * 不伪造一整行承诺：枢纽的行是「会前那一眼」的形状，硬凑成板行意味着编出一堆这里
 * 根本不知道的字段（信号、方向、最后动静），而编出来的字段迟早会被谁当真。
 */
function targetOf(prep: BoardEventWire['prepares'][number]): RepairTarget {
  return {
    id: prep.commitmentId,
    what: prep.what,
    status: prep.status,
    ...(prep.due === undefined ? {} : { due: { text: prep.due } }),
    ...(prep.goalRef === undefined ? {} : { goalRef: prep.goalRef }),
  }
}

export function YzjEventHub(props: EventHubProps): ReactNode {
  const { eventId, title, inject, openSession, close } = props
  const [event, setEvent] = useState<BoardEventWire | undefined>(undefined)
  /** 三值：还没读到 / 读到了 / 读到了但没有这一场。合并即撒谎。 */
  const [read, setRead] = useState<'pending' | 'found' | 'gone'>('pending')
  const [portal, setPortal] = useState<Portal | undefined>(undefined)

  /**
   * 移交 —— 先问图要当前值，再开那张预选好的选择条（决策 #59）。
   *
   * 读不回来就说读不回来：一颗按下去没有下文的键，比没有这颗键更坏。
   */
  const openHandoff = useCallback(async (row: RepairTarget): Promise<void> => {
    const opened = await handoffPortal(inject, row)
    if ('error' in opened) { setNote(opened.error); return }
    setRepair(undefined)
    setPortal(opened)
  }, [inject])

  /*
    **「既可见又可动」对 hub 行同样自我适用**（决策 #57：板与 hub 同构）。

    这一格此前只有「去看 ›」：会前那一眼看出「这件来不及了」，能做的只有跳走——而跳到
    那个话题里也没有动词，因为动词长在板和目标页上。修理入口就摆在看见它的地方。
  */
  const [repair, setRepair] = useState<Repair | undefined>(undefined)
  const [field, setField] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  /** 已经亮出后果、正等第二下的那颗作废。门的两半同生同灭（8 秒后松手）。 */
  const [armed, setArmed] = useState('')

  useEffect(() => {
    if (armed === '') return undefined
    const timer = setTimeout(() => { setArmed('') }, 8_000)
    return () => { clearTimeout(timer) }
  }, [armed])

  useEffect(() => {
    if (note === '') return undefined
    const timer = setTimeout(() => { setNote('') }, 5_000)
    return () => { clearTimeout(timer) }
  }, [note])

  const refresh = useCallback(async (): Promise<void> => {
    const all = await inject.events()
    const found = all.find(one => one.eventId === eventId)
    setEvent(found)
    setRead(found === undefined ? 'gone' : 'found')
  }, [inject, eventId])

  useEffect(() => {
    let alive = true
    void refresh()
    /*
      就绪度要**随着交付自动翻绿**，所以这一屏是活的，不是一张快照——但节拍要配得上
      它的代价。`events()` 那一头是**一次 CLI 子进程 + 一次网络往返**（`calendar
      event list`，20 秒超时）；这一屏第一版照抄了别处的 6 秒轮询，于是打开着的每
      六秒就烧一个子进程，慢一点的一次回来之前下一次已经出发了。

      30 秒是按**这一屏在回答什么**定的：会前那一眼是分钟量级的事，一件活交付之后
      半分钟内翻绿绰绰有余。真要更快，该做的是给它一个只读图、不碰 CLI 的端点——
      日程那半截（标题、时间、地点）本来就一整天不会变，跟着一起重取纯属陪跑。
    */
    const timer = setInterval(() => { if (alive) void refresh() }, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  const head = (
    <div className={css.hubHead}>
      <button type="button" className={css.hubBack} onClick={close}>‹ 返回</button>
      <span className={css.hubTitle}>{event?.title ?? title}</span>
    </div>
  )

  if (read === 'pending' && event === undefined) {
    return <div className={css.hub}>{head}<div className={css.calm}>正在读这场会…</div></div>
  }
  if (event === undefined) {
    return (
      <div className={css.hub}>
        {head}
        {/*
          今天的会读的是「还没开完的」。开完了它就该从这一屏退场——但退场要说一声，
          不然人会以为是读失败了。
        */}
        <div className={css.calm}>这场会不在「今天还没开完的」里了——可能已经开完，或者被取消。</div>
      </div>
    )
  }

  const open = event.prepares.filter(prep => prep.status === 'open')
  const materials = materialsOf(event)

  return (
    <div className={css.hub}>
      {head}
      <div className={css.hubMeta}>
        {clockOf(event)}
        {event.location === undefined ? '' : ` · ${event.location}`}
        {event.organizer === undefined ? '' : ` · ${event.organizer} 组织`}
      </div>
      <div className={`${css.hubReady} ${css[`ready_${event.readiness}`] ?? ''}`}>
        {event.readinessLine}
      </div>

      {/*
        关联任务 = **服务边**，而服务边是可选边 (v4.19)。

        一场没挂东西的会不是「没准备」，是还没有人对它有期待。这两句话在界面上必须
        长得不一样——把合法的空渲染成缺失，就是在替人造一个不存在的待办。
      */}
      <div className={css.hubSection}>关联任务 · {event.prepares.length}</div>
      {event.prepares.length === 0
        ? (
          <div className={css.calm}>
            还没有任何活挂在这场会上——<b>这是合法状态</b>，不是「没准备好」。
            下面的「为此会准备」会派出第一件。
          </div>
        )
        : event.prepares.map(prep => (
          <div className={css.hubPrep} key={prep.commitmentId}>
            <span className={css.hubPrepWhat}>{prep.what}</span>
            <span className={css.hubPrepWho}>
              {prep.who} · {STATUS_LABEL[prep.status] ?? prep.status}
            </span>
            {/*
              一跳可达。没有会话可跳的那一条如实说没有——它登记时不在任何话题里，
              过程就不在这套系统里，这不是一个可以点的东西。
            */}
            {prep.sessionId === undefined
              ? <span className={css.hubPrepHint}>没有可跳进去的会话</span>
              : (
                <button
                  type="button"
                  className={css.hubGo}
                  onClick={() => { openSession(prep.sessionId as string) }}
                >
                  去看 ›
                </button>
              )}
            {/* 无主权不渲染——和板、目标页共用同一个谓词、同一份判断。 */}
            {prep.status === 'open' && prep.stewardedBy === undefined && (
              <button
                type="button"
                className={css.hubGo}
                title="顺延期限 / 移交 / 合并 / 作废 / 收养或摘除——改的都是当初说出口的话"
                onClick={() => {
                  setRepair(current => (current?.row.id === prep.commitmentId
                    ? undefined
                    : { kind: 'postpone', row: targetOf(prep) }))
                  setField(prep.due ?? '')
                }}
              >
                修理
              </button>
            )}
            {repair !== undefined && repair.row.id === prep.commitmentId && (
              <div className={css.hubRepair}>
                <div className={css.hubTabs}>
                  {([
                    ['postpone', '顺延期限'], ['handoff', '移交'], ['merge', '合并'],
                    ['void', '作废…'], ['attach', prep.goalRef === undefined ? '收养' : '摘除'],
                  ] as const).map(([kind, label]) => (
                    <button
                      type="button"
                      key={kind}
                      className={`${css.hubGo} ${repair.kind === kind ? css.hubTabOn : ''}`}
                      onClick={() => {
                        setRepair({ kind, row: targetOf(prep) })
                        setField(kind === 'postpone' ? prep.due ?? '' : '')
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <RepairVerbs
                  repair={repair}
                  siblings={(event?.prepares ?? []).map(targetOf)}
                  inject={inject}
                  busy={busy !== ''}
                  field={field}
                  setField={setField}
                  handoff={(target) => { void openHandoff(target) }}
                  close={() => { setRepair(undefined) }}
                  run={(id, work, done) => {
                    setBusy(id)
                    void work.then((result) => {
                      setBusy('')
                      setNote(result.error ?? done)
                      setRepair(undefined)
                      void refresh()
                    })
                  }}
                />
              </div>
            )}
          </div>
        ))}
        {note !== '' && <div className={css.hubNote}>{note}</div>}

      {/*
        材料就绪度 —— 会上真正要用的是**东西**，不是「已完成」四个字。
      */}
      <div className={css.hubSection}>材料 · {materials.length}</div>
      {event.prepares.length === 0
        ? <div className={css.calm}>没有期待中的材料——就绪度这件事还没被激活。</div>
        : materials.length === 0
          ? (
            <div className={css.calm}>
              挂着的 {event.prepares.length} 件还没留下任何工件
              {open.length > 0 ? `（${open.length} 件还在跟）` : ''}。
            </div>
          )
          : materials.map(artifact => (
            <div className={css.hubMaterial} key={artifact.uri}>
              <span className={css.hubMaterialTitle}>{artifact.title}</span>
              {safeHref(artifact.uri) === undefined
                ? <span className={css.hubPrepHint}>这个引用不是一个链接</span>
                : (
                  <a
                    className={css.hubGo}
                    href={safeHref(artifact.uri)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    打开 ↗
                  </a>
                )}
            </div>
          ))}

      {/*
        描述 = 日程真身里的那一段，**全参会人看得见的那一版**。

        图上齐全不等于开会的人知道：他们看的是日程条目。所以材料清单没写进去这件事
        要在这儿说，而不是只在板上说一句。
      */}
      <div className={css.hubSection}>日程描述</div>
      <div className={css.hubDesc}>
        {event.description ?? '这场会的日程描述是空的。'}
      </div>
      {materials.length > 0 && event.postedMaterials === undefined && (
        <div className={css.hubWarn}>
          材料还没写进日程描述——参会的人在日程里看不到它们。
        </div>
      )}

      <button
        type="button"
        className={css.hubCta}
        title="选一个会话跳进去，用你自己的话把会前要准备的事派出去"
        onClick={() => {
          setPortal({
            subject: 'event',
            goalRef: `yzj://event/${event.eventId}`,
            goalName: event.title,
            voice: 'place',
            seed: eventPrepSeed(event.title),
            // 会前补的那一刀也要派给谁——同一个动词，同样两维（板与 hub 同构）。
            pick: 'executor',
            title: '为这场会准备：谁来做、在哪儿说？',
            note: '会前要补的那一刀，说给谁听、在哪说，只有你知道。',
          })
        }}
      >
        为此会准备 ↗
      </button>

      {portal !== undefined && (
        <RoomPicker
          portal={portal}
          inject={inject}
          close={() => { setPortal(undefined) }}
          go={(landing, choice) => {
            setPortal(undefined)
            landPortal(portal, landing, choice, openSession)
          }}
        />
      )}
    </div>
  )
}
