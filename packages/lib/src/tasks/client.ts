// packages/lib/src/tasks/client.ts

/**
 * Client-side exports for task functionality
 *
 * Usage:
 * import { DateLanguageModule } from '@auxx/lib/tasks/client'
 * import { TASK_FILTER_FIELDS, TASK_SORT_OPTIONS } from '@auxx/lib/tasks/client'
 *
 * For types, import directly from @auxx/types/task:
 * import type { RelativeDate, PredefinedDateOption } from '@auxx/types/task'
 * import { PREDEFINED_DATE_OPTIONS, findPredefinedOption } from '@auxx/types/task'
 *
 * For utility functions, import directly from @auxx/utils:
 * import { formatRelativeDate, formatTimeRemaining } from '@auxx/utils'
 */

// Task filter and sort config
export {
  getTaskFilterField,
  isValidTaskFilterFieldId,
  TASK_FILTER_FIELD_IDS,
  TASK_FILTER_FIELDS,
  type TaskFilterFieldDefinition,
  type TaskFilterFieldId,
} from './config/filter-fields'
export {
  DEFAULT_SORT_DIRECTIONS,
  getTaskSortOption,
  isValidTaskSortField,
  type SortDirection,
  TASK_SORT_FIELD_IDS,
  TASK_SORT_OPTIONS,
  type TaskSortConfig,
  type TaskSortField,
  type TaskSortOption,
} from './config/sort-options'
export { DateLanguageModule } from './date-language-module'
export type { DatePattern } from './date-patterns'
export {
  type DateParseResult,
  TextDateParser,
  type TextDateParserOptions,
} from './text-date-parser'
