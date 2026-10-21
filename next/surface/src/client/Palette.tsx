/**
 * ⌘K —— 去任何地方 (界面重设计 §8 · §4.4).
 *
 * 不是新入口：它是到已有地方的捷径——要你的那几件、群和私聊、话题、承诺、目标、产出，
 * 外加两三个「去哪」。按下回车落到的，和在左栏、承诺页里点下去落到的是同一个地方。
 *
 * 同一层还放 `?` 那张键盘表：它们都是「盖在上面、Esc 就走」的那种东西。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BoardViewWire, InboxView, NeedWire, ObjectRowWire, SurfaceInject } from './rpc.ts'
import {
  goToOrigin, jumpToNeed, openSessionNow, pushFrame, setFrame, setSpotlight,
} from './store.ts'
import { openPreview, safeHref } from './preview.ts'
import { artifactRefOf } from './artifacts.ts'
import { KEYMAP, onGlobalKey, openPalette, paletteMode, subscribePalette } from './keys.ts'
import { goalTitleOf } from './Board.tsx'
import { AgentFace, Icon, type IconName } from './icons.tsx'
import { AGENT } from './words.ts'
import tokens from './tokens.module.css'
import css from './palette.module.css'

/** 按下回车去哪。纯数据——执行在 `go` 里，好测。 */
export type PaletteTarget =
  | { readonly kind: 'need'; readonly need: NeedWire }
  | { readonly kind: 'topic'; readonly sessionId: string }
  | { readonly kind: 'place'; readonly placeKey: string; readonly groupName: string }
  | { readonly kind: 'commitment'; readonly id: string; readonly title: string }
  | { readonly kind: 'goal'; readonly goalRef: string; readonly goalName: string }
  | { readonly kind: 'artifact'; readonly row: ObjectRowWire }
  | { readonly kind: 'board' }
  | { readonly kind: 'judg' }
  | { readonly kind: 'help' }

export type PaletteGroup = '要你' | '地方' | '话题' | '承诺' | '目标' | '产出' | '去哪'

export interface PaletteItem {
  readonly key: string
  readonly group: PaletteGroup
  readonly label: string
  readonly sub?: string
  readonly icon: IconName | 'agent' | 'need'
  /** 搜的就是这一串：名字 + 小字 + 别名。 */
  readonly hay: string
  readonly target: PaletteTarget
}

const GROUPS: readonly PaletteGroup[] = ['要你', '去哪', '地方', '话题', '承诺', '目标', '产出']

export interface PaletteData {
  readonly inbox?: InboxView
  readonly board?: BoardViewWire
  readonly artifacts?: readonly ObjectRowWire[]
}

/** 手上这几份数据能去的地方，一条一行。 */
export function paletteItems(data: PaletteData): readonly PaletteItem[] {
  const items: PaletteItem[] = []
  const add = (item: Omit<PaletteItem, 'hay'> & { extra?: string }): void => {
    const { extra, ...rest } = item
    items.push({ ...rest, hay: [rest.label, rest.sub ?? '', extra ?? ''].join(' ').toLowerCase() })
  }
  for (const need of data.inbox?.needs ?? []) {
    add({
      key: `need:${need.ref.kind}:${need.ref.id}`, group: '要你', icon: 'need',
      label: `${need.verb} ${need.label}`, sub: need.placeName ?? need.where, target: { kind: 'need', need },
    })
  }
  add({ key: 'go:board', group: '去哪', icon: 'list', label: '承诺', sub: '谁欠你的、你欠谁的', target: { kind: 'board' }, extra: 'board 对账' })
  if (data.inbox?.pledger?.enabled === true) {
    add({ key: 'go:judg', group: '去哪', icon: 'lock', label: '我定过的', sub: '只有你看得到', target: { kind: 'judg' }, extra: '判断 私账' })
  }
  add({ key: 'go:help', group: '去哪', icon: 'keyboard', label: '快捷键', sub: '?', target: { kind: 'help' }, extra: 'keyboard shortcuts' })
  const names = new Map<string, string>()
  // 云小助在岗的地方排前面：空着按 ⌘K 时先给的那几个，该是你真在用的。
  const conversations = [...(data.inbox?.conversations ?? [])]
    .sort((left, right) => Number(right.onDuty && right.kind !== 'assistant') - Number(left.onDuty && left.kind !== 'assistant'))
  for (const row of conversations) {
    names.set(row.placeKey, row.name)
    const direct = row.kind !== 'group'
    add({
      key: `place:${row.placeKey}`, group: '地方', icon: direct ? 'users' : 'hash',
      label: row.selfChat ? '我 · 审批通道' : direct ? row.name : row.name,
      sub: row.selfChat ? '和云小助的私聊' : direct ? '私聊' : row.onDuty ? '群' : `群 · ${AGENT}没在这里接单`,
      target: { kind: 'place', placeKey: row.placeKey, groupName: row.name },
    })
  }
  for (const place of data.inbox?.places ?? []) {
    for (const topic of place.topics) {
      add({
        key: `topic:${topic.sessionId}`, group: '话题', icon: 'steps',
        label: topic.title, sub: place.conversationKind === 'direct' ? `和${place.groupName}的私聊` : place.groupName,
        target: { kind: 'topic', sessionId: topic.sessionId },
      })
    }
  }
  for (const goal of data.board?.goals ?? []) {
    const name = goal.row?.what ?? goalTitleOf(goal.goalRef)
    add({
      key: `goal:${goal.goalRef}`, group: '目标', icon: 'target', label: name,
      sub: `${String(goal.counts.open)} 在跟${goal.counts.overdue > 0 ? ` · ${String(goal.counts.overdue)} 逾期` : ''}`,
      target: { kind: 'goal', goalRef: goal.goalRef, goalName: name },
    })
  }
  for (const row of data.board?.rows ?? []) {
    if (row.isGoal !== undefined && row.goalRef === undefined) continue
    if (row.status !== 'open') continue
    const who = row.executorKind === 'agent' ? AGENT : row.who
    add({
      key: `commitment:${row.id}`, group: '承诺', icon: 'check', label: row.what,
      sub: [row.direction === 'owed-to-me' ? `${who}欠你` : row.direction === 'mine' ? '你欠的' : who, row.due?.text].filter(Boolean).join(' · '),
      target: { kind: 'commitment', id: row.id, title: row.what },
    })
  }
  for (const row of data.artifacts ?? []) {
    const ref = artifactRefOf({ uri: row.uri, title: row.title })
    add({
      key: `artifact:${row.uri}`, group: '产出', icon: 'doc', label: ref.title,
      ...(row.from === undefined ? {} : { sub: `来自「${row.from.label}」` }),
      target: { kind: 'artifact', row },
    })
  }
  return items
}

/**
 * 按输入筛：每个词都要命中（「财务 对账」= 既有财务又有对账）。空着的时候不摊开整本：
 * 只给要你的、去哪、最近的几个地方——隐身档下连地方都不给。
 */
export function matchPalette(items: readonly PaletteItem[], query: string, stealth = false): readonly PaletteItem[] {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(word => word !== '')
  const hits = words.length === 0
    ? items.filter((item) => {
      if (stealth) return item.group === '去哪'
      return item.group === '要你' || item.group === '去哪'
    }).concat(stealth ? [] : items.filter(item => item.group === '地方').slice(0, 5))
    : items.filter(item => words.every(word => item.hay.includes(word)))
  return [...hits].sort((left, right) => GROUPS.indexOf(left.group) - GROUPS.indexOf(right.group)).slice(0, 60)
}

/** 去那儿：和左栏、承诺页里点下去是同一个落点。 */
function go(target: PaletteTarget): void {
  openPalette('closed')
  switch (target.kind) {
    case 'need': jumpToNeed(target.need); return
    case 'topic': setFrame({ kind: 'session' }); openSessionNow(target.sessionId); return
    case 'place': setFrame({ kind: 'place', placeKey: target.placeKey, groupName: target.groupName }); return
    case 'board': setFrame({ kind: 'board' }); return
    case 'judg': pushFrame({ kind: 'judg' }, 0); return
    case 'help': openPalette('help'); return
    case 'goal': pushFrame({ kind: 'goal', goalRef: target.goalRef, goalName: target.goalName }, 0); return
    case 'commitment':
      setFrame({ kind: 'board' })
      setSpotlight({ kind: 'commitment', id: target.id, title: target.title })
      return
    case 'artifact': {
      const ref = artifactRefOf({ uri: target.row.uri, title: target.row.title, ...(target.row.from === undefined ? {} : { from: target.row.from }) })
      if (ref.fileId !== undefined) { openPreview({ ...ref, fileId: ref.fileId }); return }
      const href = safeHref(target.row.uri)
      if (href !== undefined) { window.open(href, '_blank', 'noopener,noreferrer'); return }
      if (target.row.from !== undefined) goToOrigin(target.row.from)
    }
  }
}

function ItemIcon(props: { icon: PaletteItem['icon'] }): ReactNode {
  if (props.icon === 'agent') return <AgentFace size={18} />
  if (props.icon === 'need') return <span className={css.needDot} />
  return <Icon name={props.icon} size={15} />
}

function Search(props: { inject: SurfaceInject }): ReactNode {
  const { inject } = props
  const [query, setQuery] = useState('')
  const [data, setData] = useState<PaletteData>({})
  const [at, setAt] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([inject.inbox(), inject.board(), inject.artifacts()]).then(([inbox, board, artifacts]) => {
      if (alive) setData({ ...(inbox === undefined ? {} : { inbox }), board, artifacts })
    })
    return () => { alive = false }
  }, [inject])

  const items = useMemo(() => paletteItems(data), [data])
  const hits = useMemo(() => matchPalette(items, query, data.inbox?.stealth === true), [items, query, data.inbox?.stealth])
  useEffect(() => { setAt(0) }, [query])
  useEffect(() => {
    listRef.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setAt(value => Math.min(hits.length - 1, value + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setAt(value => Math.max(0, value - 1)) }
    if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[at]
      if (hit !== undefined) go(hit.target)
    }
    if (event.key === 'Escape') { event.preventDefault(); openPalette('closed') }
  }

  let lastGroup: PaletteGroup | undefined
  return (
    <div className={css.panel} role="dialog" aria-label="跳到…" onClick={(event) => { event.stopPropagation() }}>
      <div className={css.inputRow}>
        <Icon name="search" size={16} className={css.inputIcon} />
        <input
          className={css.input}
          value={query}
          autoFocus
          placeholder="跳到群、人、话题、承诺、目标、文件…"
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={onKey}
        />
        <kbd className={css.kbd}>Esc</kbd>
      </div>
      <div className={css.list} ref={listRef} role="listbox">
        {hits.length === 0
          ? <div className={css.empty}>{query.trim() === '' ? '正在读…' : `没有带「${query.trim()}」的。`}</div>
          : hits.map((hit, index) => {
            const head = hit.group !== lastGroup ? hit.group : undefined
            lastGroup = hit.group
            return (
              <div key={hit.key}>
                {head !== undefined && <div className={css.group}>{head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === at}
                  {...(index === at ? { 'data-on': '1' } : {})}
                  className={`${css.item} ${index === at ? css.itemOn : ''}`}
                  onMouseMove={() => { if (index !== at) setAt(index) }}
                  onClick={() => { go(hit.target) }}
                >
                  <span className={css.icon}><ItemIcon icon={hit.icon} /></span>
                  <span className={css.label}>{hit.label}</span>
                  {hit.sub !== undefined && <span className={css.sub}>{hit.sub}</span>}
                  {index === at && <span className={css.enter}>⏎</span>}
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
}

function KeyHelp(): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); openPalette('closed') }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])
  return (
    <div className={`${css.panel} ${css.help}`} role="dialog" aria-label="快捷键" onClick={(event) => { event.stopPropagation() }}>
      <div className={css.helpHead}>快捷键</div>
      <dl className={css.keys}>
        {KEYMAP.map(entry => (
          <div className={css.keyRow} key={entry.keys}>
            <dt className={css.keyKeys}>
              {entry.keys.split(/\s+/u).filter(key => key !== '').map(key => <kbd className={css.kbd} key={key}>{key}</kbd>)}
            </dt>
            <dd className={css.keyDoes}>{entry.does}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export interface PaletteProps {
  inject: SurfaceInject
}

export function YzjPalette(props: PaletteProps): ReactNode {
  const mode = useSyncExternalStore(subscribePalette, paletteMode)
  const close = useCallback((): void => { openPalette('closed') }, [])
  useEffect(() => {
    window.addEventListener('keydown', onGlobalKey)
    return () => { window.removeEventListener('keydown', onGlobalKey) }
  }, [])
  if (mode === 'closed') return null
  return (
    <div className={`${tokens.tokens} ${css.mask}`} onClick={close}>
      {mode === 'help' ? <KeyHelp /> : <Search inject={props.inject} />}
    </div>
  )
}
