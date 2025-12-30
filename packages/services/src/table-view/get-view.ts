// packages/services/src/table-view/get-view.ts

import { database, schema } from '@auxx/database'
import { and, eq, or } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TableViewEntity } from '@auxx/database/models'
import type { ViewNotFoundError } from './errors'

/**
 * Options for getting a view
 */
export interface GetViewOptions {
  /** Only return views owned by this user (stricter than access check) */
  ownerOnly?: boolean
  /** Custom error message */
  notFoundMessage?: string
}

/**
 * Input for getting a single view
 */
export interface GetViewInput {
  id: string
  userId: string
  organizationId: string
  options?: GetViewOptions
}

/**
 * Get a single view by ID
 * - Default: user can access own views OR shared org views
 * - ownerOnly: user must own the view
 */
export async function getView(input: GetViewInput) {
  const { id, userId, organizationId, options = {} } = input
  const { ownerOnly = false, notFoundMessage = 'View not found' } = options

  // Build where clause based on access level
  const whereClause = ownerOnly
    ? and(eq(schema.TableView.id, id), eq(schema.TableView.userId, userId))
    : and(
        eq(schema.TableView.id, id),
        or(
          eq(schema.TableView.userId, userId),
          and(
            eq(schema.TableView.organizationId, organizationId),
            eq(schema.TableView.isShared, true)
          )
        )
      )

  const dbResult = await fromDatabase(
    database.select().from(schema.TableView).where(whereClause).limit(1),
    'get-view'
  )

  if (dbResult.isErr()) return dbResult

  const view = dbResult.value[0]
  if (!view) {
    return err<ViewNotFoundError>({
      code: 'VIEW_NOT_FOUND',
      message: notFoundMessage,
      viewId: id,
    })
  }

  return ok(view as TableViewEntity)
}
