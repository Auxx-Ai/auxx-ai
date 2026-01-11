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

export { DateLanguageModule } from './date-language-module'
export { TextDateParser, type DateParseResult, type TextDateParserOptions } from './text-date-parser'
export { type DatePattern } from './date-patterns'

// Task filter and sort config
export {
  TASK_FILTER_FIELDS,
  TASK_FILTER_FIELD_IDS,
  getTaskFilterField,
  isValidTaskFilterFieldId,
  type TaskFilterFieldId,
  type TaskFilterFieldDefinition,
} from './config/filter-fields'

export {
  TASK_SORT_OPTIONS,
  TASK_SORT_FIELD_IDS,
  DEFAULT_SORT_DIRECTIONS,
  getTaskSortOption,
  isValidTaskSortField,
  type TaskSortOption,
  type TaskSortField,
  type SortDirection,
  type TaskSortConfig,
} from './config/sort-options'
