// apps/web/src/components/tasks/utils/condition-to-props.ts

import type { TaskPriority } from '@auxx/lib/tasks'
import type { Condition } from '~/components/conditions'

/**
 * Task filter props that useTasks hook accepts
 */
export interface TaskFilterProps {
  assigneeIds?: string[]
  priority?: TaskPriority[]
  search?: string
  includeCompleted?: boolean
}

/**
 * Convert Condition[] to individual filter props for useTasks.
 * This is a temporary bridge until the API supports Condition[] directly.
 */
export function convertConditionsToFilterProps(conditions: Condition[]): TaskFilterProps {
  const result: TaskFilterProps = {}

  for (const condition of conditions) {
    switch (condition.fieldId) {
      case 'assignee':
        if (condition.operator === 'in' && Array.isArray(condition.value)) {
          result.assigneeIds = condition.value as string[]
        }
        break
      case 'priority':
        if (condition.operator === 'in' && Array.isArray(condition.value)) {
          result.priority = condition.value as TaskPriority[]
        } else if (condition.operator === 'equals' && condition.value) {
          result.priority = [condition.value as TaskPriority]
        }
        break
      case 'status':
        if (condition.value === 'completed') {
          result.includeCompleted = true
        }
        break
    }
  }

  return result
}
