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
 * legacy raw shape) into a FieldType-discriminated snapshot so timeline rows
 * that pre-date the snapshot system still render sensibly.
 *
 * - Pure: no async, no DB, no cache. Safe to use in client code as a fallback.
 * - Best-effort: when the source carries no denormalized label (e.g.,
 *   relationship without `displayName`), the snapshot's `label` falls back
 *   to the recordId/optionId/actorId. This is the price of pre-snapshot rows.
 *
 * `fieldType` should be the FieldType the change row was written with. When
 * absent, the resolver attempts a structural guess based on the value shape.
 */
export function legacyTypedFieldValueToSnapshot(
  value: unknown,
  fieldType?: string
): TimelineFieldChangeSnapshotValue {
  if (value === null || value === undefined) return null

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
        return textSnapshot(String(v.value ?? ''), fieldType)
      case 'number':
        return numberSnapshot(Number(v.value ?? 0), fieldType)
      case 'boolean':
        return { fieldType: 'CHECKBOX', value: Boolean(v.value) }
      case 'date':
        return dateSnapshot(String(v.value ?? ''), fieldType)
      case 'option': {
        const optionId = String(v.optionId ?? '')
        const labelRaw = typeof v.label === 'string' ? v.label : optionId
        const [label] = truncateForSnapshot(labelRaw, TIMELINE_SNAPSHOT_LABEL_LIMIT)
        const color = typeof v.color === 'string' ? v.color : undefined
        return {
          fieldType: optionFieldType(fieldType),
          optionId,
          label,
          ...(color ? { color } : {}),
        }
      }
      case 'relationship': {
        const recordId = String(v.recordId ?? '')
        const displayName = typeof v.displayName === 'string' ? v.displayName : recordId
        const [label] = truncateForSnapshot(displayName, TIMELINE_SNAPSHOT_LABEL_LIMIT)
        return {
          fieldType: 'RELATIONSHIP',
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
          fieldType: 'ACTOR',
          actorId: actorIdRaw as ActorId,
          actorType,
          label,
        }
      }
      case 'json':
        return jsonSnapshot(v.value as Record<string, unknown> | undefined, fieldType)
      default:
        return null
    }
  }

  // Bare primitives — legacy or non-typed payloads.
  if (typeof value === 'boolean') return { fieldType: 'CHECKBOX', value }
  if (typeof value === 'number') return numberSnapshot(value, fieldType)
  if (typeof value === 'string') {
    if (fieldType && DATE_FIELD_TYPES.has(fieldType)) return dateSnapshot(value, fieldType)
    return textSnapshot(value, fieldType)
  }
  if (typeof value === 'object') {
    return jsonSnapshot(value as Record<string, unknown>, fieldType)
  }

  return null
}

const DATE_FIELD_TYPES = new Set(['DATE', 'DATETIME', 'TIME'])
const TEXT_LIKE_FIELD_TYPES = new Set(['TEXT', 'EMAIL', 'URL', 'NAME', 'PHONE_INTL'])
const NUMBER_LIKE_FIELD_TYPES = new Set(['NUMBER', 'CURRENCY'])
const OPTION_LIKE_FIELD_TYPES = new Set(['SINGLE_SELECT', 'MULTI_SELECT', 'TAGS'])
const JSON_LIKE_FIELD_TYPES = new Set(['JSON', 'ADDRESS_STRUCT'])

function textSnapshot(text: string, fieldType?: string): TimelineFieldChangeSnapshot {
  if (fieldType === 'RICH_TEXT') {
    const [html, wasTruncated] = truncateForSnapshot(text, TIMELINE_SNAPSHOT_BODY_LIMIT)
    return wasTruncated
      ? { fieldType: 'RICH_TEXT', html, truncated: true }
      : { fieldType: 'RICH_TEXT', html }
  }
  const ft = TEXT_LIKE_FIELD_TYPES.has(fieldType ?? '')
    ? (fieldType as 'TEXT' | 'EMAIL' | 'URL' | 'NAME' | 'PHONE_INTL')
    : 'TEXT'
  const [truncated, wasTruncated] = truncateForSnapshot(text, TIMELINE_SNAPSHOT_BODY_LIMIT)
  return wasTruncated
    ? { fieldType: ft, text: truncated, truncated: true }
    : { fieldType: ft, text: truncated }
}

function numberSnapshot(num: number, fieldType?: string): TimelineFieldChangeSnapshot {
  const ft = NUMBER_LIKE_FIELD_TYPES.has(fieldType ?? '')
    ? (fieldType as 'NUMBER' | 'CURRENCY')
    : 'NUMBER'
  return { fieldType: ft, value: num, formatted: String(num) }
}

function dateSnapshot(iso: string, fieldType?: string): TimelineFieldChangeSnapshot {
  const ft: 'DATE' | 'DATETIME' | 'TIME' =
    fieldType === 'DATETIME' ? 'DATETIME' : fieldType === 'TIME' ? 'TIME' : 'DATE'
  return { fieldType: ft, iso }
}

function optionFieldType(fieldType?: string): 'SINGLE_SELECT' | 'MULTI_SELECT' | 'TAGS' {
  return OPTION_LIKE_FIELD_TYPES.has(fieldType ?? '')
    ? (fieldType as 'SINGLE_SELECT' | 'MULTI_SELECT' | 'TAGS')
    : 'SINGLE_SELECT'
}

function jsonSnapshot(
  value: Record<string, unknown> | undefined,
  fieldType?: string
): TimelineFieldChangeSnapshot {
  const ft: 'JSON' | 'ADDRESS_STRUCT' = JSON_LIKE_FIELD_TYPES.has(fieldType ?? '')
    ? (fieldType as 'JSON' | 'ADDRESS_STRUCT')
    : 'JSON'
  const safe = value ?? {}
  const stringified = JSON.stringify(safe)
  if (stringified.length <= TIMELINE_SNAPSHOT_BODY_LIMIT) {
    return { fieldType: ft, value: safe }
  }
  const [truncated] = truncateForSnapshot(stringified, TIMELINE_SNAPSHOT_BODY_LIMIT)
  return { fieldType: ft, value: { _truncated: truncated }, truncated: true }
}
