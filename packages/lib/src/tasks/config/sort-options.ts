// packages/lib/src/tasks/config/sort-options.ts

/**
 * Available sort fields for tasks
 */
export type TaskSortField =
  | 'deadline'
  | 'createdAt'
  | 'assignee'
  | 'priority'
  | 'title'
  | 'completedAt'

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Sort configuration
 */
export interface TaskSortConfig {
  field: TaskSortField
  direction: SortDirection
}

/**
 * Sort field IDs for validation.
 */
export const TASK_SORT_FIELD_IDS = [
  'deadline',
  'createdAt',
  'assignee',
  'priority',
  'title',
  'completedAt',
] as const

/**
 * Sort option interface.
 */
export interface TaskSortOption {
  field: TaskSortField
  label: string
  icon: string
  defaultDirection: SortDirection
  /** Whether this sort affects grouping display */
  affectsGrouping: boolean
}

/**
 * Sort options for task list.
 * Shared between frontend (sort select) and backend (validation).
 */
export const TASK_SORT_OPTIONS: TaskSortOption[] = [
  {
    field: 'deadline',
    label: 'Due Date',
    icon: 'Calendar',
    defaultDirection: 'asc',
    affectsGrouping: true, // Groups: overdue, today, tomorrow, etc.
  },
  {
    field: 'createdAt',
    label: 'Created Date',
    icon: 'Clock',
    defaultDirection: 'desc',
    affectsGrouping: true, // Groups: today, yesterday, this week, etc.
  },
  {
    field: 'assignee',
    label: 'Assignee',
    icon: 'User',
    defaultDirection: 'asc',
    affectsGrouping: true, // Groups: by user name
  },
  {
    field: 'priority',
    label: 'Priority',
    icon: 'Flag',
    defaultDirection: 'desc',
    affectsGrouping: true, // Groups: high, medium, low, none
  },
  {
    field: 'title',
    label: 'Title',
    icon: 'Type',
    defaultDirection: 'asc',
    affectsGrouping: false, // Alphabetical, no grouping
  },
  {
    field: 'completedAt',
    label: 'Completed Date',
    icon: 'CheckCircle',
    defaultDirection: 'desc',
    affectsGrouping: true, // Groups: today, yesterday, this week, etc.
  },
]

/**
 * Default sort configurations per field
 */
export const DEFAULT_SORT_DIRECTIONS: Record<TaskSortField, SortDirection> = {
  deadline: 'asc', // Earliest due first
  createdAt: 'desc', // Newest first
  assignee: 'asc', // Alphabetical
  priority: 'desc', // High priority first
  title: 'asc', // Alphabetical
  completedAt: 'desc', // Most recently completed first
}

/**
 * Get a sort option by field.
 */
export function getTaskSortOption(field: TaskSortField): TaskSortOption | undefined {
  return TASK_SORT_OPTIONS.find((o) => o.field === field)
}

/**
 * Validate that a field is a valid sort field.
 */
export function isValidTaskSortField(field: string): field is TaskSortField {
  return TASK_SORT_FIELD_IDS.includes(field as TaskSortField)
}
