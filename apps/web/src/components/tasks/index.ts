// apps/web/src/components/tasks/index.ts

// UI Components
export {
  TasksPage,
  TasksSection,
  TasksList,
  TasksListHeader,
  TaskItem,
  TaskCheckbox,
  TaskDialog,
  TaskFilterBar,
  TaskSortSelect,
  TasksStatsCards,
  CreateTaskButton,
  type TaskStats,
} from './ui'

// Hooks
export { useTasks } from './hooks/use-tasks'
export { useTask } from './hooks/use-task'
export { useTaskMutations } from './hooks/use-task-mutations'

// Store
export { useTaskStore } from './stores/task-store'

// Utils
export { groupTasks, type TaskGroup, type TaskGroupVariant } from './utils/group-tasks'
export { formatTaskDeadline, formatTaskDeadlineDisplay } from './utils/group-tasks-by-period'
export { convertConditionsToFilterProps, type TaskFilterProps } from './utils/condition-to-props'

// Re-export config from @auxx/lib for convenience
// NOTE: Prefer importing directly from '@auxx/lib/tasks/client' for explicit dependency
export {
  TASK_FILTER_FIELDS,
  TASK_SORT_OPTIONS,
  type TaskSortConfig,
  type TaskSortField,
  type SortDirection,
} from '@auxx/lib/tasks/client'
