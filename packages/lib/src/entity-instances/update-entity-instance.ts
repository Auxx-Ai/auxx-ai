// packages/lib/src/entity-instances/update-entity-instance.ts

import { type Database, database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
// Leaf-file import on purpose: the crud barrel pulls in UnifiedCrudHandler,
// which imports this package's barrel — write-session-als itself only touches
// node:async_hooks, so no runtime cycle this way.
import { getAmbientWriteSession } from '../resources/crud/write-session-als'

/** Parameters for updating an entity instance */
export interface UpdateEntityInstanceParams {
  id: string
  organizationId: string
  data: {
    /** `EntityInstance.archivedAt` is a `timestamp` column — a `Date`, never a string. */
    archivedAt?: Date | null
  }
}

/**
 * Update entity instance metadata (archive/restore)
 * Field values should be updated separately using the custom field value service
 */
export async function updateEntityInstance(params: UpdateEntityInstanceParams) {
  const { id, organizationId, data } = params

  const now = new Date()
  const updateData: Record<string, unknown> = {
    // D-7 explicit content stamp: archive/restore is a record content change,
    // and `updatedAt` no longer auto-bumps (`$onUpdate` removed).
    updatedAt: now,
  }
  if ('archivedAt' in data) {
    updateData.archivedAt = data.archivedAt
    // Archive/restore is meaningful activity — advance lastActivityAt so the
    // staleness scanner doesn't flag a freshly-restored entity as stale.
    // EXCEPT under a seed write session: seeded data is not activity (door
    // matrix, lastActivityAt × seed = off). The updatedAt content stamp above
    // still applies (updatedAtStamp × seed = per-record).
    if (getAmbientWriteSession()?.origin.kind !== 'seed') {
      updateData.lastActivityAt = now
    }
  }

  const dbResult = await fromDatabase(
    database
      .update(schema.EntityInstance)
      .set(updateData)
      .where(
        and(
          eq(schema.EntityInstance.id, id),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
      .returning(),
    'update-entity-instance'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const updated = dbResult.value[0]
  if (!updated) {
    return err({
      code: 'ENTITY_INSTANCE_NOT_FOUND' as const,
      message: `Entity instance not found: ${id}`,
      entityInstanceId: id,
    })
  }

  return ok(updated)
}

/** Parameters for {@link archiveEntityInstances}. */
export interface ArchiveEntityInstancesParams {
  /** Ids to archive. Duplicates tolerated; unknown ids are no-ops. */
  ids: readonly string[]
  organizationId: string
  db?: Database
}

/**
 * Archive a SET of entity instances in one statement.
 *
 * The set-based twin of {@link updateEntityInstance}'s archive branch, and it
 * reproduces that branch's two stamps exactly:
 *
 * - `updatedAt` always (D-7: archive is a record content change, and `$onUpdate`
 *   was removed from the column).
 * - `lastActivityAt` unless the ambient write session is a SEED — seeded data is
 *   not activity, per the door matrix.
 *
 * ⚠️ **Only rows that are not already archived are touched**, and the returned
 * ids are exactly the rows that changed. `archiveEntity` reads through
 * `getEntityInstance` without `includeArchived` and throws for an archived row,
 * which `bulkArchiveEntities` swallows — so an already-archived id has never
 * counted toward a bulk archive, and it must not start counting now. This is
 * also what keeps the tier-2 `records:changed` frame honest: it announces the
 * rows that actually moved.
 */
export async function archiveEntityInstances(params: ArchiveEntityInstancesParams) {
  const { organizationId, db = database } = params
  const ids = [...new Set(params.ids)]
  if (ids.length === 0) return ok([] as string[])

  const now = new Date()
  const updateData: Record<string, unknown> = { updatedAt: now, archivedAt: now }
  if (getAmbientWriteSession()?.origin.kind !== 'seed') {
    updateData.lastActivityAt = now
  }

  const dbResult = await fromDatabase(
    db
      .update(schema.EntityInstance)
      .set(updateData)
      .where(
        and(
          inArray(schema.EntityInstance.id, ids),
          eq(schema.EntityInstance.organizationId, organizationId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .returning({ id: schema.EntityInstance.id }),
    'archive-entity-instances'
  )

  if (dbResult.isErr()) return err(dbResult.error)

  return ok(dbResult.value.map((row) => row.id))
}
