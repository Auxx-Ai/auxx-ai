// packages/lib/src/data-connectors/cell-sync-read.ts
//
// The single-cell twin of the batch read in `field-values/field-value-queries.ts`:
// resolve ONE (record, field) pair's `CellSyncInfo` from the same three inputs
// (live item bindings, the stored marker, the field shape) through the same
// `resolveCellSyncState`. `setConnectorFieldPin` returns it so the badge can
// paint the new state from the mutation response instead of invalidating the
// record's whole field-value cache (plans/money/tasks/42 §0).

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNotNull } from 'drizzle-orm'
import { listItemBindingsForInstances } from './item-bindings'
import { type CellSyncInfo, resolveCellSyncState } from './sync-state'

export interface ReadCellSyncStateInput {
  organizationId: string
  entityInstanceId: string
  /** The concrete `CustomField.id` — the same key a pin stores. */
  fieldId: string
}

/**
 * The cell's sync state after a write, or `null` when the field is not bound to
 * any contributing connector on this record.
 *
 * Three indexed reads, run together: the record's live items (with their
 * mappings' bindings), any row of the cell still stamped by a connector, and the
 * field's own `options` (only `multi` is read — a multi field never re-asserts
 * another row, so it can never be `edited`). Deliberately NOT a per-cell read
 * path for lists: the batch fetch resolves whole pages through
 * `listItemBindingsForInstances` in one query.
 */
export async function readCellSyncState(
  db: Database | Transaction,
  input: ReadCellSyncStateInput
): Promise<CellSyncInfo | null> {
  const { organizationId, entityInstanceId, fieldId } = input

  const [bindingsByInstance, markerRows, fieldRows] = await Promise.all([
    listItemBindingsForInstances(db, organizationId, [entityInstanceId]),
    db
      .select({ managedByConnectorId: schema.FieldValue.managedByConnectorId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.fieldId, fieldId),
          isNotNull(schema.FieldValue.managedByConnectorId)
        )
      )
      .limit(1),
    db
      .select({ options: schema.CustomField.options })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.id, fieldId)
        )
      )
      .limit(1),
  ])

  return resolveCellSyncState({
    fieldId,
    field: { options: fieldRows[0]?.options as { multi?: boolean } | null | undefined },
    markerConnectorId: markerRows[0]?.managedByConnectorId ?? null,
    bindings: bindingsByInstance.get(entityInstanceId) ?? [],
  })
}
