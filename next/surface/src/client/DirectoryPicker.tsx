/**
 * Choosing a local working directory.
 *
 * A local session has to run somewhere, and replacing `sidebar.workspaces`
 * took the host's only entry for saying where. This is that entry, put back.
 *
 * Two routes, because hosts compose two different capabilities and a client
 * cannot know which it got until it asks:
 *
 * - **native** — `pickDirectory()` opens the operating system's own dialog.
 *   That is what THIS deployment serves, and it is the better route when it
 *   exists. It is also invisible from inside the browser: the dialog opens on
 *   the machine, and the promise simply does not settle until somebody there
 *   answers it. So the button that triggers it says so and stays cancellable —
 *   a control that might never return must never look merely slow.
 * - **browse** — `listDirectory()` walks the host filesystem in-page. Hosts
 *   composed with the `browse` capability serve this one; ours answers
 *   `directory-picker-unavailable`, which is exactly why it is a fallback and
 *   not the plan.
 *
 * And under both, a plain path field. It works when neither capability does,
 * which is the difference between a feature that degrades and one that dies.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import tokens from './tokens.module.css'
import css from './contract.module.css'
import picker from './picker.module.css'

/** One directory level, as the host's browse capability returns it. */
export interface DirectoryLevel {
  path: string
  home: string
  crumbs: { name: string; path: string }[]
  entries: { name: string; path: string; hidden: boolean }[]
  truncated: boolean
}

export interface DirectoryPickerProps {
  /** The host's `browse` capability, when it composed one. */
  listDirectory?(path?: string): Promise<DirectoryLevel | undefined>
  /** The host's `native` capability, when it composed one. */
  pickDirectory?(): Promise<string | null>
  /** Register the chosen directory and open a session in it. */
  choose(path: string): Promise<void>
  close(): void
}

export function YzjDirectoryPicker(props: DirectoryPickerProps): ReactNode {
  const { listDirectory, pickDirectory, choose, close } = props
  const [level, setLevel] = useState<DirectoryLevel | undefined>(undefined)
  const [browseError, setBrowseError] = useState('')
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [waitingNative, setWaitingNative] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  const load = useCallback((path?: string): void => {
    if (listDirectory === undefined) return
    void listDirectory(path)
      .then((next) => {
        if (next !== undefined) {
          setLevel(next)
          setBrowseError('')
        }
      })
      .catch((cause: unknown) => {
        setBrowseError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [listDirectory])

  useEffect(() => { load() }, [load])

  const use = useCallback((path: string): void => {
    setBusy(true)
    setError('')
    void choose(path)
      .then(close)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setBusy(false) })
  }, [choose, close])

  const entries = (level?.entries ?? []).filter(entry => showHidden || !entry.hidden)
  const canBrowse = level !== undefined

  return (
    <div className={`${tokens.tokens} ${css.mask}`} onClick={close}>
      <div
        className={`${css.panel} ${picker.panel}`}
        role="dialog"
        aria-label="选择本地工作目录"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.head}>
          <span className={css.avatar}>▢</span>
          <span>
            <div className={css.title}>选择本地工作目录</div>
            <div className={css.sub}>本地会话在这个目录里跑；云之家话题不受影响</div>
          </span>
          <button type="button" className={css.close} onClick={close} aria-label="关闭">×</button>
        </div>

        {pickDirectory !== undefined && (
          <div className={picker.native}>
            <button
              type="button"
              className={picker.use}
              disabled={busy || waitingNative}
              onClick={() => {
                setWaitingNative(true)
                setError('')
                void pickDirectory()
                  .then((path) => { if (path !== null) use(path) })
                  .catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  })
                  .finally(() => { setWaitingNative(false) })
              }}
            >
              用系统对话框选…
            </button>
            <span className={picker.nativeNote}>
              {waitingNative
                ? '系统的文件夹对话框已经弹在这台机器上了——去那边选，或者在下面直接填路径。'
                : '对话框会开在跑 dsh 的那台机器上，不是这个浏览器里。'}
            </span>
          </div>
        )}

        {canBrowse && (
          <>
            <div className={picker.crumbs}>
              {(level?.crumbs ?? []).map(crumb => (
                <button
                  type="button"
                  key={crumb.path}
                  className={picker.crumb}
                  onClick={() => { load(crumb.path) }}
                >
                  {crumb.name}
                </button>
              ))}
              <button
                type="button"
                className={picker.hidden}
                onClick={() => { setShowHidden(value => !value) }}
              >
                {showHidden ? '隐藏点开头的' : '显示点开头的'}
              </button>
            </div>
            <div className={picker.list}>
              {entries.length === 0 && <div className={picker.calm}>这个目录里没有子目录。</div>}
              {entries.map(entry => (
                <button
                  type="button"
                  key={entry.path}
                  className={picker.entry}
                  onClick={() => { load(entry.path) }}
                >
                  <span className={picker.folder}>▸</span>
                  <span className={picker.entryName}>{entry.name}</span>
                </button>
              ))}
              {level?.truncated === true && (
                <div className={picker.calm}>目录太多，只列出了前一部分。</div>
              )}
            </div>
          </>
        )}

        {!canBrowse && browseError !== '' && (
          <div className={picker.note}>
            这台宿主没装目录浏览能力（{browseError.split(':').pop()?.trim()}）。
            用上面的系统对话框，或者直接填绝对路径。
          </div>
        )}

        {error !== '' && <div className={picker.error}>{error}</div>}

        <div className={picker.foot}>
          <input
            className={picker.path}
            value={typed}
            placeholder={level?.path ?? '/Users/you/project'}
            spellCheck={false}
            onChange={(event) => { setTyped(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && typed.trim() !== '') use(typed.trim())
            }}
          />
          <button
            type="button"
            className={picker.use}
            disabled={busy || (typed.trim() === '' && level === undefined)}
            onClick={() => { use(typed.trim() === '' ? level?.path ?? '' : typed.trim()) }}
          >
            {busy ? '打开中…' : '用这个目录'}
          </button>
        </div>
      </div>
    </div>
  )
}
