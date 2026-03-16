// packages/lib/src/table-views/table-view-queries.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq, inArray, or } from 'drizzle-orm'
import type { CachedTableView } from '../cache/user-cache-keys'

/**
 * Compute all table views accessible to a user in an org.
 * Returns user's personal views + org shared views, dehydrated for cache.
 * Used by the cache provider — no cache references here.
 */
export async function computeUserTableViews(
  userId: string,
  organizationId: string,
  db: Database
): Promise<CachedTableView[]> {
  const rows = await db
    .select()
    .from(schema.TableView)
    .where(
      and(
        or(
          eq(schema.TableView.userId, userId),
          and(
            eq(schema.TableView.organizationId, organizationId),
            eq(schema.TableView.isShared, true)
          )
        ),
        inArray(schema.TableView.contextType, [
          'table',
          'kanban',
          'panel',
          'dialog_create',
          'dialog_edit',
        ])
      )
    )
    .orderBy(asc(schema.TableView.tableId), asc(schema.TableView.name))

  return rows.map((v) => ({
    id: v.id,
    tableId: v.tableId,
    name: v.name,
    config: v.config as Record<string, unknown>,
    contextType: v.contextType,
    isDefault: v.isDefault,
    isShared: v.isShared,
    userId: v.userId,
    organizationId: v.organizationId,
    createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
    updatedAt: v.updatedAt instanceof Date ? v.updatedAt.toISOString() : String(v.updatedAt),
  }))
}
