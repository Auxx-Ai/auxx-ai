// packages/services/src/field-view/get-org-field-view.ts

import { database, schema } from '@auxx/database'
import type { TableViewEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/** View context type for table views */
type ViewContextType = 'table' | 'kanban' | 'panel' | 'dialog_create' | 'dialog_edit'

/** Field view configuration for panel and dialog views */
type FieldViewConfig = {
  fieldVisibility: Record<string, boolean>
  fieldOrder: string[]
  collapsedSections?: string[]
  fieldLabels?: Record<string, string>
  showLabels?: boolean
}

/**
 * Input for getting an organization's default field view
 */
export interface GetOrgFieldViewInput {
  entityDefinitionId: string
  contextType: ViewContextType
  organizationId: string
}

/**
 * Get the organization's default field view for an entity and context type.
 * Returns null if no view exists (caller should use default field list).
 */
export async function getOrgFieldView(input: GetOrgFieldViewInput) {
  const { entityDefinitionId, contextType, organizationId } = input

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.TableView)
      .where(
        and(
          eq(schema.TableView.tableId, entityDefinitionId),
          eq(schema.TableView.contextType, contextType),
          eq(schema.TableView.organizationId, organizationId),
          eq(schema.TableView.isShared, true),
          eq(schema.TableView.isDefault, true)
        )
      )
      .limit(1),
    'get-org-field-view'
  )

  if (dbResult.isErr()) return dbResult

  if (dbResult.value.length === 0) {
    return ok({ view: null, config: null })
  }

  const view = dbResult.value[0] as TableViewEntity
  return ok({ view, config: view.config as FieldViewConfig })
}
