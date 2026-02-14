// packages/services/src/field-values/update-display-name.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { UpdateDisplayNameInput } from './types'

/**
 * Update the displayName on an EntityInstance.
 * Called when the primary display field value changes.
 *
 * @param input - Update parameters
 * @returns Result with void on success
 */
export async function updateEntityDisplayName(input: UpdateDisplayNameInput) {
  const { entityId, organizationId, displayName } = input

  const dbResult = await fromDatabase(
    database
      .update(schema.EntityInstance)
      .set({ displayName })
      .where(
        and(
          eq(schema.EntityInstance.id, entityId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      ),
    'update-entity-display-name'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(undefined)
}
