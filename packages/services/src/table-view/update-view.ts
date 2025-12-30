// packages/services/src/table-view/update-view.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TableViewEntity } from '@auxx/database/models'
import { getView } from './get-view'

/**
 * Input for updating a view
 */
export interface UpdateViewInput {
  id: string
  userId: string
  organizationId: string
  name?: string
  config?: Record<string, unknown>
  isShared?: boolean
}

/**
 * Update an existing view (owner only)
 */
export async function updateView(input: UpdateViewInput) {
  const { id, userId, organizationId, name, config, isShared } = input

  // Verify ownership using getView
  const viewResult = await getView({
    id,
    userId,
    organizationId,
    options: { ownerOnly: true, notFoundMessage: "View not found or you don't have permission to update it" },
  })

  if (viewResult.isErr()) return viewResult

  // Build partial update - only include defined fields
  const updates: Partial<{ name: string; config: Record<string, unknown>; isShared: boolean; updatedAt: Date }> = { updatedAt: new Date() }
  if (name !== undefined) updates.name = name
  if (config !== undefined) updates.config = config
  if (isShared !== undefined) updates.isShared = isShared

  const dbResult = await fromDatabase(
    database.update(schema.TableView).set(updates).where(eq(schema.TableView.id, id)).returning(),
    'update-view'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value[0] as TableViewEntity)
}
