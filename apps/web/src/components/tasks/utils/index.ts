// apps/web/src/components/tasks/utils/index.ts

export {
  groupTasks,
  groupTasksByCompletion,
  type TaskGroup,
  type TaskGroupVariant,
  type TaskCompletionGroup,
} from './group-tasks'
export { formatTaskDeadline, formatTaskDeadlineDisplay } from './group-tasks-by-period'
export { convertConditionsToFilterProps, type TaskFilterProps } from './condition-to-props'
