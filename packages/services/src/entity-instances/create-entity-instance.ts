// packages/services/src/entity-instances/create-entity-instance.ts

import { database, schema } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** Parameters for creating an entity instance */
export interface CreateEntityInstanceParams {
  entityDefinitionId: string
  organizationId: string
  createdById?: string
}

/**
 * Create a new entity instance
 * Field values should be set separately using the custom field value service
 */
export async function createEntityInstance(params: CreateEntityInstanceParams) {
  const { entityDefinitionId, organizationId, createdById } = params

  const dbResult = await fromDatabase(
    database
      .insert(schema.EntityInstance)
      .values({
        entityDefinitionId,
        organizationId,
        createdById: createdById ?? null,
        updatedAt: new Date().toISOString(),
      })
      .returning(),
    'create-entity-instance'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const created = dbResult.value[0]
  if (!created) {
    return err({
      code: 'ENTITY_INSTANCE_NOT_FOUND' as const,
      message: 'Failed to create entity instance',
      entityInstanceId: '',
    })
  }

  return ok(created)
}
