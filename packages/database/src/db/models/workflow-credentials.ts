// packages/database/src/db/models/workflow-credentials.ts
// WorkflowCredentials model built on BaseModel (org-scoped)

import { WorkflowCredentials } from '../schema/workflow-credentials'
import { BaseModel } from '../utils/base-model'

/** Selected WorkflowCredentials entity type */
export type WorkflowCredentialsEntity = typeof WorkflowCredentials.$inferSelect
/** Insertable WorkflowCredentials input type */
export type CreateWorkflowCredentialsInput = typeof WorkflowCredentials.$inferInsert
/** Updatable WorkflowCredentials input type */
export type UpdateWorkflowCredentialsInput = Partial<CreateWorkflowCredentialsInput>

/**
 * WorkflowCredentialsModel encapsulates CRUD for the WorkflowCredentials table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class WorkflowCredentialsModel extends BaseModel<
  typeof WorkflowCredentials,
  CreateWorkflowCredentialsInput,
  WorkflowCredentialsEntity,
  UpdateWorkflowCredentialsInput
> {
  /** Drizzle table */
  get table() {
    return WorkflowCredentials
  }
}
