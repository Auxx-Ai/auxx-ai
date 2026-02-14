// packages/lib/src/tasks/index.ts

// Filter and sort config (also available from @auxx/lib/tasks/client)
export {
  DEFAULT_SORT_DIRECTIONS,
  getTaskFilterField,
  getTaskSortOption,
  isValidTaskFilterFieldId,
  isValidTaskSortField,
  type SortDirection,
  TASK_FILTER_FIELD_IDS,
  TASK_FILTER_FIELDS,
  TASK_SORT_FIELD_IDS,
  TASK_SORT_OPTIONS,
  type TaskFilterFieldDefinition,
  type TaskFilterFieldId,
  type TaskSortConfig,
  type TaskSortField,
  type TaskSortOption,
} from './config'
export { DateLanguageModule } from './date-language-module'
export { createTaskService, TaskService } from './task-service'
export type {
  CreateTaskInput,
  EntityReference,
  GroupedTasksResponse,
  TaskFilterOptions,
  TaskGroup,
  TaskListResponse,
  TaskPriority,
  TaskReferenceWithEntity,
  TaskWithRelations,
  UpdateTaskInput,
} from './types'

// Types moved to @auxx/types/task - import directly from there:
// import type { RelativeDate, AbsoluteDate, Deadline } from '@auxx/types/task'
