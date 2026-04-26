// packages/lib/src/timeline/legacy-snapshot.ts

import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import {
  TIMELINE_SNAPSHOT_ARRAY_LIMIT,
  TIMELINE_SNAPSHOT_BODY_LIMIT,
  TIMELINE_SNAPSHOT_LABEL_LIMIT,
  type TimelineFieldChangeSnapshot,
  type TimelineFieldChangeSnapshotValue,
  truncateForSnapshot,
} from './field-change-snapshot'

/**
 * Best-effort, DB-free conversion of a raw `TypedFieldValue` (or array, or
 * legacy raw shape) into a `TimelineFieldChangeSnapshot` so that timeline
 * rows that pre-date the snapshot system still render sensibly.
 *
 * - Pure: no async, no DB, no cache. Safe to use in client code as a fallback.
 * - Best-effort: when the source carries no denormalized label (e.g.,
 *   relationship without `displayName`), the snapshot's `label` falls back
 *   to the recordId/optionId/actorId. This is the price of pre-snapshot rows.
 *
 * Pass `fieldType` when available so the resolver can pick the right kind
 * for empty / wrapped / scalar inputs. When `fieldType` is missing the
 * resolver still attempts a structural unwrap.
 */
export function legacyTypedFieldValueToSnapshot(
  value: unknown,
  fieldType?: string
): TimelineFieldChangeSnapshotValue {
  if (value === null || value === undefined) return null

  // Multi-value: legacy rows store arrays for MULTI_SELECT, TAGS, RELATIONSHIP, FILE,
  // multi-ACTOR, and any opt-in `multi: true` scalar field.
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    const slice = value.slice(0, TIMELINE_SNAPSHOT_ARRAY_LIMIT)
    return slice
      .map((v) => unwrapSingle(v, fieldType))
      .filter((s): s is TimelineFieldChangeSnapshot => s !== null)
  }

  return unwrapSingle(value, fieldType)
}

function unwrapSingle(value: unknown, fieldType?: string): TimelineFieldChangeSnapshot | null {
  if (value === null || value === undefined) return null

  // Wrapped TypedFieldValue — discriminated by `type`.
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const v = value as { type: string } & Record<string, unknown>
    switch (v.type) {
      case 'text':
        return textSnapshot(String(v.value ?? ''))
      case 'number':
        return numberSnapshot(Number(v.value ?? 0))
      case 'boolean':
        return { kind: 'boolean', value: Boolean(v.value) }
      case 'date':
        return dateSnapshot(String(v.value ?? ''), fieldType)
      case 'option': {
        const optionId = String(v.optionId ?? '')
        const labelRaw = typeof v.label === 'string' ? v.label : optionId
        const [label] = truncateForSnapshot(labelRaw, TIMELINE_SNAPSHOT_LABEL_LIMIT)
        const color = typeof v.color === 'string' ? v.color : undefined
        return { kind: 'option', optionId, label, ...(color ? { color } : {}) }
      }
      case 'relationship': {
        const recordId = String(v.recordId ?? '')
        const displayName = typeof v.displayName === 'string' ? v.displayName : recordId
        const [label] = truncateForSnapshot(displayName, TIMELINE_SNAPSHOT_LABEL_LIMIT)
        return {
          kind: 'relationship',
          recordId: recordId as RecordId,
          label,
          entityType: null,
        }
      }
      case 'actor': {
        const actorIdRaw = typeof v.actorId === 'string' ? v.actorId : ''
        const actorType = v.actorType === 'group' ? ('group' as const) : ('user' as const)
        const displayName =
          typeof v.displayName === 'string'
            ? v.displayName
            : typeof v.id === 'string'
              ? v.id
              : actorIdRaw
        const [label] = truncateForSnapshot(displayName, TIMELINE_SNAPSHOT_LABEL_LIMIT)
        return {
          kind: 'actor',
          actorId: actorIdRaw as ActorId,
          actorType,
          label,
        }
      }
      case 'json':
        return jsonSnapshot(v.value as Record<string, unknown> | undefined)
      default:
        return null
    }
  }

  // Bare primitives — legacy or non-typed payloads.
  if (typeof value === 'boolean') return { kind: 'boolean', value }
  if (typeof value === 'number') return numberSnapshot(value)
  if (typeof value === 'string') {
    if (fieldType && DATE_FIELD_TYPES.has(fieldType)) return dateSnapshot(value, fieldType)
    return textSnapshot(value)
  }
  if (typeof value === 'object') {
    return jsonSnapshot(value as Record<string, unknown>)
  }

  return null
}

const DATE_FIELD_TYPES = new Set(['DATE', 'DATETIME', 'TIME'])

function textSnapshot(text: string): TimelineFieldChangeSnapshot {
  const [truncated, wasTruncated] = truncateForSnapshot(text, TIMELINE_SNAPSHOT_BODY_LIMIT)
  return wasTruncated
    ? { kind: 'text', text: truncated, truncated: true }
    : { kind: 'text', text: truncated }
}

function numberSnapshot(num: number): TimelineFieldChangeSnapshot {
  return { kind: 'number', value: num, formatted: String(num) }
}

function dateSnapshot(iso: string, fieldType?: string): TimelineFieldChangeSnapshot {
  const variant: 'date' | 'datetime' | 'time' =
    fieldType === 'DATETIME' ? 'datetime' : fieldType === 'TIME' ? 'time' : 'date'
  return { kind: 'date', iso, variant }
}

function jsonSnapshot(value: Record<string, unknown> | undefined): TimelineFieldChangeSnapshot {
  const safe = value ?? {}
  const stringified = JSON.stringify(safe)
  if (stringified.length <= TIMELINE_SNAPSHOT_BODY_LIMIT) {
    return { kind: 'json', value: safe }
  }
  const [truncated] = truncateForSnapshot(stringified, TIMELINE_SNAPSHOT_BODY_LIMIT)
  return { kind: 'json', value: { _truncated: truncated }, truncated: true }
}
