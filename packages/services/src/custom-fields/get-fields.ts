// packages/services/src/custom-fields/get-fields.ts

import { database, schema } from '@auxx/database'
import { eq, and, asc } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { CustomFieldEntity } from '@auxx/database/models'

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

  // Resources that DON'T have EntityDefinitions (legacy model types)
  // These are queried by modelType column directly
  const legacyModelTypes = ['thread', 'message', 'inbox', 'user', 'participant', 'dataset']
  const isLegacyModelType = legacyModelTypes.includes(entityDefinitionId)

  let conditions

  if (isLegacyModelType) {
    // Legacy query by modelType (for thread, message, etc. without EntityDefinitions)
    conditions = [
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.modelType, entityDefinitionId as any),
    ]
  } else {
    // Entity-based query by entityDefinitionId (for contact, ticket, part, custom entities)
    // These have EntityDefinition records and CustomFields are linked via entityDefinitionId UUID
    conditions = [
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
    ]
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
