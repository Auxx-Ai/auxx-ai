// packages/lib/src/ai/kopilot/task-notifications/index.ts

export { buildTaskNotificationBody, type TaskNotificationBodyInput } from './body'
export { EVAL_SUITE_TASK_KIND, evalSuiteTaskNotificationHandler } from './kinds/eval-suite'
export { getTaskNotificationHandler, listTaskNotificationKinds } from './registry'
export type {
  TaskNotificationKindHandler,
  TaskNotificationRef,
  TaskNotificationSummary,
  TaskSnapshot,
} from './types'
