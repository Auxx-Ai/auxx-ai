// packages/services/src/table-view/set-default-view.ts

import { database, schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/models'
import { and, eq, ne } from 'drizzle-orm'
import { fromDatabase } from '../shared/utils'

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
 * Uses transaction to ensure atomicity - unsets other defaults for the same table
 * NOTE: Permission check (admin/owner) must happen in router
 */
export async function setDefaultView(input: SetDefaultViewInput) {
  const { tableId, viewId, organizationId } = input

  return fromDatabase(
    database.transaction(async (tx) => {
      // First, verify the view exists and get its tableId
      const existingView = await tx.query.TableView.findFirst({
        where: eq(schema.TableView.id, viewId),
      })

      if (!existingView) {
        throw new Error('View not found')
      }

      // Verify the view belongs to the organization
      if (existingView.organizationId !== organizationId) {
        throw new Error('View does not belong to this organization')
      }

      // Unset any other defaults for this table
      await tx
        .update(schema.TableView)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.TableView.tableId, existingView.tableId),
            eq(schema.TableView.organizationId, organizationId),
            ne(schema.TableView.id, viewId)
          )
        )

      // Set this view as default (also makes it shared)
      const [updated] = await tx
        .update(schema.TableView)
        .set({ isDefault: true, isShared: true, updatedAt: new Date() })
        .where(
          and(eq(schema.TableView.id, viewId), eq(schema.TableView.organizationId, organizationId))
        )
        .returning()

      if (!updated) {
        throw new Error('Failed to set default view')
      }

      return updated as TableViewEntity
    }),
    'set-default-view'
  )
}
