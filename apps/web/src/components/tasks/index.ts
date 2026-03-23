// apps/web/src/components/tasks/index.ts

// Re-export config from @auxx/lib for convenience
// NOTE: Prefer importing directly from '@auxx/lib/tasks/client' for explicit dependency
export {
  type SortDirection,
  TASK_FILTER_FIELDS,
  TASK_SORT_OPTIONS,
  type TaskSortConfig,
  type TaskSortField,
} from '@auxx/lib/tasks/client'
export { useTask } from './hooks/use-task'
export { useTaskMutations } from './hooks/use-task-mutations'
// Hooks
export { useTasks } from './hooks/use-tasks'

// Store
export { useCreateTaskStore } from './stores/create-task-store'
export { useTaskStore } from './stores/task-store'
// UI Components
export {
  CreateTaskButton,
  FloatingTaskRoot,
  TaskCheckbox,
  TaskDialog,
  TaskFilterBar,
  TaskItem,
  TaskSortSelect,
  type TaskStats,
  TasksList,
  TasksListHeader,
  TasksPage,
  TasksSection,
  TasksStatsCards,
} from './ui'
export { convertConditionsToFilterProps, type TaskFilterProps } from './utils/condition-to-props'
// Utils
export { groupTasks, type TaskGroup, type TaskGroupVariant } from './utils/group-tasks'
export { formatTaskDeadline, formatTaskDeadlineDisplay } from './utils/group-tasks-by-period'
