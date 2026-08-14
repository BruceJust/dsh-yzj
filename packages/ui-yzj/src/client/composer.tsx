/**
 * Composer-side Yunzhijia seat: `conversation.input.dock`. The drop UX now
 * lives in the PANEL (a full-viewport overlay while a yzj drag is in
 * flight — drag anywhere, not just a small band). This dock owns the
 * session-scoped insert-reference verb: panel-side drops arrive through the
 * drop bus and mint the same ☁ reference chip an '@' pick would.
 * - The '@' menu itself is provided by input-source.ts (the trigger
 *   pipeline); this package registers no tool-row button.
 */
import { useEffect } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InsertReferenceRequest } from '@deepseek-ai/dsh-client-ui-input-trigger/src/types.ts'
import type { YzjDragRef } from './panel.tsx'
import { SOURCE_NAME, encodeRef } from './input-source.ts'
import { onYzjDropRequest } from './drop-bus.ts'

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
 * The composer dock: subscribes to the drop bus (the panel emits on any
 * yzj drop anywhere on screen) and mints the ☁ reference chip.
 */
export function YzjComposerDock(props: PropsRuntime<'conversation.input.dock'> & YzjDropInjected) {
  useEffect(() => {
    return onYzjDropRequest((ref) => props.insertReference(ref))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
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
