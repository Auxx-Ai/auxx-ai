// @auxx/lib/realtime/events.ts

import type { FieldValueKey } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'

/** Stored field value — matches the client store's StoredFieldValue shape. */
export type StoredFieldValue = unknown

/** Persistent AI generation state published alongside a FieldValue. */
export type AiStatus = 'generating' | 'result' | 'error'

/**
 * Client-visible AI metadata. Mirrors the server-side bag that lives in
 * `FieldValue.valueJson`. All fields optional because each state populates a
 * different subset (generating: { jobId, requestedAt }; result: { model,
 * generatedAt, inputHash, tokens }; error: { errorMessage, failedAt }).
 */
export interface AiValueMetadata {
  model?: string
  generatedAt?: string
  inputHash?: string
  tokens?: { prompt: number; completion: number }
  jobId?: string
  errorMessage?: string
  failedAt?: string
  requestedAt?: string
}

/**
 * One entry in a fieldValues:updated payload.
 * - `value` absent means "don't touch the value in the store"
 * - `aiStatus`/`aiMetadata` absent means "don't touch the AI marker"
 * - `aiStatus: null` / `aiMetadata: null` explicitly clear the marker
 */
export interface FieldValueUpdateEntry {
  key: FieldValueKey
  value?: StoredFieldValue
  aiStatus?: AiStatus | null
  aiMetadata?: AiValueMetadata | null
}

/** All resource sync events sent over the org channel. */
export type ResourceSyncEvent =
  | FieldValuesUpdatedEvent
  | RecordCreatedEvent
  | RecordUpdatedEvent
  | RecordDeletedEvent
  | RecordArchivedEvent

/** Field values changed (from mutations, triggers, cost recalc, etc.) */
export interface FieldValuesUpdatedEvent {
  event: 'fieldValues:updated'
  data: {
    entries: FieldValueUpdateEntry[]
    chunk?: { index: number; total: number }
  }
}

/**
 * Record metadata for lifecycle events.
 *
 * All denormalized columns optional so partial updates stay cheap — the
 * field-value mutation layer emits `record:updated` with only the column
 * it just changed (see `maybeUpdateDisplayValue`). Missing != null; the
 * front-end should merge only fields that are present.
 */
export interface RecordMeta {
  id: string
  recordId: RecordId
  displayName?: string
  secondaryDisplayValue?: string | null
  avatarUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

/** A new record was created. */
export interface RecordCreatedEvent {
  event: 'record:created'
  data: {
    entityDefinitionId: string
    record: RecordMeta
    fieldValues?: Array<{ key: FieldValueKey; value: StoredFieldValue }>
  }
}

/**
 * A record's denormalized columns changed (displayName, secondaryDisplayValue,
 * avatarUrl, updatedAt). Fires from two places:
 *   - `maybeUpdateDisplayValue` (field-value mutation layer) — whenever a
 *     field write causes a denormalized column to change. Payload carries
 *     only the changed column plus updatedAt.
 *   - `updateEntityAvatarIfApplicable` (thumbnail-job callback) — when the
 *     avatar-128 preset resolves to a CDN URL after a FILE-ref write.
 * Field-value changes themselves still go through fieldValues:updated.
 */
export interface RecordUpdatedEvent {
  event: 'record:updated'
  data: {
    entityDefinitionId: string
    record: RecordMeta
  }
}

/** A record was hard-deleted. */
export interface RecordDeletedEvent {
  event: 'record:deleted'
  data: {
    recordId: RecordId
    entityDefinitionId: string
  }
}

/** A record was archived (soft-deleted). */
export interface RecordArchivedEvent {
  event: 'record:archived'
  data: {
    recordId: RecordId
    entityDefinitionId: string
  }
}
