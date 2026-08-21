/**
 * Narrow accessors for reading `JsonValue` payloads off the log. Everything
 * that comes back from a log line is untyped by construction (the log outlives
 * the build that wrote it), so readers coerce defensively rather than assert.
 */

import type { JsonValue } from './types.ts'

/** The value as a plain object, or undefined for anything else. */
export function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (Array.isArray(value)) return undefined
  return value as Record<string, JsonValue>
}

/** The value as a non-empty string, or undefined. */
export function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The value as a finite number, or undefined. */
export function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The value as a string array, dropping non-string members. */
export function asStringArray(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/** The value as an object reference, or undefined when either half is missing. */
export function asObjectRef(value: JsonValue | undefined): { kind: string; id: string } | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const kind = asString(record.kind)
  const id = asString(record.id)
  return kind === undefined || id === undefined ? undefined : { kind, id }
}
