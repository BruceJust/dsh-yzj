/**
 * 金库语境下的右栏 —— **对象面账本律的私账那一半** (v2.2 = #62 追加澄清).
 *
 * 右栏**没有自己的身份**：它是当前会话的物的投影，切会话即整体重算——
 * **右栏 = f(当前会话, tab)**。金库是一个会话（一个 frame），所以进了金库，右栏
 * 整体换成这一棵树；这不是「组织侧对象面加了个私账 tab」，那样两本账就在同一个
 * 组件里混排了。
 *
 * 三个 tab 的账本归属各自恒定：
 *
 * - **当前 = 证据面**（金库的物 = 判例的证据）。摘要为主、锚为辅、锚死显形；
 *   锚活着时那一小块只读预览由 surface 单独去组织侧取，**私账层一层不取内容**。
 * - **记忆 = agent 的复利**，在这里**永远为空**，且空态说清为什么——两本复利账
 *   在右栏也不合流。
 * - **资源 = 组织侧的全局浏览器**，唯一跨账本恒定格，复用组织侧**同一个组件**。
 *   单向可见：私账语境看得见组织的物（你的可见域本来就含着它们），组织语境永远
 *   看不见私账的物。
 *
 * **选中态活在会话视图态里，切离私账即毁**（残留面 = 第四泄漏口）：它存在
 * `store.ts` 的那一格上，而 `setFrame` 在离开金库的那一刻把它清掉——投屏时右栏
 * 残留的一条判例就是一次泄漏，所以这里没有「上次看的是哪一条」这种记忆。
 */

import {
  useEffect, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import type {
  EvidenceFaceWire, ObjectFaceWire, ObjectPreviewWire, SurfaceInject,
} from './rpc.ts'
import { ResourceTab } from './ResourceTab.tsx'
import { currentVaultSelection, subscribeVaultSelection } from './store.ts'
import tokens from './tokens.module.css'
import css from './objects.module.css'
import vault from './vault.module.css'

type Tab = 'current' | 'memory' | 'resources'

export interface VaultObjectFaceProps {
  inject: SurfaceInject
  /** 一跳回真身 —— **会话级导航**，不是在这一栏里就地打开组织侧的活视图。 */
  openSession?(sessionId: string): void
  openGoal?(goalRef: string): void
}

export function YzjVaultObjectFace(props: VaultObjectFaceProps): ReactNode {
  const { inject, openSession, openGoal } = props
  const [tab, setTab] = useState<Tab>('current')
  const selection = useSyncExternalStore(subscribeVaultSelection, currentVaultSelection)
  const [evidence, setEvidence] = useState<EvidenceFaceWire | undefined>(undefined)
  const [previews, setPreviews] = useState<Readonly<Record<string, ObjectPreviewWire>>>({})
  const [resources, setResources] = useState<ObjectFaceWire | undefined>(undefined)

  /*
    默认态 = **待对表首项的备料**（选中态为空时）。

    打开金库就是**人发起的回看时刻**——持镜人条款说的「人发起」在这里有了一个确切
    的时刻定义：agent 此刻聚合证据是合法的，而**备料不定案**——归因那一格仍然在
    中栏那一行上，仍然由你按。
  */
  useEffect(() => {
    let dropped = false
    void (selection === undefined
      ? inject.vaultEvidence()
      : inject.vaultEvidence(selection.kind, selection.id)
    ).then((face) => { if (!dropped) setEvidence(face) })
    return () => { dropped = true }
  }, [inject, selection])

  /*
    只给**活着的锚**取预览，而且只在锚集变了的时候取。

    锚死的不取：**预览消失本身就是显形的一半**——那一行留下快照加一枚「真身已变 /
    已亡」的徽记，而不是一个看起来还活着的标题。也不挂轮询：预览是组织侧的礼貌，
    要看最新的，那颗「回真身 ↗」就在旁边。
  */
  const anchorKeys = (evidence?.rows ?? [])
    .filter(row => row.premise === 'live' && row.anchor !== undefined)
    .map(row => `${(row.anchor as { kind: string }).kind}:${(row.anchor as { id: string }).id}`)
    .join('|')

  useEffect(() => {
    const live = anchorKeys === '' ? [] : anchorKeys.split('|').map((one) => {
      const cut = one.indexOf(':')
      return { kind: one.slice(0, cut), id: one.slice(cut + 1) }
    })
    if (live.length === 0) { setPreviews({}); return }
    let dropped = false
    void Promise.all(live.map(async (anchor) => {
      const one = await inject.objectPreview(anchor.kind, anchor.id)
      return { key: `${anchor.kind}:${anchor.id}`, one }
    })).then((results) => {
      if (dropped) return
      const next: Record<string, ObjectPreviewWire> = {}
      for (const result of results) {
        if (result.one !== undefined) next[result.key] = result.one
      }
      setPreviews(next)
    })
    return () => { dropped = true }
  }, [anchorKeys, inject])

  /*
    资源 tab 读的是**不带会话的那一次查询** —— 组织侧的全局浏览器。

    进了这一格才去读：一个永远不被打开的 tab 没有理由每次进金库都发一次请求。
  */
  useEffect(() => {
    if (tab !== 'resources' || resources !== undefined) return
    let dropped = false
    void inject.objects().then((face) => { if (!dropped) setResources(face) })
    return () => { dropped = true }
  }, [tab, resources, inject])

  const evidenceRows = evidence?.rows ?? []

  return (
    <div className={`${tokens.tokens} ${css.panel}`}>
      <div className={css.head}>
        <span className={css.title}>对象面 · 金库</span>
        <span className={css.sub}>中栏是流、右栏是物 · 这里的物是判例的证据</span>
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
            {id === 'current' && evidenceRows.length > 0 && (
              <span className={css.tabCount}>{evidenceRows.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* 半径常显：三个 tab 是同一个点上的三个半径，各自说清自己是哪一个。 */}
      <div className={css.radius}>
        {tab === 'current'
          ? evidence?.title ?? '选中一行看它的证据'
          : tab === 'memory'
            ? '金库语境：这一格永远为空'
            : '本机会话产出的 · 组织侧的物 · 跨账本恒定格（单向可见：这里看得见组织，组织看不见这里）'}
      </div>

      <div className={css.body}>
        {tab === 'current' && (
          evidence === undefined
            ? (
              <div className={css.calm}>
                {/* 空态要有出生故事：「还没有」和「你还没选」是两句话。 */}
                没有待对表的预期，所以这里空着。
                <br />
                左边任意一行按「证据」，它的照片就摆到这儿——<b>对表不出屏</b>，
                四格仍然在那一行上。
              </div>
            )
            : (
              <>
                {evidenceRows.map((one, index) => {
                  const key = one.anchor === undefined ? '' : `${one.anchor.kind}:${one.anchor.id}`
                  const preview = previews[key]
                  /*
                    **有门才画门**（#57 占位律）：这个对象说得出自己躺在哪儿，
                    **且**宿主给了过去的能力。少一样就不画——灰按钮是「你不配」
                    的展示，不渲染才是「这条路在这个宿主里不存在」。
                  */
                  const jump = preview?.sessionId !== undefined && openSession !== undefined
                    ? () => { openSession(preview.sessionId as string) }
                    : preview?.goalRef !== undefined && openGoal !== undefined
                      ? () => { openGoal(preview.goalRef as string) }
                      : undefined
                  return (
                    <div
                      key={`${one.at}:${String(index)}`}
                      className={`${vault.evidenceRow} ${one.premise === 'changed' ? vault.evidenceDead : ''}`}
                    >
                      {/* 第一行永远是照片。**它不是从锚解析出来的**。 */}
                      {one.text}
                      <span className={vault.evidenceMeta}>
                        {new Date(one.at).toLocaleString('zh-CN', { hour12: false })}
                        {one.mark === undefined ? '' : ` · ⚠ ${one.mark}`}
                        {one.anchor === undefined
                          ? ' · 无锚：这一段只有快照，本来就跳不回去'
                          : ` · ${one.anchor.kind}:${one.anchor.id}（回真身用的坐标，内容不来自它）`}
                      </span>
                      {preview?.alive === true && (
                        <div className={vault.preview}>
                          <b>现在</b>：{preview.title ?? ''}
                          {(preview.lines ?? []).map(line => (
                            <span className={vault.evidenceMeta} key={line}>{line}</span>
                          ))}
                        </div>
                      )}
                      {/*
                        「回真身 ↗」是**会话级导航**，不是在这一栏里就地打开。

                        在私账的屏幕里长出一个组织侧的活视图，就是账本混排的第一步。
                        一跳 = 整屏换账本，Back 回得到金库（导航栈既有）。
                      */}
                      {jump !== undefined && (
                        <div className={vault.actions}>
                          <button
                            type="button"
                            className={vault.verb}
                            onClick={jump}
                            title="一跳回它躺着的地方——整屏换账本。内容不来自这一跳：正文在上面那张照片里。"
                          >
                            回真身 ↗
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className={vault.evidenceMeta}>{evidence.note}</div>
              </>
            )
        )}

        {tab === 'memory' && (
          <div className={css.calm}>
            {/*
              **金库 ≠ 记忆**（#61 澄清③）：空态出生故事——「恰好为空」和「不可能
              有」是两句话，而这一格是后者。
            */}
            空，而且<b>永远为空</b>：金库内容永不入记忆库。
            <br />
            记忆是 agent 的复利、金库是人的复利——两本复利账不合流，也互不蒸馏。
            工程上蒸馏管道对这本账没有通路，反向也禁。
          </div>
        )}

        {tab === 'resources' && (
          <ResourceTab
            rows={resources?.resources ?? []}
            /*
              空态的**范围要说准**。

              这一格读的是不带会话的那一次查询，落在「本机」这个半径上——写成
              「组织侧还没有产出工件」就把范围说大了，而一句说大了的空态会让人以为
              组织侧真的空空如也。恒定的是**账本归属**（它永远看组织的物），不是范围。
            */
            empty={resources === undefined
              ? '读取中…'
              : '本机会话还没有产出工件。群里产出的在各自的群里——这一格看的始终是组织的物。'}
          />
        )}
      </div>
    </div>
  )
}
