// packages/database/src/db/models/table-view.ts
// TableView model built on BaseModel (org-scoped)

import { TableView } from '../schema/table-view'
import { BaseModel } from '../utils/base-model'

/** Selected TableView entity type */
export type TableViewEntity = typeof TableView.$inferSelect
/** Insertable TableView input type */
export type CreateTableViewInput = typeof TableView.$inferInsert
/** Updatable TableView input type */
export type UpdateTableViewInput = Partial<CreateTableViewInput>

/**
 * TableViewModel encapsulates CRUD for the TableView table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TableViewModel extends BaseModel<
  typeof TableView,
  CreateTableViewInput,
  TableViewEntity,
  UpdateTableViewInput
> {
  /** Drizzle table */
  get table() {
    return TableView
  }
}
