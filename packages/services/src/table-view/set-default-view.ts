// packages/services/src/table-view/set-default-view.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TableViewEntity } from '@auxx/database/models'

/**
 * Input for setting default view
 */
export interface SetDefaultViewInput {
  tableId: string
  viewId: string
  organizationId: string
}

/**
 * Set a view as default for the organization
 * NOTE: Permission check (admin/owner) must happen in router
 */
export async function setDefaultView(input: SetDefaultViewInput) {
  const { tableId, viewId, organizationId } = input

  // Remove current default
  const removeResult = await fromDatabase(
    database
      .update(schema.TableView)
      .set({ isDefault: false })
      .where(and(eq(schema.TableView.tableId, tableId), eq(schema.TableView.organizationId, organizationId), eq(schema.TableView.isDefault, true))),
    'remove-current-default'
  )

  if (removeResult.isErr()) return removeResult

  // Set new default (also makes it shared)
  const dbResult = await fromDatabase(
    database.update(schema.TableView).set({ isDefault: true, isShared: true, updatedAt: new Date() }).where(eq(schema.TableView.id, viewId)).returning(),
    'set-default-view'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value[0] as TableViewEntity)
}
