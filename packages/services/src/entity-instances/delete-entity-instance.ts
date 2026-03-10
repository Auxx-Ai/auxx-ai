// packages/services/src/entity-instances/delete-entity-instance.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** Parameters for deleting an entity instance */
export interface DeleteEntityInstanceParams {
  id: string
  organizationId: string
}

/**
 * Permanently delete an entity instance and its field values
 * Prefer archiving over deletion
 */
export async function deleteEntityInstance(params: DeleteEntityInstanceParams) {
  const { id, organizationId } = params

  // Delete field values first
  const fvResult = await fromDatabase(
    database.delete(schema.FieldValue).where(eq(schema.FieldValue.entityId, id)),
    'delete-entity-instance-field-values'
  )
  if (fvResult.isErr()) {
    return err(fvResult.error)
  }

  // Delete the instance
  const dbResult = await fromDatabase(
    database
      .delete(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.id, id),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      ),
    'delete-entity-instance'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  return ok({ success: true })
}
