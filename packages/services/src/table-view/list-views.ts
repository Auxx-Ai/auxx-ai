// packages/services/src/table-view/list-views.ts

import { database, schema } from '@auxx/database'
import { and, eq, or, desc, asc, inArray } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TableViewEntity } from '@auxx/database/models'
import type { ViewContextType } from '@auxx/lib/conditions'

/** Context types shown in table view selectors (excludes panel/dialog) */
const TABLE_CONTEXT_TYPES: ViewContextType[] = ['table', 'kanban']

/**
 * Input for listing views
 */
export interface ListViewsInput {
  tableId: string
  userId: string
  organizationId: string
  /** Filter by context type(s). Defaults to ['table', 'kanban'] to exclude field views. */
  contextType?: ViewContextType | ViewContextType[]
}

/**
 * Input for listing all views in an organization
 */
export interface ListAllViewsInput {
  userId: string
  organizationId: string
  /** Filter by context type(s). Defaults to ['table', 'kanban'] to exclude field views. */
  contextType?: ViewContextType | ViewContextType[]
}

/**
 * List all views for a table (user's personal + org shared)
 */
export async function listViews(input: ListViewsInput) {
  const { tableId, userId, organizationId, contextType = TABLE_CONTEXT_TYPES } = input

  // Normalize to array
  const contextTypes = Array.isArray(contextType) ? contextType : [contextType]

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
          ),
          // Filter by context type(s) - defaults to table/kanban
          inArray(schema.TableView.contextType, contextTypes)
        )
      )
      .orderBy(desc(schema.TableView.isDefault), asc(schema.TableView.name)),
    'list-views'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value as TableViewEntity[])
}

/**
 * List all views across all tables for an organization (for app-wide store init)
 * Returns user's personal views + all shared views in the org
 */
export async function listAllViews(input: ListAllViewsInput) {
  const { userId, organizationId, contextType = TABLE_CONTEXT_TYPES } = input

  // Normalize to array
  const contextTypes = Array.isArray(contextType) ? contextType : [contextType]

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.TableView)
      .where(
        and(
          or(
            eq(schema.TableView.userId, userId),
            and(eq(schema.TableView.organizationId, organizationId), eq(schema.TableView.isShared, true))
          ),
          inArray(schema.TableView.contextType, contextTypes)
        )
      )
      .orderBy(asc(schema.TableView.tableId), asc(schema.TableView.name)),
    'list-all-views'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value as TableViewEntity[])
}
