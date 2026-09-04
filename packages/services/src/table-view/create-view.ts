// packages/services/src/table-view/create-view.ts

import { database, schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ViewAlreadyExistsError } from './errors'

/**
 * View context type for table views.
 *
 * A local copy of `@auxx/lib/conditions`'s `viewContextTypes`, because
 * `@auxx/services` sits below `@auxx/lib` in the dependency tiers and cannot
 * import it. Keep the two in step: `drawer` and `detail` hold record layout
 * deltas (plans/drawer/record-layout-system.md §5).
 */
type ViewContextType =
  | 'table'
  | 'kanban'
  | 'panel'
  | 'dialog_create'
  | 'dialog_edit'
  | 'drawer'
  | 'detail'

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
  /**
   * Canonical `EntityDefinition.id` this view belongs to, or null for non-entity
   * surfaces. Resolved from `tableId` by the router. Persisted for the def-admin
   * gate; the typed replacement for parsing the def out of `tableId`.
   */
  entityDefinitionId?: string | null
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
    entityDefinitionId = null,
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
    // `err<T, E>` — the FIRST slot is the ok-value type; see get-view.ts.
    return err<never, ViewAlreadyExistsError>({
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
        entityDefinitionId,
        updatedAt: new Date(),
      })
      .returning(),
    'create-view'
  )

  if (dbResult.isErr()) return dbResult
  return ok(dbResult.value[0] as TableViewEntity)
}
