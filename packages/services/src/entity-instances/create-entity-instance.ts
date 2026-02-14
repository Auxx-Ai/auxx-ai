// packages/services/src/entity-instances/create-entity-instance.ts

import { type Database, database, schema } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** Parameters for creating an entity instance */
export interface CreateEntityInstanceParams {
  entityDefinitionId: string
  organizationId: string
  createdById?: string | null
  /** Primary display name */
  displayName?: string | null
  /** Secondary display value (subtitle/description) */
  secondaryDisplayValue?: string | null
  /** Avatar URL */
  avatarUrl?: string | null
  /** Generic metadata JSONB */
  metadata?: Record<string, unknown> | null
}

/**
 * Create a new entity instance
 * Field values should be set separately using the custom field value service
 * @param params - Creation parameters
 * @param tx - Optional transaction context
 */
export async function createEntityInstance(params: CreateEntityInstanceParams, tx?: Database) {
  const {
    entityDefinitionId,
    organizationId,
    createdById,
    displayName,
    secondaryDisplayValue,
    avatarUrl,
    metadata,
  } = params

  const db = tx ?? database

  const dbResult = await fromDatabase(
    db
      .insert(schema.EntityInstance)
      .values({
        entityDefinitionId,
        organizationId,
        createdById: createdById || null,
        displayName: displayName ?? null,
        secondaryDisplayValue: secondaryDisplayValue ?? null,
        avatarUrl: avatarUrl ?? null,
        metadata: metadata ?? null,
        updatedAt: new Date(),
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
