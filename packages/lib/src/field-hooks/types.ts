// packages/lib/src/field-hooks/types.ts

import type { TypedFieldValueInput } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { CachedField } from '../field-values/types'
import type { TimelineFieldChangeSnapshotValue } from '../timeline/field-change-snapshot'

// =============================================================================
// POST-WRITE TRIGGER TYPES (existing)
// =============================================================================

/** Fired when a field with a registered trigger has its value changed */
export interface FieldTriggerEvent {
  action: 'updated'
  systemAttribute: SystemAttribute
  recordIds: RecordId[]
  organizationId: string
  userId: string
}

/** Fired when an entity of a registered type is created or deleted */
export interface EntityTriggerEvent {
  action: 'created' | 'deleted'
  entitySlug: string
  entityType: string
  entityDefinitionId: string
  entityInstanceId: string
  organizationId: string
  userId: string
  values: Record<string, unknown>
}

/** Async handler for field value change triggers */
export type FieldTriggerHandler = (event: FieldTriggerEvent) => Promise<void>

/** Async handler for entity lifecycle triggers */
export type EntityTriggerHandler = (event: EntityTriggerEvent) => Promise<void>

// =============================================================================
// PRE-WRITE HOOK TYPES (new)
// =============================================================================

/**
 * Event passed to a per-field pre-hook before the value lands.
 *
 * Hooks can:
 * - Return the (possibly transformed) value to allow the write
 * - Return `undefined` to silently drop the write for this field
 * - Throw to reject the entire write (caller surface decides how to map the error)
 */
export interface FieldPreHookEvent {
  recordId: RecordId
  /** Resolved entity definition UUID */
  entityDefinitionId: string
  /** entityType from EntityDefinition (e.g. 'tag', 'contact'); null for custom entities */
  entityType: string | null
  /** EntityDefinition apiSlug (e.g. 'tags', 'contacts'). Stable lookup key. */
  entitySlug: string
  fieldId: string
  systemAttribute: SystemAttribute
  /** Cached field metadata — use this instead of re-fetching */
  field: CachedField
  /**
   * Post-coercion value the caller is about to write. May be `null` to
   * signal a delete intent — guards that forbid clearing must handle `null`.
   *
   * 🛑 **Typed, not `unknown`, and that is load-bearing**
   * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §5b).
   * `fireFieldPreHooks` runs AFTER `validateAndConvertValue`, so what arrives here is the
   * COERCED envelope — a SINGLE_SELECT is `{ type: 'option', optionId }`, never the bare
   * string the caller typed. Three guards were written comparing this directly to a string
   * literal; every one of them was inert, read correctly in review, and passed a unit test
   * that fed it a bare string. Because `TypedFieldValueInput` is a union of OBJECT types,
   * that comparison is now `error TS2367: This comparison appears to be unintentional […]
   * have no overlap` — the mistake is unwriteable rather than merely discouraged.
   *
   * ⚠️ Unwrap deliberately, per field type. There is no framework-level normalisation on
   * purpose: it would be lossy (a relationship guard needs `relatedEntityId`, an actor guard
   * the actor envelope) and it would make the mistake invisible rather than impossible — a
   * guard comparing a normalised value to the wrong literal still fails silently.
   * `unwrapStatusValue` (`resources/hooks/lifecycle-status-guard.ts`) is the SINGLE_SELECT
   * one.
   */
  newValue: TypedFieldValueInput | TypedFieldValueInput[] | null
  /**
   * Existing value on the record for this field. Pre-fetched on the bulk
   * path; `undefined` on the single-field path (hooks that need it can
   * load via a helper).
   */
  existingValue: unknown
  /**
   * Every value the caller is writing in THIS request, keyed by fieldId.
   * Single-field path: one-element map. Bulk path: full request.
   */
  allValues: ReadonlyMap<string, unknown>
  organizationId: string
  userId?: string
  /**
   * Set of systemAttributes the caller has been pre-authorized to write
   * regardless of guards. Sourced from FieldValueContext.bypassFieldGuards.
   */
  bypass: ReadonlySet<SystemAttribute>
}

/**
 * Pre-hook returns the (possibly modified) value, or `undefined` to drop the
 * write for this field, or throws to reject the operation.
 *
 * Multiple hooks for the same (entitySlug, systemAttribute) compose
 * left-to-right; entity-scoped run before global (`'*'`-scoped) hooks — so a
 * handler's return value is the next handler's `newValue`, which is why it is
 * typed the same way rather than `unknown`.
 */
export type FieldPreHookHandler = (
  event: FieldPreHookEvent
) => Promise<TypedFieldValueInput | TypedFieldValueInput[] | null | undefined>

/**
 * Pre-delete entity hook — fired before an entity is permanently deleted.
 * Throw to reject the delete. (No return value — delete has nothing to transform.)
 */
export interface EntityPreDeleteEvent {
  recordId: RecordId
  entityDefinitionId: string
  entityType: string | null
  entitySlug: string
  /** Captured field values prior to delete (same shape as post-trigger eventData) */
  values: Record<string, unknown>
  organizationId: string
  userId: string
  /** Same bypass set used by field pre-hooks. */
  bypass: ReadonlySet<SystemAttribute>
}

export type EntityPreDeleteHandler = (event: EntityPreDeleteEvent) => Promise<void>

/**
 * Post-delete entity hook — fired after an entity is permanently deleted. Deletes do not fire
 * field-change post-hooks, so this is the seam for projections that must refresh once a record
 * is gone (e.g. billing amounts on the parent work order). Failures are logged and swallowed,
 * matching field-change post-hook semantics; anything that must block the delete belongs in a
 * pre-delete hook instead.
 */
export interface EntityPostDeleteEvent {
  recordId: RecordId
  entityDefinitionId: string
  entityType: string | null
  entitySlug: string
  /** Field values captured before the delete (systemAttribute-keyed raw values). */
  values: Record<string, unknown>
  organizationId: string
  userId: string
}

export type EntityPostDeleteHandler = (event: EntityPostDeleteEvent) => Promise<void>

// =============================================================================
// POST-WRITE FIELD-CHANGE HOOK TYPES
// =============================================================================

/**
 * Event passed to a post-write field-change hook after a value lands.
 *
 * Fires from setValueWithBuiltIn once the write and its realtime publish
 * are complete. Handler failures are logged and swallowed — they must not
 * break the write.
 */
export interface EntityFieldChangeEvent {
  recordId: RecordId
  entityDefinitionId: string
  /** entityType from EntityDefinition (e.g. 'contact', 'ticket'); null for custom entities. */
  entityType: string | null
  entitySlug: string
  field: CachedField
  /**
   * Pre-write value on the record. `null` if the field had no value before
   * this write. For array-return fields (FILE, TAGS, MULTI_SELECT,
   * RELATIONSHIP, multi-ACTOR) this is the full array pre-write.
   */
  oldValue: unknown
  /**
   * Post-write value. For array-return fields, the full array that the
   * write produced. `null` if the write deleted the only row.
   */
  newValue: unknown
  /**
   * Server-resolved snapshot of `oldValue` with frozen labels — render
   * from this, not from `oldValue`. `null` when the field was empty.
   */
  oldDisplay: TimelineFieldChangeSnapshotValue
  /**
   * Server-resolved snapshot of `newValue` with frozen labels — render
   * from this, not from `newValue`. `null` when the field was cleared.
   */
  newDisplay: TimelineFieldChangeSnapshotValue
  organizationId: string
  userId: string
  /**
   * When set, this event is one of many emitted by a single bulk operation
   * (e.g. `setBulkValues`, `addValuesBulk`, `removeValuesBulk`). Forwarded
   * onto the published `<prefix>:field:updated` event and persisted into the
   * timeline row's `eventData` for future cross-record grouping. Single-write
   * paths leave this `undefined`.
   */
  bulkOperationId?: string
}

/**
 * Async handler invoked after a successful field write. Errors are logged
 * and swallowed by the dispatcher — handlers must not break the write.
 */
export type EntityFieldChangeHandler = (event: EntityFieldChangeEvent) => Promise<void>
