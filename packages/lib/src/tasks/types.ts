// packages/lib/src/tasks/types.ts

import type { TaskEntity, TaskAssignmentEntity, TaskReferenceEntity } from '@auxx/database'
import type { Deadline } from '@auxx/types/task'

/**
 * Priority levels for tasks
 */
export type TaskPriority = 'low' | 'medium' | 'high'

// Date types (RelativeDate, AbsoluteDate, Deadline) are in @auxx/types/task
// Import directly: import type { RelativeDate, AbsoluteDate, Deadline } from '@auxx/types/task'

/**
 * Entity reference for linking tasks to entity instances
 */
export interface EntityReference {
  entityInstanceId: string
  entityDefinitionId: string
}

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
 * Input for updating an existing task
 */
export interface UpdateTaskInput {
  id: string
  title?: string
  description?: string
  deadline?: Deadline | null
  priority?: TaskPriority | null
  assignedUserIds?: string[]
  referencedEntities?: EntityReference[]
}

/**
 * Input for completing a task
 */
export interface CompleteTaskInput {
  taskId: string
  completionNotes?: string
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
  entityInstanceId?: string
  entityDefinitionId?: string
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
  references: TaskReferenceWithEntity[]
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
