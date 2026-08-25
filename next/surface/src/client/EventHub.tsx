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
import { RoomPicker, type Portal } from './RoomPicker.tsx'
import { sendErrand } from './store.ts'
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
  open: '在跟', closed: '已完成', voided: '已作废', merged: '已合并',
}

export function YzjEventHub(props: EventHubProps): ReactNode {
  const { eventId, title, inject, openSession, close } = props
  const [event, setEvent] = useState<BoardEventWire | undefined>(undefined)
  /** 三值：还没读到 / 读到了 / 读到了但没有这一场。合并即撒谎。 */
  const [read, setRead] = useState<'pending' | 'found' | 'gone'>('pending')
  const [portal, setPortal] = useState<Portal | undefined>(undefined)

  const refresh = useCallback(async (): Promise<void> => {
    const all = await inject.events()
    const found = all.find(one => one.eventId === eventId)
    setEvent(found)
    setRead(found === undefined ? 'gone' : 'found')
  }, [inject, eventId])

  useEffect(() => {
    let alive = true
    void refresh()
    // 就绪度要**随着交付自动翻绿**，所以这一屏是活的，不是一张快照。
    const timer = setInterval(() => { if (alive) void refresh() }, 6_000)
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
  const materials = event.prepares.flatMap(prep => prep.artifacts)

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
          </div>
        ))}

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
            title: '为这场会准备：跳进哪个会话说？',
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
          go={(sessionId) => {
            sendErrand({
              subject: portal.subject,
              goalRef: portal.goalRef,
              goalName: portal.goalName,
              voice: portal.voice,
              ...(portal.seed === undefined ? {} : { seed: portal.seed }),
            })
            setPortal(undefined)
            openSession(sessionId)
          }}
        />
      )}
    </div>
  )
}
