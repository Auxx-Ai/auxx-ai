// packages/lib/src/tasks/types.ts

import type { TaskEntity, TaskAssignmentEntity, TaskReferenceEntity } from '@auxx/database'
import type { Deadline } from '@auxx/types/task'
import type { RecordId } from '@auxx/types/resource'

/**
 * Priority levels for tasks
 */
export type TaskPriority = 'low' | 'medium' | 'high'

// Date types (RelativeDate, AbsoluteDate, Deadline) are in @auxx/types/task
// Import directly: import type { RelativeDate, AbsoluteDate, Deadline } from '@auxx/types/task'

/**
 * Entity reference for linking tasks to entity instances.
 * @deprecated Use RecordId from @auxx/types/resource instead
 */
export type EntityReference = RecordId

/**
 * Input for creating a new task
 */
export interface CreateTaskInput {
  title: string
  description?: string
  deadline?: Deadline
  priority?: TaskPriority
  assignedUserIds?: string[]
  referencedEntities?: EntityReference[]
}

/**
 * Input for updating an existing task.
 *
 * Supports partial updates - only defined fields are updated.
 * Use `null` to explicitly clear a field.
 *
 * @example Complete a task:
 * { id: 'task-1', completedAt: new Date(), completedById: 'user-1' }
 *
 * @example Reopen a task:
 * { id: 'task-1', completedAt: null, completedById: null }
 *
 * @example Archive a task:
 * { id: 'task-1', archivedAt: new Date() }
 *
 * @example Update multiple fields:
 * { id: 'task-1', title: 'New title', priority: 'high' }
 */
export interface UpdateTaskInput {
  /** Task ID (required) */
  id: string

  // Core fields
  title?: string
  description?: string | null
  deadline?: Deadline | null
  priority?: TaskPriority | null

  // Completion fields
  completedAt?: Date | string | null
  completedById?: string | null

  // Archive field
  archivedAt?: Date | string | null

  // Relation fields (full replacement)
  assignedUserIds?: string[]
  referencedEntities?: EntityReference[]
}


/**
 * Filter options for listing tasks
 */
export interface TaskFilterOptions {
  organizationId: string
  userId?: string
  assigneeIds?: string[]
  createdById?: string
  priority?: TaskPriority[]
  recordId?: RecordId
  search?: string
  includeCompleted?: boolean
  includeArchived?: boolean
  deadlineFrom?: Date
  deadlineTo?: Date
  cursor?: string
  limit?: number
}

/**
 * Grouping options for task lists
 */
export type TaskGroup = 'today' | 'thisWeek' | 'upcoming' | 'overdue' | 'completed' | 'all'

/**
 * Grouped task response
 */
export interface GroupedTasksResponse {
  today: TaskWithRelations[]
  thisWeek: TaskWithRelations[]
  upcoming: TaskWithRelations[]
  overdue: TaskWithRelations[]
  completed: TaskWithRelations[]
}

/**
 * Task with its related assignments and references
 */
export interface TaskWithRelations extends TaskEntity {
  assignments: TaskAssignmentWithUser[]
  references: RecordId[]
}

/**
 * Task assignment with user information
 */
export interface TaskAssignmentWithUser extends TaskAssignmentEntity {
  assignedTo: {
    id: string
    name: string | null
    email: string
    image: string | null
  }
}

/**
 * Task reference with entity instance information
 */
export interface TaskReferenceWithEntity extends TaskReferenceEntity {
  entityInstance: {
    id: string
    displayName: string | null
    entityDefinitionId: string
  }
  entityDefinition: {
    id: string
    name: string
    slug: string
  }
}

/**
 * Paginated task list response
 */
export interface TaskListResponse {
  tasks: TaskWithRelations[]
  nextCursor?: string
  hasMore: boolean
  total: number
}
