/**
 * Composer-side Yunzhijia seats:
 * - `conversation.input.dock`: the drop band above the composer card.
 *   Dragging a workspace/doc/group/event/contact/message from the panel
 *   inserts a reference CHIP (not plain text) into the draft via the scoped
 *   insert-reference event; the chip carries context through the source
 *   codec on send. Registered here (not `conversation.composer.dock`) so the
 *   drop target exists in the hero phase too — a brand-new session otherwise
 *   has nowhere to drop.
 *   The band is invisible at rest: a window-level dragenter with the yzj
 *   drag mime makes it appear, so the composer stays clean until a real
 *   drag is in flight (no persistent "拖到这里" hint strip).
 * - The '@' menu itself is provided by input-source.ts (the trigger
 *   pipeline); this package registers no tool-row button.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InsertReferenceRequest } from '@deepseek-ai/dsh-client-ui-input-trigger/src/types.ts'
import { YZJ_DRAG_MIME, YzjCloudIcon, type YzjDragRef } from './panel.tsx'
import { SOURCE_NAME, encodeRef } from './input-source.ts'
import css from './composer.module.css'

/** Injected drop actions: mint a chip from a drag ref (session-scoped). */
export interface YzjDropInjected {
  /**
   * Insert a reference chip at the end of the draft. The span is resolved
   * from the live input store at call time (component snapshots are
   * point-in-time and stale), so no span crosses the inject boundary.
   */
  insertReference: (ref: YzjDragRef) => void
  /** Insert plain instruction text at the end of the draft (quick actions). */
  insertText: (text: string) => void
}

/** Quick instructions offered after a drop (design v1.6 §5.2 req. 4). */
const QUICK_ACTIONS: readonly { label: string; text: string }[] = [
  { label: '让 agent 总结', text: '请总结上面引用的云之家内容，给出要点' },
  { label: '起草回复', text: '基于上面引用的内容起草回复' },
  { label: '沉淀知识库', text: '把上面引用的内容整理成文档存入知识库' },
]

/**
 * The drop band above the composer card. Invisible at rest; a window-level
 * dragenter carrying the yzj mime reveals it ("松开以插入云之家引用"), and
 * dropping mints a reference chip plus a reminder banner (count + quick
 * instructions) so 拖入 → 指令 collapses into one step.
 */
export function YzjComposerDock(props: PropsRuntime<'conversation.input.dock'> & YzjDropInjected) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dropped, setDropped] = useState(0)
  const depth = useRef(0)

  // Reveal the band while any yzj drag is in flight, wherever it crosses the
  // window; hide it when the drag ends or leaves the window entirely.
  useEffect(() => {
    const onEnter = (event: DragEvent): void => {
      if (event.dataTransfer !== null && event.dataTransfer.types.includes(YZJ_DRAG_MIME)) {
        depth.current += 1
        setArmed(true)
      }
    }
    const onLeave = (event: DragEvent): void => {
      // relatedTarget stays set while moving between elements inside the
      // window; it is null only when the cursor leaves the document.
      if (event.relatedTarget === null) {
        depth.current = 0
        setArmed(false)
      }
    }
    const onEnd = (): void => {
      depth.current = 0
      setArmed(false)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onEnd)
    window.addEventListener('dragend', onEnd)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onEnd)
      window.removeEventListener('dragend', onEnd)
    }
  }, [])

  const onDrop = (event: React.DragEvent): void => {
    depth.current = 0
    setArmed(false)
    if (busy) return
    const raw = event.dataTransfer.getData(YZJ_DRAG_MIME)
    if (raw === '') return
    let ref: YzjDragRef | undefined
    try {
      const parsed = JSON.parse(raw) as YzjDragRef
      if (typeof parsed.kind === 'string' && typeof parsed.title === 'string') ref = parsed
    } catch {
      ref = undefined
    }
    if (ref === undefined) return
    setBusy(true)
    props.insertReference(ref)
    setDropped(count => count + 1)
    setTimeout(() => { setBusy(false) }, 60)
  }

  return (
    <div>
      {armed && (
        <div
          className={css.dropBand}
          onDragOver={(event) => { event.preventDefault() }}
          onDrop={(event) => {
            event.preventDefault()
            onDrop(event)
          }}
        >
          <YzjCloudIcon size={13} />
          <span>松开以插入云之家引用</span>
        </div>
      )}
      {dropped > 0 && (
        <div className={css.reminder} role="status">
          <div className={css.reminderHead}>
            <YzjCloudIcon size={13} />
            <span>已引用 {dropped} 条云之家内容，输入指令让 agent 处理，或：</span>
          </div>
          <div className={css.quickRow} role="group" aria-label="快捷处理">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.label}
                type="button"
                className={css.quickButton}
                onClick={() => {
                  props.insertText(action.text)
                  setDropped(0)
                }}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className={css.quickDismiss}
              onClick={() => { setDropped(0) }}
              aria-label="收起提醒"
            >
              收起
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Build the scoped insert-reference payload for a drag ref. */
export function dragInsertRequest(ref: YzjDragRef, span: { start: number; end: number; draftRev: number }): InsertReferenceRequest {
  return {
    reference: {
      source: SOURCE_NAME,
      ref: encodeRef(ref),
      label: `☁ ${ref.title}`,
      clipboardText: `【云之家·${ref.kind === 'doc' ? '文档' : ref.kind === 'group' ? '会话' : ref.kind === 'event' ? '日程' : ref.kind === 'contact' ? '联系人' : ref.kind === 'message' ? '消息' : '知识库'}】${ref.title}`,
    },
    span,
  }
}
