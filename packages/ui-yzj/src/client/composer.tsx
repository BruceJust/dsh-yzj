/**
 * Composer-side Yunzhijia seats:
 * - `conversation.input.dock`: the drop band above the composer card.
 *   Dragging a workspace/doc/group/event/contact/message inserts a reference
 *   CHIP (not plain text) into the draft via the scoped insert-reference
 *   event — exactly what an '@' pick produces. Drops can land either on this
 *   band or ANYWHERE on the yzj panel itself (the panel emits through the
 *   drop bus; this dock owns the scoped insert verb and mints the chip).
 *   Registered here (not `conversation.composer.dock`) so the drop target
 *   exists in the hero phase too — a brand-new session otherwise has nowhere
 *   to drop. The band is invisible at rest and appears only while a yzj drag
 *   is in flight.
 * - The '@' menu itself is provided by input-source.ts (the trigger
 *   pipeline); this package registers no tool-row button.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InsertReferenceRequest } from '@deepseek-ai/dsh-client-ui-input-trigger/src/types.ts'
import { YZJ_DRAG_MIME, YzjCloudIcon, type YzjDragRef } from './panel.tsx'
import { SOURCE_NAME, encodeRef } from './input-source.ts'
import { onYzjDropRequest } from './drop-bus.ts'
import css from './composer.module.css'

/** Injected drop action: mint a chip from a drag ref (session-scoped). */
export interface YzjDropInjected {
  /**
   * Insert a reference chip at the end of the draft. The span is resolved
   * from the live input store at call time (component snapshots are
   * point-in-time and stale), so no span crosses the inject boundary.
   */
  insertReference: (ref: YzjDragRef) => void
}

/**
 * The drop band above the composer card. Invisible at rest; a window-level
 * dragenter carrying the yzj mime reveals it ("松开以插入云之家引用"), and
 * dropping (here or anywhere on the yzj panel via the drop bus) mints a
 * ☁ reference chip — no extra cards or buttons, just agent context.
 */
export function YzjComposerDock(props: PropsRuntime<'conversation.input.dock'> & YzjDropInjected) {
  const [armed, setArmed] = useState(false)
  const depth = useRef(0)

  // Panel-side drops arrive through the bus; mint the same chip.
  useEffect(() => {
    return onYzjDropRequest((ref) => props.insertReference(ref))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    props.insertReference(ref)
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
