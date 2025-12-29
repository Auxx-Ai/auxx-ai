// packages/database/src/db/models/workflow.ts
// Workflow model built on BaseModel (org-scoped)

import { Workflow } from '../schema/workflow'
import { BaseModel } from '../utils/base-model'

/** Selected Workflow entity type */
export type WorkflowEntity = typeof Workflow.$inferSelect
/** Insertable Workflow input type */
export type CreateWorkflowInput = typeof Workflow.$inferInsert
/** Updatable Workflow input type */
export type UpdateWorkflowInput = Partial<CreateWorkflowInput>

/**
 * WorkflowModel encapsulates CRUD for the Workflow table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class WorkflowModel extends BaseModel<
  typeof Workflow,
  CreateWorkflowInput,
  WorkflowEntity,
  UpdateWorkflowInput
> {
  /** Drizzle table */
  get table() {
    return Workflow
  }
}
