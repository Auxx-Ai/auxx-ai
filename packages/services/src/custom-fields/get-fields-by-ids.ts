// packages/services/src/custom-fields/get-fields-by-ids.ts

import { database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { and, eq, inArray } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for getting multiple fields by IDs
 */
export interface GetFieldsByIdsInput {
  fieldIds: string[]
  organizationId: string
}

/**
 * Get multiple custom fields by their IDs.
 * Useful for fetching both sides of a relationship after updates.
 *
 * @param input - Query parameters with array of field IDs
 * @returns Result with array of fields
 */
export async function getFieldsByIds(input: GetFieldsByIdsInput) {
  const { fieldIds, organizationId } = input

  if (fieldIds.length === 0) {
    return ok([] as CustomFieldEntity[])
  }

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(
        and(
          inArray(schema.CustomField.id, fieldIds),
          eq(schema.CustomField.organizationId, organizationId)
        )
      ),
    'get-fields-by-ids'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value as CustomFieldEntity[])
}
