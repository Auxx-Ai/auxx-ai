// packages/database/src/db/models/labels-on-thread.ts
// LabelsOnThread pivot model built on BaseModel (no org scope column; composite key)

import { LabelsOnThread } from '../schema/labels-on-thread'
import { BaseModel } from '../utils/base-model'

/** Selected LabelsOnThread row type */
export type LabelsOnThreadEntity = typeof LabelsOnThread.$inferSelect
/** Insertable LabelsOnThread input type */
export type CreateLabelsOnThreadInput = typeof LabelsOnThread.$inferInsert
/** Updatable LabelsOnThread input type */
export type UpdateLabelsOnThreadInput = Partial<CreateLabelsOnThreadInput>

/**
 * LabelsOnThreadModel encapsulates CRUD for the LabelsOnThread pivot table.
 * Note: This table has a composite primary key and no id column.
 * BaseModel id-based helpers (findById/update/delete) will throw for this model.
 */
export class LabelsOnThreadModel extends BaseModel<
  typeof LabelsOnThread,
  CreateLabelsOnThreadInput,
  LabelsOnThreadEntity,
  UpdateLabelsOnThreadInput
> {
  get table() {
    return LabelsOnThread
  }
}
