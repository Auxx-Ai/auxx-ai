// packages/services/src/entity-instances/update-entity-instance.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** Parameters for updating an entity instance */
export interface UpdateEntityInstanceParams {
  id: string
  organizationId: string
  data: {
    archivedAt?: string | null
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
    updatedAt: now,
  }
  if ('archivedAt' in data) {
    updateData.archivedAt = data.archivedAt
    // Archive/restore is meaningful activity — advance lastActivityAt so the
    // staleness scanner doesn't flag a freshly-restored entity as stale.
    updateData.lastActivityAt = now
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
