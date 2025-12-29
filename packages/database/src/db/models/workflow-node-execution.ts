// packages/database/src/db/models/workflow-node-execution.ts
// WorkflowNodeExecution model built on BaseModel (org-scoped)

import { WorkflowNodeExecution } from '../schema/workflow-node-execution'
import { BaseModel } from '../utils/base-model'

/** Selected WorkflowNodeExecution entity type */
export type WorkflowNodeExecutionEntity = typeof WorkflowNodeExecution.$inferSelect
/** Insertable WorkflowNodeExecution input type */
export type CreateWorkflowNodeExecutionInput = typeof WorkflowNodeExecution.$inferInsert
/** Updatable WorkflowNodeExecution input type */
export type UpdateWorkflowNodeExecutionInput = Partial<CreateWorkflowNodeExecutionInput>

/**
 * WorkflowNodeExecutionModel encapsulates CRUD for the WorkflowNodeExecution table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class WorkflowNodeExecutionModel extends BaseModel<
  typeof WorkflowNodeExecution,
  CreateWorkflowNodeExecutionInput,
  WorkflowNodeExecutionEntity,
  UpdateWorkflowNodeExecutionInput
> {
  /** Drizzle table */
  get table() {
    return WorkflowNodeExecution
  }
}
