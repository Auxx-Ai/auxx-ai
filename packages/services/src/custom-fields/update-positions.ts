// packages/services/src/custom-fields/update-positions.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { ModelTypes, type ModelType } from './types'

/**
 * Input for updating field positions
 */
export interface UpdateFieldPositionsInput {
  organizationId: string
  positions: Array<{ id: string; position: number }>
  modelType?: ModelType
}

/**
 * Update positions of multiple custom fields in bulk
 *
 * @param input - Positions to update
 * @returns Result with success status
 */
export async function updateFieldPositions(input: UpdateFieldPositionsInput) {
  const { organizationId, positions, modelType = ModelTypes.CONTACT } = input
  // modelType is already lowercase and matches DB format
  const dbModelType = modelType

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      for (const { id, position } of positions) {
        await tx
          .update(schema.CustomField)
          .set({ position })
          .where(
            and(
              eq(schema.CustomField.id, id),
              eq(schema.CustomField.organizationId, organizationId),
              eq(schema.CustomField.modelType, dbModelType as any)
            )
          )
      }
      return { success: true }
    }),
    'update-field-positions'
  )

  if (result.isErr()) {
    return result
  }

  return ok(result.value)
}
