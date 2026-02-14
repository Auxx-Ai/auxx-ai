// packages/database/src/db/models/task.ts
// Task model built on BaseModel (org-scoped)

import { Task } from '../schema/task'
import { BaseModel } from '../utils/base-model'

/** Selected Task entity type */
export type TaskEntity = typeof Task.$inferSelect
/** Insertable Task input type */
export type CreateTaskInput = typeof Task.$inferInsert
/** Updatable Task input type */
export type UpdateTaskInput = Partial<CreateTaskInput>

/**
 * TaskModel encapsulates CRUD for the Task table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TaskModel extends BaseModel<
  typeof Task,
  CreateTaskInput,
  TaskEntity,
  UpdateTaskInput
> {
  /** Drizzle table */
  get table() {
    return Task
  }
}
