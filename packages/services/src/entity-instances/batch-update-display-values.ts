// packages/services/src/entity-instances/batch-update-display-values.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for batch updating display values on EntityInstances.
 */
export interface BatchUpdateDisplayValuesInput {
  organizationId: string
  /** Map of instanceId -> display value */
  updates: Map<string, string | null>
  /** Which column to update */
  column: 'displayName' | 'secondaryDisplayValue' | 'avatarUrl'
}

/**
 * Batch update display values for multiple EntityInstances.
 * Thin DB operation - business logic lives in lib package.
 */
export async function batchUpdateDisplayValues(input: BatchUpdateDisplayValuesInput) {
  const { organizationId, updates, column } = input

  if (updates.size === 0) {
    return ok({ updated: 0 })
  }

  let updated = 0

  // Update in chunks to avoid parameter limits
  const entries = Array.from(updates.entries())
  const CHUNK_SIZE = 100

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE)

    for (const [instanceId, value] of chunk) {
      const result = await fromDatabase(
        database
          .update(schema.EntityInstance)
          .set({ [column]: value })
          .where(
            and(
              eq(schema.EntityInstance.id, instanceId),
              eq(schema.EntityInstance.organizationId, organizationId)
            )
          ),
        'batch-update-display-value'
      )

      if (result.isOk()) {
        updated++
      }
    }
  }

  return ok({ updated })
}

/**
 * Input for clearing display values on all instances of an entity definition.
 */
export interface ClearDisplayValuesInput {
  entityDefinitionId: string
  organizationId: string
  column: 'displayName' | 'secondaryDisplayValue' | 'avatarUrl'
}

/**
 * Clear display values for all instances of an entity definition.
 * Used when display field is set to null.
 */
export async function clearDisplayValues(input: ClearDisplayValuesInput) {
  const { entityDefinitionId, organizationId, column } = input

  const result = await fromDatabase(
    database
      .update(schema.EntityInstance)
      .set({ [column]: null })
      .where(
        and(
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      ),
    'clear-display-values'
  )

  if (result.isErr()) {
    return err(result.error)
  }

  return ok({ cleared: true })
}
