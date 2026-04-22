// apps/web/src/components/dynamic-table/utils/cell-coercion.ts
'use client'

import {
  getRelatedEntityDefinitionId,
  isRecordId,
  parseRecordId,
  type RecordId,
  type ResourceField,
} from '@auxx/lib/resources/client'
import type { CopyCellPayload } from '../types'

/**
 * Paste coercion matrix — decide whether a source cell (from the clipboard
 * sidecar or a TSV-split plain-text cell) can land in a target field, and if
 * so, produce the value to write.
 *
 * Liberal on sources, strict on targets. If the target can't represent the
 * source, we skip with a reason rather than silently coercing.
 */

export interface CoerceOptions {
  columnId: string
  /** Resolve a relationship target by display name. Returns a RecordId or null. */
  resolveRelationshipByDisplay?: (columnId: string, query: string) => string | null
  /** Resolve an actor target by display name. Returns an ActorId or null. */
  resolveActorByDisplay?: (columnId: string, query: string) => string | null
}

export type CoerceResult = { ok: true; value: unknown } | { ok: false; reason: CoerceReason }

export type CoerceReason =
  | 'read-only'
  | 'unknown-target-type'
  | 'not-a-number'
  | 'not-a-boolean'
  | 'not-a-date'
  | 'no-matching-option'
  | 'no-matching-record'
  | 'wrong-entity-type'
  | 'no-matching-user'
  | 'structured-only-lossless'

/** Human-readable reason for toast display. */
export function reasonToLabel(reason: CoerceReason): string {
  switch (reason) {
    case 'read-only':
      return 'read-only'
    case 'unknown-target-type':
      return 'unknown field type'
    case 'not-a-number':
      return 'not a number'
    case 'not-a-boolean':
      return 'not a boolean'
    case 'not-a-date':
      return 'not a date'
    case 'no-matching-option':
      return 'no matching option'
    case 'no-matching-record':
      return 'no matching record'
    case 'wrong-entity-type':
      return 'wrong record type'
    case 'no-matching-user':
      return 'no matching user'
    case 'structured-only-lossless':
      return 'incompatible structured field'
  }
}

/**
 * Coerce a source payload into a value suitable for the target field.
 * Returns {ok: true, value} on success, or {ok: false, reason} on skip.
 * The returned `value` is a raw primitive (string, number, array, etc.) —
 * server-side `formatToTypedInput` will convert it to the internal typed form.
 */
export function coerceForPaste(
  source: CopyCellPayload,
  targetField: ResourceField,
  opts: CoerceOptions
): CoerceResult {
  if (targetField.capabilities?.updatable === false) {
    return { ok: false, reason: 'read-only' }
  }
  const targetType = targetField.fieldType
  if (!targetType) return { ok: false, reason: 'unknown-target-type' }

  const display = (source.display ?? '').trim()
  const hasRaw = source.raw !== undefined && source.raw !== null

  // Empty source → clear the cell.
  if (display === '' && !hasRaw) {
    return { ok: true, value: null }
  }

  // Lossless short-circuit: identical field types, use raw directly.
  // Excluded:
  //   - RELATIONSHIP / ACTOR: entity-type / user-resolution checks below.
  //   - SELECT / MULTI_SELECT / TAGS: option ids are per-field, so `raw`
  //     from a different column is not a valid id in the target's option
  //     set. The dedicated cases below validate against target options.
  if (
    source.fieldType === targetType &&
    hasRaw &&
    targetType !== 'RELATIONSHIP' &&
    targetType !== 'ACTOR' &&
    targetType !== 'SINGLE_SELECT' &&
    targetType !== 'MULTI_SELECT' &&
    targetType !== 'TAGS'
  ) {
    return { ok: true, value: source.raw }
  }

  switch (targetType) {
    case 'TEXT':
    case 'EMAIL':
    case 'URL':
    case 'PHONE':
    case 'PHONE_INTL':
    case 'ADDRESS':
    case 'RICH_TEXT': {
      // Any source → stringify. Prefer primaryDisplay (relationship) over display.
      const value = source.primaryDisplay ?? source.display ?? ''
      return { ok: true, value }
    }

    case 'NUMBER':
    case 'CURRENCY': {
      const candidates: unknown[] = []
      if (hasRaw) candidates.push(source.raw)
      if (display !== '') candidates.push(display)
      for (const c of candidates) {
        const n = parseNumber(c)
        if (n !== null) return { ok: true, value: n }
      }
      return { ok: false, reason: 'not-a-number' }
    }

    case 'CHECKBOX': {
      const candidates: unknown[] = []
      if (hasRaw) candidates.push(source.raw)
      if (display !== '') candidates.push(display)
      for (const c of candidates) {
        const b = parseBool(c)
        if (b !== null) return { ok: true, value: b }
      }
      return { ok: false, reason: 'not-a-boolean' }
    }

    case 'DATE':
    case 'DATETIME':
    case 'TIME': {
      const candidates: unknown[] = []
      if (hasRaw) candidates.push(source.raw)
      if (display !== '') candidates.push(display)
      for (const c of candidates) {
        const iso = parseDateIso(c)
        if (iso !== null) return { ok: true, value: iso }
      }
      return { ok: false, reason: 'not-a-date' }
    }

    case 'SINGLE_SELECT': {
      const options = targetField.options?.options ?? []
      // Prefer the raw option id (lossless path for select→select with same id space).
      if (source.fieldType === 'SINGLE_SELECT' && typeof source.raw === 'string') {
        if (options.some((o) => (o.id ?? o.value) === source.raw)) {
          return { ok: true, value: source.raw }
        }
      }
      const query = display
      if (!query) return { ok: true, value: null }
      const optionId = findOptionId(query, options)
      if (!optionId) return { ok: false, reason: 'no-matching-option' }
      return { ok: true, value: optionId }
    }

    case 'MULTI_SELECT':
    case 'TAGS': {
      const options = targetField.options?.options ?? []
      // Lossless path: array of option ids from a matching multi-select source.
      if (
        (source.fieldType === 'MULTI_SELECT' || source.fieldType === 'TAGS') &&
        Array.isArray(source.raw)
      ) {
        const ids = source.raw.filter((v): v is string => typeof v === 'string')
        if (ids.every((id) => options.some((o) => (o.id ?? o.value) === id))) {
          return { ok: true, value: ids }
        }
        // else fall through to label-lookup
      }
      // Split display on commas.
      const parts = display
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length === 0) return { ok: true, value: [] }
      const optionIds: string[] = []
      for (const p of parts) {
        const id = findOptionId(p, options)
        if (!id) return { ok: false, reason: 'no-matching-option' }
        optionIds.push(id)
      }
      return { ok: true, value: optionIds }
    }

    case 'RELATIONSHIP': {
      const relConfig = targetField.options?.relationship
      const targetRelatedDefId = relConfig ? getRelatedEntityDefinitionId(relConfig) : null
      const hasMany = relConfig?.relationshipType === 'has_many'

      // Lossless: source is a relationship with a RecordId.
      if (source.fieldType === 'RELATIONSHIP' && typeof source.recordId === 'string') {
        if (targetRelatedDefId) {
          const sourceDefId = parseRecordId(source.recordId as RecordId).entityDefinitionId
          if (sourceDefId !== targetRelatedDefId) {
            return { ok: false, reason: 'wrong-entity-type' }
          }
        }
        return { ok: true, value: source.recordId }
      }

      // RecordId round-trip: when copy falls back to emitting the RecordId in
      // `display` (dataMap miss at copy time, or plain-text paste from another
      // auxx tab), accept it directly if the entity def matches the target.
      // has_many sources come through as ", "-joined RecordIds.
      const candidates = display
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (candidates.length > 0 && candidates.every(isRecordId)) {
        if (targetRelatedDefId) {
          const allMatch = candidates.every(
            (c) => parseRecordId(c as RecordId).entityDefinitionId === targetRelatedDefId
          )
          if (!allMatch) return { ok: false, reason: 'wrong-entity-type' }
        }
        return { ok: true, value: hasMany ? candidates : candidates[0] }
      }

      // Display-name lookup (phase 2d callback).
      const resolver = opts.resolveRelationshipByDisplay
      if (resolver) {
        const query = source.primaryDisplay ?? display
        if (query) {
          const recordId = resolver(opts.columnId, query)
          if (recordId) return { ok: true, value: recordId }
        }
      }
      return { ok: false, reason: 'no-matching-record' }
    }

    case 'ACTOR': {
      // Lossless: source is an actor; raw is the ActorId or the actor object.
      if (source.fieldType === 'ACTOR' && source.raw !== undefined && source.raw !== null) {
        return { ok: true, value: source.raw }
      }
      const resolver = opts.resolveActorByDisplay
      if (resolver && display) {
        const actorId = resolver(opts.columnId, display)
        if (actorId) return { ok: true, value: actorId }
      }
      return { ok: false, reason: 'no-matching-user' }
    }

    case 'CALC':
      // Targets with CALC are read-only by capability, so we never reach here,
      // but keep this branch for safety.
      return { ok: false, reason: 'read-only' }

    case 'NAME':
    case 'ADDRESS_STRUCT':
    case 'FILE':
    case 'JSON':
      // Structured types: lossless only (identical source type).
      if (source.fieldType === targetType && hasRaw) {
        return { ok: true, value: source.raw }
      }
      return { ok: false, reason: 'structured-only-lossless' }

    default:
      return { ok: false, reason: 'unknown-target-type' }
  }
}

// ============================================================================
// PARSERS
// ============================================================================

function parseNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/[$€£¥,\s]/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v !== 'string') return null
  const lower = v.toLowerCase().trim()
  if (lower === 'true' || lower === 'yes' || lower === '1' || lower === 'on' || lower === '✓') {
    return true
  }
  if (lower === 'false' || lower === 'no' || lower === '0' || lower === 'off' || lower === '✗') {
    return false
  }
  return null
}

function parseDateIso(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed === '') return null
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function findOptionId(
  query: string,
  options: Array<{ id?: string; value: string; label: string }>
): string | null {
  if (!query || options.length === 0) return null
  const q = query.trim()
  const qLower = q.toLowerCase()
  // Exact match on id or value (case-sensitive), label (case-insensitive).
  const match = options.find(
    (o) =>
      o.id === q ||
      o.value === q ||
      o.label === q ||
      o.label.toLowerCase() === qLower ||
      o.value.toLowerCase() === qLower
  )
  if (!match) return null
  return match.id ?? match.value
}
