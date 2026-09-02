// packages/lib/src/field-values/field-change-events.ts
//
// The `<prefix>:field:updated` bus event, as a step of the write path rather
// than a pluggable hook. It used to be a global `'*'` field-change post-hook
// (`field-hooks/post/publish-field-change-event.ts`), which meant every
// record write published one bus event PER FIELD on top of the record-level
// `:updated` event `updateEntity` publishes, and the timeline showed both
// (plans/field-values/update-path-and-events.md section 1a).
//
// Now a write either publishes the per-field event itself (the panel path,
// bulk edits, add/remove) or hands the change to a collector the record-level
// producer owns, which folds every field of the write into ONE `:updated`
// event carrying `changes[]`.

import type { RecordId } from '@auxx/types/resource'
import { publisher } from '../events/publisher'
import type {
  ContactFieldUpdatedEvent,
  EntityInstanceFieldUpdatedEvent,
  RecordFieldChange,
  TicketFieldUpdatedEvent,
} from '../events/types'

export type { RecordFieldChange } from '../events/types'

/** A per-field change collector a record-level producer hands down. */
export type FieldChangeCollector = RecordFieldChange[]

export interface FieldChangeEventArgs {
  recordId: RecordId
  entityDefinitionId: string
  entitySlug: string
  /** entityType from EntityDefinition; null for custom entities. */
  entityType: string | null
  organizationId: string
  userId: string
  change: RecordFieldChange
  bulkOperationId?: string
}

/** The per-field event type for one entity type (prefix convention). */
export function fieldUpdatedEventType(
  entityType: string | null
): 'contact:field:updated' | 'ticket:field:updated' | 'entity:field:updated' {
  if (entityType === 'contact') return 'contact:field:updated'
  if (entityType === 'ticket') return 'ticket:field:updated'
  return 'entity:field:updated'
}

/**
 * Publish one `<prefix>:field:updated` event, or push the change onto the
 * caller's collector when a record-level producer owns the announcement.
 * Fire-and-forget: the publisher never throws.
 */
export function emitFieldChange(
  args: FieldChangeEventArgs,
  collector: FieldChangeCollector | undefined
): void {
  if (collector) {
    collector.push(args.change)
    return
  }
  const { change } = args
  const data = {
    recordId: args.recordId,
    entityDefinitionId: args.entityDefinitionId,
    entitySlug: args.entitySlug,
    organizationId: args.organizationId,
    userId: args.userId,
    fieldId: change.fieldId,
    fieldName: change.fieldName,
    fieldType: change.fieldType,
    oldValue: change.oldValue,
    newValue: change.newValue,
    oldDisplay: change.oldDisplay,
    newDisplay: change.newDisplay,
    ...(args.bulkOperationId ? { bulkOperationId: args.bulkOperationId } : {}),
  }
  void publisher.publishLater({ type: fieldUpdatedEventType(args.entityType), data } as
    | ContactFieldUpdatedEvent
    | TicketFieldUpdatedEvent
    | EntityInstanceFieldUpdatedEvent)
}
