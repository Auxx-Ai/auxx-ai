// packages/database/src/db/models/workflow-run.ts
// WorkflowRun model built on BaseModel (org-scoped)

import { WorkflowRun } from '../schema/workflow-run'
import { BaseModel } from '../utils/base-model'

/** Selected WorkflowRun entity type */
export type WorkflowRunEntity = typeof WorkflowRun.$inferSelect
/** Insertable WorkflowRun input type */
export type CreateWorkflowRunInput = typeof WorkflowRun.$inferInsert
/** Updatable WorkflowRun input type */
export type UpdateWorkflowRunInput = Partial<CreateWorkflowRunInput>

/**
 * WorkflowRunModel encapsulates CRUD for the WorkflowRun table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class WorkflowRunModel extends BaseModel<
  typeof WorkflowRun,
  CreateWorkflowRunInput,
  WorkflowRunEntity,
  UpdateWorkflowRunInput
> {
  /** Drizzle table */
  get table() {
    return WorkflowRun
  }
}
