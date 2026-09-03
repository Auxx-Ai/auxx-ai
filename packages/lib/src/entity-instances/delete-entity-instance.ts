// packages/lib/src/entity-instances/delete-entity-instance.ts

import { type Database, database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { sweepEntityFieldValues } from '../field-values/sweep-entity-references'

/** Parameters for deleting an entity instance */
export interface DeleteEntityInstanceParams {
  id: string
  organizationId: string
  /**
   * Connection to run on. Defaults to the global handle, which is what every
   * caller used before this parameter existed — pass `ctx.db` to keep a delete
   * on the caller's connection (see {@link deleteEntityInstances}).
   */
  db?: Database
}

/** Parameters for {@link deleteEntityInstances}. */
export interface DeleteEntityInstancesParams {
  /** Ids to remove. Duplicates are tolerated; unknown / other-org ids are no-ops. */
  ids: readonly string[]
  organizationId: string
  db?: Database
}

/**
 * How many records go into one transaction. `sweepEntityFieldValues` inlines
 * every id into `IN (…)` lists on both halves of the relation sweep, so an
 * unbounded batch would build a statement with tens of thousands of parameters.
 * The caller may hand this function any number of ids; chunking is its job, not
 * the caller's.
 */
const DELETE_CHUNK = 500

/**
 * Permanently delete a SET of entity instances, their field values, and every
 * relation pointing AT them. Prefer archiving over deletion.
 *
 * This is the set-based twin of {@link deleteEntityInstance} and the reason bulk
 * deletion is affordable: the singular version costs ~6 statements and a
 * transaction PER RECORD, and `bulkDeleteEntities` called it in a loop, so
 * removing a connector's 23,265 synced records meant a quarter of a million
 * round trips (plans/records/bulk-delete-at-scale.md §2.2). The same work over a
 * batch is four statements.
 *
 * Modelled on `ThreadMutationService.bulkDeletePermanently`, which is these same
 * three deletes over `Thread` and has been shipped since the relation sweep
 * landed.
 *
 * **Mixed definitions are handled, not assumed away.** The sweep's display-name
 * cascade is keyed on ONE `entityType`, so the ids are grouped by the type they
 * actually resolve to and swept once per group. A caller that batches by
 * definition (the normal case) produces exactly one group.
 *
 * **Chunked, one transaction per chunk.** A partial failure therefore commits
 * the chunks that already succeeded — the same granularity the per-record loop
 * had, only coarser, and the alternative (one transaction over 23k records)
 * holds locks for minutes.
 *
 * Every rule the singular version's docblock records applies here unchanged, and
 * two of them are load-bearing:
 *
 * ⚠️ `TimelineEvent` is matched on `entityId` ALONE, never on `entityType`. That
 * column carries two keyspaces for the same record — `createTimelineEvent`
 * stamps `EntityDefinition.id` from the canonical `recordId`, while money's own
 * writers build theirs from the type slug (`toRecordId('order', …)`) — and the
 * two strings never compare equal. One order in dev holds 12 rows under its def
 * id and 12 under `'order'`. The entity instance id is unique on its own.
 *
 * ⚠️ Rows where a deleted record is only the RELATED end (`relatedEntityId`) on
 * a `TimelineEvent` are left alone deliberately: they are another, still-living
 * record's history — "this contact once had an order" survives the order.
 *
 * Every statement is org-scoped on its own, so an id from another organization
 * deletes nothing rather than deleting the wrong thing.
 */
export async function deleteEntityInstances(params: DeleteEntityInstancesParams) {
  const { organizationId, db = database } = params
  const ids = [...new Set(params.ids)]
  if (ids.length === 0) return ok({ success: true, count: 0 })

  let count = 0

  for (let offset = 0; offset < ids.length; offset += DELETE_CHUNK) {
    const chunk = ids.slice(offset, offset + DELETE_CHUNK)

    const result = await fromDatabase(
      db.transaction(async (tx) => {
        // The dead records' `entityType` drives the dependent display-name
        // cascade inside the sweep. Read before the delete; an id that resolves
        // to nothing (wrong org, or already gone) still joins the `null` group
        // so its own values are swept — every statement below is org-scoped.
        const targets = await tx
          .select({
            id: schema.EntityInstance.id,
            entityType: schema.EntityDefinition.entityType,
          })
          .from(schema.EntityInstance)
          .innerJoin(
            schema.EntityDefinition,
            eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
          )
          .where(
            and(
              inArray(schema.EntityInstance.id, chunk),
              eq(schema.EntityInstance.organizationId, organizationId)
            )
          )

        const byType = new Map<string | null, string[]>()
        const resolved = new Set<string>()
        for (const target of targets) {
          resolved.add(target.id)
          const group = byType.get(target.entityType) ?? []
          group.push(target.id)
          byType.set(target.entityType, group)
        }
        const unresolved = chunk.filter((id) => !resolved.has(id))
        if (unresolved.length > 0) {
          byType.set(null, [...(byType.get(null) ?? []), ...unresolved])
        }

        for (const [entityType, groupIds] of byType) {
          await sweepEntityFieldValues(tx, {
            organizationId,
            entityIds: groupIds,
            entityType,
          })
        }

        await tx
          .delete(schema.TimelineEvent)
          .where(
            and(
              inArray(schema.TimelineEvent.entityId, chunk),
              eq(schema.TimelineEvent.organizationId, organizationId)
            )
          )

        const deleted = await tx
          .delete(schema.EntityInstance)
          .where(
            and(
              inArray(schema.EntityInstance.id, chunk),
              eq(schema.EntityInstance.organizationId, organizationId)
            )
          )
          .returning({ id: schema.EntityInstance.id })

        return deleted.length
      }),
      'delete-entity-instances'
    )

    if (result.isErr()) return err(result.error)
    count += result.value
  }

  return ok({ success: true, count })
}

/**
 * Permanently delete an entity instance, its field values, and every relation
 * pointing AT it. Prefer archiving over deletion.
 *
 * This is the single delete path behind tRPC `record.delete`, and one
 * {@link deleteEntityInstances} call — there is one implementation of the rules,
 * not two that drift. `record.bulkDelete` reaches the set-based function
 * directly for definitions that carry no pre/post-delete hooks.
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
 * Everything runs in one transaction: previously the two statements were
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
 */
export async function deleteEntityInstance(params: DeleteEntityInstanceParams) {
  const result = await deleteEntityInstances({
    ids: [params.id],
    organizationId: params.organizationId,
    db: params.db,
  })

  if (result.isErr()) return err(result.error)

  return ok({ success: true })
}
