// packages/database/src/db/models/workflow-file.ts
// WorkflowFile model built on BaseModel (no org scope column)

import { WorkflowFile } from '../schema/workflow-file'
import { BaseModel } from '../utils/base-model'

/** Selected WorkflowFile entity type */
export type WorkflowFileEntity = typeof WorkflowFile.$inferSelect
/** Insertable WorkflowFile input type */
export type CreateWorkflowFileInput = typeof WorkflowFile.$inferInsert
/** Updatable WorkflowFile input type */
export type UpdateWorkflowFileInput = Partial<CreateWorkflowFileInput>

/**
 * WorkflowFileModel encapsulates CRUD for the WorkflowFile table.
 * No org scoping is applied by default.
 */
export class WorkflowFileModel extends BaseModel<
  typeof WorkflowFile,
  CreateWorkflowFileInput,
  WorkflowFileEntity,
  UpdateWorkflowFileInput
> {
  /** Drizzle table */
  get table() {
    return WorkflowFile
  }
}
