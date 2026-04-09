// @auxx/lib/realtime/events.ts

import type { FieldValueKey } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'

/** Stored field value — matches the client store's StoredFieldValue shape. */
export type StoredFieldValue = unknown

/** All resource sync events sent over the org channel. */
export type ResourceSyncEvent =
  | FieldValuesUpdatedEvent
  | RecordCreatedEvent
  | RecordDeletedEvent
  | RecordArchivedEvent

/** Field values changed (from mutations, triggers, cost recalc, etc.) */
export interface FieldValuesUpdatedEvent {
  event: 'fieldValues:updated'
  data: {
    entries: Array<{ key: FieldValueKey; value: StoredFieldValue }>
    chunk?: { index: number; total: number }
  }
}

/** Record metadata for lifecycle events. */
export interface RecordMeta {
  id: string
  recordId: RecordId
  displayName?: string
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
