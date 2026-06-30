// packages/lib/src/table-views/update-table-view.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/types'
import { and, eq, ne } from 'drizzle-orm'

export interface UpdateTableViewInput {
  db: Database
  id: string
  userId: string
  organizationId: string
  /** When set, the loaded view's `tableId` must match — guards against editing a view from another table. */
  expectedTableId?: string
  /** Rename. Omit to leave the name untouched. */
  name?: string
  /** Shallow-merged over the existing view `config`. Omit to leave the config untouched. */
  configPatch?: Record<string, unknown>
  /** Admins/owners may edit a shared org view they don't own. */
  isAdmin?: boolean
}

export type UpdateTableViewResult =
  | { ok: true; view: TableViewEntity }
  | { ok: false; reason: 'not_found' | 'duplicate_name' | 'table_mismatch' }

/**
 * Update a table view in place on the request-scoped `db`. Mirrors the
 * `@auxx/services` `updateView` permission + rename-collision rules but stays
 * in lib so kopilot tools persist on the same request connection (see
 * `createTableView`). Config is **merged**, not replaced — only the keys in
 * `configPatch` change, so UI-set column sizing/pinning/formatting survive.
 * Cache invalidation (`table-view.updated`) is the caller's responsibility.
 */
export async function updateTableView(input: UpdateTableViewInput): Promise<UpdateTableViewResult> {
  const {
    db,
    id,
    userId,
    organizationId,
    expectedTableId,
    name,
    configPatch,
    isAdmin = false,
  } = input

  const [existing] = await db
    .select()
    .from(schema.TableView)
    .where(and(eq(schema.TableView.id, id), eq(schema.TableView.organizationId, organizationId)))
    .limit(1)

  if (!existing) return { ok: false, reason: 'not_found' }
  if (expectedTableId !== undefined && existing.tableId !== expectedTableId) {
    return { ok: false, reason: 'table_mismatch' }
  }

  // Owner can edit own views; admins can also edit shared org views.
  const canEdit = existing.userId === userId || (isAdmin && existing.isShared)
  if (!canEdit) return { ok: false, reason: 'not_found' }

  // Rename collision guard — same unique scope as createTableView.
  if (name !== undefined && name !== existing.name) {
    const [dup] = await db
      .select({ id: schema.TableView.id })
      .from(schema.TableView)
      .where(
        and(
          eq(schema.TableView.tableId, existing.tableId),
          eq(schema.TableView.userId, existing.userId),
          eq(schema.TableView.name, name),
          eq(schema.TableView.contextType, existing.contextType),
          ne(schema.TableView.id, id)
        )
      )
      .limit(1)
    if (dup) return { ok: false, reason: 'duplicate_name' }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (name !== undefined) updates.name = name
  if (configPatch !== undefined) {
    updates.config = { ...(existing.config as Record<string, unknown>), ...configPatch }
  }

  const [row] = await db
    .update(schema.TableView)
    .set(updates)
    .where(eq(schema.TableView.id, id))
    .returning()

  return { ok: true, view: row as TableViewEntity }
}
