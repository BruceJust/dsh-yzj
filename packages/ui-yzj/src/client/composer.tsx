/**
 * Composer-side Yunzhijia seats:
 * - `conversation.composer.dock`: the drop band under the composer card.
 *   Dragging a workspace/doc/group/event/contact/message from the floating
 *   panel here inserts a reference CHIP (not plain text) into the draft via
 *   the scoped insert-reference event; the chip carries context through the
 *   source codec on send.
 * - The '@' menu itself is provided by input-source.ts (the trigger
 *   pipeline); this package registers no tool-row button.
 */
import { useRef, useState } from 'react'
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
}

/**
 * The drop band under the composer card. Idle it is a slim hint; while a
 * yzj drag hovers it expands and invites the drop.
 */
export function YzjComposerDock(props: PropsRuntime<'conversation.composer.dock'> & YzjDropInjected) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const depth = useRef(0)

  const onDragEnter = (event: React.DragEvent): void => {
    if (event.dataTransfer.types.includes(YZJ_DRAG_MIME)) {
      depth.current += 1
      setArmed(true)
    }
  }
  const onDragLeave = (): void => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setArmed(false)
  }
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
    setTimeout(() => { setBusy(false) }, 60)
  }

  return (
    <div
      className={armed ? `${css.dropBand} ${css.dropBandArmed}` : css.dropBand}
      onDragEnter={onDragEnter}
      onDragOver={(event) => { event.preventDefault() }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault()
        onDrop(event)
      }}
    >
      <YzjCloudIcon size={13} />
      <span>{armed ? '松开以插入云之家卡片' : '把云之家内容拖到这里，以卡片插入上下文'}</span>
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
