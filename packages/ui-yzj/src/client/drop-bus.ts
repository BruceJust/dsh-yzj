/**
 * Drop bus between the yzj panel and the composer dock: dropping a yzj item
 * ANYWHERE on the panel emits a drop request; the session's composer dock
 * (which owns the scoped insert-reference verb) picks it up and mints the
 * same ☁ reference chip an '@' pick or a direct band drop would. Single-slot
 * bus: exactly one composer is active per session view.
 */
import type { YzjDragRef } from './panel.tsx'

type Listener = (ref: YzjDragRef) => void

let listener: Listener | null = null

/** Subscribe the active composer dock; returns the disposer. */
export function onYzjDropRequest(callback: Listener): () => void {
  listener = callback
  return () => {
    if (listener === callback) listener = null
  }
}

/** Emit one panel-side drop; no-op when no composer is listening. */
export function emitYzjDropRequest(ref: YzjDragRef): void {
  if (listener !== null) listener(ref)
}
