// packages/services/src/table-view/create-view.ts

import { database, schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/models'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ViewAlreadyExistsError } from './errors'

/** View context type for table views */
type ViewContextType = 'table' | 'kanban' | 'panel' | 'dialog_create' | 'dialog_edit'

/**
 * Input for creating a view
 */
export interface CreateViewInput {
  tableId: string
  name: string
  config: Record<string, unknown>
  isShared: boolean
  userId: string
  organizationId: string
  /** Context type for the view. Defaults to 'table'. */
  contextType?: ViewContextType
  /** Whether this is the default view for this context. Defaults to false. */
  isDefault?: boolean
}

/**
 * Create a new view
 */
export async function createView(input: CreateViewInput) {
  const {
    tableId,
    name,
    config,
    isShared,
    userId,
    organizationId,
    contextType = 'table',
    isDefault = false,
  } = input

  // Check for duplicate name within same context type
  const existingResult = await fromDatabase(
    database
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
      .limit(1),
    'check-view-exists'
  )

  if (existingResult.isErr()) return existingResult
  if (existingResult.value.length > 0) {
    return err<ViewAlreadyExistsError>({
      code: 'VIEW_ALREADY_EXISTS',
      message: 'A view with this name already exists',
      name,
    })
  }

  const dbResult = await fromDatabase(
    database
      .insert(schema.TableView)
      .values({
        tableId,
        name,
        config,
        isShared,
        isDefault,
        userId,
        organizationId,
        contextType,
        updatedAt: new Date(),
      })
      .returning(),
    'create-view'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value[0] as TableViewEntity)
}
