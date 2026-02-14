// packages/database/src/db/models/workflow-app.ts
// WorkflowApp model built on BaseModel (org-scoped)

import { and, eq, type SQL } from 'drizzle-orm'
import { Workflow } from '../schema/workflow'
import { WorkflowApp } from '../schema/workflow-app'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected WorkflowApp entity type */
export type WorkflowAppEntity = typeof WorkflowApp.$inferSelect
/** Insertable WorkflowApp input type */
export type CreateWorkflowAppInput = typeof WorkflowApp.$inferInsert
/** Updatable WorkflowApp input type */
export type UpdateWorkflowAppInput = Partial<CreateWorkflowAppInput>

/**
 * WorkflowAppModel encapsulates CRUD for the WorkflowApp table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class WorkflowAppModel extends BaseModel<
  typeof WorkflowApp,
  CreateWorkflowAppInput,
  WorkflowAppEntity,
  UpdateWorkflowAppInput
> {
  /** Drizzle table */
  get table() {
    return WorkflowApp
  }

  /** Find a workflow app by id with its draftWorkflow joined (if any) */
  async findWithDraftById(
    id: string
  ): Promise<
    TypedResult<
      { app: WorkflowAppEntity; draftWorkflow: typeof Workflow.$inferSelect | null },
      Error
    >
  > {
    try {
      this.requireOrgIfScoped()
      const whereParts: SQL<unknown>[] = [eq(WorkflowApp.id, id)]
      if (this.scopeFilter) whereParts.unshift(this.scopeFilter)

      let q = this.db
        .select({
          app: WorkflowApp,
          draft: Workflow,
        })
        .from(WorkflowApp)
        .leftJoin(Workflow, eq(Workflow.id, WorkflowApp.draftWorkflowId))
        .$dynamic()
      if (whereParts.length === 1) q = q.where(whereParts[0])
      else q = q.where(and(...whereParts))
      q = q.limit(1)
      const rows = (await q) as any[]
      const row = rows?.[0]
      if (!row) return Result.ok({ app: undefined as any, draftWorkflow: null })
      return Result.ok({
        app: row.app as WorkflowAppEntity,
        draftWorkflow: (row.draft as any) ?? null,
      })
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
