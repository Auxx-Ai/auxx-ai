// packages/lib/src/data-connectors/managed-fields.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'

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

/** `<defId>:<fieldId>` names the field; a bare id (legacy rows, tests) is accepted too. */
function refNamesField(ref: string, fieldId: string): boolean {
  return ref === fieldId || ref.endsWith(`:${fieldId}`)
}
