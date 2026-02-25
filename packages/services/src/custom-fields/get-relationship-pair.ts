// packages/services/src/custom-fields/get-relationship-pair.ts

import { database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { getInverseFieldId, type RelationshipConfig } from './types'

/**
 * Input for getting a relationship pair
 */
export interface GetRelationshipPairInput {
  resourceFieldId: ResourceFieldId
  organizationId: string
}

/**
 * Get both sides of a relationship field
 *
 * @param input - Field identification
 * @returns Result with primary and inverse fields
 */
export async function getRelationshipPair(input: GetRelationshipPairInput) {
  const { resourceFieldId, organizationId } = input

  // Parse ResourceFieldId to get components
  const { fieldId } = parseResourceFieldId(resourceFieldId)

  // Get the primary field
  const primaryResult = await fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.id, fieldId),
          eq(schema.CustomField.organizationId, organizationId)
        )
      )
      .limit(1),
    'get-relationship-primary'
  )

  if (primaryResult.isErr()) {
    return primaryResult
  }

  const primary = primaryResult.value[0] as CustomFieldEntity | undefined
  if (!primary) {
    return err({
      code: 'CUSTOM_FIELD_NOT_FOUND' as const,
      message: 'Field not found',
      fieldId: fieldId as string,
    })
  }

  if (primary.type !== 'RELATIONSHIP') {
    return err({
      code: 'VALIDATION_ERROR' as const,
      message: 'Field is not a relationship field',
    })
  }

  const relationshipConfig = (primary.options as { relationship?: RelationshipConfig })
    ?.relationship
  const inverseFieldId = relationshipConfig ? getInverseFieldId(relationshipConfig) : null

  let inverse: CustomFieldEntity | null = null

  if (inverseFieldId) {
    const inverseResult = await fromDatabase(
      database
        .select()
        .from(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.id, inverseFieldId),
            eq(schema.CustomField.organizationId, organizationId)
          )
        )
        .limit(1),
      'get-relationship-inverse'
    )

    if (inverseResult.isOk() && inverseResult.value[0]) {
      inverse = inverseResult.value[0] as CustomFieldEntity
    }
  }

  return ok({ primary, inverse })
}
