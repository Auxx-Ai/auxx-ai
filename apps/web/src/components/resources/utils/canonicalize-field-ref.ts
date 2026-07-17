// apps/web/src/components/resources/utils/canonicalize-field-ref.ts

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  type FieldPath,
  type FieldReference,
  type FieldValueKey,
  fieldRefToKey,
  isFieldPath,
  normalizeFieldRef,
  type ResourceFieldId,
} from '@auxx/types/field'
import { useResourceStore } from '../store/resource-store'
import { getNormalizedDefinitionId, getNormalizedRecordId } from './normalize-record-id'

/**
 * Canonicalize a single ResourceFieldId — BOTH halves:
 *
 * 1. Definition half: alias prefix (entityType/apiSlug) → canonical def id.
 *    Splits on the FIRST colon only, so app-field encoding
 *    (`<def>:@app:<slug>:<key>`) passes through with its tail intact.
 * 2. Field half: static-key / systemAttribute forms → the row-id form the
 *    server, realtime, and save paths key by. `work_order:name` and
 *    `line_item_name` must land in the same value slot as
 *    `<defId>:<customFieldRowId>` — otherwise key-form subscribers miss
 *    optimistic updates.
 *
 * Unknown segments are left untouched (pre-hydration no-op).
 */
function canonicalizeSegment(segment: ResourceFieldId): ResourceFieldId {
  const colonIndex = segment.indexOf(':')
  if (colonIndex === -1) return segment
  const defSegment = segment.slice(0, colonIndex)
  const fieldHalf = segment.slice(colonIndex + 1)
  const canonicalDef = getNormalizedDefinitionId(defSegment)
  const candidate =
    canonicalDef === defSegment ? segment : (`${canonicalDef}:${fieldHalf}` as ResourceFieldId)

  // Late-bound app refs keep their encoding — getFieldByRef resolves those.
  if (fieldHalf.startsWith('@app:')) return candidate

  const state = useResourceStore.getState()
  // fieldMap registers static-key aliases (`<def>:<key>`) pointing at the
  // effective field object, whose resourceFieldId is the canonical row-id ref.
  const field = state.fieldMap[candidate]
  if (field?.resourceFieldId && field.resourceFieldId !== candidate) {
    return field.resourceFieldId
  }
  if (!field) {
    // Bare systemAttribute as the field half (e.g. `line_item_name`) —
    // globally unique; only adopt it when it belongs to this definition.
    const attrRfId = state.systemAttributeMap[fieldHalf]
    if (attrRfId?.startsWith(`${canonicalDef}:`)) return attrRfId
  }
  return candidate
}

/**
 * Canonicalize every definition segment of a FieldReference where a mapping
 * exists — the direct-ref segment, or ALL segments of a drill-down FieldPath
 * (`Ticket → Contact → Name` references other definitions per segment).
 * Plain FieldIds pass through (no definition half to rewrite). Unknown
 * prefixes are left untouched.
 */
export function canonicalizeFieldRef(fieldRef: FieldReference): FieldReference {
  if (isFieldPath(fieldRef)) {
    let changed = false
    const segments = fieldRef.map((segment) => {
      const next = canonicalizeSegment(segment)
      if (next !== segment) changed = true
      return next
    })
    return changed ? (segments as FieldPath) : fieldRef
  }
  if (typeof fieldRef === 'string' && fieldRef.includes(':')) {
    return canonicalizeSegment(fieldRef as ResourceFieldId)
  }
  return fieldRef
}

/** Result of {@link buildCanonicalFieldValueKey}. */
export interface CanonicalFieldValueKey {
  /** Canonical RecordId (prefix = entityDefinitionId). */
  recordId: RecordId
  /** Canonical FieldReference (plain FieldIds resolved against the record's def). */
  fieldRef: FieldReference
  /** Store key: `${recordId}:${fieldRefKey}` with both halves canonical. */
  key: FieldValueKey
}

/**
 * Canonicalize BOTH halves of a field-value key — the single helper behind
 * queue keys, subscriber keys, and request building, so they can never
 * disagree on prefix form (plan Part 7).
 */
export function buildCanonicalFieldValueKey(
  rawRecordId: RecordId,
  rawFieldRef: FieldReference
): CanonicalFieldValueKey {
  const recordId = getNormalizedRecordId(rawRecordId)
  const fieldRef = canonicalizeFieldRef(normalizeFieldRef(recordId, rawFieldRef))
  const key = `${recordId}:${fieldRefToKey(fieldRef)}` as FieldValueKey
  return { recordId, fieldRef, key }
}
