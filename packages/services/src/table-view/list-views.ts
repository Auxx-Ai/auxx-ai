// packages/services/src/table-view/list-views.ts

import { database, schema } from '@auxx/database'
import { and, eq, or, desc, asc } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TableViewEntity } from '@auxx/database/models'

/**
 * Input for listing views
 */
export interface ListViewsInput {
  tableId: string
  userId: string
  organizationId: string
}

/**
 * List all views for a table (user's personal + org shared)
 */
export async function listViews(input: ListViewsInput) {
  const { tableId, userId, organizationId } = input

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.TableView)
      .where(
        and(
          eq(schema.TableView.tableId, tableId),
          or(
            eq(schema.TableView.userId, userId),
            and(eq(schema.TableView.organizationId, organizationId), eq(schema.TableView.isShared, true))
          )
        )
      )
      .orderBy(desc(schema.TableView.isDefault), asc(schema.TableView.name)),
    'list-views'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value as TableViewEntity[])
}
