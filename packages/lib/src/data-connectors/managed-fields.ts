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
 * `fieldId` shares `managedFields`'s own key space: the mapping's raw `targetFieldRef`,
 * which for a system-field target is the bare `systemAttribute` string (e.g. `'order_total'`,
 * `'line_item_line_total'`) — exactly what a `SystemAttribute` value already is, so every
 * totals-engine caller can pass one straight through.
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

  return items.some((item) => (item.managedFields ?? []).includes(fieldId))
}
