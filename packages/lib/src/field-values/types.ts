// packages/lib/src/field-values/types.ts

import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import type { TypedFieldValue, TypedFieldValueInput } from '@auxx/types'
import type { FieldPath, FieldReference, ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import type { FieldOptions } from '../custom-fields/field-options'
import type { AiStatus, FieldValueUpdateEntry } from '../realtime/events'
import type { AiValueMetadata } from './ai-autofill/generation-service'

// Re-export for convenience
export type { FieldReference, FieldPath, ResourceFieldId }

// =============================================================================
// CACHED FIELD TYPE
// =============================================================================

/** Field definition enriched with display config from the resource cache. */
export type CachedField = CustomFieldEntity & {
  entityDefinition: {
    id: string
    primaryDisplayFieldId: string | null
    secondaryDisplayFieldId: string | null
    avatarFieldId: string | null
  } | null
}

// =============================================================================
// MODEL TYPES
// =============================================================================

/** Model type for field values (matches ModelTypes from custom-fields) */
export type ModelType = 'contact' | 'ticket' | 'thread' | 'entity'

// =============================================================================
// SERVICE INPUT TYPES
// =============================================================================

/**
 * Input for setting a single field value.
 * The service will fetch the CustomField to determine the type and convert the value.
 * Automatically updates EntityInstance.displayName if this is the primary display field.
 */
export interface SetValueInput {
  recordId: RecordId
  fieldId: string
  /** Raw value - service will convert based on field type */
  value: unknown
}

/**
 * Input for setValueWithBuiltIn - handles both built-in and custom fields.
 * Replaces CustomFieldService.setValue
 */
export interface SetValueWithBuiltInInput {
  recordId: RecordId
  fieldId: string
  value: unknown
  /** Whether to publish events (default: true) */
  publishEvents?: boolean
  /** Skip inverse relationship sync (used by bulk operations that handle sync separately) */
  skipInverseSync?: boolean
  /**
   * Stage 1 AI flag. When `true`, `setValueWithBuiltIn` short-circuits
   * before the value-conversion/uniqueness/write path and enqueues a
   * BullMQ autofill job instead. `value` is ignored in this mode.
   */
  ai?: boolean
  /**
   * Stage 2 AI metadata. Populated by the worker when committing a
   * successful AI generation through the normal set pipeline. The
   * metadata bag is merged into `FieldValue.valueJson` alongside
   * `aiStatus='result'`. Mutually exclusive with `ai` — if both are
   * present, `ai` wins and `aiGeneration` is ignored.
   */
  aiGeneration?: AiValueMetadata
  /**
   * When set, the realtime entry this write would have published is pushed
   * here instead of being published inline — used by `setValuesForEntity` to
   * batch every field from one multi-field write into a single
   * `fieldValues:updated` frame instead of one frame per field. Additive
   * only: post-hooks and field triggers still fire per field exactly as
   * today, gated on `publishEvents` as always. `publishEvents: false` still
   * short-circuits the publish site entirely — this collector is never
   * consulted in that case.
   */
  collectRealtime?: FieldValueUpdateEntry[]
  /**
   * When `true`, the per-field `searchText` recompute inside
   * `maybeUpdateDisplayValue` is suppressed — the caller owns the refresh and
   * flushes ONE recompute after its last field write (query-reduction plan
   * §3A). Display COLUMN writes are unaffected. Callers that set this MUST
   * refresh themselves; the default keeps today's per-field behavior.
   */
  skipSearchTextRefresh?: boolean
  /**
   * Batched idempotency-guard pre-read (query-reduction plan §3B), keyed
   * `entityId:fieldId` (see `setRowsKey`), each entry the pair's stored rows
   * in sortKey order (`[]` = covered, no rows). When this write's pair has an
   * entry, the guard uses it instead of its own SELECT; a missing key falls
   * back to the individual load. Serves ONLY the D-6 short-circuit and the
   * hooks' oldValue derivation — the reconcile re-reads inside its own
   * transaction regardless (delete-insert-replace §5B RULE). Ignored for AI
   * stage-2 commits, which bypass the guard entirely.
   */
  preloadedSetRows?: ReadonlyMap<string, FieldValueRow[]>
}

/**
 * Input for setValuesForEntity - batch set multiple fields on one entity.
 * Replaces CustomFieldService.setValues
 */
export interface SetValuesForEntityInput {
  recordId: RecordId
  values: Array<{ fieldId: string; value: unknown }>
  /** Whether to publish events (default: true) */
  publishEvents?: boolean
  /** Skip inverse relationship sync (used by bulk operations that handle sync separately) */
  skipInverseSync?: boolean
  /**
   * When `true`, even the record-level `searchText` flush is suppressed —
   * used by `setBulkValues`, which recomputes all changed records in one
   * batched statement after its fan-out. See
   * {@link SetValueWithBuiltInInput.skipSearchTextRefresh}.
   */
  skipSearchTextRefresh?: boolean
  /**
   * Pre-batched guard rows handed down by `setBulkValues` (one SELECT for the
   * whole bulk op). When absent, `setValuesForEntity` batch-loads its own
   * record's pairs in one SELECT. See
   * {@link SetValueWithBuiltInInput.preloadedSetRows}.
   */
  preloadedSetRows?: ReadonlyMap<string, FieldValueRow[]>
  /**
   * When `true`, the per-record D-7 watermark stamp is suppressed — the
   * caller owns the stamp and must cover every changed record itself.
   * Used by `setBulkValues`, which stamps all changed records in one
   * batched UPDATE after its fan-out (query-reduction plan §3C).
   */
  skipInstanceStamp?: boolean
}

/**
 * Input for setBulkValues - set same values on multiple entities.
 * Replaces CustomFieldService.bulkSetValues
 */
export interface SetBulkValuesInput {
  recordIds: RecordId[]
  values: Array<{ fieldId: string; value: unknown }>
  /**
   * Stage 1 AI request across the full cartesian product. Each (recordId,
   * fieldId) pair enqueues its own BullMQ autofill job via the short-circuit
   * path. The literal `value` for each pair is ignored.
   */
  ai?: boolean
}

/** Input for adding relation values to a single source entity. */
export interface AddRelationValuesInput {
  recordId: RecordId
  fieldId: string
  /** Target records to link to. All must share the same entityDefinitionId. */
  relatedRecordIds: RecordId[]
}

/** Input for removing relation values from a single source entity. */
export interface RemoveRelationValuesInput {
  recordId: RecordId
  fieldId: string
  /** Target records to unlink. */
  relatedRecordIds: RecordId[]
}

/** Input for adding the same relation values to many source entities in one call. */
export interface AddRelationValuesBulkInput {
  /** Source entities receiving the related values. Must share one entityDefinitionId. */
  recordIds: RecordId[]
  /** Resolved CustomField.id (UUID) — not a systemAttribute */
  fieldId: string
  /** Target entities to link to. Must share one entityDefinitionId. */
  relatedRecordIds: RecordId[]
  /** If true, skip inverse relationship sync. Default false. */
  skipInverseSync?: boolean
  /** If true, skip realtime publish AND field-trigger events. Default false. */
  skipPublishEvents?: boolean
}

/** Input for removing the same relation values from many source entities in one call. */
export interface RemoveRelationValuesBulkInput {
  recordIds: RecordId[]
  fieldId: string
  /** Target records to unlink. Only the instance portion is used in the DELETE scope. */
  relatedRecordIds: RecordId[]
  /** If true, skip inverse relationship sync. Default false. */
  skipInverseSync?: boolean
  /** If true, skip realtime publish AND field-trigger events. Default false. */
  skipPublishEvents?: boolean
}

/** Per-item write mode for {@link ApplyBulkInput}. */
export type BulkWriteMode = 'set' | 'add' | 'remove'

/**
 * One field write inside a bulk operation. `mode` defaults to `'set'`
 * (replace); `'add'` / `'remove'` append / delete values on multi-value fields.
 */
export interface BulkValueItem {
  fieldId: string
  value: unknown
  mode?: BulkWriteMode
}

/**
 * Input for {@link FieldValueService.applyBulk}. Two shapes:
 * - **uniform** — the same `values` applied across every record in `recordIds`.
 * - **per-record** — each `items` entry carries its own record + value map, so
 *   different records get different values in one call.
 */
export type ApplyBulkInput =
  | { recordIds: RecordId[]; values: BulkValueItem[]; ai?: boolean }
  | { items: Array<{ recordId: RecordId; values: BulkValueItem[] }>; ai?: boolean }

/**
 * Result of {@link FieldValueService.applyBulk}. `count` is the number of `set`
 * operations (records for the uniform path, items for the per-record path) —
 * unchanged from the legacy `setBulk` return. `added` / `removed` are present
 * only when the call included `add` / `remove` items.
 */
export interface ApplyBulkResult {
  count: number
  added?: number
  removed?: number
}

/**
 * Result state for field value mutations.
 * `'generating'` is only surfaced when the caller passed `ai: true` —
 * internal callers that never opt into AI autofill never see it.
 */
export type SetValueState = 'complete' | 'failed' | 'generating'

/**
 * Result from setValueWithBuiltIn - always returns arrays for consistency
 */
export interface SetValueResult {
  state: SetValueState
  performedAt: string
  values: TypedFieldValue[]
  /**
   * Populated when `state === 'generating'`. The BullMQ job id that will
   * produce the eventual result — useful as a correlation id. Clients
   * normally identify cells via `(recordId, fieldId)`, so this is optional.
   */
  jobId?: string
  /**
   * `true` when the write performed a REAL change (rows written or deleted).
   * `false`/absent for no-ops: the D-6 idempotency guard (identical set),
   * B-14 delete-of-absent, pre-hook drops, and AI stage-1 short-circuits.
   * Surfaced additively for the D-7 `EntityInstance.updatedAt` stamp — a
   * record write stamps once iff at least one field actually changed.
   */
  changed?: boolean
}

/**
 * Result from setValuesForEntity
 */
export interface SetValuesResult {
  fieldId: string
  state: SetValueState
  performedAt: string
  values: TypedFieldValue[]
  /** See {@link SetValueResult.changed} — real change vs idempotent no-op. */
  changed?: boolean
}

/**
 * Input for setting a field value when caller already has field type info.
 * Skips CustomField lookup for better performance.
 * Does NOT update displayName - caller is responsible for that.
 */
export interface SetValueWithTypeInput {
  recordId: RecordId
  fieldId: string
  fieldType: FieldType
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
  /** Skip inverse relationship sync (used by bulk operations that handle sync separately) */
  skipInverseSync?: boolean
  /**
   * AI metadata for stage-2 commits. When present, buildFieldValueRow
   * merges `aiStatus='result'` + `valueJson=meta` into each target row.
   * Absent for manual edits — the reconcile then writes `aiStatus=null`
   * onto surviving rows, clearing any prior AI marker in place.
   */
  aiGeneration?: AiValueMetadata
  /** See {@link SetValueWithBuiltInInput.skipSearchTextRefresh}. */
  skipSearchTextRefresh?: boolean
}

/** Input for adding a value to a multi-value field */
export interface AddValueInput {
  recordId: RecordId
  fieldId: string
  fieldType: FieldType
  value: TypedFieldValueInput
  position?: 'start' | 'end' | { after: string }
}

/**
 * Input for promoting one value of a multi-value field to primary
 * (position 0). `valueId` is the FieldValue row id to move to the front.
 */
export interface SetPrimaryValueInput {
  recordId: RecordId
  fieldId: string
  valueId: string
}

/** Input for getting a single field value */
export interface GetValueInput {
  recordId: RecordId
  fieldId: string
}

/** Input for getting multiple values */
export interface GetValuesInput {
  recordId: RecordId
  fieldIds?: string[]
}

/**
 * Input for batch getting values.
 * Uses RecordId format: entityDefinitionId:entityInstanceId.
 *
 * @example
 * // Direct fields:
 * { recordIds: ["contact:abc123"], fieldReferences: ["contact:email", "contact:name"] }
 *
 * // Relationship paths:
 * { recordIds: ["product:xyz"], fieldReferences: [["product:vendor", "vendor:name"]] }
 */
export interface BatchGetValuesInput {
  recordIds: RecordId[]

  /**
   * Field references to fetch. Each can be:
   * - ResourceFieldId: "contact:email" (direct field, depth 1)
   * - FieldPath: ["product:vendor", "vendor:name"] (relationship traversal, depth 2+)
   */
  fieldReferences: FieldReference[]
}

/** Input for deleting values */
export interface DeleteValueInput {
  recordId: RecordId
  fieldId: string
}

// =============================================================================
// SERVICE RETURN TYPES
// =============================================================================

/**
 * Single result from batch get.
 * Contains the field reference that was requested and the resolved value.
 */
export interface TypedFieldValueResult {
  recordId: RecordId

  /**
   * The field reference that was requested.
   * - ResourceFieldId for direct fields
   * - FieldPath for relationship traversal
   */
  fieldRef: FieldReference

  /**
   * The typed value(s).
   * - Single value for direct fields and has_one/belongs_to paths
   * - Array for has_many paths or multi-value fields
   */
  value: TypedFieldValue | TypedFieldValue[] | null

  /** The terminal field's FieldType (e.g., TEXT, RELATIONSHIP, CURRENCY) — for converter dispatch */
  fieldType: FieldType

  /** Field options from CustomField.options — for display formatting (decimals, currency, etc.) */
  fieldOptions?: FieldOptions

  /**
   * AI marker on the row — `'generating' | 'result' | 'error'` when present,
   * `null` otherwise. Lets the client rehydrate the sparkle/shimmer state on
   * refresh without waiting for a realtime event.
   */
  aiStatus?: AiStatus | null

  /** AI metadata from the row (model, generatedAt, errorMessage, etc.). */
  aiMetadata?: AiValueMetadata | null

  /**
   * Contributing data-connector that wrote/manages this value (per-cell marker
   * from `FieldValue.managedByConnectorId`), `null` when user/AI/owned. Lets the
   * client render a "Synced by <connector>" badge on an otherwise-editable cell.
   */
  managedByConnectorId?: string | null

  /** Issues found during fetch (optional) */
  issues?: string[]
}

/** Result from batch get values */
export interface BatchFieldValueResult {
  values: TypedFieldValueResult[]
}

// =============================================================================
// DATABASE ROW TYPES
// =============================================================================

/** Raw row from FieldValue table */
export interface FieldValueRow {
  id: string
  entityId: string
  entityDefinitionId: string
  fieldId: string
  organizationId: string
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  valueJson: unknown | null
  optionId: string | null
  relatedEntityId: string | null
  relatedEntityDefinitionId: string | null
  actorId: string | null
  sortKey: string
  createdAt: string
  updatedAt: string
}
