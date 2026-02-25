// packages/services/src/table-view/duplicate-view.ts

import { database, schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/types'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { getView } from './get-view'

/**
 * Input for duplicating a view
 */
export interface DuplicateViewInput {
  id: string
  name: string
  userId: string
  organizationId: string
}

/**
 * Duplicate an existing view (creates personal copy)
 */
export async function duplicateView(input: DuplicateViewInput) {
  const { id, name, userId, organizationId } = input

  // Get original view (user can duplicate own or shared org views)
  const originalResult = await getView({ id, userId, organizationId })
  if (originalResult.isErr()) return originalResult

  const original = originalResult.value

  const dbResult = await fromDatabase(
    database
      .insert(schema.TableView)
      .values({
        tableId: original.tableId,
        name,
        config: original.config,
        isShared: false,
        userId,
        organizationId,
        updatedAt: new Date(),
      })
      .returning(),
    'duplicate-view'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value[0] as TableViewEntity)
}
