// packages/database/src/db/models/workflow-join-state.ts
// WorkflowJoinState model built on BaseModel (no org scope column)

import { WorkflowJoinState } from '../schema/workflow-join-state'
import { BaseModel } from '../utils/base-model'

/** Selected WorkflowJoinState entity type */
export type WorkflowJoinStateEntity = typeof WorkflowJoinState.$inferSelect
/** Insertable WorkflowJoinState input type */
export type CreateWorkflowJoinStateInput = typeof WorkflowJoinState.$inferInsert
/** Updatable WorkflowJoinState input type */
export type UpdateWorkflowJoinStateInput = Partial<CreateWorkflowJoinStateInput>

/**
 * WorkflowJoinStateModel encapsulates CRUD for the WorkflowJoinState table.
 * No org scoping is applied by default.
 */
export class WorkflowJoinStateModel extends BaseModel<
  typeof WorkflowJoinState,
  CreateWorkflowJoinStateInput,
  WorkflowJoinStateEntity,
  UpdateWorkflowJoinStateInput
> {
  /** Drizzle table */
  get table() {
    return WorkflowJoinState
  }
}
