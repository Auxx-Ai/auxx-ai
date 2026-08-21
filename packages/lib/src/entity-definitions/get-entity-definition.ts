// packages/lib/src/entity-definitions/get-entity-definition.ts

import { database } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { err, ok } from 'neverthrow'

/**
 * Get a single entity definition by ID
 * Validates organization ownership
 */
export async function getEntityDefinition(params: { id: string; organizationId: string }) {
  const { id, organizationId } = params

  const dbResult = await fromDatabase(
    database.query.EntityDefinition.findFirst({
      where: (defs, { eq, and, isNull }) =>
        and(eq(defs.id, id), eq(defs.organizationId, organizationId), isNull(defs.archivedAt)),
    }),
    'get-entity-definition'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const definition = dbResult.value

  if (!definition) {
    return err({
      code: 'ENTITY_DEFINITION_NOT_FOUND' as const,
      message: `Entity definition not found: ${id}`,
      entityDefinitionId: id,
    })
  }

  return ok(definition)
}
