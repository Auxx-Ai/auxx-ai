// packages/lib/src/entity-instances/get-entity-instance.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok } from 'neverthrow'

/** Parameters for getting an entity instance */
export interface GetEntityInstanceParams {
  id: string
  organizationId: string
  /**
   * Load the row even when it is archived. Default `false`, which is what every
   * read path wants.
   *
   * 🛑 **`restoreEntity` and `deleteEntity` MUST pass `true`.** Archiving sets
   * `archivedAt`, and this loader excluded any row that carries it — so
   * `restoreEntity`, whose entire purpose is to clear that column, could never
   * load its own target and answered `Entity not found` for every record it
   * existed to serve. A hard delete of an archived record failed the same way,
   * which meant an archived row could be neither restored nor purged: archive
   * was a one-way door. Found 2026-08-31 with DemoOrg1's 9 purchase orders and
   * 9 vendor bills stuck behind it, and it also made a delete guard's own advice
   * ("delete or unlink the bills first") impossible to follow.
   */
  includeArchived?: boolean
}

/**
 * Get entity instance by ID with field values
 */
export async function getEntityInstance(params: GetEntityInstanceParams) {
  const { id, organizationId, includeArchived = false } = params

  const dbResult = await fromDatabase(
    database.query.EntityInstance.findFirst({
      where: (instances, { eq, and, isNull }) =>
        and(
          eq(instances.id, id),
          eq(instances.organizationId, organizationId),
          includeArchived ? undefined : isNull(instances.archivedAt)
        ),
      with: {
        entityDefinition: true,
        values: {
          with: {
            field: true,
          },
        },
      },
    }),
    'get-entity-instance'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  if (!dbResult.value) {
    return err({
      code: 'ENTITY_INSTANCE_NOT_FOUND' as const,
      message: `Entity instance not found: ${id}`,
      entityInstanceId: id,
    })
  }

  return ok(dbResult.value)
}

/** The bare `EntityInstance` row, without its values. */
export type EntityInstanceRow = typeof schema.EntityInstance.$inferSelect

/**
 * Load just the `EntityInstance` row, on the caller's connection.
 *
 * {@link getEntityInstance} joins every FieldValue and its CustomField, on
 * the pool. A write path that only needs the row (an existence check, the
 * pre-hooks' `id` and `metadata`) must not pay that join, and inside a
 * transaction it must read on the transaction's connection or it cannot see
 * its own uncommitted rows.
 */
export async function getEntityInstanceRow(
  params: GetEntityInstanceParams,
  db: Database | Transaction = database
): Promise<EntityInstanceRow | null> {
  const { id, organizationId, includeArchived = false } = params
  const [row] = await db
    .select()
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, id),
        eq(schema.EntityInstance.organizationId, organizationId),
        includeArchived ? undefined : isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  return row ?? null
}
