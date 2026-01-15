// packages/services/src/custom-fields/get-fields.ts

import { database, schema } from '@auxx/database'
import { eq, and, asc } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { ModelTypes } from './types'
import type { CustomFieldEntity } from '@auxx/database/models'
import { getModelType } from '@auxx/types/resource'

/**
 * Input for getting custom fields
 */
export interface GetCustomFieldsInput {
  organizationId: string
  entityDefinitionId: string
}

/**
 * Get all custom fields for an organization
 *
 * @param input - Query parameters
 * @returns Result with custom fields array
 */
export async function getCustomFields(input: GetCustomFieldsInput) {
  const { organizationId, entityDefinitionId } = input

  // Derive modelType from entityDefinitionId
  const modelType = getModelType(entityDefinitionId)

  // Build conditions
  const conditions = [
    eq(schema.CustomField.organizationId, organizationId),
    eq(schema.CustomField.modelType, modelType as any),
  ]

  // For custom entities (ENTITY type), filter by entityDefinitionId
  if (modelType === ModelTypes.ENTITY) {
    conditions.push(eq(schema.CustomField.entityDefinitionId, entityDefinitionId))
  }

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(and(...conditions))
      .orderBy(asc(schema.CustomField.sortOrder)),
    'get-custom-fields'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value as CustomFieldEntity[])
}
