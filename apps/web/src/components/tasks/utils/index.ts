// apps/web/src/components/tasks/utils/index.ts

export { convertConditionsToFilterProps, type TaskFilterProps } from './condition-to-props'
export {
  groupTasks,
  groupTasksByCompletion,
  type TaskCompletionGroup,
  type TaskGroup,
  type TaskGroupVariant,
} from './group-tasks'
export { formatTaskDeadline, formatTaskDeadlineDisplay } from './group-tasks-by-period'
