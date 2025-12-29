// packages/services/src/custom-fields/get-fields.ts

import { database, schema } from '@auxx/database'
import { eq, and, asc } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { ModelTypes, type ModelType } from './types'
import type { CustomFieldEntity } from '@auxx/database/models'

/**
 * Input for getting custom fields
 */
export interface GetCustomFieldsInput {
  organizationId: string
  modelType?: ModelType
  entityDefinitionId?: string | null
}

/**
 * Get all custom fields for an organization
 *
 * @param input - Query parameters
 * @returns Result with custom fields array
 */
export async function getCustomFields(input: GetCustomFieldsInput) {
  const { organizationId, modelType = ModelTypes.CONTACT, entityDefinitionId } = input

  // Build conditions based on whether entityDefinitionId is provided
  // Values are now lowercase and match directly
  const conditions = [
    eq(schema.CustomField.organizationId, organizationId),
    eq(schema.CustomField.modelType, modelType as any),
  ]

  // For custom entities (ENTITY type), filter by entityDefinitionId
  if (modelType === ModelTypes.ENTITY && entityDefinitionId) {
    conditions.push(eq(schema.CustomField.entityDefinitionId, entityDefinitionId))
  }

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(and(...conditions))
      .orderBy(asc(schema.CustomField.position)),
    'get-custom-fields'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value as CustomFieldEntity[])
}
