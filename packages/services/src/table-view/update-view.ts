// packages/services/src/table-view/update-view.ts

import { database, schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
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
  /** Admins/owners can update shared views they don't own */
  isAdmin?: boolean
}

/**
 * Update an existing view.
 * - Regular users can only update their own views.
 * - Admins/owners can also update shared views within the org.
 */
export async function updateView(input: UpdateViewInput) {
  const { id, userId, organizationId, name, config, isShared, isAdmin = false } = input

  // Admins can edit any org view; regular users can only edit their own
  const viewResult = await getView({
    id,
    userId,
    organizationId,
    options: {
      ownerOnly: !isAdmin,
      orgWide: isAdmin,
      notFoundMessage: "View not found or you don't have permission to update it",
    },
  })

  if (viewResult.isErr()) return viewResult

  // Build partial update - only include defined fields
  const updates: Partial<{
    name: string
    config: Record<string, unknown>
    isShared: boolean
    updatedAt: Date
  }> = { updatedAt: new Date() }
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
