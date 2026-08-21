// packages/lib/src/entity-definitions/delete-entity-definition-row.ts

import { database, EntityDefinition } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { getEntityDefinition } from './get-entity-definition'

/**
 * Permanently delete an entity definition
 * Should only be used with caution - prefer archiveEntityDefinition()
 */
export async function deleteEntityDefinition(params: { id: string; organizationId: string }) {
  const { id, organizationId } = params

  // Verify entity exists and belongs to organization
  const existingResult = await getEntityDefinition({ id, organizationId })
  if (existingResult.isErr()) {
    return err(existingResult.error)
  }

  const dbResult = await fromDatabase(
    database
      .delete(EntityDefinition)
      .where(and(eq(EntityDefinition.id, id), eq(EntityDefinition.organizationId, organizationId))),
    'delete-entity-definition'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  return ok({ success: true })
}
