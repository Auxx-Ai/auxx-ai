// packages/database/src/db/models/task-assignment.ts
// TaskAssignment model built on BaseModel (org-scoped)

import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { TaskAssignment } from '../schema/task-assignment'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected TaskAssignment entity type */
export type TaskAssignmentEntity = typeof TaskAssignment.$inferSelect
/** Insertable TaskAssignment input type */
export type CreateTaskAssignmentInput = typeof TaskAssignment.$inferInsert
/** Updatable TaskAssignment input type */
export type UpdateTaskAssignmentInput = Partial<CreateTaskAssignmentInput>

/**
 * TaskAssignmentModel encapsulates CRUD for the TaskAssignment table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TaskAssignmentModel extends BaseModel<
  typeof TaskAssignment,
  CreateTaskAssignmentInput,
  TaskAssignmentEntity,
  UpdateTaskAssignmentInput
> {
  /** Drizzle table */
  get table() {
    return TaskAssignment
  }

  /** Find assignments by task and user, optionally only active */
  async findByTaskAndUser(
    taskId: string,
    userId: string,
    opts: { onlyActive?: boolean } = {}
  ): Promise<TypedResult<TaskAssignmentEntity[], Error>> {
    try {
      const whereParts: SQL<unknown>[] = [
        eq(TaskAssignment.taskId, taskId as any),
        eq(TaskAssignment.assignedToUserId, userId as any),
      ]
      if (opts.onlyActive) {
        whereParts.push(isNull(TaskAssignment.unassignedAt))
      }
      let q = this.db.select().from(TaskAssignment).$dynamic()
      q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok(rows as TaskAssignmentEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Find all active assignments for a task */
  async findActiveByTask(taskId: string): Promise<TypedResult<TaskAssignmentEntity[], Error>> {
    try {
      const rows = await this.db
        .select()
        .from(TaskAssignment)
        .where(and(eq(TaskAssignment.taskId, taskId as any), isNull(TaskAssignment.unassignedAt)))
      return Result.ok(rows as TaskAssignmentEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
