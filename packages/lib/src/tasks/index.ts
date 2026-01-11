// packages/lib/src/tasks/index.ts

export { TaskService, createTaskService } from './task-service'
export { DateLanguageModule, createDateLanguageModule } from './date-language-module'
export type {
  TaskPriority,
  EntityReference,
  CreateTaskInput,
  UpdateTaskInput,
  CompleteTaskInput,
  TaskFilterOptions,
  TaskGroup,
  GroupedTasksResponse,
  TaskWithRelations,
  TaskAssignmentWithUser,
  TaskReferenceWithEntity,
  TaskListResponse,
} from './types'

// Filter and sort config (also available from @auxx/lib/tasks/client)
export {
  TASK_FILTER_FIELDS,
  TASK_FILTER_FIELD_IDS,
  getTaskFilterField,
  isValidTaskFilterFieldId,
  TASK_SORT_OPTIONS,
  TASK_SORT_FIELD_IDS,
  DEFAULT_SORT_DIRECTIONS,
  getTaskSortOption,
  isValidTaskSortField,
  type TaskFilterFieldId,
  type TaskFilterFieldDefinition,
  type TaskSortOption,
  type TaskSortField,
  type SortDirection,
  type TaskSortConfig,
} from './config'

// Types moved to @auxx/types/task - import directly from there:
// import type { RelativeDate, AbsoluteDate, Deadline } from '@auxx/types/task'
