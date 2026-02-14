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
    case ModelTypes.CONTACT:
      entityResult = await fromDatabase(
        database
          .select({ id: schema.Contact.id })
          .from(schema.Contact)
          .where(
            and(eq(schema.Contact.id, entityId), eq(schema.Contact.organizationId, organizationId))
          )
          .limit(1),
        'verify-contact'
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

    case ModelTypes.TICKET:
      entityResult = await fromDatabase(
        database
          .select({ id: schema.Ticket.id })
          .from(schema.Ticket)
          .where(
            and(eq(schema.Ticket.id, entityId), eq(schema.Ticket.organizationId, organizationId))
          )
          .limit(1),
        'verify-ticket'
      )
      break

    case ModelTypes.ENTITY:
      // Custom entities are verified via EntityInstance table
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

    case ModelTypes.PART:
      entityResult = await fromDatabase(
        database
          .select({ id: schema.Part.id })
          .from(schema.Part)
          .where(and(eq(schema.Part.id, entityId), eq(schema.Part.organizationId, organizationId)))
          .limit(1),
        'verify-part'
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
