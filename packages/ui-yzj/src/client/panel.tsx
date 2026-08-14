/**
 * The Yunzhijia workspace panel: a frame overlay with four tabs — 知识库
 * (workspace → doc tree), 日程 (today), 会话 (recent groups → messages), and
 * 我的 (whoami + directory search). Rendering stays presentational: data
 * arrives through the injected fetch face and the shared store; verbs are the
 * injected face and store actions.
 */
import { useEffect, useState } from 'react'
import type { BakedActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { YzjPanelActions, YzjPanelState, YzjTab } from './stores.ts'
import type { YzjPanelInject } from './rpc.ts'
import css from './panel.module.css'

/** The props shares the panel reads. */
export interface YzjPanelProps extends YzjPanelInject {
  useStore: <R>(selector: (state: YzjPanelState) => R) => R
  actions: BakedActions<YzjPanelState, YzjPanelActions>
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id
}

const TABS: { key: YzjTab; label: string }[] = [
  { key: 'docs', label: '知识库' },
  { key: 'calendar', label: '日程' },
  { key: 'chat', label: '会话' },
  { key: 'me', label: '我的' },
]

/** The sidebar-foot toggle; label and open state ride the store shares. */
export interface YzjPanelButtonProps {
  useStore: <R>(selector: (state: YzjPanelState) => R) => R
  actions: BakedActions<YzjPanelState, YzjPanelActions>
}

/** The sidebar-foot Yunzhijia toggle. */
export function YzjPanelButton(props: YzjPanelButtonProps) {
  const open = props.useStore(state => state.open)
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => { props.actions.setOpen(!open) }}
      title="云之家"
    >
      <span>云之家</span>
    </button>
  )
}

/** Load one tab's data into the store through the fetch face. */
function loadTab(
  tab: YzjTab,
  props: YzjPanelProps,
): void {
  const fail = (error: unknown): void => {
    props.actions.setError(typeof error === 'string' ? error : '加载失败')
    props.actions.setLoading(false)
  }
  props.actions.setLoading(true)
  props.actions.setError('')
  if (tab === 'docs') {
    void props.fetchWorkspaces().then((result) => {
      if (result.ok) {
        props.actions.setWorkspaces(asArray(result.value))
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  } else if (tab === 'calendar') {
    const today = new Date().toISOString().slice(0, 10)
    void props.fetchEvents(today, today).then((result) => {
      if (result.ok) {
        props.actions.setEvents(asArray(result.value))
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  } else if (tab === 'chat') {
    void props.fetchGroups(50).then((result) => {
      if (result.ok) {
        props.actions.setGroups(asArray(asRecord(result.value).list))
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  } else {
    void props.fetchWhoami().then((result) => {
      if (result.ok) {
        const users = asArray(result.value)
        props.actions.setMe(users[0] ?? {})
        props.actions.setLoading(false)
      } else fail(result.error.message)
    })
  }
}

/** The frame-overlay Yunzhijia panel; renders null while closed. */
export function YzjPanel(props: YzjPanelProps) {
  const open = props.useStore(state => state.open)
  const tab = props.useStore(state => state.tab)
  const [keyword, setKeyword] = useState('')
  const state = props.useStore(s => s)

  useEffect(() => {
    if (!open) return
    loadTab(tab, props)
    // tab switches and opens are the load triggers; state reads inside the
    // loader come from the snapshot taken at effect time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  if (!open) return null

  const openWorkspace = (id: string): void => {
    props.actions.setWorkspaceId(id)
    props.actions.setLoading(true)
    void props.fetchDocs(id).then((result) => {
      if (result.ok) {
        props.actions.setDocs(asArray(result.value))
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  const openGroup = (id: string): void => {
    props.actions.setGroupId(id)
    props.actions.setLoading(true)
    void props.fetchMessages(id, 20).then((result) => {
      if (result.ok) {
        props.actions.setMessages(asArray(asRecord(result.value).list))
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  const runSearch = (): void => {
    if (keyword.trim() === '') return
    props.actions.setLoading(true)
    void props.fetchSearch(keyword.trim()).then((result) => {
      if (result.ok) {
        props.actions.setSearchResults(asArray(result.value))
      } else {
        props.actions.setError(result.error.message)
      }
      props.actions.setLoading(false)
    })
  }

  return (
    <div className={css.panel} role="dialog" aria-label="云之家">
      <header className={css.header}>
        <span className={css.title}>云之家</span>
        <nav className={css.tabs}>
          {TABS.map(item => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => { props.actions.setTab(item.key) }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={css.headerButton}
          onClick={() => { loadTab(tab, props) }}
          disabled={state.loading}
          aria-label="刷新"
        >
          刷新
        </button>
        <button
          type="button"
          className={css.headerButton}
          onClick={() => { props.actions.setOpen(false) }}
          aria-label="关闭"
        >
          关闭
        </button>
      </header>

      {state.error !== '' && <div className={css.error}>{state.error}</div>}
      {state.loading && <div className={css.loading}>加载中…</div>}

      {tab === 'docs' && (
        <div className={css.body}>
          {state.workspaceId === '' ? (
            <div className={css.list}>
              {state.workspaces.length === 0 && !state.loading && <div className={css.empty}>暂无知识库</div>}
              {state.workspaces.map((item, index) => {
                const ws = asRecord(item)
                const count = typeof ws.docCount === 'number' ? ws.docCount : 0
                return (
                  <button key={`w${index}`} type="button" className={css.item} onClick={() => { openWorkspace(asString(ws.id)) }}>
                    <span className={css.itemTitle}>{asString(ws.name)}</span>
                    <span className={css.itemSub}>{shortId(asString(ws.id))} · 文档 {count}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className={css.list}>
              <button type="button" className={css.back} onClick={() => { props.actions.setWorkspaceId('') }}>← 返回知识库</button>
              {state.docs.length === 0 && !state.loading && <div className={css.empty}>暂无文档</div>}
              {state.docs.map((item, index) => {
                const node = asRecord(item)
                const suffix = asString(node.fileSuffix)
                return (
                  <button key={`d${index}`} type="button" className={css.item} onClick={() => { window.open(asString(node.openWebUrl), '_blank', 'noreferrer') }}>
                    <span className={css.itemTitle}>{asString(node.title)}</span>
                    <span className={css.itemSub}>{suffix === 'dbt' ? '多维表格' : '在线文档'} · {asString(node.updateTime).slice(0, 10)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'calendar' && (
        <div className={css.body}>
          <div className={css.list}>
            {state.events.length === 0 && !state.loading && <div className={css.empty}>今日暂无日程</div>}
            {state.events.map((item, index) => {
              const event = asRecord(item)
              const clock = (ms: unknown): string => {
                if (typeof ms !== 'number') return ''
                const date = new Date(ms)
                const pad = (n: number): string => String(n).padStart(2, '0')
                return `${pad(date.getHours())}:${pad(date.getMinutes())}`
              }
              const start = clock(event.startDate)
              const end = clock(event.endDate)
              return (
                <div key={`e${index}`} className={css.item}>
                  <span className={css.itemTitle}>{asString(event.title)}</span>
                  <span className={css.itemSub}>{start === '' ? '' : `${start}${end === '' ? '' : ` → ${end}`}`}{asString(event.personName) === '' ? '' : ` · ${asString(event.personName)}`}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <div className={css.body}>
          {state.groupId === '' ? (
            <div className={css.list}>
              {state.groups.length === 0 && !state.loading && <div className={css.empty}>暂无最近会话</div>}
              {state.groups.map((item, index) => {
                const group = asRecord(item)
                const unread = typeof group.unreadCount === 'number' ? group.unreadCount : 0
                const last = asString(asRecord(group.lastMsg).content)
                return (
                  <button key={`g${index}`} type="button" className={css.item} onClick={() => { openGroup(asString(group.groupId)) }}>
                    <span className={css.itemTitle}>
                      {asString(group.groupName)}
                      {unread > 0 && <span className={css.badge}>{unread}</span>}
                    </span>
                    <span className={css.itemSub}>{last.replace(/\s+/g, ' ').slice(0, 40)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className={css.list}>
              <button type="button" className={css.back} onClick={() => { props.actions.setGroupId('') }}>← 返回会话</button>
              {state.messages.map((item, index) => {
                const message = asRecord(item)
                const content = asString(message.content)
                return (
                  <div key={`m${index}`} className={css.item}>
                    <span className={css.itemTitle}>{content === '' ? '(文件/图片消息)' : content}</span>
                    <span className={css.itemSub}>{asString(message.sendTime).slice(5, 16)} · {asString(message.fromOpenId)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'me' && (
        <div className={css.body}>
          <div className={css.searchRow}>
            <input
              className={css.searchInput}
              value={keyword}
              onChange={(event) => { setKeyword(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }}
              placeholder="搜索同事…"
            />
            <button type="button" className={css.headerButton} onClick={runSearch}>搜索</button>
          </div>
          {(() => {
            const me = asRecord(state.me)
            if (Object.keys(me).length === 0) return null
            const photo = asString(me.photoUrl)
            return (
              <div className={css.meCard}>
                {photo !== ''
                  ? <img className={css.meAvatar} src={photo} alt="" />
                  : <span className={css.meAvatarFallback}>{asString(me.name).slice(0, 1)}</span>}
                <div className={css.meInfo}>
                  <div className={css.meName}>{asString(me.name)}</div>
                  <div className={css.meSub}>
                    {[asString(me.department), asString(me.jobTitle), asString(me.jobNo) === '' ? '' : `工号 ${asString(me.jobNo)}`].filter(part => part !== '').join(' · ')}
                  </div>
                </div>
              </div>
            )
          })()}
          <div className={css.list}>
            {state.searchResults.map((item, index) => {
              const user = asRecord(item)
              const openId = asString(user.oId ?? user.openId)
              return (
                <div key={`s${index}`} className={css.item}>
                  <span className={css.itemTitle}>{asString(user.name)}</span>
                  <span className={css.itemSub}>{[asString(user.department), asString(user.jobTitle), shortId(openId)].filter(part => part !== '').join(' · ')}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
