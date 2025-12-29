// packages/services/src/custom-fields/get-field-by-id.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ModelType } from './types'

/**
 * Input for getting a field by ID
 */
export interface GetFieldByIdInput {
  fieldId: string
  organizationId: string
  modelType: ModelType
}

/**
 * Get a custom field by ID (DB query only)
 *
 * @param input - Query parameters
 * @returns Result with field or null
 */
export async function getFieldByIdQuery(input: GetFieldByIdInput) {
  const { fieldId, organizationId, modelType } = input

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.id, fieldId),
          eq(schema.CustomField.organizationId, organizationId),
          // modelType is already lowercase and matches DB format
          eq(schema.CustomField.modelType, modelType as any)
        )
      )
      .limit(1),
    'get-field-by-id'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value[0] || null)
}
