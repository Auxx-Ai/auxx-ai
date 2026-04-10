// packages/services/src/custom-fields/verify-entity.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { EntityNotFoundError } from './errors'
import { type ModelType, ModelTypes } from './types'

/**
 * Input for entity verification
 */
export interface VerifyEntityInput {
  organizationId: string
  entityId: string
  modelType: ModelType
}

/**
 * Verify entity exists and belongs to organization (DB query only)
 *
 * @param input - Entity details
 * @returns Result indicating entity existence
 */
export async function verifyEntityExistsQuery(input: VerifyEntityInput) {
  const { organizationId, entityId, modelType } = input

  let entityResult

  switch (modelType) {
    // Contact, Ticket, and Part tables have been dropped - they now use EntityInstance.
    // Fall through to ENTITY case for these types.
    case ModelTypes.CONTACT:
    case ModelTypes.TICKET:
    case ModelTypes.PART:
    case ModelTypes.ENTITY:
      // All entity types (contact, ticket, part, custom) are verified via EntityInstance table
      entityResult = await fromDatabase(
        database
          .select({ id: schema.EntityInstance.id })
          .from(schema.EntityInstance)
          .where(
            and(
              eq(schema.EntityInstance.id, entityId),
              eq(schema.EntityInstance.organizationId, organizationId)
            )
          )
          .limit(1),
        'verify-entity-instance'
      )
      break

    case ModelTypes.THREAD:
      entityResult = await fromDatabase(
        database
          .select({ id: schema.Thread.id })
          .from(schema.Thread)
          .where(
            and(eq(schema.Thread.id, entityId), eq(schema.Thread.organizationId, organizationId))
          )
          .limit(1),
        'verify-thread'
      )
      break

    default:
      return err({
        code: 'ENTITY_NOT_FOUND',
        message: `Unknown model type: ${modelType}`,
        entityType: modelType,
      } as EntityNotFoundError)
  }

  if (entityResult.isErr()) {
    return entityResult
  }

  if (!entityResult.value[0]) {
    return err({
      code: 'ENTITY_NOT_FOUND',
      message: `${modelType} not found`,
      entityId,
      entityType: modelType,
    } as EntityNotFoundError)
  }

  return ok(entityResult.value[0])
}
