// packages/lib/src/table-views/create-table-view.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'

type ViewContextType = 'table' | 'kanban' | 'panel' | 'dialog_create' | 'dialog_edit'

export interface CreateTableViewInput {
  db: Database
  tableId: string
  name: string
  config: Record<string, unknown>
  userId: string
  organizationId: string
  isShared?: boolean
  contextType?: ViewContextType
}

export type CreateTableViewResult =
  | { ok: true; view: TableViewEntity }
  | { ok: false; reason: 'duplicate_name' }

/**
 * Insert a personal/shared table view. Mirrors the duplicate-name guard the
 * `@auxx/services` createView uses (unique per `tableId + userId + name +
 * contextType`) but stays in lib on the request-scoped `db` so kopilot tools
 * can persist without crossing into the legacy services layer. Cache
 * invalidation (`table-view.created`) is the caller's responsibility.
 */
export async function createTableView(input: CreateTableViewInput): Promise<CreateTableViewResult> {
  const {
    db,
    tableId,
    name,
    config,
    userId,
    organizationId,
    isShared = false,
    contextType = 'table',
  } = input

  const existing = await db
    .select({ id: schema.TableView.id })
    .from(schema.TableView)
    .where(
      and(
        eq(schema.TableView.tableId, tableId),
        eq(schema.TableView.userId, userId),
        eq(schema.TableView.name, name),
        eq(schema.TableView.contextType, contextType)
      )
    )
    .limit(1)

  if (existing.length > 0) return { ok: false, reason: 'duplicate_name' }

  const [row] = await db
    .insert(schema.TableView)
    .values({
      tableId,
      name,
      config,
      isShared,
      isDefault: false,
      userId,
      organizationId,
      contextType,
      updatedAt: new Date(),
    })
    .returning()

  return { ok: true, view: row as TableViewEntity }
}
