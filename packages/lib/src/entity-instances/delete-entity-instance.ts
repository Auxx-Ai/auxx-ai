// packages/lib/src/entity-instances/delete-entity-instance.ts

import { database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { sweepEntityFieldValues } from '../field-values/sweep-entity-references'

/** Parameters for deleting an entity instance */
export interface DeleteEntityInstanceParams {
  id: string
  organizationId: string
}

/**
 * Permanently delete an entity instance, its field values, and every relation
 * pointing AT it. Prefer archiving over deletion.
 *
 * This is the single delete path behind tRPC `record.delete` **and**
 * `record.bulkDelete` (`bulkDeleteEntities` is a plain loop over `deleteEntity`,
 * which calls this) — the sweep belongs here and nowhere else.
 *
 * Two defects this function used to carry, both fixed by
 * {@link sweepEntityFieldValues}:
 *
 * 1. It deleted only the record's OWN field values, leaving the mirror row on
 *    the still-living record at the other end of every relation.
 * 2. That delete was **not** org-scoped while the `EntityInstance` delete was,
 *    and it ran first — so a mismatched `organizationId` stripped a surviving
 *    record of all its values, deleted nothing, and returned `success: true`.
 *
 * Everything now runs in one transaction: previously the two statements were
 * sequential and unwrapped, so a failure between them left a record with no
 * values.
 *
 * The record's own `TimelineEvent` rows go with it, for the same reason and by
 * the same rule — keyed off the mechanism (a record is going away), not off a
 * registration list. `TimelineEvent.entityId` is a bare `text()` column with no
 * FK, `deleteEntityDefinitionDeep` does not touch the table either, and nothing
 * had ever called the `deleteTimelineEvents` service written for exactly this:
 * 83% of the dev table (189,797 of 229,078 rows) points at an `entityId` that
 * no longer resolves.
 *
 * ⚠️ Matched on `entityId` ALONE, never on `entityType`. That column carries two
 * keyspaces for the same record — `createTimelineEvent` stamps
 * `EntityDefinition.id` from the canonical `recordId`, while money's own writers
 * build theirs from the type slug (`toRecordId('order', …)`), and the two
 * strings never compare equal. One order in dev holds 12 rows under its def id
 * and 12 under `'order'`. This is the same hazard `tx-write-flush.ts` documents,
 * with the same resolution: the entity instance id is unique on its own.
 *
 * Rows where this record is only the RELATED end (`relatedEntityId`) are left
 * alone deliberately: they are another, still-living record's history — "this
 * contact once had an order" survives the order.
 */
export async function deleteEntityInstance(params: DeleteEntityInstanceParams) {
  const { id, organizationId } = params

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      // The dead record's `entityType` drives the dependent display-name
      // cascade inside the sweep. Read before the delete; absent (wrong org, or
      // already gone) simply skips the cascade — every statement below is
      // org-scoped on its own.
      const [target] = await tx
        .select({ entityType: schema.EntityDefinition.entityType })
        .from(schema.EntityInstance)
        .innerJoin(
          schema.EntityDefinition,
          eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
        )
        .where(
          and(
            eq(schema.EntityInstance.id, id),
            eq(schema.EntityInstance.organizationId, organizationId)
          )
        )
        .limit(1)

      await sweepEntityFieldValues(tx, {
        organizationId,
        entityIds: [id],
        entityType: target?.entityType ?? null,
      })

      await tx
        .delete(schema.TimelineEvent)
        .where(
          and(
            eq(schema.TimelineEvent.entityId, id),
            eq(schema.TimelineEvent.organizationId, organizationId)
          )
        )

      await tx
        .delete(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, id),
            eq(schema.EntityInstance.organizationId, organizationId)
          )
        )
    }),
    'delete-entity-instance'
  )

  if (result.isErr()) {
    return err(result.error)
  }

  return ok({ success: true })
}
