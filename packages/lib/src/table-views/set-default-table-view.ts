// packages/lib/src/table-views/set-default-table-view.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/types'
import { and, eq, ne } from 'drizzle-orm'

export interface SetDefaultTableViewInput {
  db: Database
  tableId: string
  viewId: string
  organizationId: string
}

export type SetDefaultTableViewResult =
  | { ok: true; view: TableViewEntity }
  | { ok: false; reason: 'not_found' | 'table_mismatch' }

/**
 * Make `viewId` the org default for its table on the request-scoped `db`.
 * Mirrors the `@auxx/services` `setDefaultView` transaction (admin-gating is the
 * caller's job): in one transaction, unset `isDefault` on every other view for
 * the same `tableId + organizationId + contextType`, then set the target
 * `isDefault: true` and `isShared: true` (a default view is org-wide). Honors
 * the partial-unique index `(tableId, organizationId, contextType, isDefault)`.
 * Cache invalidation (`table-view.default-changed`) is the caller's responsibility.
 */
export async function setDefaultTableView(
  input: SetDefaultTableViewInput
): Promise<SetDefaultTableViewResult> {
  const { db, tableId, viewId, organizationId } = input

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.TableView)
      .where(
        and(eq(schema.TableView.id, viewId), eq(schema.TableView.organizationId, organizationId))
      )
      .limit(1)

    if (!existing) return { ok: false, reason: 'not_found' } as const
    if (existing.tableId !== tableId) return { ok: false, reason: 'table_mismatch' } as const

    // Unset any other default for this table + context.
    await tx
      .update(schema.TableView)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.TableView.tableId, existing.tableId),
          eq(schema.TableView.organizationId, organizationId),
          eq(schema.TableView.contextType, existing.contextType),
          ne(schema.TableView.id, viewId)
        )
      )

    const [row] = await tx
      .update(schema.TableView)
      .set({ isDefault: true, isShared: true, updatedAt: new Date() })
      .where(eq(schema.TableView.id, viewId))
      .returning()

    return { ok: true, view: row as TableViewEntity } as const
  })
}
