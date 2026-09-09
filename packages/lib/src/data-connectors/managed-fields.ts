// packages/lib/src/data-connectors/managed-fields.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { refNamesField } from './sync-state'

/**
 * Whether `fieldId` is connector-managed on `entityInstanceId` — the same
 * `DataConnectorItem.managedFields` read the `connector_owned_only` merge strategy already
 * does (`sinks/entity-sink.ts`'s `buildWriteSet` and `computeDriftedInstances`), generalized
 * so the totals engine can stand down for a record whose totals a connector transcribes
 * (plans/money/tasks/37-shopify-native-retarget.md §6).
 *
 * `managedFields` holds the mapping's raw `targetFieldRef` strings, and a target ref is
 * `<defId>:<fieldId>` for a concrete column or `<defId>:@app:<slug>:<key>` for a late-bound
 * app field. It is never a bare `systemAttribute`. So `fieldId` must be the concrete
 * `CustomField.id` (resolve the attribute through the org cache first), and a ref counts as a
 * match when its last segment is that id. Passing an attribute name matches nothing, which is
 * the bug the first cut of the totals stand-down shipped with: it compared `'order_total'`
 * against `'c62a…:ityqe…'` and the engine recomputed every transcribed order at sync finalize.
 *
 * A record can be bound to more than one live `DataConnectorItem` — a shared def can be
 * co-owned by several mappings — so every non-archived item for the instance is checked;
 * ANY one of them naming the field is enough to answer `true`.
 */
export async function isFieldConnectorManaged(
  db: Database,
  organizationId: string,
  entityInstanceId: string,
  fieldId: string
): Promise<boolean> {
  if (!fieldId) return false
  const items = await db
    .select({ managedFields: schema.DataConnectorItem.managedFields })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.DataConnectorItem.entityInstanceId, entityInstanceId),
        isNull(schema.DataConnectorItem.archivedAt)
      )
    )

  return items.some((item) => (item.managedFields ?? []).some((ref) => refNamesField(ref, fieldId)))
}

/**
 * Whether the RECORD itself came from a connector - any non-archived
 * `DataConnectorItem` binds the instance, whatever fields that item manages.
 *
 * Coarser than {@link isFieldConnectorManaged} on purpose, and asking a
 * different question. That one asks "may I recompute this cell"; this one asks
 * "did a person create this record, or did a sync". The callers that need the
 * coarse answer are the ones deciding whether a HUMAN VERB applies at all:
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.1 hides Fulfill for a
 * connector order (the shipment log is derived from the channel's own
 * fulfillment facts instead, and two writers on one log is the defect 49 §2.1
 * exists to end), and the fulfillment log pass derives a log ONLY for orders
 * that have a channel to derive it from.
 *
 * A bound item with an EMPTY `managedFields` still counts. The array says which
 * cells the connector owns; the ROW says the record is the connector's. An item
 * whose mapping happens to manage nothing is still a synced record.
 *
 * Archived items do not count: a disconnected connector leaves its items
 * archived, and an order whose connector was removed becomes an ordinary record
 * a person may fulfil by hand again.
 */
export async function isRecordConnectorManaged(
  db: Database,
  organizationId: string,
  entityInstanceId: string
): Promise<boolean> {
  if (!entityInstanceId) return false
  const [item] = await db
    .select({ id: schema.DataConnectorItem.id })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.DataConnectorItem.entityInstanceId, entityInstanceId),
        isNull(schema.DataConnectorItem.archivedAt)
      )
    )
    .limit(1)
  return !!item
}

/**
 * {@link isRecordConnectorManaged} for a SET, in one query.
 *
 * 🛑 The batch form is the one the passes use, and the reason is the same one
 * `orderDemandPass` gives for resolving its parents in a single call: a finalize
 * pass runs over a whole sync manifest, so a per-record existence check would
 * restore an N+1 on the exact path that exists to remove one. A 500-order sync
 * asks once.
 *
 * Returns only the ids that ARE bound; an id absent from the set is not bound
 * (or does not exist, which is the same answer for every caller). An empty input
 * returns an empty set without touching the database.
 */
export async function listConnectorManagedRecordIds(
  db: Database,
  organizationId: string,
  entityInstanceIds: readonly string[]
): Promise<Set<string>> {
  const ids = [...new Set(entityInstanceIds.filter(Boolean))]
  if (ids.length === 0) return new Set()

  const rows = await db
    .selectDistinct({ entityInstanceId: schema.DataConnectorItem.entityInstanceId })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        inArray(schema.DataConnectorItem.entityInstanceId, ids),
        isNull(schema.DataConnectorItem.archivedAt)
      )
    )

  return new Set(rows.map((row) => row.entityInstanceId).filter((id): id is string => !!id))
}
