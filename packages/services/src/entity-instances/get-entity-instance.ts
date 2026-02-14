// packages/services/src/entity-instances/get-entity-instance.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** Parameters for getting an entity instance */
export interface GetEntityInstanceParams {
  id: string
  organizationId: string
}

/**
 * Get entity instance by ID with field values
 */
export async function getEntityInstance(params: GetEntityInstanceParams) {
  const { id, organizationId } = params

  const dbResult = await fromDatabase(
    database.query.EntityInstance.findFirst({
      where: (instances, { eq, and, isNull }) =>
        and(
          eq(instances.id, id),
          eq(instances.organizationId, organizationId),
          isNull(instances.archivedAt)
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
