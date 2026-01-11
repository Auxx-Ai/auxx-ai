// packages/database/src/db/models/task-reference.ts
// TaskReference model built on BaseModel (org-scoped)

import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { TaskReference } from '../schema/task-reference'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected TaskReference entity type */
export type TaskReferenceEntity = typeof TaskReference.$inferSelect
/** Insertable TaskReference input type */
export type CreateTaskReferenceInput = typeof TaskReference.$inferInsert
/** Updatable TaskReference input type */
export type UpdateTaskReferenceInput = Partial<CreateTaskReferenceInput>

/**
 * TaskReferenceModel encapsulates CRUD for the TaskReference table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TaskReferenceModel extends BaseModel<
  typeof TaskReference,
  CreateTaskReferenceInput,
  TaskReferenceEntity,
  UpdateTaskReferenceInput
> {
  /** Drizzle table */
  get table() {
    return TaskReference
  }

  /** Find references by task and entity instance, optionally only active */
  async findByTaskAndEntity(
    taskId: string,
    entityInstanceId: string,
    opts: { onlyActive?: boolean } = {}
  ): Promise<TypedResult<TaskReferenceEntity[], Error>> {
    try {
      const whereParts: SQL<unknown>[] = [
        eq(TaskReference.taskId, taskId as any),
        eq(TaskReference.referencedEntityInstanceId, entityInstanceId as any),
      ]
      if (opts.onlyActive) {
        whereParts.push(isNull(TaskReference.deletedAt))
      }
      let q = this.db.select().from(TaskReference).$dynamic()
      q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok(rows as TaskReferenceEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Find all active references for a task */
  async findActiveByTask(taskId: string): Promise<TypedResult<TaskReferenceEntity[], Error>> {
    try {
      const rows = await this.db
        .select()
        .from(TaskReference)
        .where(and(eq(TaskReference.taskId, taskId as any), isNull(TaskReference.deletedAt)))
      return Result.ok(rows as TaskReferenceEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Find all tasks referencing a specific entity instance */
  async findByEntityInstance(
    entityInstanceId: string
  ): Promise<TypedResult<TaskReferenceEntity[], Error>> {
    try {
      const rows = await this.db
        .select()
        .from(TaskReference)
        .where(
          and(
            eq(TaskReference.referencedEntityInstanceId, entityInstanceId as any),
            isNull(TaskReference.deletedAt)
          )
        )
      return Result.ok(rows as TaskReferenceEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
