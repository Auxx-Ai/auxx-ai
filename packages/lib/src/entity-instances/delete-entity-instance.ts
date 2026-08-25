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
