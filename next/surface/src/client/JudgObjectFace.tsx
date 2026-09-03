/**
 * 「我的判断」语境下的右栏 —— 账本律：右栏 = f(当前会话, tab)。
 *
 * 当前 = 证据面：选中行的 then/later 照片，锚活可一跳，锚死 ⚰ 标记而快照在场；
 * 切离即毁选中态；默认态 = 第一条待对表的照片。记忆恒空（两本复利账不合流）；
 * 资源 = 组织侧的物，跨账本恒定格（同一个组件）。
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { EvidenceFaceWire, ObjectFaceWire, ObjectPreviewWire, SurfaceInject } from './rpc.ts'
import { ResourceTab } from './ResourceTab.tsx'
import { currentJudgSelection, subscribeJudgSelection } from './store.ts'
import tokens from './tokens.module.css'
import css from './objects.module.css'
import vault from './vault.module.css'

type Tab = 'current' | 'memory' | 'resources'

export interface JudgObjectFaceProps {
  inject: SurfaceInject
  openSession?(sessionId: string): void
  openGoal?(goalRef: string): void
}

export function YzjJudgObjectFace(props: JudgObjectFaceProps): ReactNode {
  const { inject, openSession, openGoal } = props
  const [tab, setTab] = useState<Tab>('current')
  const selection = useSyncExternalStore(subscribeJudgSelection, currentJudgSelection)
  const [evidence, setEvidence] = useState<EvidenceFaceWire | undefined>(undefined)
  const [previews, setPreviews] = useState<Readonly<Record<string, ObjectPreviewWire>>>({})
  const [resources, setResources] = useState<ObjectFaceWire | undefined>(undefined)

  useEffect(() => {
    let dropped = false
    void inject.judgEvidence(selection?.kind, selection?.id).then((face) => { if (!dropped) setEvidence(face) })
    return () => { dropped = true }
  }, [inject, selection])

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
    void Promise.all(live.map(async anchor => ({ key: `${anchor.kind}:${anchor.id}`, one: await inject.objectPreview(anchor.kind, anchor.id) })))
      .then((results) => {
        if (dropped) return
        const next: Record<string, ObjectPreviewWire> = {}
        for (const result of results) if (result.one !== undefined) next[result.key] = result.one
        setPreviews(next)
      })
    return () => { dropped = true }
  }, [anchorKeys, inject])

  useEffect(() => {
    if (tab !== 'resources' || resources !== undefined) return
    let dropped = false
    void inject.objects().then((face) => { if (!dropped) setResources(face) })
    return () => { dropped = true }
  }, [tab, resources, inject])

  const rows = evidence?.rows ?? []
  return (
    <div className={`${tokens.tokens} ${css.panel}`}>
      <div className={css.head}>
        <span className={css.title}>当时的样子</span>
        <span className={css.sub}>这些是当时拍下的原文，不是现在去查的。离开这一页就收起。</span>
      </div>
      <div className={css.tabs}>
        {([['current', '当前'], ['memory', '记忆'], ['resources', '资源']] as const).map(([id, label]) => (
          <button type="button" key={id} className={`${css.tab} ${tab === id ? css.tabOn : ''}`} onClick={() => { setTab(id) }}>
            {label}{id === 'current' && rows.length > 0 && <span className={css.tabCount}>{rows.length}</span>}
          </button>
        ))}
      </div>
      <div className={css.radius}>
        {tab === 'current' ? evidence?.title ?? '左边任一行按「看 ›」' : tab === 'memory' ? '这一格永远为空' : '组织侧的物 · 跨账本恒定格'}
      </div>
      <div className={css.body}>
        {tab === 'current' && (rows.length === 0
          ? <div className={css.calm}>左边任一行按「看 ›」，它当时的照片就摆到这儿。</div>
          : rows.map((one, index) => {
            const key = one.anchor === undefined ? '' : `${one.anchor.kind}:${one.anchor.id}`
            const preview = previews[key]
            const jump = preview?.sessionId !== undefined && openSession !== undefined
              ? () => { openSession(preview.sessionId as string) }
              : preview?.goalRef !== undefined && openGoal !== undefined ? () => { openGoal(preview.goalRef as string) } : undefined
            return (
              <div key={`${one.at}:${String(index)}`} className={`${vault.evidenceRow} ${one.premise === 'changed' ? vault.evidenceDead : ''}`}>
                {one.premise === 'changed' ? '⚰ ' : ''}{one.text}
                <span className={vault.evidenceMeta}>
                  {new Date(one.at).toLocaleString('zh-CN', { hour12: false })}
                  {one.mark === undefined ? '' : ` · ${one.mark}`}
                </span>
                {preview?.alive === true && (
                  <div className={vault.preview}><b>现在</b>：{preview.title ?? ''}{(preview.lines ?? []).map(line => <span className={vault.evidenceMeta} key={line}>{line}</span>)}</div>
                )}
                {jump !== undefined && (
                  <div className={vault.actions}><button type="button" className={vault.verb} onClick={jump}>回那张卡 ↗</button></div>
                )}
              </div>
            )
          }))}
        {tab === 'memory' && <div className={css.calm}>空，而且永远为空：你的判断记录永不入记忆库。记忆是 agent 的复利，这本账是你的——两本账不合流。</div>}
        {tab === 'resources' && (
          <ResourceTab rows={resources?.resources ?? []} empty={resources === undefined ? '读取中…' : '本机会话还没有产出工件。'} />
        )}
      </div>
    </div>
  )
}
